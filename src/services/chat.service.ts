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
  ChatMessageReaction,
  UserBlock,
  Interest,
  ConversationUserState,
  Match,
  UserPhoto,
} from '../models';
import { ChatMessageType } from '../models/chatMessage.model';
import { s3Service, formatMediaUrl, formatThumbnailUrl } from './s3.service';
import { calculateAge, calculateDistanceKm, resolveDisplayName } from './discovery.service';
import { isUserConnected, getUserRoomName } from '../realtime/socket.lifecycle';
import { getSocketServer } from '../realtime/socket.server';
import {
  GetChatListQuery,
  GetMessagesQuery,
  SendMessageInput,
  SendMultiMessageInput,
  DirectSendMessageInput,
  EditMessageInput,
  ReplyMessageInput,
  normalizeReactionEmoji,
  ALLOWED_CHAT_REACTION_EMOJIS,
} from '../schemas/chat.schema';

export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes window for editing sent messages
export const MESSAGE_DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours window for Delete for Everyone
import { env } from '../config/env';
import { notificationService } from './notification.service';

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

/**
 * Safely resolves the other participant's ID in a 1-to-1 conversation,
 * performing case-insensitive trimmed matching against the current user's ID.
 */
export const getOtherParticipantId = (
  conv: { user1Id: string; user2Id: string },
  currentUserId: string
): string => {
  const normCurrent = String(currentUserId || '').trim().toLowerCase();
  const normU1 = String(conv.user1Id || '').trim().toLowerCase();
  return normU1 === normCurrent ? conv.user2Id : conv.user1Id;
};

/**
 * Safely resolves the other participant User object in a 1-to-1 conversation,
 * performing case-insensitive trimmed matching against the current user's ID.
 */
