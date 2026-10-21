/**
 * FlirtTime Chat Service
 * Production-ready business logic for Chat List, Conversation Details, Message History, and Real-Time Delivery.
 */

import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  ConversationPin,
  ChatMessagePin,
  UserBlock,
  Interest,
  ConversationUserState,
} from '../models';
import { ChatMessageType } from '../models/chatMessage.model';
import { s3Service, formatMediaUrl } from './s3.service';
import { calculateAge, calculateDistanceKm, resolveDisplayName } from './discovery.service';
import { isUserConnected, getUserRoomName } from '../realtime/socket.lifecycle';
import { getSocketServer } from '../realtime/socket.server';
import { GetChatListQuery, SendMessageInput, SendMultiMessageInput } from '../schemas/chat.schema';
import { env } from '../config/env';

export class ChatServiceError extends Error {
  public readonly statusCode: number;
  public readonly errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'ChatServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ChatServiceError.prototype);
  }
}

/**
 * Resolves full display name for chat screens (matching screenshot headers e.g. "Jessica Parker")
 */
export const resolveChatDisplayName = (user: any): string => {
  if (user?.fullName && user.fullName.trim().length > 0) {
    return user.fullName.trim();
  }
  if (user?.firstName) {
    const last = user.lastName ? ` ${user.lastName.trim()}` : '';
    return `${user.firstName.trim()}${last}`;
  }
  return user?.nickName || user?.username || 'User';
};

export interface ChatParticipantDTO {
  userId: string;
  displayName: string;
  profileImageUrl: string | null;
  isOnline: boolean;
  age?: number | null;
  distanceKm?: number | null;
  commonInterests?: Array<{ id: string; name: string; icon: string | null }>;
}

export interface LastMessageDTO {
  content: string | null;
  sentAt: string | Date;
  senderId?: string;
  messageType?: string;
}

export interface ChatListItemDTO {
  conversationId: string;
  participant: ChatParticipantDTO;
  lastMessage: LastMessageDTO | null;
  unreadCount: number;
  isPinned: boolean;
  isArchived?: boolean;
}

export interface ChatMessageSenderDTO {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: ChatMessageType;
  metadata: any;
  status: 'sent' | 'delivered' | 'read';
  isDelivered: boolean;
  deliveredAt: Date | string | null;
  isRead: boolean;
  readAt: Date | string | null;
  sentAt: Date | string;
  isMine: boolean;
  isPinned: boolean;
  pinnedAt: Date | string | null;
  pinnedBy: string | null;
  sender?: ChatMessageSenderDTO;
}

export interface SendMessageResultItemDTO {
  recipientId: string;
  conversationId: string | null;
  status: 'success' | 'failed';
  message?: ChatMessageDTO;
  error?: string;
  errorCode?: string;
}

export interface SendMultiMessageResultDTO {
  totalCount: number;
  successCount: number;
  failureCount: number;
  results: SendMessageResultItemDTO[];
}

export class ChatService {
  /**
   * Helper to retrieve all user IDs currently blocked by or blocking the given user.
   */
  private async getBlockedUserIds(userId: string): Promise<Set<string>> {
    const blocks = await UserBlock.findAll({
      where: {
        [Op.or]: [{ userId }, { blockedUserId: userId }],
      },
      attributes: ['userId', 'blockedUserId'],
      raw: true,
    });

    const blockedSet = new Set<string>();
    for (const b of blocks) {
      if (b.userId === userId) {
        blockedSet.add(b.blockedUserId);
      } else {
        blockedSet.add(b.userId);
      }
    }
    return blockedSet;
  }

