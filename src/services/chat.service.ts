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
  UserBlock,
  Interest,
} from '../models';
import { formatMediaUrl } from './s3.service';
import { calculateAge, calculateDistanceKm, resolveDisplayName } from './discovery.service';
import { isUserConnected, getUserRoomName } from '../realtime/socket.lifecycle';
import { getSocketServer } from '../realtime/socket.server';
import { GetChatListQuery, SendMessageInput } from '../schemas/chat.schema';

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
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: 'text' | 'audio' | 'image' | 'moment_reply' | 'moment_gift';
  metadata: any;
  isRead: boolean;
  sentAt: Date | string;
  isMine: boolean;
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

    if (blockedArray.length > 0) {
      whereCondition[Op.and] = [
        {
          user1Id: { [Op.notIn]: blockedArray },
          user2Id: { [Op.notIn]: blockedArray },
        },
      ];
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

      if (!whereCondition[Op.and]) {
        whereCondition[Op.and] = [];
      }
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

    // Filter out conversations where the other participant is inactive/deleted
    const validConversations = allMatching.filter((conv) => {
      const otherUser = conv.user1Id === currentUserId ? conv.user2 : conv.user1;
      return otherUser && otherUser.isActive !== false;
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

    // 6. Compute unread message counts in a single O(1) batched query
    const unreadRecords = await ChatMessage.findAll({
      attributes: [
        'conversationId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'unreadCount'],
      ],
      where: {
        conversationId: { [Op.in]: conversationIds },
        recipientId: currentUserId,
        isRead: false,
      },
      group: ['conversationId'],
      raw: true,
    });

    const unreadMap = new Map<string, number>();
    for (const record of unreadRecords as any[]) {
      unreadMap.set(record.conversationId, parseInt(record.unreadCount, 10) || 0);
    }

    // 7. Map to standardized, canonical DTOs
    const pinnedList: ChatListItemDTO[] = [];
    const unpinnedList: ChatListItemDTO[] = [];

    for (const conv of validConversations) {
      const otherUser = conv.user1Id === currentUserId ? conv.user2 : conv.user1;
      const isPinned = pinnedConversationIdSet.has(conv.id);
      const unreadCount = unreadMap.get(conv.id) || 0;

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

    if (!conversation) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Verify membership
    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
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
    };
  }

  /**
   * 3. GET MESSAGES (Message History in Screen 2)
   */
  public async getMessages(
    currentUserId: string,
    conversationId: string,
    query: { page?: number; limit?: number; before?: string }
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
      attributes: ['id', 'user1Id', 'user2Id'],
    });

    if (!conversation) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
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

    const whereClause: any = { conversationId };
    if (query.before) {
      whereClause.createdAt = { [Op.lt]: new Date(query.before) };
    }

    const { count, rows } = await ChatMessage.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    // Return in chronological order (oldest to newest) for smooth chat stream rendering
    const chronologicalMessages = [...rows].reverse().map((msg) => {
      let parsedMetadata: any = null;
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata);
        } catch {
          parsedMetadata = msg.metadata;
        }
      }

      return {
        id: msg.id,
        conversationId: msg.conversationId,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        content: msg.content,
        messageType: (msg.messageType as any) || 'text',
        metadata: parsedMetadata,
        isRead: msg.isRead,
        sentAt: msg.createdAt,
        isMine: msg.senderId === currentUserId,
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
    if (!conversation) {
      throw new ChatServiceError('Conversation not found', 404);
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

        return {
          id: existingMessage.id,
          conversationId: existingMessage.conversationId,
          senderId: existingMessage.senderId,
          recipientId: existingMessage.recipientId,
          content: existingMessage.content,
          messageType: existingMessage.messageType as any,
          metadata: meta,
          isRead: existingMessage.isRead,
          sentAt: existingMessage.createdAt,
          isMine: true,
        };
      }
    }

    // Prepare metadata payload
    let metadataPayload: string | null = null;
    const metadataObj: Record<string, any> = {};
    if (data.clientMessageId) {
      metadataObj.clientMessageId = data.clientMessageId;
    }
    if (data.metadata && typeof data.metadata === 'object') {
      Object.assign(metadataObj, data.metadata);
    }
    if (Object.keys(metadataObj).length > 0) {
      metadataPayload = JSON.stringify(metadataObj);
    } else if (typeof data.metadata === 'string') {
      metadataPayload = data.metadata;
    }

    // Execute database write inside an atomic transaction
    const t = await sequelize.transaction();
    let savedMessage: ChatMessage;

    try {
      savedMessage = await ChatMessage.create(
        {
          conversationId,
          senderId,
          recipientId,
          content: data.content,
          messageType: (data.messageType as any) || 'text',
          metadata: metadataPayload,
          isRead: false,
        },
        { transaction: t }
      );

      // Update conversation lastMessage preview
      conversation.lastMessage = data.content;
      conversation.lastMessageAt = savedMessage.createdAt;
      await conversation.save({ transaction: t });

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

    const messageDto: ChatMessageDTO = {
      id: savedMessage.id,
      conversationId: savedMessage.conversationId,
      senderId: savedMessage.senderId,
      recipientId: savedMessage.recipientId,
      content: savedMessage.content,
      messageType: savedMessage.messageType as any,
      metadata: parsedMeta,
      isRead: savedMessage.isRead,
      sentAt: savedMessage.createdAt,
      isMine: true,
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
   * 5. MARK MESSAGES AS READ
   */
  public async markMessagesAsRead(
    currentUserId: string,
    conversationId: string
  ): Promise<{ conversationId: string; markedCount: number }> {
    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id'],
    });

    if (!conversation) {
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

    const [markedCount] = await ChatMessage.update(
      { isRead: true },
      {
        where: {
          conversationId,
          recipientId: currentUserId,
          isRead: false,
        },
      }
    );

    // Notify other user via real-time read receipt
    if (markedCount > 0) {
      try {
        const io = getSocketServer();
        io.to(getUserRoomName(otherUserId)).emit('chat:read_receipt' as any, {
          conversationId,
          readerId: currentUserId,
          readAt: new Date().toISOString(),
        });
      } catch {}
    }

    return {
      conversationId,
      markedCount,
    };
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
      attributes: ['id', 'user1Id', 'user2Id'],
    });

    if (!conversation) {
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

    if (isPinned) {
      await ConversationPin.findOrCreate({
        where: {
          conversationId,
          userId: currentUserId,
        },
      });
    } else {
      await ConversationPin.destroy({
        where: {
          conversationId,
          userId: currentUserId,
        },
      });
    }

    return {
      conversationId,
      isPinned,
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
}

export const chatService = new ChatService();