export const getOtherParticipantUser = (
  conv: { user1Id: string; user2Id: string; user1?: any; user2?: any },
  currentUserId: string
): any => {
  const normCurrent = String(currentUserId || '').trim().toLowerCase();
  const normU1 = String(conv.user1Id || '').trim().toLowerCase();
  return normU1 === normCurrent ? conv.user2 : conv.user1;
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

export interface ChatMessageReplyRefDTO {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: string;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: ChatMessageType | 'text' | 'moment_reply' | 'moment_gift' | string;
  metadata: any;
  status?: 'sent' | 'delivered' | 'read';
  isDelivered?: boolean;
  deliveredAt?: Date | string | null;
  isRead: boolean;
  readAt?: Date | string | null;
  sentAt?: Date | string;
  createdAt?: string | Date;
  isMine: boolean;
  isSender?: boolean;
  isPinned?: boolean;
  pinnedAt?: Date | string | null;
  pinnedBy?: string | null;
  isEdited?: boolean;
  editedAt?: Date | string | null;
  replyToMessageId?: string | null;
  replyTo?: ChatMessageReplyRefDTO | null;
  sender?: ChatMessageSenderDTO;
  imageUrl?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  audioUrl?: string;
  voiceUrl?: string;
  url?: string;
  duration?: number | string;
  durationMs?: number;
  images?: any[];
  imageUrls?: string[];
  messages?: ChatMessageDTO[];
  reactions?: MessageReactionDTO[];
  reactionCounts?: Record<string, number>;
  myReaction?: string | null;
  userReaction?: string | null;
  otherUserReaction?: string | null;
  reaction?: string | null;
  emoji?: string | null;
  hasReacted?: boolean;
}

export interface MessageReactionDTO {
  id: string;
  messageId: string;
  conversationId: string;
  userId: string;
  emoji: string;
  createdAt: string;
  user?: {
    id: string;
    fullName: string;
    nickName: string | null;
    profilePicture: string | null;
  } | null;
}

export interface MessageReactionResultDTO {
  action: 'added' | 'updated' | 'removed';
  messageId: string;
  conversationId: string;
  userId?: string;
  reactorId?: string;
  senderId?: string;
  emoji: string | null;
  reactionEmoji?: string | null;
  reaction: MessageReactionDTO | null;
  reactions?: MessageReactionDTO[];
  reactionsCount?: number;
  myReaction?: string | null;
  otherUserReaction?: string | null;
  user: {
    id: string;
    fullName: string;
    nickName: string | null;
    profilePicture: string | null;
  };
  reactionCounts: Record<string, number>;
}

export interface ConversationSummaryDTO {
  id: string;
  targetUser: {
    id: string;
    name: string;
    username: string;
    profilePhotoUrl: string | null;
    isVerified: boolean;
    isSubscribed: boolean;
  };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isMatched: boolean;
  messageType?: ChatMessageType;
  metadata?: any;
  status?: 'sent' | 'delivered' | 'read';
  isDelivered?: boolean;
  deliveredAt?: Date | string | null;
  isRead?: boolean;
  readAt?: Date | string | null;
  sentAt?: Date | string;
  isMine?: boolean;
  isPinned?: boolean;
  pinnedAt?: Date | string | null;
  pinnedBy?: string | null;
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
   * Helper to resolve the primary approved profile photo URL
   */
  private resolvePrimaryPhoto(userProfilePicture?: string | null, photos?: any[] | null): string | null {
    let photo = userProfilePicture || null;
    if (!photo && photos && photos.length > 0) {
      const approvedPhotos = photos.filter((p) => p.status === 'approved');
      if (approvedPhotos.length > 0) {
        const primary = approvedPhotos.find((p) => p.isPrimary);
        photo = primary ? primary.imageUrl : approvedPhotos[0].imageUrl;
      }
    }
    return photo ? formatThumbnailUrl(photo) : null;
  }

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

    const normCurrentUserId = String(currentUserId || '').trim().toLowerCase();

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

    // Exclude conversations without any messages (no chat history)
    whereCondition[Op.and].push({
      [Op.or]: [
        {
          lastMessage: {
            [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }],
          },
        },
        {
          lastMessageAt: {
            [Op.ne]: null,
          },
        },
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
          {
            user1Id: currentUserId,
            [Op.or]: [
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user2.fullName')), 'LIKE', term),
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user2.firstName')), 'LIKE', term),
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user2.username')), 'LIKE', term),
            ],
          },
          {
            user2Id: currentUserId,
            [Op.or]: [
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user1.fullName')), 'LIKE', term),
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user1.firstName')), 'LIKE', term),
              sequelize.where(sequelize.fn('LOWER', sequelize.col('user1.username')), 'LIKE', term),
            ],
          },
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
    // a) Self-conversations (user1Id === user2Id)
    // b) Inactive/deleted user or partner resolving to current user
    // c) Empty conversations (no chat / no messages)
    // d) Search filter on other participant
    // e) Delete for Me state (hidden unless a new message arrived after deletion)
    // f) Archive state (archived vs unarchived chat list)
    const validConversations = allMatching.filter((conv) => {
      if (conv.isDeletedForEveryone) return false;

      const normU1 = String(conv.user1Id || '').trim().toLowerCase();
      const normU2 = String(conv.user2Id || '').trim().toLowerCase();

      // Exclude self-conversations
      if (normU1 === normU2) return false;

      // Safely resolve the other participant using case-insensitive check
      const otherUser = normU1 === normCurrentUserId ? conv.user2 : conv.user1;
      if (!otherUser || otherUser.isActive === false) return false;

      // Ensure other participant is NOT the current user
      const normOtherUserId = String(otherUser.id || '').trim().toLowerCase();
      if (normOtherUserId === normCurrentUserId) return false;

      // Exclude empty conversations (no chat / no messages)
      const hasChat = Boolean(
        (conv.lastMessage && conv.lastMessage.trim().length > 0) || conv.lastMessageAt
      );
      if (!hasChat) {
        return false;
      }

      // If search query was provided, ensure the OTHER participant matches
      if (query.search && query.search.trim().length > 0) {
        const searchLower = query.search.trim().toLowerCase();
        const otherDisplayName = resolveChatDisplayName(otherUser).toLowerCase();
        const otherUsername = String(otherUser.username || '').toLowerCase();
        if (!otherDisplayName.includes(searchLower) && !otherUsername.includes(searchLower)) {
          return false;
        }
      }

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

    // 6. Compute unread message counts considering per-user cleared timestamps and deleted messages
    const unreadRecords = await ChatMessage.findAll({
      attributes: ['conversationId', 'createdAt', 'metadata'],
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
      if (record.metadata) {
        try {
          const meta = JSON.parse(record.metadata);
          if (meta.isDeletedForEveryone || meta.isDeleted) continue;
          if (Array.isArray(meta.deletedForUserIds) && meta.deletedForUserIds.includes(currentUserId)) continue;
        } catch {}
      }
      unreadMap.set(record.conversationId, (unreadMap.get(record.conversationId) || 0) + 1);
    }

    // 7. Map to standardized, canonical DTOs
    const pinnedList: ChatListItemDTO[] = [];
    const unpinnedList: ChatListItemDTO[] = [];

    for (const conv of validConversations) {
      const normU1 = String(conv.user1Id || '').trim().toLowerCase();
      const otherUser = normU1 === normCurrentUserId ? conv.user2 : conv.user1;
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
    const includeModels = [
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
    ];

    let conversation = await Conversation.findByPk(conversationId, {
      include: includeModels,
    });

    if (!conversation) {
      // Check if conversationId is actually a participant/target user ID
      const [u1, u2] = [currentUserId, conversationId].sort();
      conversation = await Conversation.findOne({
        where: { user1Id: u1, user2Id: u2 },
        include: includeModels,
      });
    }

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Verify membership
    const normCurrentUserId = String(currentUserId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normCurrentUserId && normUser2Id !== normCurrentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    if (normUser1Id === normUser2Id) {
      throw new ChatServiceError('Invalid conversation', 400);
    }

    // Check user deletion state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId: conversation.id, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const viewerUser = normUser1Id === normCurrentUserId ? conversation.user1 : conversation.user2;
    const targetUser = normUser1Id === normCurrentUserId ? conversation.user2 : conversation.user1;

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

    let conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
    });

    if (!conversation) {
      // Check if conversationId is actually a participant/target user ID
      const [u1, u2] = [currentUserId, conversationId].sort();
      conversation = await Conversation.findOne({
        where: { user1Id: u1, user2Id: u2 },
        attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
      });
    }

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    const actualConversationId = conversation.id;

    const normCurrentUserId = String(currentUserId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normCurrentUserId && normUser2Id !== normCurrentUserId) {
      throw new ChatServiceError('Conversation not found', 404);
    }

    // Check user state for Delete for Me
    const userState = await ConversationUserState.findOne({
      where: { conversationId: actualConversationId, userId: currentUserId },
    });

    if (userState?.isDeleted) {
      const deletionThreshold = userState.clearedAt || userState.deletedAt;
      if (!conversation.lastMessageAt || (deletionThreshold && new Date(conversation.lastMessageAt) <= new Date(deletionThreshold))) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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

    const whereClause: any = { conversationId: actualConversationId };

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
          conversationId: actualConversationId,
          userId: currentUserId,
        },
        attributes: ['messageId'],
      });
      const pinnedMessageIds = pinnedRecords.map((p) => p.messageId);
      whereClause.id = { [Op.in]: pinnedMessageIds };
    }

    // Exclude messages deleted for everyone or deleted for requesting user
    whereClause[Op.and] = whereClause[Op.and] || [];
    whereClause[Op.and].push({
      [Op.or]: [
        { metadata: null },
        {
          [Op.and]: [
            { metadata: { [Op.notLike]: '%"isDeletedForEveryone":true%' } },
            { metadata: { [Op.notLike]: `%"deletedForUserIds":%${currentUserId}%` } },
          ],
        },
      ],
    });

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

    // Safety filter to exclude any deleted messages
    const visibleRows = rows.filter((msg) => {
      if (!msg.metadata) return true;
      try {
        const meta = JSON.parse(msg.metadata);
        if (meta.isDeletedForEveryone || meta.isDeleted) return false;
        if (Array.isArray(meta.deletedForUserIds) && meta.deletedForUserIds.includes(currentUserId)) return false;
      } catch {}
      return true;
    });

    // Batch resolve pinned status for returned messages
    const messageIds = visibleRows.map((r) => r.id);
    let pinsMap = new Map<string, any>();
    let reactionsMap = new Map<string, any[]>();
    if (messageIds.length > 0) {
      const [pinRows, reactionRows] = await Promise.all([
        ChatMessagePin.findAll({
          where: {
            conversationId: actualConversationId,
            messageId: { [Op.in]: messageIds },
            userId: currentUserId,
          },
          attributes: ['messageId', 'pinnedBy', 'createdAt'],
        }),
        ChatMessageReaction.findAll({
          where: {
            messageId: { [Op.in]: messageIds },
          },
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'fullName', 'nickName', 'profilePicture'],
            },
          ],
          order: [['createdAt', 'ASC']],
        }),
      ]);
      pinsMap = new Map(pinRows.map((p) => [p.messageId, p]));
      for (const r of reactionRows) {
        const list = reactionsMap.get(r.messageId) || [];
        list.push(r);
        reactionsMap.set(r.messageId, list);
      }
    }

    // Return in chronological order (oldest to newest) for smooth chat stream rendering
    const chronologicalMessages: ChatMessageDTO[] = [...visibleRows].reverse().map((msg) => {
      let parsedMetadata: any = null;
      if (msg.metadata) {
        try {
          parsedMetadata = JSON.parse(msg.metadata);
        } catch {
          parsedMetadata = msg.metadata;
        }
      }

      if (msg.messageType === 'image' && msg.content) {
        if (!parsedMetadata || typeof parsedMetadata !== 'object') {
          parsedMetadata = {};
        }
        const cleanKey = s3Service.extractKey(msg.content);
        if (!parsedMetadata.thumbnailUrl) {
          parsedMetadata.thumbnailUrl = s3Service.getThumbnailUrl(cleanKey);
        }
        if (!parsedMetadata.imageUrl) {
          parsedMetadata.imageUrl = s3Service.getPublicUrl(cleanKey);
        }
        if (!parsedMetadata.mediaUrl) {
          parsedMetadata.mediaUrl = s3Service.getPublicUrl(cleanKey);
        }
        if (!parsedMetadata.url) {
          parsedMetadata.url = s3Service.getPublicUrl(cleanKey);
        }
        if (Array.isArray(parsedMetadata.images)) {
          parsedMetadata.images = parsedMetadata.images.map((img: any) => {
            if (typeof img === 'string') {
              const k = s3Service.extractKey(img);
              return { url: s3Service.getPublicUrl(k), thumbnailUrl: s3Service.getThumbnailUrl(k), key: k };
            }
            if (img && typeof img === 'object') {
              const k = img.key || s3Service.extractKey(img.url || img.imageUrl || '');
              return {
                ...img,
                url: img.url || (k ? s3Service.getPublicUrl(k) : ''),
                thumbnailUrl: img.thumbnailUrl || (k ? s3Service.getThumbnailUrl(k) : ''),
              };
            }
            return img;
          });
        }
      } else if (msg.messageType === 'audio' && msg.content) {
        if (!parsedMetadata || typeof parsedMetadata !== 'object') {
          parsedMetadata = {};
        }
        const cleanKey = s3Service.extractKey(msg.content);
        if (!parsedMetadata.audioUrl) {
          parsedMetadata.audioUrl = s3Service.getPublicUrl(cleanKey);
        }
        if (!parsedMetadata.mediaUrl) {
          parsedMetadata.mediaUrl = s3Service.getPublicUrl(cleanKey);
        }
        if (!parsedMetadata.url) {
          parsedMetadata.url = s3Service.getPublicUrl(cleanKey);
        }
      }

      const status: 'sent' | 'delivered' | 'read' = msg.isRead
        ? 'read'
        : msg.isDelivered
          ? 'delivered'
          : 'sent';

      const pinInfo = pinsMap.get(msg.id);

      const isMine = String(msg.senderId || '').trim().toLowerCase() === normCurrentUserId;

      const msgItem: ChatMessageDTO = {
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
        isMine,
        isSender: isMine,
        isPinned: !!pinInfo,
        pinnedAt: pinInfo?.createdAt || null,
        pinnedBy: pinInfo?.pinnedBy || null,
        isEdited: !!parsedMetadata?.isEdited,
        editedAt: parsedMetadata?.editedAt || null,
        replyToMessageId: parsedMetadata?.replyToMessageId || null,
        replyTo: parsedMetadata?.replyTo || null,
        sender: senderMap.get(msg.senderId) || {
          id: msg.senderId,
          displayName: isMine ? 'You' : 'Participant',
          profileImageUrl: null,
        },
      };

      const msgReactions = reactionsMap.get(msg.id) || [];
      const reactionCounts: Record<string, number> = { total: msgReactions.length };
      let myReaction: string | null = null;
      let otherUserReaction: string | null = null;
      let lastReaction: string | null = null;

      const reactionsList: MessageReactionDTO[] = msgReactions.map((r: any) => {
        const isCurrent = String(r.userId || '').trim().toLowerCase() === normCurrentUserId;
        if (isCurrent) {
          myReaction = r.emoji;
        } else {
          otherUserReaction = r.emoji;
        }
        lastReaction = r.emoji;
        reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
        return {
          id: r.id,
          messageId: r.messageId,
          conversationId: r.conversationId,
          userId: r.userId,
          emoji: r.emoji,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
          user: r.user
            ? {
                id: r.user.id,
                fullName: r.user.fullName || r.user.nickName || 'User',
                nickName: r.user.nickName || null,
                profilePicture: formatMediaUrl(r.user.profilePicture),
              }
            : null,
        };
      });

      const activeReactionEmoji = myReaction || otherUserReaction || lastReaction || null;

      msgItem.reactions = reactionsList;
      msgItem.reactionCounts = reactionCounts.total > 0 ? reactionCounts : { total: 0 };
      msgItem.myReaction = myReaction;
      msgItem.userReaction = myReaction;
      msgItem.otherUserReaction = otherUserReaction;
      msgItem.reaction = activeReactionEmoji;
      msgItem.emoji = activeReactionEmoji;
      msgItem.hasReacted = !!myReaction;

      if (msg.messageType === 'image') {
        const cleanKey = s3Service.extractKey(msg.content);
        const resolvedUrl =
          parsedMetadata?.imageUrl ||
          parsedMetadata?.url ||
          parsedMetadata?.mediaUrl ||
          (cleanKey ? s3Service.getPublicUrl(cleanKey) : undefined);
        const resolvedThumb =
          parsedMetadata?.thumbnailUrl ||
          (cleanKey ? s3Service.getThumbnailUrl(cleanKey) : undefined);

        msgItem.imageUrl = resolvedUrl;
        msgItem.thumbnailUrl = resolvedThumb;
        msgItem.mediaUrl = resolvedUrl;
        msgItem.url = resolvedUrl;

        if (Array.isArray(parsedMetadata?.images) && parsedMetadata.images.length > 0) {
          msgItem.images = parsedMetadata.images;
          msgItem.imageUrls = parsedMetadata.images.map((i: any) =>
            typeof i === 'string' ? i : i.url || i.imageUrl || ''
          );
        } else {
          msgItem.images = resolvedUrl
            ? [{ url: resolvedUrl, imageUrl: resolvedUrl, thumbnailUrl: resolvedThumb, key: cleanKey }]
            : [];
          msgItem.imageUrls = resolvedUrl ? [resolvedUrl] : [];
        }
      } else if (msg.messageType === 'audio') {
        const cleanKey = s3Service.extractKey(msg.content);
        const resolvedAudio =
          parsedMetadata?.audioUrl ||
          parsedMetadata?.voiceUrl ||
          parsedMetadata?.url ||
          parsedMetadata?.mediaUrl ||
          (cleanKey ? s3Service.getPublicUrl(cleanKey) : undefined);

        msgItem.audioUrl = resolvedAudio;
        msgItem.voiceUrl = resolvedAudio;
        msgItem.mediaUrl = resolvedAudio;
        msgItem.url = resolvedAudio;

        const dur =
          parsedMetadata?.duration !== undefined
            ? Number(parsedMetadata.duration)
            : undefined;
        if (dur !== undefined && !Number.isNaN(dur)) {
          msgItem.duration = dur;
          msgItem.durationMs =
            parsedMetadata?.durationMs !== undefined
              ? Number(parsedMetadata.durationMs)
              : dur * 1000;
        }
      }

      return msgItem;
    });

    const totalPages = Math.ceil(count / limit) || 1;
    const hasMore = offset + limit < count;

    return {
      conversationId: actualConversationId,
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
    let conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      // Check if conversationId is actually a participant/target user ID
      const [u1, u2] = [senderId, conversationId].sort();
      conversation = await Conversation.findOne({
        where: { user1Id: u1, user2Id: u2 },
      });
      if (!conversation) {
        // Auto-create if target user exists and is active
        const targetUser = await User.findByPk(conversationId);
        if (targetUser && targetUser.isActive) {
          conversation = await Conversation.create({
            user1Id: u1,
            user2Id: u2,
            isDeletedForEveryone: false,
          });
        }
      }
    }

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found or has been deleted', conversation?.isDeletedForEveryone ? 400 : 404);
    }

    conversationId = conversation.id;

    const normSenderId = String(senderId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normSenderId && normUser2Id !== normSenderId) {
      throw new ChatServiceError('You are not a participant in this conversation', 403);
    }

    const recipientId = getOtherParticipantId(conversation, senderId);

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
      throw new ChatServiceError(
        'You cannot send messages to this user',
        403,
        'CHAT_FORBIDDEN'
      );
    }

    // Idempotent retry / deduplication check by clientMessageId
    if (data.clientMessageId) {
      const existingMsg = await ChatMessage.findOne({
        where: {
          conversationId,
          senderId,
          metadata: {
            [Op.like]: `%"clientMessageId":"${data.clientMessageId}"%`,
          },
        },
      });

      if (existingMsg) {
        let existingMeta: any = null;
        if (existingMsg.metadata) {
          try {
            existingMeta = JSON.parse(existingMsg.metadata);
          } catch {
            existingMeta = existingMsg.metadata;
          }
        }

        const senderUser = await User.findByPk(senderId, {
          attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
        });

        return {
          id: existingMsg.id,
          conversationId: existingMsg.conversationId,
          senderId: existingMsg.senderId,
          recipientId: existingMsg.recipientId,
          content: existingMsg.content,
          messageType: existingMsg.messageType as any,
          metadata: existingMeta,
          status: existingMsg.isRead ? 'read' : existingMsg.isDelivered ? 'delivered' : 'sent',
          isDelivered: !!existingMsg.isDelivered,
          deliveredAt: existingMsg.deliveredAt,
          isRead: !!existingMsg.isRead,
          readAt: existingMsg.readAt,
          sentAt: existingMsg.createdAt,
          createdAt: existingMsg.createdAt,
          isMine: true,
          isSender: true,
          isPinned: false,
          pinnedAt: null,
          pinnedBy: null,
          isEdited: !!existingMeta?.isEdited,
          editedAt: existingMeta?.editedAt || null,
          replyToMessageId: existingMeta?.replyToMessageId || null,
          replyTo: existingMeta?.replyTo || null,
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

    // Validate and link Reply Reference if replyToMessageId is supplied
    const targetReplyMessageId =
      data.replyToMessageId ||
      (data as any).parentMessageId ||
      (data as any).replyToId;

    if (targetReplyMessageId) {
      const parentMessage = await ChatMessage.findByPk(targetReplyMessageId);
      if (!parentMessage) {
        throw new ChatServiceError('Original message not found', 404, 'MESSAGE_NOT_FOUND');
      }

      if (parentMessage.conversationId !== conversationId) {
        throw new ChatServiceError(
          'Original message does not belong to this conversation',
          400,
          'INVALID_CONVERSATION'
        );
      }

      // Check if user has cleared history past parent message
      const senderUserState = await ConversationUserState.findOne({
        where: { conversationId, userId: senderId },
        attributes: ['clearedAt', 'isDeleted'],
      });

      if (senderUserState?.clearedAt && parentMessage.createdAt <= senderUserState.clearedAt) {
        throw new ChatServiceError('Cannot reply to a deleted message', 400, 'MESSAGE_DELETED');
      }

      let parentMeta: any = {};
      if (parentMessage.metadata) {
        try {
          parentMeta = JSON.parse(parentMessage.metadata);
        } catch {
          parentMeta = {};
        }
      }

      if (
        parentMeta.isDeleted ||
        parentMeta.recalled ||
        parentMeta.isDeletedForEveryone ||
        (Array.isArray(parentMeta.deletedForUserIds) && parentMeta.deletedForUserIds.includes(senderId))
      ) {
        throw new ChatServiceError('Cannot reply to a deleted or recalled message', 400, 'MESSAGE_DELETED');
      }

      const parentSender = await User.findByPk(parentMessage.senderId, {
        attributes: ['id', 'username', 'firstName', 'lastName', 'fullName'],
      });

      const parentSenderName = parentSender ? resolveChatDisplayName(parentSender) : 'Participant';

      let parentPreview = parentMessage.content || '';
      if (parentMessage.messageType === 'image') {
        parentPreview = 'Photo';
      } else if (parentMessage.messageType === 'audio') {
        parentPreview = 'Voice message';
      } else if (parentMessage.messageType === 'location') {
        parentPreview = 'Location';
      } else if (parentMessage.messageType === 'contact') {
        parentPreview = 'Contact';
      } else if (parentPreview.length > 200) {
        parentPreview = parentPreview.substring(0, 200) + '...';
      }

      const replyToRef: ChatMessageReplyRefDTO = {
        id: parentMessage.id,
        senderId: parentMessage.senderId,
        senderName: parentSenderName,
        content: parentPreview,
        messageType: parentMessage.messageType,
      };

      metadataObj.replyToMessageId = parentMessage.id;
      metadataObj.replyTo = replyToRef;
    }

    let rawImages = (data as any).images || metadataObj.images;
    if (typeof rawImages === 'string') {
      try {
        rawImages = JSON.parse(rawImages);
      } catch {}
    }

    let rawImageUrls =
      (data as any).imageUrls ||
      (data as any).mediaUrls ||
      metadataObj.imageUrls ||
      metadataObj.mediaUrls;
    if (typeof rawImageUrls === 'string') {
      try {
        rawImageUrls = JSON.parse(rawImageUrls);
      } catch {}
    }

    let msgType: ChatMessageType = (data.messageType as ChatMessageType) || (data.type as ChatMessageType) || 'text';
    if (!data.messageType && !data.type) {
      if ((data as any).audioUrl || (data as any).audio || (data as any).voiceUrl) {
        msgType = 'audio';
      } else if (
        (data as any).imageUrl ||
        (data as any).image ||
        (Array.isArray(rawImages) && rawImages.length > 0) ||
        (Array.isArray(rawImageUrls) && rawImageUrls.length > 0)
      ) {
        msgType = 'image';
      }
    }

    let rawContent = (
      data.content ||
      (data as any).imageUrl ||
      (data as any).image ||
      (data as any).mediaUrl ||
      (data as any).imageKey ||
      (data as any).audioUrl ||
      (data as any).audio ||
      (data as any).voiceUrl ||
      (data as any).url ||
      (data as any).fileUrl ||
      ''
    );
    if (!rawContent && Array.isArray(rawImages) && rawImages.length > 0) {
      const firstImg = rawImages[0];
      rawContent = typeof firstImg === 'string'
        ? firstImg
        : firstImg?.url ||
          firstImg?.imageUrl ||
          firstImg?.uri ||
          firstImg?.path ||
          firstImg?.mediaUrl ||
          firstImg?.key ||
          '';
    }
    if (!rawContent && Array.isArray(rawImageUrls) && rawImageUrls.length > 0) {
      const firstUrl = rawImageUrls[0];
      rawContent = typeof firstUrl === 'string' ? firstUrl : (firstUrl as any)?.url || (firstUrl as any)?.imageUrl || '';
    }
    let messageContent = (typeof rawContent === 'string' ? rawContent : '').trim();

    // 1. Gather all direct file attachments (support single or multiple files)
    let attachedFiles: Express.Multer.File[] = [];
    if (Array.isArray((data as any).files)) {
      attachedFiles = (data as any).files;
    } else if ((data as any).files && typeof (data as any).files === 'object') {
      const fileObj = (data as any).files as Record<string, Express.Multer.File[]>;
      for (const k of ['image', 'images', 'file', 'files', 'photo', 'photos', 'media', 'attachment', 'audio', 'voice', 'recording']) {
        if (Array.isArray(fileObj[k]) && fileObj[k].length > 0) {
          attachedFiles.push(...fileObj[k]);
        }
      }
      if (attachedFiles.length === 0) {
        for (const list of Object.values(fileObj)) {
          if (Array.isArray(list)) {
            attachedFiles.push(...list);
          }
        }
      }
    }
    if (attachedFiles.length === 0 && (data as any).file) {
      attachedFiles = [(data as any).file];
    }

    const uploadedImages: Array<{
      url: string;
      imageUrl: string;
      thumbnailUrl: string;
      mediaUrl: string;
      key: string;
      mimeType: string;
      fileSize: number;
    }> = [];

    const uploadedAudios: Array<{
      url: string;
      audioUrl: string;
      voiceUrl: string;
      mediaUrl: string;
      key: string;
      mimeType: string;
      fileSize: number;
      duration?: number;
      durationMs?: number;
    }> = [];

    // Helper: resolve exact audio MIME type for mobile voice notes
    const resolveAudioMime = (origName: string, mime: string): string => {
      if (mime && mime.startsWith('audio/') && mime !== 'audio/octet-stream') {
        return mime;
      }
      const lower = origName.toLowerCase();
      if (lower.endsWith('.m4a')) return 'audio/m4a';
      if (lower.endsWith('.mp3')) return 'audio/mpeg';
      if (lower.endsWith('.wav')) return 'audio/wav';
      if (lower.endsWith('.aac')) return 'audio/aac';
      if (lower.endsWith('.caf')) return 'audio/x-caf';
      if (lower.endsWith('.ogg')) return 'audio/ogg';
      if (lower.endsWith('.webm')) return 'audio/webm';
      if (lower.endsWith('.3gp') || lower.endsWith('.3gpp')) return 'audio/3gpp';
      if (lower.endsWith('.amr')) return 'audio/amr';
      if (lower.endsWith('.flac')) return 'audio/flac';
      if (lower.endsWith('.opus')) return 'audio/opus';
      return 'audio/m4a';
    };

    // 1. Process all attached multipart files (support 3-4 images, audio, or both)
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        if (!file || !file.buffer) continue;
        const mime = (file.mimetype || '').toLowerCase();
        const origName = (file.originalname || '').toLowerCase();
        const field = (file.fieldname || '').toLowerCase();

        const isAudio =
          mime.startsWith('audio/') ||
          ['audio', 'voice', 'voicenote', 'recording', 'sound'].includes(field) ||
          /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus)$/i.test(origName) ||
          (msgType === 'audio' && !mime.startsWith('image/'));

        if (isAudio) {
          const audioMime = resolveAudioMime(origName, mime);
          const s3Key = await s3Service.uploadMedia(file.buffer, senderId, audioMime, 'chat');
          const audioPubUrl = s3Service.getPublicUrl(s3Key);
          const dur =
            (data as any).duration !== undefined
              ? Number((data as any).duration)
              : metadataObj.duration !== undefined
                ? Number(metadataObj.duration)
                : undefined;
          const durMs =
            (data as any).durationMs !== undefined
              ? Number((data as any).durationMs)
              : dur !== undefined
                ? dur * 1000
                : undefined;

          uploadedAudios.push({
            url: audioPubUrl,
            audioUrl: audioPubUrl,
            voiceUrl: audioPubUrl,
            mediaUrl: audioPubUrl,
            key: s3Key,
            mimeType: audioMime,
            fileSize: file.size,
            duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
            durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
          });
        } else {
          const imgMime = file.mimetype || 'image/jpeg';
          const s3Key = await s3Service.uploadMedia(file.buffer, senderId, imgMime, 'chat');
          if (imgMime.startsWith('image/')) {
            s3Service.generateAndUploadThumbnail(s3Key, file.buffer).catch(() => {});
          }
          const pubUrl = s3Service.getPublicUrl(s3Key);
          const thUrl = s3Service.getThumbnailUrl(s3Key);
          uploadedImages.push({
            url: pubUrl,
            imageUrl: pubUrl,
            thumbnailUrl: thUrl,
            mediaUrl: pubUrl,
            key: s3Key,
            mimeType: imgMime,
            fileSize: file.size,
          });
        }
      }
    }

    // 2. Process image arrays passed via JSON (data.images or data.imageUrls)
    if (Array.isArray(rawImages) && rawImages.length > 0) {
      for (const item of rawImages) {
        const raw =
          typeof item === 'string'
            ? item
            : item?.url ||
              item?.imageUrl ||
              item?.uri ||
              item?.path ||
              item?.mediaUrl ||
              item?.key ||
              '';
        if (!raw) continue;
        const cleanKey = s3Service.extractKey(raw);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: item?.mimeType || 'image/jpeg',
          fileSize: item?.fileSize || 0,
        });
      }
    }
    if (Array.isArray(rawImageUrls) && rawImageUrls.length > 0) {
      for (const rawItem of rawImageUrls) {
        const raw = typeof rawItem === 'string' ? rawItem : (rawItem as any)?.url || (rawItem as any)?.imageUrl || '';
        if (!raw || typeof raw !== 'string') continue;
        const cleanKey = s3Service.extractKey(raw);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: 'image/jpeg',
          fileSize: 0,
        });
      }
    }

    if (uploadedImages.length > 0) {
      msgType = 'image';
      if (!messageContent || messageContent === '__FILE_ATTACHMENT__') {
        messageContent = uploadedImages[0].key;
      }
    }

    // 3. Process audio passed via JSON (data.audioUrl or data.voiceUrl or data.audio)
    const bodyAudio = (data as any).audioUrl || (data as any).voiceUrl || (data as any).audio;
    if (bodyAudio && uploadedAudios.length === 0) {
      const cleanKey = s3Service.extractKey(bodyAudio);
      const audioPubUrl = s3Service.getPublicUrl(cleanKey);
      const dur =
        (data as any).duration !== undefined
          ? Number((data as any).duration)
          : metadataObj.duration !== undefined
            ? Number(metadataObj.duration)
            : undefined;
      const durMs =
        (data as any).durationMs !== undefined
          ? Number((data as any).durationMs)
          : dur !== undefined
            ? dur * 1000
            : undefined;

      uploadedAudios.push({
        url: audioPubUrl,
        audioUrl: audioPubUrl,
        voiceUrl: audioPubUrl,
        mediaUrl: audioPubUrl,
        key: cleanKey,
        mimeType: 'audio/mpeg',
        fileSize: 0,
        duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
        durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
      });
    }

    // 4. Handle Base64 or single S3 key for image / audio in messageContent
    if ((msgType === 'image' || (!msgType && (data as any).imageUrl)) && uploadedImages.length === 0) {
      const isBase64DataUri = messageContent.startsWith('data:image/');
      const isPureBase64 =
        !messageContent.includes(' ') &&
        !messageContent.startsWith('http') &&
        !messageContent.startsWith('chat/') &&
        !messageContent.startsWith('uploads/') &&
        messageContent.length > 500;

      if (isBase64DataUri || isPureBase64) {
        let mimeType = 'image/jpeg';
        let base64Data = messageContent;

        if (isBase64DataUri) {
          const match = messageContent.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const s3Key = await s3Service.uploadMedia(buffer, senderId, mimeType, 'chat');
        s3Service.generateAndUploadThumbnail(s3Key, buffer).catch(() => {});

        const pubUrl = s3Service.getPublicUrl(s3Key);
        const thUrl = s3Service.getThumbnailUrl(s3Key);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: s3Key,
          mimeType,
          fileSize: buffer.length,
        });
      } else if (messageContent && messageContent !== '__FILE_ATTACHMENT__') {
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

        const cleanKey = s3Service.extractKey(messageContent);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: 'image/jpeg',
          fileSize: 0,
        });
      }
    } else if ((msgType === 'audio' || (!msgType && (data as any).audioUrl)) && uploadedAudios.length === 0) {
      const isBase64Audio =
        messageContent.startsWith('data:audio/') ||
        (!messageContent.includes(' ') &&
          !messageContent.startsWith('http') &&
          !messageContent.startsWith('chat/') &&
          !messageContent.startsWith('uploads/') &&
          messageContent.length > 500);

      if (isBase64Audio) {
        let mimeType = 'audio/mpeg';
        let base64Data = messageContent;

        if (messageContent.startsWith('data:audio/')) {
          const match = messageContent.match(/^data:(audio\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const s3Key = await s3Service.uploadMedia(buffer, senderId, mimeType, 'chat');
        const audioPublicUrl = s3Service.getPublicUrl(s3Key);
        const dur =
          (data as any).duration !== undefined
            ? Number((data as any).duration)
            : metadataObj.duration !== undefined
              ? Number(metadataObj.duration)
              : undefined;
        const durMs =
          (data as any).durationMs !== undefined
            ? Number((data as any).durationMs)
            : dur !== undefined
              ? dur * 1000
              : undefined;

        uploadedAudios.push({
          url: audioPublicUrl,
          audioUrl: audioPublicUrl,
          voiceUrl: audioPublicUrl,
          mediaUrl: audioPublicUrl,
          key: s3Key,
          mimeType,
          fileSize: buffer.length,
          duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
          durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
        });
      } else if (messageContent && messageContent !== '__FILE_ATTACHMENT__') {
        const cleanKey = s3Service.extractKey(messageContent);
        const audioPublicUrl = s3Service.getPublicUrl(cleanKey);
        const dur =
          (data as any).duration !== undefined
            ? Number((data as any).duration)
            : metadataObj.duration !== undefined
              ? Number(metadataObj.duration)
              : undefined;
        const durMs =
          (data as any).durationMs !== undefined
            ? Number((data as any).durationMs)
            : dur !== undefined
              ? dur * 1000
              : undefined;

        uploadedAudios.push({
          url: audioPublicUrl,
          audioUrl: audioPublicUrl,
          voiceUrl: audioPublicUrl,
          mediaUrl: audioPublicUrl,
          key: cleanKey,
          mimeType: 'audio/mpeg',
          fileSize: 0,
          duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
          durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
        });
      }
    }

    // 5. Validation for empty content when no attachments exist
    if (uploadedImages.length === 0 && uploadedAudios.length === 0) {
      if (msgType === 'image') {
        throw new ChatServiceError('Image URL or storage key is required in content', 400);
      }
      if (msgType === 'audio') {
        throw new ChatServiceError('Audio URL or storage key is required in content', 400);
      }
      if (msgType === 'text' && !messageContent) {
        throw new ChatServiceError('Message content cannot be empty', 400);
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

        const imageUrl =
          meta?.imageUrl ||
          (existingMessage.messageType === 'image' ? s3Service.getPublicUrl(existingMessage.content) : undefined);
        const thumbnailUrl =
          meta?.thumbnailUrl ||
          (existingMessage.messageType === 'image' ? s3Service.getThumbnailUrl(existingMessage.content) : undefined);
        const audioUrl =
          meta?.audioUrl ||
          meta?.voiceUrl ||
          (existingMessage.messageType === 'audio' ? s3Service.getPublicUrl(existingMessage.content) : undefined);
        const mediaUrl = meta?.mediaUrl || audioUrl || imageUrl;
        const url = audioUrl || imageUrl || mediaUrl;

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
          createdAt: existingMessage.createdAt,
          isMine: true,
          isSender: true,
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
          imageUrl,
          thumbnailUrl,
          mediaUrl,
          audioUrl,
          voiceUrl: audioUrl,
          url,
          duration: meta?.duration,
          durationMs: meta?.durationMs,
          images: meta?.images,
          imageUrls: meta?.imageUrls || (meta?.images ? meta.images.map((i: any) => i.url || i.imageUrl) : undefined),
        };
      }
    }

    // 6. Build the items to insert into chat_messages
    const itemsToCreate: Array<{
      type: ChatMessageType;
      content: string;
      meta: Record<string, any>;
      preview: string;
    }> = [];

    // All images (creates distinct chat message row for each image so ALL images display in chat UI)
    for (let i = 0; i < uploadedImages.length; i++) {
      const img = uploadedImages[i];
      const itemMeta: Record<string, any> = {
        ...metadataObj,
        imageUrl: img.imageUrl,
        thumbnailUrl: img.thumbnailUrl,
        mediaUrl: img.mediaUrl,
        url: img.url,
        mimeType: img.mimeType,
        fileSize: img.fileSize,
        images: uploadedImages,
        imageUrls: uploadedImages.map((x) => x.imageUrl),
      };
      if ((data as any).caption && i === 0) {
        itemMeta.caption = (data as any).caption;
      }
      itemsToCreate.push({
        type: 'image',
        content: img.key,
        meta: itemMeta,
        preview: '📷 Photo',
      });
    }

    // All audios (creates distinct chat message row for each audio note)
    for (const aud of uploadedAudios) {
      const itemMeta: Record<string, any> = {
        ...metadataObj,
        audioUrl: aud.audioUrl,
        voiceUrl: aud.voiceUrl,
        mediaUrl: aud.mediaUrl,
        url: aud.url,
        mimeType: aud.mimeType,
        fileSize: aud.fileSize,
      };
      if (aud.duration !== undefined) {
        itemMeta.duration = aud.duration;
      }
      if (aud.durationMs !== undefined) {
        itemMeta.durationMs = aud.durationMs;
      }
      itemsToCreate.push({
        type: 'audio',
        content: aud.key,
        meta: itemMeta,
        preview: '🎤 Voice message',
      });
    }

    // If neither image nor audio, handle location, contact, or text message
    if (itemsToCreate.length === 0) {
      let preview = messageContent;
      if (msgType === 'location') {
        preview = metadataObj.name ? `📍 ${metadataObj.name}` : '📍 Location';
      } else if (msgType === 'contact') {
        preview = metadataObj.name ? `👤 ${metadataObj.name}` : '👤 Contact';
      }
      itemsToCreate.push({
        type: msgType,
        content: messageContent,
        meta: { ...metadataObj },
        preview,
      });
    }

    // 7. Execute database write inside an atomic transaction
    const t = await sequelize.transaction();
    const savedMessages: ChatMessage[] = [];
    let lastMessagePreview: string = '';

    try {
      for (let i = 0; i < itemsToCreate.length; i++) {
        const item = itemsToCreate[i];
        const clientMsgId =
          data.clientMessageId
            ? i === 0
              ? data.clientMessageId
              : `${data.clientMessageId}-${i}`
            : undefined;

        if (clientMsgId) {
          item.meta.clientMessageId = clientMsgId;
        }

        const metadataPayload =
          Object.keys(item.meta).length > 0 ? JSON.stringify(item.meta) : null;

        const saved = await ChatMessage.create(
          {
            conversationId,
            senderId,
            recipientId,
            content: item.content,
            messageType: item.type,
            metadata: metadataPayload,
            isRead: false,
          },
          { transaction: t }
        );

        savedMessages.push(saved);
        lastMessagePreview = item.preview;
      }

      const lastSavedMessage = savedMessages[savedMessages.length - 1];
      conversation.lastMessage = lastMessagePreview;
      conversation.lastMessageAt = lastSavedMessage.createdAt;
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

    // 8. Build DTOs for all created messages
    const senderUser = await User.findByPk(senderId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });

    const allDtos: ChatMessageDTO[] = [];
    for (const savedMessage of savedMessages) {
      let parsedMeta: any = null;
      if (savedMessage.metadata) {
        try {
          parsedMeta = JSON.parse(savedMessage.metadata);
        } catch {
          parsedMeta = savedMessage.metadata;
        }
      }

      const imageUrl =
        parsedMeta?.imageUrl ||
        (savedMessage.messageType === 'image' ? s3Service.getPublicUrl(savedMessage.content) : undefined);
      const thumbnailUrl =
        parsedMeta?.thumbnailUrl ||
        (savedMessage.messageType === 'image' ? s3Service.getThumbnailUrl(savedMessage.content) : undefined);
      const audioUrl =
        parsedMeta?.audioUrl ||
        parsedMeta?.voiceUrl ||
        (savedMessage.messageType === 'audio' ? s3Service.getPublicUrl(savedMessage.content) : undefined);
      const mediaUrl = parsedMeta?.mediaUrl || audioUrl || imageUrl;
      const url = audioUrl || imageUrl || mediaUrl;

      const dur =
        parsedMeta?.duration !== undefined
          ? Number(parsedMeta.duration)
          : undefined;
      const durMs =
        parsedMeta?.durationMs !== undefined
          ? Number(parsedMeta.durationMs)
          : dur !== undefined
            ? dur * 1000
            : undefined;

      const dto: ChatMessageDTO = {
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
        createdAt: savedMessage.createdAt,
        isMine: true,
        isSender: true,
        isPinned: false,
        pinnedAt: null,
        pinnedBy: null,
        isEdited: !!parsedMeta?.isEdited,
        editedAt: parsedMeta?.editedAt || null,
        replyToMessageId: parsedMeta?.replyToMessageId || null,
        replyTo: parsedMeta?.replyTo || null,
        sender: senderUser
          ? {
            id: senderUser.id,
            displayName: resolveChatDisplayName(senderUser),
            profileImageUrl: formatMediaUrl(senderUser.profilePicture),
          }
          : undefined,
        imageUrl,
        thumbnailUrl,
        mediaUrl,
        audioUrl,
        voiceUrl: audioUrl,
        url,
        duration: dur,
        durationMs: durMs,
        images: parsedMeta?.images || (uploadedImages.length > 0 ? uploadedImages : undefined),
        imageUrls: parsedMeta?.imageUrls || (uploadedImages.length > 0 ? uploadedImages.map((i) => i.imageUrl) : undefined),
      };

      allDtos.push(dto);
    }

    // 9. Real-Time Delivery via Socket.IO for every created message
    try {
      const io = getSocketServer();
      const recipientRoom = getUserRoomName(recipientId);
      const senderRoom = getUserRoomName(senderId);

      for (const dto of allDtos) {
        const recipientPayload = {
          ...dto,
          isMine: false,
          isSender: false,
        };

        // Deliver to recipient's multi-device room across all standard event names
        io.to(recipientRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(recipientRoom).emit('message:received' as any, recipientPayload);
        io.to(recipientRoom).emit('new_message' as any, recipientPayload);

        // Synchronize sender's other connected devices (e.g. tablet, web, mobile)
        io.to(senderRoom).emit('chat:message_sent' as any, dto);
        io.to(senderRoom).emit('message:sent' as any, dto);
        io.to(senderRoom).emit('new_message' as any, dto);
        io.to(senderRoom).emit('message:received' as any, dto);
        io.to(senderRoom).emit('chat:message_received' as any, dto);
      }

      // Real-time conversation list updates for both sender and recipient
      await this.emitConversationUpdate(
        conversationId,
        savedMessages[savedMessages.length - 1],
        lastMessagePreview,
        senderId,
        recipientId
      );
    } catch {
      // Socket server may not be bound in isolated test contexts; continue gracefully
    }

    const primaryDto: ChatMessageDTO = {
      ...allDtos[0],
      messages: allDtos.map((d) => ({ ...d })),
    };
    if (uploadedAudios.length > 0 && !primaryDto.audioUrl) {
      primaryDto.audioUrl = uploadedAudios[0].audioUrl;
      primaryDto.voiceUrl = uploadedAudios[0].voiceUrl;
      primaryDto.duration = uploadedAudios[0].duration;
      primaryDto.durationMs = uploadedAudios[0].durationMs;
    }
    return primaryDto;
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

    if (data.conversationId && (!data.recipientIds || data.recipientIds.length === 0) && !(data as any).recipientId) {
      const conv = await Conversation.findByPk(data.conversationId);
      if (!conv || conv.isDeletedForEveryone) {
        throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
      }
      if (conv.user1Id !== senderId && conv.user2Id !== senderId) {
        throw new ChatServiceError('You are not a participant in this conversation', 403, 'FORBIDDEN');
      }
      const otherId = getOtherParticipantId(conv, senderId);
      targetRecipientIds = [otherId];
      directConversationMap.set(otherId, conv);
    } else {
      const rawIds: string[] = [];
      if (Array.isArray(data.recipientIds)) {
        rawIds.push(...data.recipientIds);
      } else if (typeof (data as any).recipientIds === 'string' && (data as any).recipientIds.trim()) {
        const s = (data as any).recipientIds.trim();
        rawIds.push(...(s.includes(',') ? s.split(',').map((x: string) => x.trim()).filter(Boolean) : [s]));
      } else if ((data as any).recipientId) {
        rawIds.push((data as any).recipientId);
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
        } catch { }
      }
    }

    let msgType: ChatMessageType = (data.messageType || data.type || 'text') as ChatMessageType;
    if (!data.messageType && !data.type) {
      if ((data as any).audioUrl || (data as any).audio || (data as any).voiceUrl) {
        msgType = 'audio';
      } else if ((data as any).imageUrl || (data as any).image || (data as any).images || (data as any).imageUrls) {
        msgType = 'image';
      }
    }

    let rawContent = (
      data.content ||
      (data as any).imageUrl ||
      (data as any).image ||
      (data as any).mediaUrl ||
      (data as any).imageKey ||
      (data as any).audioUrl ||
      (data as any).audio ||
      (data as any).voiceUrl ||
      (data as any).url ||
      (data as any).fileUrl ||
      ''
    );
    if (typeof rawContent !== 'string' && Array.isArray((data as any).images) && (data as any).images.length > 0) {
      const firstImg = (data as any).images[0];
      rawContent = typeof firstImg === 'string' ? firstImg : firstImg?.url || firstImg?.imageUrl || '';
    }
    let messageContent = (typeof rawContent === 'string' ? rawContent : '').trim();

    // 1. Direct file attachment on broadcast: upload to S3 ONCE before distributing
    let attachedFiles: Express.Multer.File[] = [];
    if (Array.isArray((data as any).files)) {
      attachedFiles = (data as any).files;
    } else if ((data as any).files && typeof (data as any).files === 'object') {
      const fileObj = (data as any).files as Record<string, Express.Multer.File[]>;
      for (const k of ['image', 'images', 'file', 'files', 'photo', 'photos', 'media', 'attachment', 'audio', 'voice', 'recording']) {
        if (Array.isArray(fileObj[k]) && fileObj[k].length > 0) {
          attachedFiles.push(...fileObj[k]);
        }
      }
      if (attachedFiles.length === 0) {
        for (const list of Object.values(fileObj)) {
          if (Array.isArray(list)) {
            attachedFiles.push(...list);
          }
        }
      }
    }
    if (attachedFiles.length === 0 && (data as any).file) {
      attachedFiles = [(data as any).file];
    }

    const uploadedImages: Array<{
      url: string;
      imageUrl: string;
      thumbnailUrl: string;
      mediaUrl: string;
      key: string;
      mimeType: string;
      fileSize: number;
    }> = [];

    const uploadedAudios: Array<{
      url: string;
      audioUrl: string;
      voiceUrl: string;
      mediaUrl: string;
      key: string;
      mimeType: string;
      fileSize: number;
      duration?: number;
      durationMs?: number;
    }> = [];

    // Helper: resolve exact audio MIME type for mobile voice notes
    const resolveAudioMimeMulti = (origName: string, mime: string): string => {
      if (mime && mime.startsWith('audio/') && mime !== 'audio/octet-stream') {
        return mime;
      }
      const lower = origName.toLowerCase();
      if (lower.endsWith('.m4a')) return 'audio/m4a';
      if (lower.endsWith('.mp3')) return 'audio/mpeg';
      if (lower.endsWith('.wav')) return 'audio/wav';
      if (lower.endsWith('.aac')) return 'audio/aac';
      if (lower.endsWith('.caf')) return 'audio/x-caf';
      if (lower.endsWith('.ogg')) return 'audio/ogg';
      if (lower.endsWith('.webm')) return 'audio/webm';
      if (lower.endsWith('.3gp') || lower.endsWith('.3gpp')) return 'audio/3gpp';
      if (lower.endsWith('.amr')) return 'audio/amr';
      if (lower.endsWith('.flac')) return 'audio/flac';
      if (lower.endsWith('.opus')) return 'audio/opus';
      return 'audio/m4a';
    };

    // 1. Direct file attachment on broadcast: upload to S3 ONCE before distributing
    if (attachedFiles.length > 0) {
      for (const file of attachedFiles) {
        if (!file || !file.buffer) continue;
        const mime = (file.mimetype || '').toLowerCase();
        const origName = (file.originalname || '').toLowerCase();
        const field = (file.fieldname || '').toLowerCase();

        const isAudio =
          mime.startsWith('audio/') ||
          ['audio', 'voice', 'voicenote', 'recording', 'sound'].includes(field) ||
          /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus)$/i.test(origName) ||
          (msgType === 'audio' && !mime.startsWith('image/'));

        if (isAudio) {
          const audioMime = resolveAudioMimeMulti(origName, mime);
          const s3Key = await s3Service.uploadMedia(file.buffer, senderId, audioMime, 'chat');
          const audioPublicUrl = s3Service.getPublicUrl(s3Key);
          const dur =
            (data as any).duration !== undefined
              ? Number((data as any).duration)
              : metadataObj.duration !== undefined
                ? Number(metadataObj.duration)
                : undefined;
          const durMs =
            (data as any).durationMs !== undefined
              ? Number((data as any).durationMs)
              : dur !== undefined
                ? dur * 1000
                : undefined;

          uploadedAudios.push({
            url: audioPublicUrl,
            audioUrl: audioPublicUrl,
            voiceUrl: audioPublicUrl,
            mediaUrl: audioPublicUrl,
            key: s3Key,
            mimeType: audioMime,
            fileSize: file.size,
            duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
            durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
          });
        } else {
          const imgMime = file.mimetype || 'image/jpeg';
          const s3Key = await s3Service.uploadMedia(file.buffer, senderId, imgMime, 'chat');
          if (imgMime.startsWith('image/')) {
            s3Service.generateAndUploadThumbnail(s3Key, file.buffer).catch(() => {});
          }
          const pubUrl = s3Service.getPublicUrl(s3Key);
          const thUrl = s3Service.getThumbnailUrl(s3Key);
          uploadedImages.push({
            url: pubUrl,
            imageUrl: pubUrl,
            thumbnailUrl: thUrl,
            mediaUrl: pubUrl,
            key: s3Key,
            mimeType: imgMime,
            fileSize: file.size,
          });
        }
      }
    }

    // 2. Process image arrays passed via JSON (data.images or data.imageUrls)
    if (Array.isArray((data as any).images) && (data as any).images.length > 0) {
      for (const item of (data as any).images) {
        const raw = typeof item === 'string' ? item : item?.url || item?.imageUrl || item?.key || '';
        if (!raw) continue;
        const cleanKey = s3Service.extractKey(raw);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: item?.mimeType || 'image/jpeg',
          fileSize: item?.fileSize || 0,
        });
      }
    }
    if (Array.isArray((data as any).imageUrls) && (data as any).imageUrls.length > 0) {
      for (const raw of (data as any).imageUrls) {
        if (!raw || typeof raw !== 'string') continue;
        const cleanKey = s3Service.extractKey(raw);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: 'image/jpeg',
          fileSize: 0,
        });
      }
    }

    // 3. Process audio passed via JSON (data.audioUrl or data.voiceUrl or data.audio)
    const bodyAudio = (data as any).audioUrl || (data as any).voiceUrl || (data as any).audio;
    if (bodyAudio && uploadedAudios.length === 0) {
      const cleanKey = s3Service.extractKey(bodyAudio);
      const audioPubUrl = s3Service.getPublicUrl(cleanKey);
      const dur =
        (data as any).duration !== undefined
          ? Number((data as any).duration)
          : metadataObj.duration !== undefined
            ? Number(metadataObj.duration)
            : undefined;
      const durMs =
        (data as any).durationMs !== undefined
          ? Number((data as any).durationMs)
          : dur !== undefined
            ? dur * 1000
            : undefined;

      uploadedAudios.push({
        url: audioPubUrl,
        audioUrl: audioPubUrl,
        voiceUrl: audioPubUrl,
        mediaUrl: audioPubUrl,
        key: cleanKey,
        mimeType: 'audio/mpeg',
        fileSize: 0,
        duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
        durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
      });
    }

    // 4. Handle Base64 or single S3 key for image / audio in messageContent
    if ((msgType === 'image' || (!msgType && (data as any).imageUrl)) && uploadedImages.length === 0) {
      const isBase64DataUri = messageContent.startsWith('data:image/');
      const isPureBase64 =
        !messageContent.includes(' ') &&
        !messageContent.startsWith('http') &&
        !messageContent.startsWith('chat/') &&
        !messageContent.startsWith('uploads/') &&
        messageContent.length > 500;

      if (isBase64DataUri || isPureBase64) {
        let mimeType = 'image/jpeg';
        let base64Data = messageContent;

        if (isBase64DataUri) {
          const match = messageContent.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const s3Key = await s3Service.uploadMedia(buffer, senderId, mimeType, 'chat');
        s3Service.generateAndUploadThumbnail(s3Key, buffer).catch(() => {});

        const pubUrl = s3Service.getPublicUrl(s3Key);
        const thUrl = s3Service.getThumbnailUrl(s3Key);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: s3Key,
          mimeType,
          fileSize: buffer.length,
        });
      } else if (messageContent && messageContent !== '__FILE_ATTACHMENT__') {
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

        const cleanKey = s3Service.extractKey(messageContent);
        const pubUrl = s3Service.getPublicUrl(cleanKey);
        const thUrl = s3Service.getThumbnailUrl(cleanKey);
        uploadedImages.push({
          url: pubUrl,
          imageUrl: pubUrl,
          thumbnailUrl: thUrl,
          mediaUrl: pubUrl,
          key: cleanKey,
          mimeType: 'image/jpeg',
          fileSize: 0,
        });
      }
    } else if ((msgType === 'audio' || (!msgType && (data as any).audioUrl)) && uploadedAudios.length === 0) {
      const isBase64Audio =
        messageContent.startsWith('data:audio/') ||
        (!messageContent.includes(' ') &&
          !messageContent.startsWith('http') &&
          !messageContent.startsWith('chat/') &&
          !messageContent.startsWith('uploads/') &&
          messageContent.length > 500);

      if (isBase64Audio) {
        let mimeType = 'audio/mpeg';
        let base64Data = messageContent;

        if (messageContent.startsWith('data:audio/')) {
          const match = messageContent.match(/^data:(audio\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }

        const buffer = Buffer.from(base64Data, 'base64');
        const s3Key = await s3Service.uploadMedia(buffer, senderId, mimeType, 'chat');
        const audioPublicUrl = s3Service.getPublicUrl(s3Key);
        const dur =
          (data as any).duration !== undefined
            ? Number((data as any).duration)
            : metadataObj.duration !== undefined
              ? Number(metadataObj.duration)
              : undefined;
        const durMs =
          (data as any).durationMs !== undefined
            ? Number((data as any).durationMs)
            : dur !== undefined
              ? dur * 1000
              : undefined;

        uploadedAudios.push({
          url: audioPublicUrl,
          audioUrl: audioPublicUrl,
          voiceUrl: audioPublicUrl,
          mediaUrl: audioPublicUrl,
          key: s3Key,
          mimeType,
          fileSize: buffer.length,
          duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
          durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
        });
      } else if (messageContent && messageContent !== '__FILE_ATTACHMENT__') {
        const cleanKey = s3Service.extractKey(messageContent);
        const audioPublicUrl = s3Service.getPublicUrl(cleanKey);
        const dur =
          (data as any).duration !== undefined
            ? Number((data as any).duration)
            : metadataObj.duration !== undefined
              ? Number(metadataObj.duration)
              : undefined;
        const durMs =
          (data as any).durationMs !== undefined
            ? Number((data as any).durationMs)
            : dur !== undefined
              ? dur * 1000
              : undefined;

        uploadedAudios.push({
          url: audioPublicUrl,
          audioUrl: audioPublicUrl,
          voiceUrl: audioPublicUrl,
          mediaUrl: audioPublicUrl,
          key: cleanKey,
          mimeType: 'audio/mpeg',
          fileSize: 0,
          duration: dur !== undefined && !Number.isNaN(dur) ? dur : undefined,
          durationMs: durMs !== undefined && !Number.isNaN(durMs) ? durMs : undefined,
        });
      }
    }

    if (uploadedImages.length > 0) {
      messageContent = uploadedImages[0].key;
      data.content = messageContent;
    } else if (uploadedAudios.length > 0) {
      messageContent = uploadedAudios[0].key;
      data.content = messageContent;
    }

    // 5. Validation for empty content when no attachments exist
    if (uploadedImages.length === 0 && uploadedAudios.length === 0) {
      if (msgType === 'image') {
        throw new ChatServiceError('Image URL or storage key is required in content', 400);
      }
      if (msgType === 'audio') {
        throw new ChatServiceError('Audio URL or storage key is required in content', 400);
      }
      if (msgType === 'text' && !messageContent) {
        throw new ChatServiceError('Message content cannot be empty', 400);
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
        const otherId = getOtherParticipantId(conv, senderId);
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
      let savedMessage: ChatMessage | null = null;
      let lastMessagePreview: string = '';
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

            const imageUrl =
              meta?.imageUrl ||
              (existingMessage.messageType === 'image' ? s3Service.getPublicUrl(existingMessage.content) : undefined);
            const thumbnailUrl =
              meta?.thumbnailUrl ||
              (existingMessage.messageType === 'image' ? s3Service.getThumbnailUrl(existingMessage.content) : undefined);
            const audioUrl =
              meta?.audioUrl ||
              (existingMessage.messageType === 'audio' ? s3Service.getPublicUrl(existingMessage.content) : undefined);
            const mediaUrl = meta?.mediaUrl || audioUrl || imageUrl;
            const url = audioUrl || imageUrl || mediaUrl;

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
              createdAt: existingMessage.createdAt,
              isMine: true,
              isSender: true,
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
              imageUrl,
              thumbnailUrl,
              mediaUrl,
              audioUrl,
              url,
              duration: meta?.duration,
              images: meta?.images,
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

        // Build the items to insert into chat_messages for this recipient
        const itemsToCreate: Array<{
          type: ChatMessageType;
          content: string;
          meta: Record<string, any>;
          preview: string;
        }> = [];

        // All images
        for (let i = 0; i < uploadedImages.length; i++) {
          const img = uploadedImages[i];
          const itemMeta: Record<string, any> = {
            ...metadataObj,
            imageUrl: img.imageUrl,
            thumbnailUrl: img.thumbnailUrl,
            mediaUrl: img.mediaUrl,
            url: img.url,
            mimeType: img.mimeType,
            fileSize: img.fileSize,
            images: uploadedImages,
            imageUrls: uploadedImages.map((x) => x.imageUrl),
          };
          if ((data as any).caption && i === 0) {
            itemMeta.caption = (data as any).caption;
          }
          itemsToCreate.push({
            type: 'image',
            content: img.key,
            meta: itemMeta,
            preview: '📷 Photo',
          });
        }

        // All audios
        for (const aud of uploadedAudios) {
          const itemMeta: Record<string, any> = {
            ...metadataObj,
            audioUrl: aud.audioUrl,
            voiceUrl: aud.voiceUrl,
            mediaUrl: aud.mediaUrl,
            url: aud.url,
            mimeType: aud.mimeType,
            fileSize: aud.fileSize,
          };
          if (aud.duration !== undefined) {
            itemMeta.duration = aud.duration;
          }
          if (aud.durationMs !== undefined) {
            itemMeta.durationMs = aud.durationMs;
          }
          itemsToCreate.push({
            type: 'audio',
            content: aud.key,
            meta: itemMeta,
            preview: '🎤 Voice message',
          });
        }

        if (itemsToCreate.length === 0) {
          let preview = messageContent;
          if (msgType === 'location') {
            preview = metadataObj.name ? `📍 ${metadataObj.name}` : '📍 Location';
          } else if (msgType === 'contact') {
            preview = metadataObj.name ? `👤 ${metadataObj.name}` : '👤 Contact';
          }
          itemsToCreate.push({
            type: msgType,
            content: messageContent,
            meta: { ...metadataObj },
            preview,
          });
        }

        const savedMessages: ChatMessage[] = [];
        let lastMessagePreview: string = '';

        for (let i = 0; i < itemsToCreate.length; i++) {
          const item = itemsToCreate[i];
          const clientMsgId =
            clientMessageId
              ? i === 0
                ? clientMessageId
                : `${clientMessageId}-${i}`
              : undefined;

          if (clientMsgId) {
            item.meta.clientMessageId = clientMsgId;
          }

          const metadataPayload =
            Object.keys(item.meta).length > 0 ? JSON.stringify(item.meta) : null;

          const saved = await ChatMessage.create(
            {
              conversationId,
              senderId,
              recipientId,
              content: item.content,
              messageType: item.type,
              metadata: metadataPayload,
              isRead: false,
            },
            { transaction: t }
          );

          savedMessages.push(saved);
          lastMessagePreview = item.preview;
        }

        const lastSaved = savedMessages[savedMessages.length - 1];
        conv.lastMessage = lastMessagePreview;
        conv.lastMessageAt = lastSaved.createdAt;
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

        const recipientDtos: ChatMessageDTO[] = [];
        for (const savedMessage of savedMessages) {
          let parsedMeta: any = null;
          if (savedMessage.metadata) {
            try {
              parsedMeta = JSON.parse(savedMessage.metadata);
            } catch {
              parsedMeta = savedMessage.metadata;
            }
          }

          const imageUrl =
            parsedMeta?.imageUrl ||
            (savedMessage.messageType === 'image' ? s3Service.getPublicUrl(savedMessage.content) : undefined);
          const thumbnailUrl =
            parsedMeta?.thumbnailUrl ||
            (savedMessage.messageType === 'image' ? s3Service.getThumbnailUrl(savedMessage.content) : undefined);
          const audioUrl =
            parsedMeta?.audioUrl ||
            parsedMeta?.voiceUrl ||
            (savedMessage.messageType === 'audio' ? s3Service.getPublicUrl(savedMessage.content) : undefined);
          const mediaUrl = parsedMeta?.mediaUrl || audioUrl || imageUrl;
          const url = audioUrl || imageUrl || mediaUrl;

          const dur =
            parsedMeta?.duration !== undefined
              ? Number(parsedMeta.duration)
              : undefined;
          const durMs =
            parsedMeta?.durationMs !== undefined
              ? Number(parsedMeta.durationMs)
              : dur !== undefined
                ? dur * 1000
                : undefined;

          const dto: ChatMessageDTO = {
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
            createdAt: savedMessage.createdAt,
            isMine: true,
            isSender: true,
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
            imageUrl,
            thumbnailUrl,
            mediaUrl,
            audioUrl,
            voiceUrl: audioUrl,
            url,
            duration: dur,
            durationMs: durMs,
            images: parsedMeta?.images || (uploadedImages.length > 0 ? uploadedImages : undefined),
            imageUrls: parsedMeta?.imageUrls || (uploadedImages.length > 0 ? uploadedImages.map((i) => i.imageUrl) : undefined),
          };

          recipientDtos.push(dto);
        }

        // Real-Time Delivery via Socket.IO
        try {
          const io = getSocketServer();
          const recipientRoom = getUserRoomName(recipientId);
          const senderRoom = getUserRoomName(senderId);

          for (const dto of recipientDtos) {
            const recipientPayload = {
              ...dto,
              isMine: false,
              isSender: false,
            };

            // Deliver to recipient's multi-device room across all standard event names
            io.to(recipientRoom).emit('chat:message_received' as any, recipientPayload);
            io.to(recipientRoom).emit('message:received' as any, recipientPayload);
            io.to(recipientRoom).emit('new_message' as any, recipientPayload);

            // Synchronize sender's other connected devices (e.g. tablet, web, mobile)
            io.to(senderRoom).emit('chat:message_sent' as any, dto);
            io.to(senderRoom).emit('message:sent' as any, dto);
            io.to(senderRoom).emit('new_message' as any, dto);
            io.to(senderRoom).emit('message:received' as any, dto);
            io.to(senderRoom).emit('chat:message_received' as any, dto);
          }

          if (lastSaved) {
            await this.emitConversationUpdate(
              conversationId,
              lastSaved,
              lastMessagePreview,
              senderId,
              recipientId
            );
          }
        } catch {
          // Socket server may not be bound in isolated test contexts; continue gracefully
        }

        const primaryRecipientDto: ChatMessageDTO = {
          ...recipientDtos[0],
          messages: recipientDtos.map((d) => ({ ...d })),
        };
        if (uploadedAudios.length > 0 && !primaryRecipientDto.audioUrl) {
          primaryRecipientDto.audioUrl = uploadedAudios[0].audioUrl;
          primaryRecipientDto.voiceUrl = uploadedAudios[0].voiceUrl;
          primaryRecipientDto.duration = uploadedAudios[0].duration;
          primaryRecipientDto.durationMs = uploadedAudios[0].durationMs;
        }

        results.push({
          recipientId,
          conversationId,
          status: 'success',
          message: primaryRecipientDto,
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

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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

        // Also broadcast conversation:updated to reader so conversation list unread count updates immediately
        const readerRoom = getUserRoomName(currentUserId);
        const conv = await Conversation.findByPk(conversationId);
        if (conv) {
          const otherUser = await User.findByPk(otherUserId, {
            attributes: ['id', 'fullName', 'firstName', 'nickName', 'username', 'profilePicture', 'isFaceVerified', 'isSubscribed'],
          });
          if (otherUser) {
            const isPinned = await ConversationPin.findOne({ where: { conversationId, userId: currentUserId } });
            const userState = await ConversationUserState.findOne({ where: { conversationId, userId: currentUserId } });
            const updatePayload = {
              conversationId,
              id: conversationId,
              lastMessage: conv.lastMessage
                ? {
                    id: lastReadMessageId || boundaryMessage?.id || '',
                    content: conv.lastMessage,
                    messageType: 'text',
                    sentAt: conv.lastMessageAt || conv.updatedAt,
                    createdAt: conv.lastMessageAt || conv.updatedAt,
                  }
                : null,
              lastMessageText: conv.lastMessage || null,
              lastMessageAt: conv.lastMessageAt || null,
              unreadCount,
              participant: {
                userId: otherUser.id,
                id: otherUser.id,
                displayName: resolveChatDisplayName(otherUser),
                name: resolveChatDisplayName(otherUser),
                username: otherUser.username || otherUser.nickName || '',
                profileImageUrl: otherUser.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
                profilePhotoUrl: otherUser.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
                isOnline: isUserConnected(otherUser.id),
              },
              targetUser: {
                id: otherUser.id,
                name: resolveChatDisplayName(otherUser),
                username: otherUser.username || otherUser.nickName || '',
                profilePhotoUrl: otherUser.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
                isVerified: Boolean(otherUser.isFaceVerified),
                isSubscribed: Boolean(otherUser.isSubscribed),
              },
              isPinned: !!isPinned,
              isArchived: !!userState?.isArchived,
              updatedAt: now.toISOString(),
            };
            io.to(readerRoom).emit('conversation:updated', updatePayload);
            io.to(readerRoom).emit('chat:conversation_updated' as any, updatePayload);
            io.to(readerRoom).emit('conversation_updated' as any, updatePayload);
            io.to(readerRoom).emit('conversation:update' as any, updatePayload);
            io.to(readerRoom).emit('conversations:update' as any, updatePayload);
          }
        }
      } catch { }
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

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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
      } catch { }
    }

    return {
      conversationId,
      messageIds: eligibleMessages.map((m) => m.id),
      deliveredCount,
    };
  }

  /**
   * 6c. SYNC DELIVERED MESSAGES (Global or Conversation-scoped)
   * Client device synchronizes delivery status for pending or received messages.
   * Atomically transitions status to 'delivered' and emits real-time delivery receipts to senders.
   */
  public async syncDeliveredMessages(
    currentUserId: string,
    options?: {
      conversationId?: string | null;
      messageIds?: string[];
    }
  ): Promise<{
    deliveredCount: number;
    messageIds: string[];
    syncedAt: string;
    conversationId?: string;
  }> {
    const conversationId = options?.conversationId || undefined;
    const messageIds =
      Array.isArray(options?.messageIds) && options!.messageIds.length > 0
        ? options!.messageIds
        : undefined;

    // If conversationId is specified, verify current user is a valid participant
    if (conversationId) {
      const conversation = await Conversation.findByPk(conversationId, {
        attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone'],
      });

      if (!conversation || conversation.isDeletedForEveryone) {
        throw new ChatServiceError('Conversation not found', 404);
      }

      if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
        throw new ChatServiceError('Conversation not found', 404);
      }
    }

    const whereBase: any = {
      recipientId: currentUserId,
    };

    if (conversationId) {
      whereBase.conversationId = conversationId;
    }

    if (messageIds && messageIds.length > 0) {
      whereBase.id = { [Op.in]: messageIds };
    } else {
      whereBase.isDelivered = false;
    }

    const eligibleMessages = await ChatMessage.findAll({
      where: whereBase,
      attributes: ['id', 'conversationId', 'senderId', 'isDelivered'],
    });

    const now = new Date();

    if (eligibleMessages.length === 0) {
      return {
        deliveredCount: 0,
        messageIds: messageIds && messageIds.length > 0 ? messageIds : [],
        syncedAt: now.toISOString(),
        ...(conversationId ? { conversationId } : {}),
      };
    }

    const undeliveredMessages = eligibleMessages.filter((m) => !m.isDelivered);
    const undeliveredIds = undeliveredMessages.map((m) => m.id);
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

      // Group delivered messages by sender & conversation for real-time receipt dispatch
      const groupedBySender = new Map<string, { conversationId: string; messageIds: string[] }>();
      for (const msg of undeliveredMessages) {
        const key = `${msg.senderId}:${msg.conversationId}`;
        if (!groupedBySender.has(key)) {
          groupedBySender.set(key, { conversationId: msg.conversationId, messageIds: [] });
        }
        groupedBySender.get(key)!.messageIds.push(msg.id);
      }

      try {
        const io = getSocketServer();
        for (const [key, group] of groupedBySender.entries()) {
          const senderId = key.split(':')[0];
          const deliveryPayload = {
            conversationId: group.conversationId,
            recipientId: currentUserId,
            messageIds: group.messageIds,
            deliveredAt: now.toISOString(),
          };
          io.to(getUserRoomName(senderId)).emit('chat:delivery_receipt' as any, deliveryPayload);
          io.to(getUserRoomName(senderId)).emit('message:delivery_receipt' as any, deliveryPayload);
        }
      } catch {}
    }

    return {
      deliveredCount,
      messageIds: eligibleMessages.map((m) => m.id),
      syncedAt: now.toISOString(),
      ...(conversationId ? { conversationId } : {}),
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

    const unreadMessages = await ChatMessage.findAll({
      where,
      attributes: ['id', 'metadata'],
    });

    const validUnread = unreadMessages.filter((m) => {
      if (!m.metadata) return true;
      try {
        const meta = JSON.parse(m.metadata);
        if (meta.isDeletedForEveryone || meta.isDeleted) return false;
        if (Array.isArray(meta.deletedForUserIds) && meta.deletedForUserIds.includes(userId)) return false;
      } catch {}
      return true;
    });

    return validUnread.length;
  }

  /**
   * Dispatches real-time conversation update events (conversation:updated)
   * to both sender and recipient user rooms so their conversation list previews,
   * unread badge counts, and sorting order update immediately without manual pull-to-refresh.
   */
  public async emitConversationUpdate(
    conversationId: string,
    message: {
      id: string;
      content: string;
      messageType?: string;
      senderId: string;
      createdAt: Date | string;
    },
    lastMessagePreview: string,
    senderId: string,
    recipientId: string
  ): Promise<void> {
    try {
      const io = getSocketServer();
      if (!io) return;

      const [senderUser, recipientUser] = await Promise.all([
        User.findByPk(senderId, {
          attributes: ['id', 'fullName', 'firstName', 'nickName', 'username', 'profilePicture', 'isFaceVerified', 'isSubscribed'],
        }),
        User.findByPk(recipientId, {
          attributes: ['id', 'fullName', 'firstName', 'nickName', 'username', 'profilePicture', 'isFaceVerified', 'isSubscribed'],
        }),
      ]);

      if (!senderUser || !recipientUser) return;

      // Check pin status for both participants
      const [senderPin, recipientPin] = await Promise.all([
        ConversationPin.findOne({ where: { conversationId, userId: senderId } }),
        ConversationPin.findOne({ where: { conversationId, userId: recipientId } }),
      ]);

      // Check archive & delete status for both participants
      const [senderState, recipientState] = await Promise.all([
        ConversationUserState.findOne({ where: { conversationId, userId: senderId } }),
        ConversationUserState.findOne({ where: { conversationId, userId: recipientId } }),
      ]);

      // Compute unread counts for both users
      const [recipientUnreadCount, senderUnreadCount] = await Promise.all([
        this.getConversationUnreadCount(recipientId, conversationId),
        this.getConversationUnreadCount(senderId, conversationId),
      ]);

      const messageTimestamp =
        message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt;

      const lastMessageObj = {
        id: message.id,
        content: lastMessagePreview,
        messageType: message.messageType || 'text',
        senderId: message.senderId,
        sentAt: messageTimestamp,
        createdAt: messageTimestamp,
      };

      // Payload customized for Sender's conversation list:
      // Other participant is the Recipient
      const senderPayload = {
        conversationId,
        id: conversationId,
        lastMessage: lastMessageObj,
        lastMessageText: lastMessagePreview,
        lastMessageAt: messageTimestamp,
        unreadCount: senderUnreadCount,
        participant: {
          userId: recipientUser.id,
          id: recipientUser.id,
          displayName: resolveChatDisplayName(recipientUser),
          name: resolveChatDisplayName(recipientUser),
          username: recipientUser.username || recipientUser.nickName || '',
          profileImageUrl: recipientUser.profilePicture
            ? formatMediaUrl(recipientUser.profilePicture)
            : null,
          profilePhotoUrl: recipientUser.profilePicture
            ? formatMediaUrl(recipientUser.profilePicture)
            : null,
          isOnline: isUserConnected(recipientUser.id),
        },
        targetUser: {
          id: recipientUser.id,
          name: resolveChatDisplayName(recipientUser),
          username: recipientUser.username || recipientUser.nickName || '',
          profilePhotoUrl: recipientUser.profilePicture
            ? formatMediaUrl(recipientUser.profilePicture)
            : null,
          isVerified: Boolean(recipientUser.isFaceVerified),
          isSubscribed: Boolean(recipientUser.isSubscribed),
        },
        isPinned: !!senderPin,
        isArchived: !!senderState?.isArchived,
        updatedAt: messageTimestamp,
      };

      // Payload customized for Recipient's conversation list:
      // Other participant is the Sender
      const recipientPayload = {
        conversationId,
        id: conversationId,
        lastMessage: lastMessageObj,
        lastMessageText: lastMessagePreview,
        lastMessageAt: messageTimestamp,
        unreadCount: recipientUnreadCount,
        participant: {
          userId: senderUser.id,
          id: senderUser.id,
          displayName: resolveChatDisplayName(senderUser),
          name: resolveChatDisplayName(senderUser),
          username: senderUser.username || senderUser.nickName || '',
          profileImageUrl: senderUser.profilePicture
            ? formatMediaUrl(senderUser.profilePicture)
            : null,
          profilePhotoUrl: senderUser.profilePicture
            ? formatMediaUrl(senderUser.profilePicture)
            : null,
          isOnline: isUserConnected(senderUser.id),
        },
        targetUser: {
          id: senderUser.id,
          name: resolveChatDisplayName(senderUser),
          username: senderUser.username || senderUser.nickName || '',
          profilePhotoUrl: senderUser.profilePicture
            ? formatMediaUrl(senderUser.profilePicture)
            : null,
          isVerified: Boolean(senderUser.isFaceVerified),
          isSubscribed: Boolean(senderUser.isSubscribed),
        },
        isPinned: !!recipientPin,
        isArchived: !!recipientState?.isArchived,
        updatedAt: messageTimestamp,
      };

      const senderRoom = getUserRoomName(senderId);
      const recipientRoom = getUserRoomName(recipientId);

      // Emit to Sender's devices across all standard event names
      io.to(senderRoom).emit('conversation:updated', senderPayload);
      io.to(senderRoom).emit('chat:conversation_updated' as any, senderPayload);
      io.to(senderRoom).emit('conversation_updated' as any, senderPayload);
      io.to(senderRoom).emit('conversation:update' as any, senderPayload);
      io.to(senderRoom).emit('conversations:update' as any, senderPayload);

      // Emit to Recipient's devices across all standard event names
      io.to(recipientRoom).emit('conversation:updated', recipientPayload);
      io.to(recipientRoom).emit('chat:conversation_updated' as any, recipientPayload);
      io.to(recipientRoom).emit('conversation_updated' as any, recipientPayload);
      io.to(recipientRoom).emit('conversation:update' as any, recipientPayload);
      io.to(recipientRoom).emit('conversations:update' as any, recipientPayload);

      // Also emit conversation:unread_updated to recipient
      io.to(recipientRoom).emit('conversation:unread_updated', {
        conversationId,
        unreadCount: recipientUnreadCount,
      });
    } catch {
      // Socket server may not be bound in isolated test contexts; continue gracefully
    }
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
        const otherUserId = getOtherParticipantId(c, userId);
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
      attributes: ['conversationId', 'createdAt', 'metadata'],
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
      if (record.metadata) {
        try {
          const meta = JSON.parse(record.metadata);
          if (meta.isDeletedForEveryone || meta.isDeleted) continue;
          if (Array.isArray(meta.deletedForUserIds) && meta.deletedForUserIds.includes(userId)) continue;
        } catch {}
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

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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

    let msgMeta: any = null;
    if (message.metadata) {
      try {
        msgMeta = JSON.parse(message.metadata);
      } catch {
        msgMeta = null;
      }
    }

    if (
      msgMeta &&
      (msgMeta.isDeletedForEveryone ||
        msgMeta.isDeleted ||
        (Array.isArray(msgMeta.deletedForUserIds) && msgMeta.deletedForUserIds.includes(currentUserId)))
    ) {
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
          } catch { }
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
      } catch { }
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
      } catch { }
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

    const otherUserId = getOtherParticipantId(conversation, currentUserId);

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

      if (
        parsedMetadata?.isDeletedForEveryone ||
        parsedMetadata?.isDeleted ||
        (Array.isArray(parsedMetadata?.deletedForUserIds) && parsedMetadata.deletedForUserIds.includes(currentUserId))
      ) {
        continue;
      }

      if (msg.messageType === 'image' && msg.content) {
        if (!parsedMetadata || typeof parsedMetadata !== 'object') {
          parsedMetadata = {};
        }
        const cleanKey = s3Service.extractKey(msg.content);
        if (!parsedMetadata.thumbnailUrl) {
          parsedMetadata.thumbnailUrl = s3Service.getThumbnailUrl(cleanKey);
        }
        if (!parsedMetadata.imageUrl) {
          parsedMetadata.imageUrl = s3Service.getPublicUrl(cleanKey);
        }
        if (!parsedMetadata.mediaUrl) {
          parsedMetadata.mediaUrl = s3Service.getPublicUrl(cleanKey);
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
        isEdited: !!parsedMetadata?.isEdited,
        editedAt: parsedMetadata?.editedAt || null,
        replyToMessageId: parsedMetadata?.replyToMessageId || null,
        replyTo: parsedMetadata?.replyTo || null,
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
  ): Promise<{
    id: string;
    conversationId: string;
    isNew: boolean;
    user1Id: string;
    user2Id: string;
    recipientId: string;
    participant?: ChatMessageSenderDTO;
    targetUser?: any;
  }> {
    if (currentUserId === recipientId) {
      throw new ChatServiceError('You cannot start a conversation with yourself', 400);
    }

    const recipient = await User.findByPk(recipientId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture', 'isActive'],
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

    const participantDto: ChatMessageSenderDTO = {
      id: recipient.id,
      displayName: resolveChatDisplayName(recipient),
      profileImageUrl: formatMediaUrl(recipient.profilePicture),
    };

    return {
      id: conversation.id,
      conversationId: conversation.id,
      isNew,
      user1Id: conversation.user1Id,
      user2Id: conversation.user2Id,
      recipientId,
      participant: participantDto,
      targetUser: {
        id: recipient.id,
        username: recipient.username,
        name: resolveChatDisplayName(recipient),
        profilePicture: formatMediaUrl(recipient.profilePicture),
      },
    };
  }

  /**
   * Sends a chat message directly to a recipient.
   * Enforces Free Tier Rule 4: Free users can ONLY send messages if they have an active mutual match or active conversation.
   * Premium users (isSubscribed === true) are permitted to chat without a prior match.
   */
  public async sendMessageToRecipient(
    senderId: string,
    input: DirectSendMessageInput
  ): Promise<ChatMessageDTO> {
    const { recipientId, content, messageType = 'text', metadata = null } = input;

    if (senderId === recipientId) {
      throw new ChatServiceError('You cannot send a message to yourself', 400, 'SELF_CHAT_NOT_ALLOWED');
    }

    const [sender, recipient] = await Promise.all([
      User.findByPk(senderId),
      User.findByPk(recipientId),
    ]);

    if (!sender || !sender.isActive) {
      throw new ChatServiceError('Sender account is invalid or unavailable', 401, 'UNAUTHORIZED');
    }

    if (!recipient || !recipient.isActive) {
      throw new ChatServiceError('Recipient does not exist or is unavailable', 404, 'RECIPIENT_NOT_FOUND');
    }

    // Bidirectional block check
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: senderId, blockedUserId: recipientId },
          { userId: recipientId, blockedUserId: senderId },
        ],
      },
    });

    if (blockRecord) {
      throw new ChatServiceError('You cannot chat with this user', 403, 'USER_BLOCKED');
    }

    // Free Tier Rule 4: Non-subscribed users can only chat with mutual matches
    if (!sender.isSubscribed) {
      const [u1, u2] = [senderId, recipientId].sort();
      const match = await Match.findOne({
        where: {
          user1Id: u1,
          user2Id: u2,
          isActive: true,
        },
      });

      const existingConv = await Conversation.findOne({
        where: { user1Id: u1, user2Id: u2 },
      });

      if (!match && !existingConv) {
        throw new ChatServiceError(
          'You can only chat after a mutual match. Upgrade to Premium to chat directly.',
          403,
          'MATCH_REQUIRED_TO_CHAT'
        );
      }
    }

    const [u1, u2] = [senderId, recipientId].sort();
    const now = new Date();
    const [conversation] = await Conversation.findOrCreate({
      where: {
        user1Id: u1,
        user2Id: u2,
      },
      defaults: {
        user1Id: u1,
        user2Id: u2,
        lastMessage: input.content || '',
        lastMessageAt: now,
      },
    });

    if (conversation.isDeletedForEveryone) {
      conversation.isDeletedForEveryone = false;
      conversation.deletedForEveryoneAt = null;
      conversation.deletedForEveryoneBy = null;
      await conversation.save();
    }

    return this.sendMessage(senderId, conversation.id, input);
  }

  /**
   * Retrieves conversation threads for the authenticated user
   * Excludes empty conversations where no messages have been sent.
   */
  public async getConversations(userId: string): Promise<ConversationSummaryDTO[]> {
    const blockedUserIds = await this.getBlockedUserIds(userId);
    const blockedArray = Array.from(blockedUserIds);

    const whereCondition: any = {
      [Op.or]: [{ user1Id: userId }, { user2Id: userId }],
    };

    whereCondition[Op.and] = whereCondition[Op.and] || [];

    // Exclude conversations deleted for everyone
    whereCondition[Op.and].push({
      [Op.or]: [
        { isDeletedForEveryone: false },
        { isDeletedForEveryone: null },
      ],
    });

    // Exclude conversations without any messages (no chat history)
    whereCondition[Op.and].push({
      [Op.or]: [
        {
          lastMessage: {
            [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }],
          },
        },
        {
          lastMessageAt: {
            [Op.ne]: null,
          },
        },
      ],
    });

    if (blockedArray.length > 0) {
      whereCondition[Op.and].push({
        user1Id: { [Op.notIn]: blockedArray },
        user2Id: { [Op.notIn]: blockedArray },
      });
    }

    const conversations = await Conversation.findAll({
      where: whereCondition,
      include: [
        {
          model: User,
          as: 'user1',
          include: [{ model: UserPhoto, as: 'photos', where: { status: 'approved' }, required: false }],
        },
        {
          model: User,
          as: 'user2',
          include: [{ model: UserPhoto, as: 'photos', where: { status: 'approved' }, required: false }],
        },
      ],
      order: [['lastMessageAt', 'DESC NULLS LAST']],
    });

    // Fetch user states (delete-for-me check)
    const userStates = await ConversationUserState.findAll({
      where: {
        userId,
        conversationId: { [Op.in]: conversations.map((c) => c.id) },
      },
      raw: true,
    });
    const userStateMap = new Map<string, any>(userStates.map((s) => [s.conversationId, s]));

    const results: ConversationSummaryDTO[] = [];

    for (const conv of conversations) {
      if (conv.user1Id === conv.user2Id) continue;

      const partner = conv.user1Id === userId ? (conv as any).user2 : (conv as any).user1;
      if (!partner || !partner.isActive) continue;

      // Check Delete for Me
      const state = userStateMap.get(conv.id);
      if (state?.isDeleted) {
        if (!conv.lastMessageAt || new Date(conv.lastMessageAt) <= new Date(state.clearedAt || state.deletedAt)) {
          continue;
        }
      }

      // Exclude empty conversations (no chat / no messages)
      const hasChat = Boolean(
        (conv.lastMessage && conv.lastMessage.trim().length > 0) || conv.lastMessageAt
      );
      if (!hasChat) continue;

      const unreadCount = await ChatMessage.count({
        where: {
          conversationId: conv.id,
          recipientId: userId,
          isRead: false,
        },
      });

      const [u1, u2] = [userId, partner.id].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
        attributes: ['id'],
      });

      results.push({
        id: conv.id,
        targetUser: {
          id: partner.id,
          name: resolveDisplayName(partner),
          username: partner.username || partner.nickName || '',
          profilePhotoUrl: this.resolvePrimaryPhoto(partner.profilePicture, partner.photos),
          isVerified: Boolean(partner.isFaceVerified),
          isSubscribed: Boolean(partner.isSubscribed),
        },
        lastMessage: conv.lastMessage || null,
        lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
        unreadCount,
        isMatched: Boolean(match),
      });
    }

    return results;
  }

  /**
   * Retrieves paginated messages in a conversation with a specific user
   */
  public async getMessagesByUserId(
    userId: string,
    targetUserId: string,
    options: { limit?: number; cursor?: string; page?: number } = {}
  ): Promise<{
    messages: ChatMessageDTO[];
    conversationId: string | null;
    pagination: {
      limit: number;
      hasMore: boolean;
      nextCursor: string | null;
      page?: number;
      total?: number;
      totalPages?: number;
    };
  }> {
    const limit = Math.min(100, Math.max(1, options.limit || 30));
    const [u1, u2] = [userId, targetUserId].sort();

    const conversation = await Conversation.findOne({
      where: { user1Id: u1, user2Id: u2 },
    });

    if (!conversation) {
      return {
        messages: [],
        conversationId: null,
        pagination: { limit, hasMore: false, nextCursor: null, page: 1, total: 0, totalPages: 0 },
      };
    }

    const result = await this.getMessages(userId, conversation.id, {
      ...options,
      limit,
    });

    return {
      conversationId: conversation.id,
      messages: result.messages,
      pagination: {
        limit,
        hasMore: result.pagination.hasMore,
        nextCursor:
          result.pagination.hasMore && result.messages.length > 0
            ? Buffer.from(
                JSON.stringify({
                  createdAt: result.messages[result.messages.length - 1].createdAt,
                })
              ).toString('base64url')
            : null,
        page: result.pagination.page,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
      },
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
      ): Promise < { conversationId: string; isArchived: boolean } > {
        const conversation = await Conversation.findByPk(conversationId, {
          attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessageAt'],
        });

        if(!conversation || conversation.isDeletedForEveryone) {
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
): Promise < { conversationId: string; deleteType: 'me' | 'everyone' } > {
  const conversation = await Conversation.findByPk(conversationId, {
    attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'deletedForEveryoneAt', 'deletedForEveryoneBy'],
  });

  if(!conversation) {
    throw new ChatServiceError('Conversation not found', 404);
  }

    if(conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
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
  } catch { }

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
} catch { }

return {
  conversationId,
  deleteType: 'everyone',
};
  }

  /**
   * 10. EDIT MESSAGE
   * Allows original sender to edit their text message within the allowed edit window (15 minutes).
   * Ensures IDOR protection, membership validation, and concurrent transaction safety.
   */
  public async editMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    newContent: string
  ): Promise<ChatMessageDTO> {
    if (!newContent || typeof newContent !== 'string' || newContent.trim().length === 0) {
      throw new ChatServiceError('Message content cannot be empty', 400, 'VALIDATION_ERROR');
    }

    if (newContent.length > 5000) {
      throw new ChatServiceError('Message content cannot exceed 5000 characters', 400, 'VALIDATION_ERROR');
    }

    const trimmedContent = newContent.trim();

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
    }

    const normUserId = String(userId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normUserId && normUser2Id !== normUserId) {
      throw new ChatServiceError('You are not a participant in this conversation', 403, 'FORBIDDEN');
    }

    const recipientId = getOtherParticipantId(conversation, userId);

    const message = await ChatMessage.findByPk(messageId);
    if (!message) {
      throw new ChatServiceError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    if (message.conversationId !== conversationId) {
      throw new ChatServiceError('Message does not belong to this conversation', 400, 'INVALID_CONVERSATION');
    }

    if (message.senderId !== userId) {
      throw new ChatServiceError('You can only edit your own messages', 403, 'FORBIDDEN');
    }

    // Check user deletion cutoff (Delete for Me)
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId },
      attributes: ['clearedAt', 'isDeleted'],
    });

    if (userState?.clearedAt && message.createdAt <= userState.clearedAt) {
      throw new ChatServiceError('Message not found or has been deleted', 404, 'MESSAGE_NOT_FOUND');
    }

    // Only text messages can be edited (prevent editing audio, image, location, contact, system, etc.)
    if (message.messageType !== 'text') {
      throw new ChatServiceError('Only text messages can be edited', 400, 'UNSUPPORTED_MESSAGE_TYPE');
    }

    let parsedMeta: Record<string, any> = {};
    if (message.metadata) {
      try {
        parsedMeta = JSON.parse(message.metadata);
      } catch {
        parsedMeta = {};
      }
    }

    if (
      parsedMeta.isDeleted ||
      parsedMeta.recalled ||
      parsedMeta.isDeletedForEveryone ||
      (Array.isArray(parsedMeta.deletedForUserIds) && parsedMeta.deletedForUserIds.includes(userId))
    ) {
      throw new ChatServiceError('Cannot edit a deleted or recalled message', 400, 'MESSAGE_DELETED');
    }

    // Check edit window (15 minutes)
    const messageAge = Date.now() - new Date(message.createdAt).getTime();
    if (messageAge > MESSAGE_EDIT_WINDOW_MS) {
      throw new ChatServiceError(
        'Message edit window has expired (15 minutes limit)',
        400,
        'EDIT_WINDOW_EXPIRED'
      );
    }

    const now = new Date();
    parsedMeta.isEdited = true;
    parsedMeta.editedAt = now.toISOString();

    // Atomic transaction for safe concurrent update with retry for lock contention
    let attempts = 0;
    const maxAttempts = 4;
    while (attempts < maxAttempts) {
      attempts++;
      const t = await sequelize.transaction();
      try {
        const lockedMessage = await ChatMessage.findByPk(messageId, {
          transaction: t,
          lock: sequelize.getDialect() === 'postgres' ? t.LOCK.UPDATE : undefined,
        });

        if (!lockedMessage) {
          throw new ChatServiceError('Message not found', 404);
        }

        let currentMeta: Record<string, any> = {};
        if (lockedMessage.metadata) {
          try {
            currentMeta = JSON.parse(lockedMessage.metadata);
          } catch {
            currentMeta = {};
          }
        }
        currentMeta.isEdited = true;
        currentMeta.editedAt = now.toISOString();

        lockedMessage.content = trimmedContent;
        lockedMessage.metadata = JSON.stringify(currentMeta);
        await lockedMessage.save({ transaction: t });

        // Update conversation lastMessage preview if this message is the latest message
        if (
          conversation.lastMessageAt &&
          Math.abs(new Date(conversation.lastMessageAt).getTime() - new Date(lockedMessage.createdAt).getTime()) < 3000
        ) {
          conversation.lastMessage = trimmedContent;
          await conversation.save({ transaction: t });
        }

        await t.commit();
        break;
      } catch (err: any) {
        await t.rollback();
        const isLockContention =
          (err?.name === 'SequelizeDatabaseError' || err?.name === 'SequelizeTimeoutError') &&
          (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked') || err.message?.includes('deadlock'));
        if (isLockContention && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 50 * attempts));
          continue;
        }
        throw err;
      }
    }

    // Build ChatMessageDTO
    const senderUser = await User.findByPk(userId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });

    const pinRecord = await ChatMessagePin.findOne({
      where: { conversationId, messageId, userId },
    });

    const updatedDto: ChatMessageDTO = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      recipientId,
      content: trimmedContent,
      messageType: 'text',
      metadata: parsedMeta,
      status: message.isRead ? 'read' : message.isDelivered ? 'delivered' : 'sent',
      isDelivered: !!message.isDelivered,
      deliveredAt: message.deliveredAt || null,
      isRead: !!message.isRead,
      readAt: message.readAt || null,
      sentAt: message.createdAt,
      createdAt: message.createdAt,
      isMine: true,
      isPinned: !!pinRecord,
      pinnedAt: pinRecord?.createdAt || null,
      pinnedBy: pinRecord?.pinnedBy || null,
      isEdited: true,
      editedAt: now.toISOString(),
      replyToMessageId: parsedMeta.replyToMessageId || null,
      replyTo: parsedMeta.replyTo || null,
      sender: senderUser
        ? {
            id: senderUser.id,
            displayName: resolveChatDisplayName(senderUser),
            profileImageUrl: formatMediaUrl(senderUser.profilePicture),
          }
        : undefined,
    };

    // Real-time broadcast to both participants
    try {
      const io = getSocketServer();
      const recipientRoom = getUserRoomName(recipientId);
      const senderRoom = getUserRoomName(userId);

      const recipientDto: ChatMessageDTO = {
        ...updatedDto,
        isMine: false,
      };

      io.to(recipientRoom).emit('chat:message_edited' as any, recipientDto);
      io.to(recipientRoom).emit('message:edited' as any, recipientDto);

      io.to(senderRoom).emit('chat:message_edited' as any, updatedDto);
      io.to(senderRoom).emit('message:edited' as any, updatedDto);

      // If edited message is the latest message preview, update conversation list in real-time
      if (
        conversation.lastMessageAt &&
        Math.abs(new Date(conversation.lastMessageAt).getTime() - new Date(message.createdAt).getTime()) < 3000
      ) {
        await this.emitConversationUpdate(
          conversationId,
          message,
          trimmedContent,
          userId,
          recipientId
        );
      }
    } catch {}

    return updatedDto;
  }

  /**
   * 11. REPLY MESSAGE
   * Validates parent message, attaches minimal parent reference, persists reply, and emits real-time event.
   */
  public async replyMessage(
    senderId: string,
    conversationId: string,
    replyToMessageId: string,
    data: any
  ): Promise<ChatMessageDTO> {
    return this.sendMessage(senderId, conversationId, {
      ...data,
      replyToMessageId,
    });
  }

  /**
   * 12. DELETE CONVERSATION MESSAGE (Delete for Me and Delete for Everyone)
   * Deletes an individual message for requesting user ('me') or recalls it for all participants ('everyone').
   * Validates JWT context, membership, message-conversation consistency, ownership, deletion window,
   * unpins message, cleans up attachments, updates lastMessage preview, and emits real-time events.
   */
  public async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    deleteType: 'me' | 'everyone'
  ): Promise<{
    conversationId: string;
    messageId: string;
    deleteType: 'me' | 'everyone';
  }> {
    if (!deleteType || (deleteType !== 'me' && deleteType !== 'everyone')) {
      throw new ChatServiceError('deleteType must be either "me" or "everyone"', 400, 'VALIDATION_ERROR');
    }

    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'user1Id', 'user2Id', 'isDeletedForEveryone', 'lastMessage', 'lastMessageAt'],
    });

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
    }

    const normUserId = String(userId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normUserId && normUser2Id !== normUserId) {
      throw new ChatServiceError('You are not a participant in this conversation', 403, 'FORBIDDEN');
    }

    const message = await ChatMessage.findByPk(messageId);
    if (!message) {
      throw new ChatServiceError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    if (message.conversationId !== conversationId) {
      throw new ChatServiceError('Message does not belong to this conversation', 400, 'INVALID_CONVERSATION');
    }

    // Check user state for history cutoff
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId },
      attributes: ['clearedAt', 'isDeleted'],
    });

    if (userState?.clearedAt && message.createdAt <= userState.clearedAt) {
      if (deleteType === 'me') {
        return { conversationId, messageId, deleteType: 'me' };
      }
      throw new ChatServiceError('Message not found or has been deleted', 404, 'MESSAGE_NOT_FOUND');
    }

    // Delete for Everyone validation
    if (deleteType === 'everyone') {
      if (message.senderId !== userId) {
        throw new ChatServiceError('You can only delete your own messages for everyone', 403, 'FORBIDDEN');
      }

      const messageAge = Date.now() - new Date(message.createdAt).getTime();
      if (messageAge > MESSAGE_DELETE_FOR_EVERYONE_WINDOW_MS) {
        throw new ChatServiceError(
          'Message deletion window for everyone has expired (24 hours limit)',
          400,
          'DELETE_WINDOW_EXPIRED'
        );
      }
    }

    // Pre-check for idempotency before acquiring transaction
    let initialMeta: Record<string, any> = {};
    if (message.metadata) {
      try {
        initialMeta = JSON.parse(message.metadata);
      } catch {
        initialMeta = {};
      }
    }

    if (deleteType === 'everyone') {
      if (initialMeta.isDeletedForEveryone) {
        return { conversationId, messageId, deleteType: 'everyone' };
      }
    } else {
      const deletedForUserIds: string[] = Array.isArray(initialMeta.deletedForUserIds)
        ? initialMeta.deletedForUserIds
        : [];
      if (deletedForUserIds.includes(userId)) {
        return { conversationId, messageId, deleteType: 'me' };
      }
    }

    const now = new Date();
    let shouldEmitSocket = false;
    let attempts = 0;
    const maxAttempts = 4;

    while (attempts < maxAttempts) {
      attempts++;
      const t = await sequelize.transaction();
      try {
        const lockedMessage = await ChatMessage.findByPk(messageId, {
          transaction: t,
          lock: sequelize.getDialect() === 'postgres' ? t.LOCK.UPDATE : undefined,
        });

        if (!lockedMessage) {
          throw new ChatServiceError('Message not found', 404, 'MESSAGE_NOT_FOUND');
        }

        let currentMeta: Record<string, any> = {};
        if (lockedMessage.metadata) {
          try {
            currentMeta = JSON.parse(lockedMessage.metadata);
          } catch {
            currentMeta = {};
          }
        }

        if (deleteType === 'everyone') {
          if (currentMeta.isDeletedForEveryone) {
            await t.commit();
            return { conversationId, messageId, deleteType: 'everyone' };
          }

          currentMeta.isDeletedForEveryone = true;
          currentMeta.deletedForEveryoneAt = now.toISOString();
          currentMeta.deletedForEveryoneBy = userId;
          currentMeta.isDeleted = true;

          // Strip attachments and media URLs from metadata
          delete currentMeta.images;
          delete currentMeta.imageUrl;
          delete currentMeta.thumbnailUrl;
          delete currentMeta.audioUrl;
          delete currentMeta.mediaUrl;
          delete currentMeta.url;

          lockedMessage.content = 'This message was deleted';
          lockedMessage.metadata = JSON.stringify(currentMeta);
          await lockedMessage.save({ transaction: t });

          // Destroy all pin records for this message across all users
          await ChatMessagePin.destroy({
            where: { conversationId, messageId },
            transaction: t,
          });

          // Update conversation lastMessage preview if this was the latest message
          const isLastMessage =
            conversation.lastMessageAt &&
            Math.abs(new Date(conversation.lastMessageAt).getTime() - new Date(lockedMessage.createdAt).getTime()) < 3000;

          if (isLastMessage) {
            const prevMsg = await ChatMessage.findOne({
              where: {
                conversationId,
                id: { [Op.ne]: messageId },
              },
              order: [['createdAt', 'DESC']],
              transaction: t,
            });

            if (prevMsg) {
              let preview = prevMsg.content;
              if (prevMsg.messageType === 'image') preview = '📷 Photo';
              else if (prevMsg.messageType === 'audio') preview = '🎤 Voice message';
              else if (prevMsg.messageType === 'location') preview = '📍 Location';
              else if (prevMsg.messageType === 'contact') preview = '👤 Contact';
              conversation.lastMessage = preview;
              conversation.lastMessageAt = prevMsg.createdAt;
            } else {
              conversation.lastMessage = null;
              conversation.lastMessageAt = null;
            }
            await conversation.save({ transaction: t });
          }

          shouldEmitSocket = true;
        } else {
          // Delete for Me
          const deletedForUserIds: string[] = Array.isArray(currentMeta.deletedForUserIds)
            ? [...currentMeta.deletedForUserIds]
            : [];

          if (deletedForUserIds.includes(userId)) {
            await t.commit();
            return { conversationId, messageId, deleteType: 'me' };
          }

          deletedForUserIds.push(userId);
          currentMeta.deletedForUserIds = deletedForUserIds;
          lockedMessage.metadata = JSON.stringify(currentMeta);
          await lockedMessage.save({ transaction: t });

          // Destroy pin for current user
          await ChatMessagePin.destroy({
            where: { conversationId, messageId, userId },
            transaction: t,
          });

          shouldEmitSocket = true;
        }

        await t.commit();
        break;
      } catch (err: any) {
        await t.rollback();
        const isLockContention =
          (err?.name === 'SequelizeDatabaseError' || err?.name === 'SequelizeTimeoutError') &&
          (err.message?.includes('SQLITE_BUSY') || err.message?.includes('locked') || err.message?.includes('deadlock'));
        if (isLockContention && attempts < maxAttempts) {
          await new Promise((r) => setTimeout(r, 50 * attempts));
          continue;
        }
        throw err;
      }
    }

    // Post-commit Socket.IO emission to authorized participant rooms
    if (shouldEmitSocket) {
      try {
        const io = getSocketServer();
        const payload = {
          conversationId,
          messageId,
          deleteType,
        };

        if (deleteType === 'me') {
          io.to(getUserRoomName(userId)).emit('chat:message_deleted', payload);
          io.to(getUserRoomName(userId)).emit('message:deleted' as any, payload);
        } else {
          io.to(getUserRoomName(conversation.user1Id)).emit('chat:message_deleted', payload);
          io.to(getUserRoomName(conversation.user1Id)).emit('message:deleted' as any, payload);
          io.to(getUserRoomName(conversation.user2Id)).emit('chat:message_deleted', payload);
          io.to(getUserRoomName(conversation.user2Id)).emit('message:deleted' as any, payload);
        }

        // Real-time conversation list update after message deletion
        const otherUserId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
        const currentConv = await Conversation.findByPk(conversationId);
        if (currentConv) {
          const fakeMsg = {
            id: messageId,
            content: currentConv.lastMessage || '',
            messageType: 'text',
            senderId: userId,
            createdAt: currentConv.lastMessageAt || new Date(),
          };
          await this.emitConversationUpdate(
            conversationId,
            fakeMsg,
            currentConv.lastMessage || '',
            userId,
            otherUserId
          );
        }
      } catch {}
    }

    return {
      conversationId,
      messageId,
      deleteType,
    };
  }

  /**
   * Add, update, or remove (toggle) an emoji reaction on a message.
   * Concurrency-safe, participant-validated, and emits real-time Socket.IO event.
   */
  async reactToMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    emojiInput: string
  ): Promise<MessageReactionResultDTO> {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new ChatServiceError('conversationId is required', 400, 'VALIDATION_ERROR');
    }

    if (!messageId || typeof messageId !== 'string') {
      throw new ChatServiceError('messageId is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmoji = normalizeReactionEmoji(emojiInput);
    if (!normalizedEmoji) {
      throw new ChatServiceError(
        `Unsupported reaction emoji. Allowed emojis: ${ALLOWED_CHAT_REACTION_EMOJIS.join(', ')}`,
        400,
        'UNSUPPORTED_EMOJI'
      );
    }

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
    }

    const normUserId = String(userId || '').trim().toLowerCase();
    const normUser1Id = String(conversation.user1Id || '').trim().toLowerCase();
    const normUser2Id = String(conversation.user2Id || '').trim().toLowerCase();

    if (normUser1Id !== normUserId && normUser2Id !== normUserId) {
      throw new ChatServiceError('You are not a participant in this conversation', 403, 'FORBIDDEN');
    }

    const otherParticipantId = getOtherParticipantId(conversation, userId);

    // Mutual block check
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId, blockedUserId: otherParticipantId },
          { userId: otherParticipantId, blockedUserId: userId },
        ],
      },
    });

    if (isBlocked) {
      throw new ChatServiceError('You cannot interact in this conversation', 403, 'CHAT_FORBIDDEN');
    }

    const message = await ChatMessage.findByPk(messageId);
    if (!message) {
      throw new ChatServiceError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    if (message.conversationId !== conversationId) {
      throw new ChatServiceError('Message does not belong to this conversation', 400, 'INVALID_CONVERSATION');
    }

    // Check user deletion cutoff (Delete for Me)
    const userState = await ConversationUserState.findOne({
      where: { conversationId, userId },
      attributes: ['clearedAt', 'isDeleted'],
    });

    if (userState?.isDeleted) {
      throw new ChatServiceError('Conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
    }

    if (userState?.clearedAt && new Date(message.createdAt) <= new Date(userState.clearedAt)) {
      throw new ChatServiceError('Message not found or has been deleted', 404, 'MESSAGE_NOT_FOUND');
    }

    let parsedMeta: Record<string, any> | null = null;
    if (message.metadata) {
      try {
        parsedMeta = JSON.parse(message.metadata);
      } catch {
        parsedMeta = null;
      }
    }

    if (
      parsedMeta &&
      (parsedMeta.isDeleted ||
        parsedMeta.recalled ||
        parsedMeta.isDeletedForEveryone ||
        (Array.isArray(parsedMeta.deletedForUserIds) && parsedMeta.deletedForUserIds.includes(userId)))
    ) {
      throw new ChatServiceError('Cannot react to a deleted message', 400, 'MESSAGE_DELETED');
    }

    let action: 'added' | 'updated' | 'removed' = 'added';
    let activeReaction: ChatMessageReaction | null = null;

    let existingReaction = await ChatMessageReaction.findOne({
      where: { messageId, userId },
    });

    if (existingReaction) {
      if (existingReaction.emoji === normalizedEmoji) {
        // Same emoji: toggle off / remove
        await existingReaction.destroy();
        action = 'removed';
        activeReaction = null;
      } else {
        // Different emoji: update
        existingReaction.emoji = normalizedEmoji;
        await existingReaction.save();
        action = 'updated';
        activeReaction = existingReaction;
      }
    } else {
      // Add new reaction
      try {
        activeReaction = await ChatMessageReaction.create({
          conversationId,
          messageId,
          userId,
          emoji: normalizedEmoji,
        });
        action = 'added';
      } catch (err: any) {
        // Concurrent insert race condition: fetch and handle toggle/update
        existingReaction = await ChatMessageReaction.findOne({
          where: { messageId, userId },
        });
        if (existingReaction) {
          if (existingReaction.emoji === normalizedEmoji) {
            await existingReaction.destroy();
            action = 'removed';
            activeReaction = null;
          } else {
            existingReaction.emoji = normalizedEmoji;
            await existingReaction.save();
            action = 'updated';
            activeReaction = existingReaction;
          }
        } else {
          throw err;
        }
      }
    }

    // Query aggregated reaction counts and full reactions list for the message
    const allReactions = await ChatMessageReaction.findAll({
      where: { messageId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture'],
        },
      ],
      order: [['createdAt', 'ASC']],
    });

    const allReactionsList: MessageReactionDTO[] = allReactions.map((r: any) => ({
      id: r.id,
      messageId: r.messageId,
      conversationId: r.conversationId,
      userId: r.userId,
      emoji: r.emoji,
      createdAt: r.createdAt
        ? new Date(r.createdAt).toISOString()
        : new Date().toISOString(),
      user: r.user
        ? {
            id: r.user.id,
            fullName: r.user.fullName || r.user.nickName || 'User',
            nickName: r.user.nickName || null,
            profilePicture: formatMediaUrl(r.user.profilePicture),
          }
        : null,
    }));

    const reactionCounts: Record<string, number> = {
      total: allReactions.length,
    };
    for (const r of allReactions) {
      reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
    }

    // Fetch reactor user details
    const reactor = await User.findByPk(userId, {
      attributes: ['id', 'fullName', 'nickName', 'profilePicture'],
    });

    const userDto = {
      id: userId,
      fullName: reactor?.fullName || reactor?.nickName || 'User',
      nickName: reactor?.nickName || null,
      profilePicture: formatMediaUrl(reactor?.profilePicture),
    };

    const resultPayload: MessageReactionResultDTO = {
      action,
      messageId,
      conversationId,
      userId,
      reactorId: userId,
      senderId: userId,
      emoji: action === 'removed' ? null : normalizedEmoji,
      reactionEmoji: action === 'removed' ? null : normalizedEmoji,
      reaction: activeReaction
        ? {
            id: activeReaction.id,
            messageId: activeReaction.messageId,
            conversationId: activeReaction.conversationId,
            userId: activeReaction.userId,
            emoji: activeReaction.emoji,
            createdAt: activeReaction.createdAt
              ? new Date(activeReaction.createdAt).toISOString()
              : new Date().toISOString(),
          }
        : null,
      user: userDto,
      reactionCounts,
      reactions: allReactionsList,
      reactionsCount: reactionCounts.total,
    };

    // Emit Socket.IO event to all conversation participants across multiple room and event aliases
    try {
      const io = getSocketServer();
      const normUser1 = String(conversation.user1Id || '').trim();
      const normUser2 = String(conversation.user2Id || '').trim();

      const user1Reaction = allReactionsList.find(
        (r) => String(r.userId || '').trim().toLowerCase() === normUser1.toLowerCase()
      )?.emoji || null;
      const user2Reaction = allReactionsList.find(
        (r) => String(r.userId || '').trim().toLowerCase() === normUser2.toLowerCase()
      )?.emoji || null;

      const eventNames = [
        'message:reaction:updated',
        'chat:message_reaction',
        'message:reaction',
        'chat:reaction',
        'chat:message_reaction_updated',
        'chat:reaction:updated',
        'reaction:updated',
      ];

      // Emit to user1 private multi-device rooms
      const user1Payload = {
        ...resultPayload,
        myReaction: user1Reaction,
        otherUserReaction: user2Reaction,
      };
      const user1Rooms = [getUserRoomName(normUser1), getUserRoomName(normUser1.toLowerCase())];
      for (const room of new Set(user1Rooms)) {
        for (const ev of eventNames) {
          io.to(room).emit(ev as any, user1Payload as any);
        }
      }

      // Emit to user2 private multi-device rooms
      const user2Payload = {
        ...resultPayload,
        myReaction: user2Reaction,
        otherUserReaction: user1Reaction,
      };
      const user2Rooms = [getUserRoomName(normUser2), getUserRoomName(normUser2.toLowerCase())];
      for (const room of new Set(user2Rooms)) {
        for (const ev of eventNames) {
          io.to(room).emit(ev as any, user2Payload as any);
        }
      }

      // Emit to conversation/chat rooms if any clients joined them
      const convRooms = [`conversation:${conversationId}`, `chat:${conversationId}`];
      for (const room of convRooms) {
        for (const ev of eventNames) {
          io.to(room).emit(ev as any, resultPayload as any);
        }
      }
    } catch (_socketErr: any) {
      // Non-fatal if socket server is uninitialized or in test runner
    }

    return resultPayload;
  }
}

export const chatService = new ChatService();