  /**
   * 1. GET CHAT LIST (Chat List Screen)
   * Fetches conversation threads for the current user, separated into pinned and standard lists.
   */
  public async getChatList(
    currentUserId: string,
    query: GetChatListQuery
  ): Promise<{
    pinned: ChatListItemDTO[];
    conversations: ChatListItemDTO[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    // 1. Fetch blocked users to exclude from list
    const blockedUserIds = await this.getBlockedUserIds(currentUserId);
    const blockedArray = Array.from(blockedUserIds);

    // 2. Fetch pinned conversations for current user
    const pins = await ConversationPin.findAll({
      where: { userId: currentUserId },
      attributes: ['conversationId'],
      raw: true,
    });
    const pinnedConversationIdSet = new Set(pins.map((p) => p.conversationId));

    // 3. Build where condition
    const whereCondition: any = {
      [Op.or]: [{ user1Id: currentUserId }, { user2Id: currentUserId }],
    };

    whereCondition[Op.and] = whereCondition[Op.and] || [];

    // Exclude conversations deleted for everyone
    whereCondition[Op.and].push({
      [Op.or]: [
        { isDeletedForEveryone: false },
        { isDeletedForEveryone: null },
      ],
    });

    if (blockedArray.length > 0) {
      whereCondition[Op.and].push({
        user1Id: { [Op.notIn]: blockedArray },
        user2Id: { [Op.notIn]: blockedArray },
      });
    }

    // 4. Handle search query: case-insensitive filter on other participant's display name or username
    if (query.search && query.search.trim().length > 0) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      const searchCondition = {
        [Op.or]: [
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user1.fullName')),
            'LIKE',
            term
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user1.firstName')),
            'LIKE',
            term
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user1.username')),
            'LIKE',
            term
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user2.fullName')),
            'LIKE',
            term
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user2.firstName')),
            'LIKE',
            term
          ),
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('user2.username')),
            'LIKE',
            term
          ),
        ],
      };

      whereCondition[Op.and].push(searchCondition);
    }

    // 5. Query all matching conversations with participant details
    const allMatching = await Conversation.findAll({
      where: whereCondition,
      include: [
        {
          model: User,
          as: 'user1',
          attributes: ['id', 'fullName', 'firstName', 'nickName', 'username', 'profilePicture', 'isActive'],
        },
        {
          model: User,
          as: 'user2',
          attributes: ['id', 'fullName', 'firstName', 'nickName', 'username', 'profilePicture', 'isActive'],
        },
      ],
      order: [
        ['lastMessageAt', 'DESC NULLS LAST'],
        ['updatedAt', 'DESC'],
      ],
    });

    // Fetch user states (archive & delete-for-me) for matching conversations
    const userStates = await ConversationUserState.findAll({
      where: {
        userId: currentUserId,
        conversationId: { [Op.in]: allMatching.map((c) => c.id) },
      },
      raw: true,
    });
    const userStateMap = new Map<string, any>(userStates.map((s) => [s.conversationId, s]));

    // Filter out conversations based on:
    // a) Inactive/deleted user
    // b) Delete for Me state (hidden unless a new message arrived after deletion)
    // c) Archive state (archived vs unarchived chat list)
    const validConversations = allMatching.filter((conv) => {
      if (conv.isDeletedForEveryone) return false;

      const otherUser = conv.user1Id === currentUserId ? conv.user2 : conv.user1;
      if (!otherUser || otherUser.isActive === false) return false;

      const state = userStateMap.get(conv.id);

      // Check Delete for Me
      if (state?.isDeleted) {
        if (!conv.lastMessageAt || new Date(conv.lastMessageAt) <= new Date(state.clearedAt || state.deletedAt)) {
          return false;
        }
      }

      // Check Archive filter
      const isArchived = !!state?.isArchived;
      const requestArchived = !!query.archived;
      if (requestArchived) {
        return isArchived;
      } else {
        return !isArchived;
      }
    });

    if (validConversations.length === 0) {
      return {
        pinned: [],
        conversations: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      };
    }

    const conversationIds = validConversations.map((c) => c.id);

    // 6. Compute unread message counts considering per-user cleared timestamps
    const unreadRecords = await ChatMessage.findAll({
      attributes: ['conversationId', 'createdAt'],
      where: {
        conversationId: { [Op.in]: conversationIds },
        recipientId: currentUserId,
        isRead: false,
      },
      raw: true,
    });

    const unreadMap = new Map<string, number>();
    for (const record of unreadRecords as any[]) {
      const state = userStateMap.get(record.conversationId);
      if (state?.clearedAt && new Date(record.createdAt) <= new Date(state.clearedAt)) {
        continue;
      }
      unreadMap.set(record.conversationId, (unreadMap.get(record.conversationId) || 0) + 1);
    }

    // 7. Map to standardized, canonical DTOs
    const pinnedList: ChatListItemDTO[] = [];
    const unpinnedList: ChatListItemDTO[] = [];

    for (const conv of validConversations) {
      const otherUser = conv.user1Id === currentUserId ? conv.user2 : conv.user1;
      const isPinned = pinnedConversationIdSet.has(conv.id);
      const unreadCount = unreadMap.get(conv.id) || 0;
      const state = userStateMap.get(conv.id);

      const item: ChatListItemDTO = {
        conversationId: conv.id,
        participant: {
          userId: otherUser.id,
          displayName: resolveChatDisplayName(otherUser),
          profileImageUrl: otherUser.profilePicture
            ? formatMediaUrl(otherUser.profilePicture)
            : null,
          isOnline: isUserConnected(otherUser.id),
        },
        lastMessage: conv.lastMessage
          ? {
              content: conv.lastMessage,
              sentAt: conv.lastMessageAt || conv.updatedAt,
            }
          : null,
        unreadCount,
        isPinned,
        isArchived: !!state?.isArchived,
      };

      if (isPinned) {
        pinnedList.push(item);
      } else {
        unpinnedList.push(item);
      }
    }

    // Paginate the unpinned section so UI does not duplicate rows
    const totalUnpinned = unpinnedList.length;
    const paginatedConversations = unpinnedList.slice(offset, offset + limit);
    const totalPages = Math.ceil(totalUnpinned / limit) || 1;
    const hasMore = offset + limit < totalUnpinned;

    return {
      pinned: pinnedList,
      conversations: paginatedConversations,
      pagination: {
        page,
        limit,
        total: totalUnpinned,
        totalPages,
        hasMore,
      },
    };
  }

  /**
   * 2. GET CONVERSATION DETAIL (Header & Participant Summary in Screen 2)
   */
  public async getConversationDetail(
    currentUserId: string,
    conversationId: string
  ): Promise<{
    conversationId: string;
    participant: ChatParticipantDTO;
    isPinned: boolean;
    isArchived?: boolean;
  }> {
    const conversation = await Conversation.findByPk(conversationId, {
      include: [
        {
          model: User,
          as: 'user1',
          include: [
            {
              model: Interest,
              as: 'interests',
              through: { attributes: [] },
              where: { isActive: true },
              required: false,
            },
          ],
        },
        {
          model: User,
          as: 'user2',
          include: [
            {
              model: Interest,
              as: 'interests',
              through: { attributes: [] },
              where: { isActive: true },
              required: false,
            },
          ],
        },
      ],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Verify membership
    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Check user deletion state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const viewerUser = conversation.user1Id === currentUserId ? conversation.user1 : conversation.user2;
    const targetUser = conversation.user1Id === currentUserId ? conversation.user2 : conversation.user1;

    if (!targetUser || targetUser.isActive === false) {
      throw new ChatServiceError('User profile is unavailable', 404);
    }

    // Check if blocked
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: targetUser.id },
          { userId: targetUser.id, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('You cannot interact with this user', 403);
    }

    // Calculate common interests
    const viewerInterests = (viewerUser.interests || []) as any[];
    const targetInterests = (targetUser.interests || []) as any[];

    const viewerInterestIdSet = new Set(viewerInterests.map((i: any) => i.id));
    const viewerInterestNameSet = new Set(viewerInterests.map((i: any) => i.name.toLowerCase()));

    const commonInterests: Array<{ id: string; name: string; icon: string | null }> = [];
    for (const interest of targetInterests) {
      if (
        (interest.id && viewerInterestIdSet.has(interest.id)) ||
        (interest.name && viewerInterestNameSet.has(interest.name.toLowerCase()))
      ) {
        commonInterests.push({
          id: interest.id,
          name: interest.name,
          icon: interest.icon || null,
        });
      }
    }

    // Calculate distance
    const distanceKm = calculateDistanceKm(
      viewerUser.latitude,
      viewerUser.longitude,
      targetUser.latitude,
      targetUser.longitude
    );

    // Check if pinned
    const pin = await ConversationPin.findOne({
      where: { conversationId: conversation.id, userId: currentUserId },
    });

    return {
      conversationId: conversation.id,
      participant: {
        userId: targetUser.id,
        displayName: resolveChatDisplayName(targetUser),
        profileImageUrl: targetUser.profilePicture
          ? formatMediaUrl(targetUser.profilePicture)
          : null,
        isOnline: isUserConnected(targetUser.id),
        age: calculateAge(targetUser.dateOfBirth),
        distanceKm,
        commonInterests,
      },
      isPinned: !!pin,
      isArchived: !!userState?.isArchived,
    };
  }

  /**
   * 3. GET MESSAGES (Message History in Screen 2)
   */
  public async getMessages(
    currentUserId: string,
    conversationId: string,
    query: {
      page?: number;
      limit?: number;
      before?: string;
      after?: string;
      cursor?: string;
      pinned?: boolean;
    } = {}
  ): Promise<{
    conversationId: string;
    messages: ChatMessageDTO[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 30;
    const offset = (page - 1) * limit;

    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Check user state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const otherUserId =
      conversation.user1Id === currentUserId
        ? conversation.user2Id
        : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    // Cursor resolution (supports ISO timestamp or message UUID)
    const cursorValue = query.before || query.cursor;
    let beforeDate: Date | null = null;
    if (cursorValue) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursorValue);
      if (isUuid) {
        const cursorMsg = await ChatMessage.findByPk(cursorValue, { attributes: ['createdAt'] });
        if (cursorMsg) {
          beforeDate = cursorMsg.createdAt;
        }
      } else {
        const parsed = new Date(cursorValue);
        if (!isNaN(parsed.getTime())) {
          beforeDate = parsed;
        }
      }
    }

    let afterDate: Date | null = null;
    if (query.after) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.after);
      if (isUuid) {
        const afterMsg = await ChatMessage.findByPk(query.after, { attributes: ['createdAt'] });
        if (afterMsg) {
          afterDate = afterMsg.createdAt;
        }
      } else {
        const parsed = new Date(query.after);
        if (!isNaN(parsed.getTime())) {
          afterDate = parsed;
        }
      }
    }

    const whereClause: any = { conversationId };

    // Apply per-user history clearing threshold if Delete for Me was executed
    const dateConditions: any[] = [];
    if (userState?.clearedAt) {
      dateConditions.push({ [Op.gt]: userState.clearedAt });
    }
    if (beforeDate) {
      dateConditions.push({ [Op.lt]: beforeDate });
    }
    if (afterDate) {
      dateConditions.push({ [Op.gt]: afterDate });
    }

    if (dateConditions.length === 1) {
      whereClause.createdAt = dateConditions[0];
    } else if (dateConditions.length > 1) {
      whereClause.createdAt = { [Op.and]: dateConditions };
    }

    // Filter pinned messages if requested
    if (query.pinned) {
      const pinnedRecords = await ChatMessagePin.findAll({
        where: {
          conversationId,
          userId: currentUserId,
        },
        attributes: ['messageId'],
      });
      const pinnedMessageIds = pinnedRecords.map((p) => p.messageId);
      whereClause.id = { [Op.in]: pinnedMessageIds };
    }

    const { count, rows } = await ChatMessage.findAndCountAll({
      where: whereClause,
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    });

    // Batch resolve sender profiles for participant details without N+1 queries
    const [user1, user2] = await Promise.all([
      User.findByPk(conversation.user1Id, {
        attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
      }),
      User.findByPk(conversation.user2Id, {
        attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
      }),
    ]);

    const senderMap = new Map<string, ChatMessageSenderDTO>();
    if (user1) {
      senderMap.set(user1.id, {
        id: user1.id,
        displayName: resolveChatDisplayName(user1),
        profileImageUrl: formatMediaUrl(user1.profilePicture),
      });
    }
    if (user2) {
      senderMap.set(user2.id, {
        id: user2.id,
        displayName: resolveChatDisplayName(user2),
        profileImageUrl: formatMediaUrl(user2.profilePicture),
      });
    }

    // Batch resolve pinned status for returned messages
    const messageIds = rows.map((r) => r.id);
    let pinsMap = new Map<string, any>();
    if (messageIds.length > 0) {
      const pinRows = await ChatMessagePin.findAll({
        where: {
          conversationId,
          messageId: { [Op.in]: messageIds },
          userId: currentUserId,
        },
        attributes: ['messageId', 'pinnedBy', 'createdAt'],
      });
      pinsMap = new Map(pinRows.map((p) => [p.messageId, p]));
    }

    // Return in chronological order (oldest to newest) for smooth chat stream rendering
    const chronologicalMessages: ChatMessageDTO[] = [...rows].reverse().map((msg) => {
      let parsedMetadata: any = null;
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata);
        } catch {
          parsedMetadata = msg.metadata;
        }
      }

      const status: 'sent' | 'delivered' | 'read' = msg.isRead
        ? 'read'
        : msg.isDelivered
        ? 'delivered'
        : 'sent';

      const pinInfo = pinsMap.get(msg.id);

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        content: msg.content,
        messageType: (msg.messageType as any) || 'text',
        metadata: parsedMetadata,
        status,
        isDelivered: !!msg.isDelivered,
        deliveredAt: msg.deliveredAt || null,
        isRead: !!msg.isRead,
        readAt: msg.readAt || null,
        sentAt: msg.createdAt,
        isMine: msg.senderId === currentUserId,
        isPinned: !!pinInfo,
        pinnedAt: pinInfo?.createdAt || null,
        pinnedBy: pinInfo?.pinnedBy || null,
        sender: senderMap.get(msg.senderId) || {
          id: msg.senderId,
          displayName: msg.senderId === currentUserId ? 'You' : 'Participant',
          profileImageUrl: null,
        },
      };
    });

    const totalPages = Math.ceil(count / limit) || 1;
    const hasMore = offset + limit < count;

    return {
      conversationId,
      messages: chronologicalMessages,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasMore,
      },
    };
  }

  /**
   * 4. SEND MESSAGE (Authoritative Write Path for both REST and Socket.IO)
   */
  public async sendMessage(
    senderId: string,
    conversationId: string,
    data: SendMessageInput
  ): Promise<ChatMessageDTO> {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found or has been deleted', conversation?.isDeletedForEveryone ? 400 : 404);
    }

    if (conversation.user1Id !== senderId && conversation.user2Id !== senderId) {
      throw new ChatServiceError('You are not a participant in this conversation', 403);
    }

    const recipientId = conversation.user1Id === senderId ? conversation.user2Id : conversation.user1Id;

    // Check if blocked
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: senderId, blockedUserId: recipientId },
          { userId: recipientId, blockedUserId: senderId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('You cannot send messages to this user', 403);
    }

    // Prepare metadata payload and parsed object
    const metadataObj: Record<string, any> = {};
    if (data.clientMessageId) {
      metadataObj.clientMessageId = data.clientMessageId;
    }
    if (data.metadata) {
      if (typeof data.metadata === 'object') {
        Object.assign(metadataObj, data.metadata);
      } else if (typeof data.metadata === 'string') {
        try {
          const parsed = JSON.parse(data.metadata);
          if (parsed && typeof parsed === 'object') {
            Object.assign(metadataObj, parsed);
          }
        } catch {
          // If not JSON, leave as is
        }
      }
    }

    const msgType: ChatMessageType = (data.messageType as ChatMessageType) || 'text';
    let messageContent = (data.content || '').trim();

    // Photo / Camera handling
    if (msgType === 'image') {
      if (!messageContent) {
        throw new ChatServiceError('Image URL or storage key is required in content', 400);
      }

      // Attachment Ownership Verification:
      // Ensure users cannot attach media files uploaded by another user
      const userFolderMatch = messageContent.match(
        /(?:uploads|chat|photos|moments|quick-moments|avatars)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i
      );
      if (userFolderMatch && userFolderMatch[1]) {
        const ownerId = userFolderMatch[1];
        if (ownerId.toLowerCase() !== senderId.toLowerCase()) {
          throw new ChatServiceError(
            'You cannot attach media belonging to another user',
            403,
            'ATTACHMENT_OWNERSHIP_INVALID'
          );
        }
      }

      // Automatically generate/resolve thumbnail URL if missing
      if (!metadataObj.thumbnailUrl) {
        const cleanKey = s3Service.extractKey(messageContent);
        metadataObj.thumbnailUrl = s3Service.getThumbnailUrl(cleanKey);
      }
    }

    // Location sharing handling
    if (msgType === 'location') {
      const lat = Number(metadataObj.latitude);
      const lng = Number(metadataObj.longitude);
      if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      ) {
        throw new ChatServiceError(
          'Invalid location coordinates: latitude must be between -90 and 90, and longitude between -180 and 180',
          400,
          'INVALID_LOCATION_COORDINATES'
        );
      }
      if (!messageContent) {
        messageContent = metadataObj.name
          ? `📍 ${metadataObj.name}`
          : `📍 Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
    }

    // Contact sharing handling
    if (msgType === 'contact') {
      const contactName =
        typeof metadataObj.name === 'string' ? metadataObj.name.trim() : '';
      const phone =
        typeof metadataObj.phoneNumber === 'string'
          ? metadataObj.phoneNumber.trim()
          : '';
      if (!contactName || !phone) {
        throw new ChatServiceError(
          'Contact details (name and phoneNumber) are required in metadata',
          400,
          'INVALID_CONTACT_DETAILS'
        );
      }
      if (!messageContent) {
        messageContent = `👤 ${contactName}`;
      }
    }

    // Idempotency check: if clientMessageId provided, prevent duplicate insert
    if (data.clientMessageId) {
      const existingMessage = await ChatMessage.findOne({
        where: {
          conversationId,
          senderId,
          metadata: {
            [Op.like]: `%"clientMessageId":"${data.clientMessageId}"%`,
          },
        },
      });

      if (existingMessage) {
        let meta: any = null;
        try {
          meta = JSON.parse(existingMessage.metadata || '{}');
        } catch {
          meta = existingMessage.metadata;
        }

        const status: 'sent' | 'delivered' | 'read' = existingMessage.isRead
          ? 'read'
          : existingMessage.isDelivered
          ? 'delivered'
          : 'sent';

        const senderUser = await User.findByPk(senderId, {
          attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
        });

        const pin = await ChatMessagePin.findOne({
          where: {
            conversationId,
            messageId: existingMessage.id,
            userId: senderId,
          },
        });

        return {
          id: existingMessage.id,
          conversationId: existingMessage.conversationId,
          senderId: existingMessage.senderId,
          recipientId: existingMessage.recipientId,
          content: existingMessage.content,
          messageType: existingMessage.messageType as any,
          metadata: meta,
          status,
          isDelivered: !!existingMessage.isDelivered,
          deliveredAt: existingMessage.deliveredAt || null,
          isRead: existingMessage.isRead,
          readAt: existingMessage.readAt || null,
          sentAt: existingMessage.createdAt,
          isMine: true,
          isPinned: !!pin,
          pinnedAt: pin?.createdAt || null,
          pinnedBy: pin?.pinnedBy || null,
          sender: senderUser
            ? {
                id: senderUser.id,
                displayName: resolveChatDisplayName(senderUser),
                profileImageUrl: formatMediaUrl(senderUser.profilePicture),
              }
            : undefined,
        };
      }
    }

    const metadataPayload = Object.keys(metadataObj).length > 0 ? JSON.stringify(metadataObj) : null;

    // Execute database write inside an atomic transaction
    const t = await sequelize.transaction();
    let savedMessage: ChatMessage;

    try {
      savedMessage = await ChatMessage.create(
        {
          conversationId,
          senderId,
          recipientId,
          content: messageContent,
          messageType: msgType,
          metadata: metadataPayload,
          isRead: false,
        },
        { transaction: t }
      );

      // Update conversation lastMessage preview
      let lastMessagePreview: string;
      if (msgType === 'image') {
        lastMessagePreview = '📷 Photo';
      } else if (msgType === 'location') {
        lastMessagePreview = metadataObj.name ? `📍 ${metadataObj.name}` : '📍 Location';
      } else if (msgType === 'contact') {
        lastMessagePreview = metadataObj.name ? `👤 ${metadataObj.name}` : '👤 Contact';
      } else if (msgType === 'audio') {
        lastMessagePreview = '🎤 Voice message';
      } else {
        lastMessagePreview = messageContent;
      }

      conversation.lastMessage = lastMessagePreview;
      conversation.lastMessageAt = savedMessage.createdAt;
      await conversation.save({ transaction: t });

      // If either user previously deleted conversation for themselves, un-hide for new messages while preserving history cutoff
      await ConversationUserState.update(
        { isDeleted: false },
        {
          where: {
            conversationId,
            userId: { [Op.in]: [senderId, recipientId] },
            isDeleted: true,
          },
          transaction: t,
        }
      );

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    let parsedMeta: any = null;
    if (savedMessage.metadata) {
      try {
        parsedMeta = JSON.parse(savedMessage.metadata);
      } catch {
        parsedMeta = savedMessage.metadata;
      }
    }

    const senderUser = await User.findByPk(senderId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });

    const messageDto: ChatMessageDTO = {
      id: savedMessage.id,
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      recipientId: savedMessage.recipientId,
      content: savedMessage.content,
      messageType: savedMessage.messageType as any,
      metadata: parsedMeta,
      status: 'sent',
      isDelivered: false,
      deliveredAt: null,
      isRead: false,
      readAt: null,
      sentAt: savedMessage.createdAt,
      isMine: true,
      isPinned: false,
      pinnedAt: null,
      pinnedBy: null,
      sender: senderUser
        ? {
            id: senderUser.id,
            displayName: resolveChatDisplayName(senderUser),
            profileImageUrl: formatMediaUrl(senderUser.profilePicture),
          }
        : undefined,
    };

    // Real-Time Delivery via Socket.IO
    try {
      const io = getSocketServer();
      const recipientRoom = getUserRoomName(recipientId);
      const senderRoom = getUserRoomName(senderId);

      // Deliver to recipient's multi-device room
      io.to(recipientRoom).emit('chat:message_received' as any, {
        ...messageDto,
        isMine: false,
      });

      // Synchronize sender's other connected devices (e.g. tablet, web)
      io.to(senderRoom).emit('chat:message_sent' as any, messageDto);
    } catch {
      // Socket server may not be bound in isolated test contexts; continue gracefully
    }

    return messageDto;
  }

  /**
   * 4b. SEND MESSAGE TO ONE OR MULTIPLE RECIPIENTS (WhatsApp-style Broadcast / Multi-Send)
   * Resolves individual 1-to-1 conversations, creates messages with transactional isolation,
   * enforces block/privacy rules per-recipient, provides idempotency protection, and dispatches
   * real-time updates via Socket.IO.
   */
  public async sendMultiMessage(
    senderId: string,
    data: SendMultiMessageInput
  ): Promise<SendMultiMessageResultDTO> {
    // 1. Resolve target recipient IDs
    let targetRecipientIds: string[] = [];
    const directConversationMap = new Map<string, Conversation>();

    if (data.conversationId && (!data.recipientIds || data.recipientIds.length === 0) && !data.recipientId) {
      const conv = await Conversation.findByPk(data.conversationId);
      if (!conv || conv.isDeletedForEveryone) {
        throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
      }
      if (conv.user1Id !== senderId && conv.user2Id !== senderId) {
        throw new ChatServiceError('You are not a participant in this conversation', 403, 'FORBIDDEN');
      }
      const otherId = conv.user1Id === senderId ? conv.user2Id : conv.user1Id;
      targetRecipientIds = [otherId];
      directConversationMap.set(otherId, conv);
    } else {
      const rawIds: string[] = [];
      if (Array.isArray(data.recipientIds)) {
        rawIds.push(...data.recipientIds);
      }
      if (data.recipientId) {
        rawIds.push(data.recipientId);
      }
      // Deduplicate preserving order
      targetRecipientIds = Array.from(new Set(rawIds));
    }

    if (targetRecipientIds.length === 0) {
      throw new ChatServiceError('At least one valid recipient is required', 400, 'INVALID_RECIPIENTS');
    }

    // Configurable recipient limit
    const maxBulkRecipients = env.CHAT_MAX_BULK_RECIPIENTS || 50;
    if (targetRecipientIds.length > maxBulkRecipients) {
      throw new ChatServiceError(
        `Recipient limit exceeded. Maximum ${maxBulkRecipients} recipients allowed per operation`,
        400,
        'RECIPIENT_LIMIT_EXCEEDED'
      );
    }

    // Prohibit self-messaging if only sending to oneself
    if (targetRecipientIds.length === 1 && targetRecipientIds[0] === senderId) {
      throw new ChatServiceError('You cannot send a message to yourself', 400, 'SELF_MESSAGING_PROHIBITED');
    }

    // 2. Prepare message content and metadata
    const metadataObj: Record<string, any> = {};
    if (data.metadata) {
      if (typeof data.metadata === 'object') {
        Object.assign(metadataObj, data.metadata);
      } else if (typeof data.metadata === 'string') {
        try {
          const parsed = JSON.parse(data.metadata);
          if (parsed && typeof parsed === 'object') {
            Object.assign(metadataObj, parsed);
          }
        } catch {}
      }
    }

    const msgType: ChatMessageType = (data.messageType || data.type || 'text') as ChatMessageType;
    let messageContent = (data.content || '').trim();

    // Media and attachment checks
    if (msgType === 'image') {
      if (!messageContent) {
        throw new ChatServiceError('Image URL or storage key is required in content', 400);
      }

      // Attachment Ownership Verification
      const userFolderMatch = messageContent.match(
        /(?:uploads|chat|photos|moments|quick-moments|avatars)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i
      );
      if (userFolderMatch && userFolderMatch[1]) {
        const ownerId = userFolderMatch[1];
        if (ownerId.toLowerCase() !== senderId.toLowerCase()) {
          throw new ChatServiceError(
            'You cannot attach media belonging to another user',
            403,
            'ATTACHMENT_OWNERSHIP_INVALID'
          );
        }
      }

      if (!metadataObj.thumbnailUrl) {
        const cleanKey = s3Service.extractKey(messageContent);
        metadataObj.thumbnailUrl = s3Service.getThumbnailUrl(cleanKey);
      }
    } else if (msgType === 'audio') {
      if (!messageContent) {
        throw new ChatServiceError('Audio URL or storage key is required in content', 400);
      }
    } else if (msgType === 'location') {
      const lat = Number(metadataObj.latitude);
      const lng = Number(metadataObj.longitude);
      if (
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180
      ) {
        throw new ChatServiceError(
          'Invalid location coordinates: latitude must be between -90 and 90, and longitude between -180 and 180',
          400,
          'INVALID_LOCATION_COORDINATES'
        );
      }
      if (!messageContent) {
        messageContent = metadataObj.name
          ? `📍 ${metadataObj.name}`
          : `📍 Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      }
    } else if (msgType === 'contact') {
      const contactName =
        typeof metadataObj.name === 'string' ? metadataObj.name.trim() : '';
      const phone =
        typeof metadataObj.phoneNumber === 'string'
          ? metadataObj.phoneNumber.trim()
          : '';
      if (!contactName || !phone) {
        throw new ChatServiceError(
          'Contact details (name and phoneNumber) are required in metadata',
          400,
          'INVALID_CONTACT_DETAILS'
        );
      }
      if (!messageContent) {
        messageContent = `👤 ${contactName}`;
      }
    }

    // 3. Batch fetch sender user profile
    const senderUser = await User.findByPk(senderId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });

    // 4. Batch query target users, blocks, and conversations (avoid N+1)
    const targetUsers = await User.findAll({
      where: { id: { [Op.in]: targetRecipientIds } },
      attributes: ['id', 'isActive'],
    });
    const targetUserMap = new Map(targetUsers.map((u) => [u.id, u]));

    const blocks = await UserBlock.findAll({
      where: {
        [Op.or]: [
          { userId: senderId, blockedUserId: { [Op.in]: targetRecipientIds } },
          { userId: { [Op.in]: targetRecipientIds }, blockedUserId: senderId },
        ],
      },
      attributes: ['userId', 'blockedUserId'],
      raw: true,
    });
    const blockedRecipientIdSet = new Set<string>();
    for (const b of blocks) {
      if (b.userId === senderId) blockedRecipientIdSet.add(b.blockedUserId);
      if (b.blockedUserId === senderId) blockedRecipientIdSet.add(b.userId);
    }

    const conversationMap = new Map<string, Conversation>(directConversationMap);
    const missingConvRecipientIds = targetRecipientIds.filter((id) => !conversationMap.has(id));

    if (missingConvRecipientIds.length > 0) {
      const convPairs = missingConvRecipientIds.map((rId) => {
        const [u1, u2] = [senderId, rId].sort();
        return { user1Id: u1, user2Id: u2 };
      });

      const existingConvs = await Conversation.findAll({
        where: {
          [Op.or]: convPairs,
        },
      });

      for (const conv of existingConvs) {
        const otherId = conv.user1Id === senderId ? conv.user2Id : conv.user1Id;
        conversationMap.set(otherId, conv);
      }
    }

    // 5. Process each recipient independently with transaction safety
    const results: SendMessageResultItemDTO[] = [];

    for (const recipientId of targetRecipientIds) {
      // Check self-messaging in bulk list
      if (recipientId === senderId) {
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: 'You cannot send a message to yourself',
          errorCode: 'SELF_MESSAGING_PROHIBITED',
        });
        continue;
      }

      // Check recipient account validity
      const recipient = targetUserMap.get(recipientId);
      if (!recipient || recipient.isActive === false) {
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: 'User profile is unavailable',
          errorCode: 'USER_NOT_FOUND',
        });
        continue;
      }

      // Check block restrictions
      if (blockedRecipientIdSet.has(recipientId)) {
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: 'You cannot chat with this user',
          errorCode: 'USER_BLOCKED',
        });
        continue;
      }

      // Determine per-recipient clientMessageId for idempotency
      const clientMessageId =
        data.clientMessageIds?.[recipientId] ||
        (data.clientMessageId ? (targetRecipientIds.length === 1 ? data.clientMessageId : `${data.clientMessageId}:${recipientId}`) : undefined);

      // Execute database write inside an atomic transaction
      const t = await sequelize.transaction();
      try {
        let conv = conversationMap.get(recipientId);
        if (!conv) {
          const [u1, u2] = [senderId, recipientId].sort();
          conv = await Conversation.create(
            {
              user1Id: u1,
              user2Id: u2,
              isDeletedForEveryone: false,
            },
            { transaction: t }
          );
          conversationMap.set(recipientId, conv);
        } else if (conv.isDeletedForEveryone) {
          conv.isDeletedForEveryone = false;
          conv.deletedForEveryoneAt = null;
          conv.deletedForEveryoneBy = null;
          await conv.save({ transaction: t });
        }

        const conversationId = conv.id;

        // Idempotency check: if clientMessageId already processed, return existing message
        if (clientMessageId) {
          const existingMessage = await ChatMessage.findOne({
            where: {
              conversationId,
              senderId,
              metadata: {
                [Op.like]: `%"clientMessageId":"${clientMessageId}"%`,
              },
            },
            transaction: t,
          });

          if (existingMessage) {
            await t.commit();
            let meta: any = null;
            try {
              meta = JSON.parse(existingMessage.metadata || '{}');
            } catch {
              meta = existingMessage.metadata;
            }

            const status: 'sent' | 'delivered' | 'read' = existingMessage.isRead
              ? 'read'
              : existingMessage.isDelivered
              ? 'delivered'
              : 'sent';

            const pin = await ChatMessagePin.findOne({
              where: {
                conversationId,
                messageId: existingMessage.id,
                userId: senderId,
              },
            });

            const msgDto: ChatMessageDTO = {
              id: existingMessage.id,
              conversationId: existingMessage.conversationId,
              senderId: existingMessage.senderId,
              recipientId: existingMessage.recipientId,
              content: existingMessage.content,
              messageType: existingMessage.messageType as any,
              metadata: meta,
              status,
              isDelivered: !!existingMessage.isDelivered,
              deliveredAt: existingMessage.deliveredAt || null,
              isRead: existingMessage.isRead,
              readAt: existingMessage.readAt || null,
              sentAt: existingMessage.createdAt,
              isMine: true,
              isPinned: !!pin,
              pinnedAt: pin?.createdAt || null,
              pinnedBy: pin?.pinnedBy || null,
              sender: senderUser
                ? {
                    id: senderUser.id,
                    displayName: resolveChatDisplayName(senderUser),
                    profileImageUrl: formatMediaUrl(senderUser.profilePicture),
                  }
                : undefined,
            };

            results.push({
              recipientId,
              conversationId,
              status: 'success',
              message: msgDto,
            });
            continue;
          }
        }

        // Prepare recipient-specific metadata payload
        const recipientMetadataObj = { ...metadataObj };
        if (clientMessageId) {
          recipientMetadataObj.clientMessageId = clientMessageId;
        }
        const metadataPayload =
          Object.keys(recipientMetadataObj).length > 0
            ? JSON.stringify(recipientMetadataObj)
            : null;

        const savedMessage = await ChatMessage.create(
          {
            conversationId,
            senderId,
            recipientId,
            content: messageContent,
            messageType: msgType,
            metadata: metadataPayload,
            isRead: false,
          },
          { transaction: t }
        );

        // Update conversation lastMessage preview
        let lastMessagePreview: string;
        if (msgType === 'image') {
          lastMessagePreview = '📷 Photo';
        } else if (msgType === 'location') {
          lastMessagePreview = recipientMetadataObj.name ? `📍 ${recipientMetadataObj.name}` : '📍 Location';
        } else if (msgType === 'contact') {
          lastMessagePreview = recipientMetadataObj.name ? `👤 ${recipientMetadataObj.name}` : '👤 Contact';
        } else if (msgType === 'audio') {
          lastMessagePreview = '🎤 Voice message';
        } else {
          lastMessagePreview = messageContent;
        }

        conv.lastMessage = lastMessagePreview;
        conv.lastMessageAt = savedMessage.createdAt;
        await conv.save({ transaction: t });

        // Unhide conversation if previously deleted for me
        await ConversationUserState.update(
          { isDeleted: false },
          {
            where: {
              conversationId,
              userId: { [Op.in]: [senderId, recipientId] },
              isDeleted: true,
            },
            transaction: t,
          }
        );

        await t.commit();

        let parsedMeta: any = null;
        if (savedMessage.metadata) {
          try {
            parsedMeta = JSON.parse(savedMessage.metadata);
          } catch {
            parsedMeta = savedMessage.metadata;
          }
        }

        const messageDto: ChatMessageDTO = {
          id: savedMessage.id,
          conversationId: savedMessage.conversationId,
          senderId: savedMessage.senderId,
          recipientId: savedMessage.recipientId,
          content: savedMessage.content,
          messageType: savedMessage.messageType as any,
          metadata: parsedMeta,
          status: 'sent',
          isDelivered: false,
          deliveredAt: null,
          isRead: false,
          readAt: null,
          sentAt: savedMessage.createdAt,
          isMine: true,
          isPinned: false,
          pinnedAt: null,
          pinnedBy: null,
          sender: senderUser
            ? {
                id: senderUser.id,
                displayName: resolveChatDisplayName(senderUser),
                profileImageUrl: formatMediaUrl(senderUser.profilePicture),
              }
            : undefined,
        };

        // Real-Time Delivery via Socket.IO
        try {
          const io = getSocketServer();
          const recipientRoom = getUserRoomName(recipientId);
          const senderRoom = getUserRoomName(senderId);

          // Deliver to recipient's multi-device room
          io.to(recipientRoom).emit('chat:message_received' as any, {
            ...messageDto,
            isMine: false,
          });

          // Synchronize sender's other connected devices
          io.to(senderRoom).emit('chat:message_sent' as any, messageDto);
        } catch {
          // Socket server may not be bound in isolated test contexts; continue gracefully
        }

        results.push({
          recipientId,
          conversationId,
          status: 'success',
          message: messageDto,
        });
      } catch (err: any) {
        await t.rollback();
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: err.message || 'Failed to deliver message',
          errorCode: 'DELIVERY_ERROR',
        });
      }
    }

    return {
      totalCount: targetRecipientIds.length,
      successCount: results.filter((r) => r.status === 'success').length,
      failureCount: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }

  /**
   * 5. MARK MESSAGES AS READ
   * Acknowledges messages up to lastReadMessageId (or all messages if omitted)
   * as read by the current recipient. Updates receipt timestamps and unread counters.
   */
  public async markMessagesAsRead(
    currentUserId: string,
    conversationId: string,
    lastReadMessageId?: string | null
  ): Promise<{
    conversationId: string;
    lastReadMessageId: string | null;
    markedCount: number;
    unreadCount: number;
  }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const otherUserId = conversation.user1Id === currentUserId ? conversation.user2Id : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    // Boundary check if lastReadMessageId is specified
    let boundaryMessage: ChatMessage | null = null;
    if (lastReadMessageId) {
      boundaryMessage = await ChatMessage.findOne({
        where: { id: lastReadMessageId, conversationId },
        attributes: ['id', 'conversationId', 'createdAt'],
      });

      if (!boundaryMessage) {
        throw new ChatServiceError(
          'Referenced lastReadMessageId does not belong to this conversation',
          400,
          'INVALID_MESSAGE_BOUNDARY'
        );
      }
    }

    // Build query condition: only incoming unread messages where recipientId = currentUserId
    const whereCondition: any = {
      conversationId,
      recipientId: currentUserId,
      isRead: false,
    };

    if (boundaryMessage) {
      whereCondition.createdAt = {
        [Op.lte]: boundaryMessage.createdAt,
      };
    }

    // Respect per-user clearedAt threshold if Delete for Me was previously executed
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
      attributes: ['clearedAt'],
    });
    if (userState?.clearedAt) {
      whereCondition.createdAt = {
        ...(whereCondition.createdAt || {}),
        [Op.gt]: userState.clearedAt,
      };
    }

    const now = new Date();
    const t = await sequelize.transaction();
    let markedCount = 0;
    try {
      const [updatedRows] = await ChatMessage.update(
        {
          isRead: true,
          readAt: now,
          isDelivered: true,
          deliveredAt: sequelize.fn('COALESCE', sequelize.col('deliveredAt'), now),
        },
        {
          where: whereCondition,
          transaction: t,
        }
      );
      markedCount = updatedRows;
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    // Calculate updated unread count for requesting user in this conversation
    const unreadCount = await this.getConversationUnreadCount(currentUserId, conversationId);

    // Notify other user via real-time read receipt and sync unread count to reader's devices
    if (markedCount > 0) {
      try {
        const io = getSocketServer();
        const readReceiptPayload = {
          conversationId,
          readerId: currentUserId,
          lastReadMessageId: lastReadMessageId || boundaryMessage?.id || null,
          markedCount,
          readAt: now.toISOString(),
        };

        // Emit to sender's active room
        io.to(getUserRoomName(otherUserId)).emit('chat:read_receipt' as any, readReceiptPayload);
        io.to(getUserRoomName(otherUserId)).emit('message:read_receipt' as any, readReceiptPayload);

        // Synchronize updated unread badge to reader's own active sessions
        io.to(getUserRoomName(currentUserId)).emit('conversation:unread_updated' as any, {
          conversationId,
          unreadCount,
        });
      } catch {}
    }

    return {
      conversationId,
      lastReadMessageId: lastReadMessageId || boundaryMessage?.id || null,
      markedCount,
      unreadCount,
    };
  }

  /**
   * 6. ACKNOWLEDGE DELIVERY RECEIPTS
   * Recipient acknowledges physical receipt of delivered messages.
   * Updates delivery timestamps and dispatches real-time receipts to sender.
   */
  public async acknowledgeDelivery(
    currentUserId: string,
    conversationId: string,
    messageIds: string[]
  ): Promise<{
    conversationId: string;
    messageIds: string[];
    deliveredCount: number;
  }> {
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return {
        conversationId,
        messageIds: [],
        deliveredCount: 0,
      };
    }

    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const otherUserId = conversation.user1Id === currentUserId ? conversation.user2Id : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    // Security & Integrity: Only messages belonging to this conversation where current user is the RECIPIENT
    const eligibleMessages = await ChatMessage.findAll({
      where: {
        id: { [Op.in]: messageIds },
        conversationId,
        recipientId: currentUserId,
      },
      attributes: ['id', 'isDelivered'],
    });

    if (eligibleMessages.length === 0) {
      return {
        conversationId,
        messageIds: [],
        deliveredCount: 0,
      };
    }

    // Filter messages that have not yet been marked delivered
    const undeliveredIds = eligibleMessages
      .filter((msg) => !msg.isDelivered)
      .map((msg) => msg.id);

    const now = new Date();
    let deliveredCount = 0;

    if (undeliveredIds.length > 0) {
      const t = await sequelize.transaction();
      try {
        const [updatedRows] = await ChatMessage.update(
          {
            isDelivered: true,
            deliveredAt: now,
          },
          {
            where: {
              id: { [Op.in]: undeliveredIds },
            },
            transaction: t,
          }
        );
        deliveredCount = updatedRows;
        await t.commit();
      } catch (err) {
        await t.rollback();
        throw err;
      }
    }

    // Dispatch delivery receipt to sender's active sessions
    if (deliveredCount > 0) {
      try {
        const io = getSocketServer();
        const deliveryPayload = {
          conversationId,
          recipientId: currentUserId,
          messageIds: undeliveredIds,
          deliveredAt: now.toISOString(),
        };

        io.to(getUserRoomName(otherUserId)).emit('chat:delivery_receipt' as any, deliveryPayload);
        io.to(getUserRoomName(otherUserId)).emit('message:delivery_receipt' as any, deliveryPayload);
      } catch {}
    }

    return {
      conversationId,
      messageIds: eligibleMessages.map((m) => m.id),
      deliveredCount,
    };
  }

  /**
   * Helper to compute conversation unread count for a user considering clearedAt threshold.
   */
  public async getConversationUnreadCount(
    userId: string,
    conversationId: string
  ): Promise<number> {
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId },
      attributes: ['clearedAt', 'isDeleted'],
    });

    const where: any = {
      conversationId,
      recipientId: userId,
      isRead: false,
    };

    if (userState?.clearedAt) {
      where.createdAt = { [Op.gt]: userState.clearedAt };
    }

    return await ChatMessage.count({ where });
  }

  /**
   * Computes total aggregate unread messages count for a user across all active conversations.
   */
  public async getTotalUnreadCount(userId: string): Promise<{ totalUnread: number }> {
    const blockedUserIds = await this.getBlockedUserIds(userId);
    const blockedArray = Array.from(blockedUserIds);

    const userConversations = await Conversation.findAll({
      where: {
        [Op.or]: [{ user1Id: userId }, { user2Id: userId }],
        isDeletedForEveryone: false,
      },
      attributes: ['id', 'user1Id', 'user2Id', 'lastMessageAt'],
      raw: true,
    });

    if (userConversations.length === 0) {
      return { totalUnread: 0 };
    }

    const conversationIds = userConversations
      .filter((c: any) => {
        const otherUserId = c.user1Id === userId ? c.user2Id : c.user1Id;
        return !blockedArray.includes(otherUserId);
      })
      .map((c: any) => c.id);

    if (conversationIds.length === 0) {
      return { totalUnread: 0 };
    }

    const userStates = await ConversationUserState.findAll({
      where: {
        conversationId: { [Op.in]: conversationIds },
        userId,
      },
      attributes: ['conversationId', 'clearedAt', 'isDeleted'],
      raw: true,
    });

    const stateMap = new Map<string, any>();
    for (const state of userStates) {
      stateMap.set(state.conversationId, state);
    }

    const unreadRecords = await ChatMessage.findAll({
      attributes: ['conversationId', 'createdAt'],
      where: {
        conversationId: { [Op.in]: conversationIds },
        recipientId: userId,
        isRead: false,
      },
      raw: true,
    });

    let totalUnread = 0;
    for (const record of unreadRecords as any[]) {
      const state = stateMap.get(record.conversationId);
      if (state?.clearedAt && new Date(record.createdAt) <= new Date(state.clearedAt)) {
        continue;
      }
      totalUnread++;
    }

    return { totalUnread };
  }

  /**
   * 6. PIN / UNPIN CONVERSATION
   */
  public async pinConversation(
    currentUserId: string,
    conversationId: string,
    isPinned: boolean
  ): Promise<{ conversationId: string; isPinned: boolean }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const otherUserId = conversation.user1Id === currentUserId ? conversation.user2Id : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    // Check user state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const t = await sequelize.transaction();
    try {
      if (isPinned) {
        await ConversationPin.findOrCreate({
          where: {
            conversationId,
            userId: currentUserId,
          },
          transaction: t,
        });

        // If pinning an archived conversation, unarchive it
        if (userState?.isArchived) {
          userState.isArchived = false;
          userState.archivedAt = null;
          await userState.save({ transaction: t });
        }
      } else {
        await ConversationPin.destroy({
          where: {
            conversationId,
            userId: currentUserId,
          },
          transaction: t,
        });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    return {
      conversationId,
      isPinned,
    };
  }

  /**
   * 7. PIN / UNPIN MESSAGE
   * Pins or unpins a message inside a conversation with authorization, bounds, and real-time sync.
   */
  public async pinMessage(
    currentUserId: string,
    conversationId: string,
    messageId: string,
    isPinned: boolean,
    scope: 'user' | 'conversation' = 'user'
  ): Promise<{
    conversationId: string;
    messageId: string;
    isPinned: boolean;
    pinnedAt: Date | string | null;
    pinnedBy: string | null;
  }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const otherUserId = conversation.user1Id === currentUserId ? conversation.user2Id : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    // Check user state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const message = await ChatMessage.findOne({
      where: { id: messageId, conversationId },
    });

    if (!message) {
      throw new ChatServiceError('Message not found in this conversation', 404);
    }

    // If message was created prior to user's history deletion, it is inaccessible to them
    if (userState?.clearedAt && new Date(message.createdAt) <= new Date(userState.clearedAt)) {
      throw new ChatServiceError('Message not found in this conversation', 404);
    }

    const MAX_PINNED_MESSAGES_PER_CONVERSATION = 50;
    const now = new Date();
    let pinnedAt: Date | string | null = null;
    let pinnedBy: string | null = null;

    if (isPinned) {
      // Check current pin limit for this user
      let existingPin = await ChatMessagePin.findOne({
        where: {
          conversationId,
          messageId,
          userId: currentUserId,
        },
      });

      if (!existingPin) {
        const currentPinnedCount = await ChatMessagePin.count({
          where: {
            conversationId,
            userId: currentUserId,
          },
        });

        if (currentPinnedCount >= MAX_PINNED_MESSAGES_PER_CONVERSATION) {
          throw new ChatServiceError(
            `Maximum pinned messages limit reached (${MAX_PINNED_MESSAGES_PER_CONVERSATION})`,
            400,
            'PIN_LIMIT_EXCEEDED'
          );
        }

        try {
          existingPin = await ChatMessagePin.create({
            conversationId,
            messageId,
            userId: currentUserId,
            pinnedBy: currentUserId,
          });
        } catch (err: any) {
          // If created concurrently by another request, fetch existing
          existingPin = await ChatMessagePin.findOne({
            where: {
              conversationId,
              messageId,
              userId: currentUserId,
            },
          });
          if (!existingPin) {
            throw err;
          }
        }
      }

      pinnedAt = existingPin.createdAt;
      pinnedBy = existingPin.pinnedBy;

      if (scope === 'conversation') {
        const otherPin = await ChatMessagePin.findOne({
          where: { conversationId, messageId, userId: otherUserId },
        });
        if (!otherPin) {
          try {
            await ChatMessagePin.create({
              conversationId,
              messageId,
              userId: otherUserId,
              pinnedBy: currentUserId,
            });
          } catch {}
        }
      }

      // Socket.IO emission to authorized participants according to pin scope
      try {
        const io = getSocketServer();
        const payload = {
          conversationId,
          messageId,
          isPinned: true,
          pinnedBy: currentUserId,
          pinnedAt: (pinnedAt instanceof Date ? pinnedAt.toISOString() : pinnedAt) || now.toISOString(),
        };

        if (scope === 'conversation') {
          io.to(getUserRoomName(conversation.user1Id)).emit('chat:message_pinned' as any, payload);
          io.to(getUserRoomName(conversation.user2Id)).emit('chat:message_pinned' as any, payload);
        } else {
          io.to(getUserRoomName(currentUserId)).emit('chat:message_pinned' as any, payload);
        }
      } catch {}
    } else {
      // Unpinning
      await ChatMessagePin.destroy({
        where: {
          conversationId,
          messageId,
          userId: currentUserId,
        },
      });

      if (scope === 'conversation') {
        await ChatMessagePin.destroy({
          where: {
            conversationId,
            messageId,
            userId: otherUserId,
          },
        });
      }

      // Socket.IO emission to authorized participants according to pin scope
      try {
        const io = getSocketServer();
        const payload = {
          conversationId,
          messageId,
          isPinned: false,
        };

        if (scope === 'conversation') {
          io.to(getUserRoomName(conversation.user1Id)).emit('chat:message_unpinned' as any, payload);
          io.to(getUserRoomName(conversation.user2Id)).emit('chat:message_unpinned' as any, payload);
        } else {
          io.to(getUserRoomName(currentUserId)).emit('chat:message_unpinned' as any, payload);
        }
      } catch {}
    }

    return {
      conversationId,
      messageId,
      isPinned,
      pinnedAt,
      pinnedBy,
    };
  }

  /**
   * 8. GET PINNED MESSAGES
   * Fetches pinned messages for the authorized conversation, respecting deletion and block rules.
   */
  public async getPinnedMessages(
    currentUserId: string,
    conversationId: string,
    query: { page?: number; limit?: number; scope?: string } = {}
  ): Promise<{
    conversationId: string;
    messages: ChatMessageDTO[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 30;
    const offset = (page - 1) * limit;

    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Check user state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    const otherUserId =
      conversation.user1Id === currentUserId
        ? conversation.user2Id
        : conversation.user1Id;

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: otherUserId },
          { userId: otherUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('Conversation unavailable or blocked', 403, 'USER_BLOCKED');
    }

    const pinWhere: any = {
      conversationId,
      [Op.or]: [{ userId: currentUserId }, { userId: null }],
    };

    const { count, rows: pinRows } = await ChatMessagePin.findAndCountAll({
      where: pinWhere,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    if (pinRows.length === 0) {
      return {
        conversationId,
        messages: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 1,
          hasMore: false,
        },
      };
    }

    const pinMap = new Map(pinRows.map((p) => [p.messageId, p]));
    const pinnedMessageIds = pinRows.map((p) => p.messageId);

    const msgWhere: any = {
      id: { [Op.in]: pinnedMessageIds },
      conversationId,
    };

    if (userState?.clearedAt) {
      msgWhere.createdAt = { [Op.gt]: userState.clearedAt };
    }

    const messages = await ChatMessage.findAll({
      where: msgWhere,
    });

    const [user1, user2] = await Promise.all([
      User.findByPk(conversation.user1Id, {
        attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
      }),
      User.findByPk(conversation.user2Id, {
        attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
      }),
    ]);

    const userSenderMap = new Map<string, ChatMessageSenderDTO>();
    if (user1) {
      userSenderMap.set(user1.id, {
        id: user1.id,
        displayName: resolveChatDisplayName(user1),
        profileImageUrl: formatMediaUrl(user1.profilePicture),
      });
    }
    if (user2) {
      userSenderMap.set(user2.id, {
        id: user2.id,
        displayName: resolveChatDisplayName(user2),
        profileImageUrl: formatMediaUrl(user2.profilePicture),
      });
    }

    const messageMap = new Map(messages.map((m) => [m.id, m]));

    // Preserve pinRows order (most recently pinned first)
    const pinnedMessageDtos: ChatMessageDTO[] = [];
    for (const pin of pinRows) {
      const msg = messageMap.get(pin.messageId);
      if (!msg) continue; // Message was cleared or deleted

      let parsedMetadata: any = null;
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata);
        } catch {
          parsedMetadata = msg.metadata;
        }
      }

      const status: 'sent' | 'delivered' | 'read' = msg.isRead
        ? 'read'
        : msg.isDelivered
        ? 'delivered'
        : 'sent';

      pinnedMessageDtos.push({
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        content: msg.content,
        messageType: (msg.messageType as any) || 'text',
        metadata: parsedMetadata,
        status,
        isDelivered: !!msg.isDelivered,
        deliveredAt: msg.deliveredAt || null,
        isRead: !!msg.isRead,
        readAt: msg.readAt || null,
        sentAt: msg.createdAt,
        isMine: msg.senderId === currentUserId,
        isPinned: true,
        pinnedAt: pin.createdAt,
        pinnedBy: pin.pinnedBy,
        sender: userSenderMap.get(msg.senderId) || {
          id: msg.senderId,
          displayName: msg.senderId === currentUserId ? 'You' : 'Participant',
          profileImageUrl: null,
        },
      });
    }

    const totalPages = Math.ceil(count / limit) || 1;
    const hasMore = offset + limit < count;

    return {
      conversationId,
      messages: pinnedMessageDtos,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasMore,
      },
    };
  }

  /**
   * 7. START OR GET CONVERSATION BY PARTICIPANT ID
   */
  public async startConversation(
    currentUserId: string,
    recipientId: string
  ): Promise<{ conversationId: string; isNew: boolean }> {
    if (currentUserId === recipientId) {
      throw new ChatServiceError('You cannot start a conversation with yourself', 400);
    }

    const recipient = await User.findByPk(recipientId, {
      attributes: ['id', 'isActive'],
    });

    if (!recipient || recipient.isActive === false) {
      throw new ChatServiceError('User profile is unavailable', 404);
    }

    // Check if blocked
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: recipientId },
          { userId: recipientId, blockedUserId: currentUserId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('You cannot chat with this user', 403);
    }

    const [u1, u2] = [currentUserId, recipientId].sort();

    const [conversation, isNew] = await Conversation.findOrCreate({
      where: {
        user1Id: u1,
        user2Id: u2,
      },
      defaults: {
        user1Id: u1,
        user2Id: u2,
      },
    });

    return {
      conversationId: conversation.id,
      isNew,
    };
  }

  /**
   * 8. ARCHIVE / UNARCHIVE CONVERSATION
   * Toggles per-user archive status and synchronizes across user's active devices.
   */
  public async archiveConversation(
    currentUserId: string,
    conversationId: string,
    isArchived: boolean
  ): Promise<{ conversationId: string; isArchived: boolean }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Check user state for Delete for Me
    const existingState = await ConversationUserState.findOne({
      where: { conversationId, userId: currentUserId },
    });

    if (existingState?.isDeleted) {
      const deletionThreshold = existingState.clearedAt || existingState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    // Idempotent check
    if (existingState && existingState.isArchived === isArchived) {
      return {
        conversationId,
        isArchived,
      };
    }

    const now = new Date();
    const t = await sequelize.transaction();
    try {
      const [userState, created] = await ConversationUserState.findOrCreate({
        where: { conversationId, userId: currentUserId },
        defaults: {
          conversationId,
          userId: currentUserId,
          isArchived,
          archivedAt: isArchived ? now : null,
        },
        transaction: t,
      });

      if (!created) {
        userState.isArchived = isArchived;
        userState.archivedAt = isArchived ? now : null;
        await userState.save({ transaction: t });
      }

      // If archiving, automatically unpin the conversation for this user
      if (isArchived) {
        await ConversationPin.destroy({
          where: { conversationId, userId: currentUserId },
          transaction: t,
        });
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    // Real-time synchronization only to requesting user's active sessions (never other participants)
    try {
      const io = getSocketServer();
      io.to(getUserRoomName(currentUserId)).emit('conversation:archived', {
        conversationId,
        isArchived,
      });
    } catch {
      // Socket server not available in some test environments
    }

    return {
      conversationId,
      isArchived,
    };
  }

  /**
   * 9. DELETE CONVERSATION (Delete for Me or Delete for Everyone)
   * Safely marks conversation as deleted without physical message destruction.
   */
  public async deleteConversation(
    currentUserId: string,
    conversationId: string,
    deleteType: 'me' | 'everyone'
  ): Promise<{ conversationId: string; deleteType: 'me' | 'everyone' }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'deletedForEveryoneAt', 'deletedForEveryoneBy'],
    });

    if (!conversation) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const now = new Date();

    if (deleteType === 'me') {
      const t = await sequelize.transaction();
      try {
        const [userState, created] = await ConversationUserState.findOrCreate({
          where: { conversationId, userId: currentUserId },
          defaults: {
            conversationId,
            userId: currentUserId,
            isDeleted: true,
            deletedAt: now,
            clearedAt: now,
          },
          transaction: t,
        });

        if (!created) {
          userState.isDeleted = true;
          userState.deletedAt = now;
          userState.clearedAt = now;
          await userState.save({ transaction: t });
        }

        // Unpin conversation for requesting user
        await ConversationPin.destroy({
          where: { conversationId, userId: currentUserId },
          transaction: t,
        });

        await t.commit();
      } catch (err) {
        await t.rollback();
        throw err;
      }

      // Notify only requesting user's active sessions
      try {
        const io = getSocketServer();
        io.to(getUserRoomName(currentUserId)).emit('conversation:deleted', {
          conversationId,
          deleteType: 'me',
        });
      } catch {}

      return {
        conversationId,
        deleteType: 'me',
      };
    }

    // Delete for Everyone
    // Idempotent: if already deleted for everyone, return success
    if (conversation.isDeletedForEveryone) {
      return {
        conversationId,
        deleteType: 'everyone',
      };
    }

    const t = await sequelize.transaction();
    try {
      conversation.isDeletedForEveryone = true;
      conversation.deletedForEveryoneAt = now;
      conversation.deletedForEveryoneBy = currentUserId;
      await conversation.save({ transaction: t });

      // Unpin for all participants
      await ConversationPin.destroy({
        where: { conversationId },
        transaction: t,
      });

      // Update or create user state for both participants
      for (const uid of [conversation.user1Id, conversation.user2Id]) {
        const [uState, created] = await ConversationUserState.findOrCreate({
          where: { conversationId, userId: uid },
          defaults: {
            conversationId,
            userId: uid,
            isDeleted: true,
            deletedAt: now,
            clearedAt: now,
          },
          transaction: t,
        });

        if (!created) {
          uState.isDeleted = true;
          uState.deletedAt = now;
          uState.clearedAt = now;
          await uState.save({ transaction: t });
        }
      }

      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }

    // Notify all affected participants' active sessions
    try {
      const io = getSocketServer();
      const payload = {
        conversationId,
        deleteType: 'everyone' as const,
      };
      io.to(getUserRoomName(conversation.user1Id)).emit('conversation:deleted', payload);
      io.to(getUserRoomName(conversation.user2Id)).emit('conversation:deleted', payload);
    } catch {}

    return {
      conversationId,
      deleteType: 'everyone',
    };
  }
}

export const chatService = new ChatService();
