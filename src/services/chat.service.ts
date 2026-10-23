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
  SwipeAction,
  UserPhoto,
} from '../models';
import { ChatMessageType } from '../models/chatMessage.model';
import { s3Service, formatMediaUrl, formatThumbnailUrl } from './s3.service';
import { calculateAge, calculateDistanceKm } from './discovery.service';
import { isUserConnected, isUserViewingConversation, getUserRoomName } from '../realtime/socket.lifecycle';
import { getSocketServer } from '../realtime/socket.server';
import { socketLogger } from '../realtime/socket.errors';
import {
  GetChatListQuery,
  GetMessagesQuery,
  SendMessageInput,
  SendMultiMessageInput,
  DirectSendMessageInput,
  EditMessageInput,
  ReplyMessageInput,
  ForwardMessagesInput,
  GetForwardRecipientsQuery,
  normalizeReactionEmoji,
  normalizeRecipientIdentifier,
  isUuidIdentifier,
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

/**
 * Validates S3 media object key or URL for path traversal and user ownership.
 * Throws 400 INVALID_MEDIA_KEY if invalid path traversal,
 * or 403 ATTACHMENT_OWNERSHIP_INVALID if key points to another user's private media folder.
 */
export const validateMediaAttachmentKey = (raw: string, senderId: string): string => {
  if (!raw || typeof raw !== 'string') return '';
  const cleanKey = s3Service.extractKey(raw);
  if (cleanKey.includes('..') || cleanKey.includes('\\') || cleanKey.includes('\0')) {
    throw new ChatServiceError('Invalid S3 object key or URL', 400, 'INVALID_MEDIA_KEY');
  }
  const userFolderMatch = (raw + ' ' + cleanKey).match(
    /(?:uploads|chat|photos|moments|quick-moments|avatars|verifications)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/i
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
  return cleanKey;
};

/** Accepts a JSON array, a comma-separated string, or a single URL. */
export const coerceMediaList = (raw: any): any[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to comma-separated / single value
    }
    if (trimmed.includes(',')) {
      return trimmed.split(',').map((part) => part.trim()).filter(Boolean);
    }
    return [trimmed];
  }
  return [];
};

/**
 * Gallery cells on the receiver load thumbnailUrl. Thumbnail objects are created
 * in the background and 404 until that finishes, so each gallery item points at
 * the original image, which is already public.
 */
export const decorateChatGalleryImage = (img: any): any => {
  if (!img) return img;
  if (typeof img === 'string') {
    const key = s3Service.extractKey(img);
    const full = img.startsWith('http://') || img.startsWith('https://')
      ? img
      : s3Service.getPublicUrl(key);
    return {
      url: full,
      imageUrl: full,
      mediaUrl: full,
      thumbnailUrl: full,
      path: full,
      uri: full,
      src: full,
      key,
    };
  }
  const raw = img.url || img.imageUrl || img.mediaUrl || img.path || img.uri || img.src || '';
  const key = img.key || (raw ? s3Service.extractKey(raw) : '');
  const full =
    raw && (String(raw).startsWith('http://') || String(raw).startsWith('https://'))
      ? raw
      : key
        ? s3Service.getPublicUrl(key)
        : '';
  return {
    ...img,
    url: full,
    imageUrl: full,
    mediaUrl: full,
    thumbnailUrl: full || img.thumbnailUrl,
    path: full,
    uri: full,
    src: full,
    key,
  };
};

export const dedupeChatImages = <T extends { key?: string; imageUrl?: string; url?: string }>(
  images: T[]
): T[] => {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const img of images) {
    const id = String(img.key || img.imageUrl || img.url || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(img);
  }
  return unique;
};

/**
 * Flat copy for socket delivery. Nested `messages` are omitted so a receiver
 * does not walk a second list that was copied from the sender (`isMine: true`)
 * and then hide the gallery.
 */
export const buildViewerChatMessage = (
  dto: ChatMessageDTO,
  isMine: boolean,
  gallery?: any[],
  galleryUrls?: string[]
): ChatMessageDTO => {
  const images = (gallery && gallery.length > 0 ? gallery : dto.images || []).map(decorateChatGalleryImage);
  const imageUrls =
    galleryUrls && galleryUrls.length > 0
      ? galleryUrls
      : images.map((img: any) => img?.imageUrl || img?.url).filter(Boolean);
  const { messages: _nested, results: _results, ...rest } = dto as ChatMessageDTO & {
    messages?: ChatMessageDTO[];
    results?: any[];
  };
  return {
    ...rest,
    isMine,
    isSender: isMine,
    images,
    imageUrls,
    mediaUrls: imageUrls,
  };
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
  /** Same value as status. The mobile client reads this field for ticks. */
  receiptStatus?: 'sent' | 'delivered' | 'read';
  isDelivered?: boolean;
  deliveredAt?: Date | string | null;
  isRead: boolean;
  readAt?: Date | string | null;
  sentAt?: Date | string;
  createdAt?: string | Date;
  isMine: boolean;
  isSender?: boolean;
  isPinned?: boolean;
  /** Same value as isPinned. Mobile pin events read this flag. */
  pinned?: boolean;
  pinnedAt?: Date | string | null;
  pinnedBy?: string | null;
  isEdited?: boolean;
  editedAt?: Date | string | null;
  replyToMessageId?: string | null;
  replyTo?: ChatMessageReplyRefDTO | null;
  isForwarded?: boolean;
  forwardedFromMessageId?: string | null;
  originalSenderId?: string | null;
  originalSenderName?: string | null;
  originalCreatedAt?: string | Date | null;
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
  mediaUrls?: string[];
  messages?: ChatMessageDTO[];
  reactions?: MessageReactionDTO[];
  reactionCounts?: Record<string, number>;
  myReaction?: string | null;
  userReaction?: string | null;
  otherUserReaction?: string | null;
  reaction?: string | null;
  emoji?: string | null;
  hasReacted?: boolean;
  totalCount?: number;
  results?: any[];
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

export interface ForwardResultItemDTO {
  recipientId: string;
  conversationId: string | null;
  status: 'success' | 'failed';
  messageId?: string;
  messageIds?: string[];
  isForwarded?: boolean;
  messages?: ChatMessageDTO[];
  error?: string;
  errorCode?: string;
}

export interface ForwardMessagesResultDTO {
  totalCount: number;
  successCount: number;
  failureCount: number;
  results: ForwardResultItemDTO[];
}

export type ForwardRecipientRelationshipType = 'match' | 'super_like_received';

export interface ForwardRecipientDTO {
  userId: string;
  name: string;
  profileImage: string | null;
  relationshipType: ForwardRecipientRelationshipType;
}

export interface ForwardRecipientsPaginationDTO {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ForwardRecipientsResponseDTO {
  recipients: ForwardRecipientDTO[];
  pagination: ForwardRecipientsPaginationDTO;
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

    // Fetch noped users to exclude from chat list
    const nopedSwipes = await SwipeAction.findAll({
      where: {
        [Op.or]: [
          { userId: currentUserId, action: 'nope' },
          { targetUserId: currentUserId, action: 'nope' },
        ],
      },
      attributes: ['userId', 'targetUserId'],
      raw: true,
    });
    const nopedUserIds = new Set<string>();
    nopedSwipes.forEach((s) => {
      if (s.userId === currentUserId) nopedUserIds.add(s.targetUserId);
      if (s.targetUserId === currentUserId) nopedUserIds.add(s.userId);
    });

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

      // Exclude noped users
      if (nopedUserIds.has(otherUser.id)) return false;

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
          },
          attributes: ['messageId', 'userId', 'pinnedBy', 'createdAt'],
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
      pinsMap = new Map();
      for (const pin of pinRows) {
        const existing = pinsMap.get(pin.messageId);
        const isViewer =
          String(pin.userId || '').trim().toLowerCase() === normCurrentUserId;
        if (!existing || isViewer) {
          pinsMap.set(pin.messageId, pin);
        }
      }
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

      if (parsedMetadata && typeof parsedMetadata === 'object') {
        if (typeof parsedMetadata.images === 'string') {
          try {
            parsedMetadata.images = JSON.parse(parsedMetadata.images);
          } catch {}
        }
        if (typeof parsedMetadata.imageUrls === 'string') {
          try {
            parsedMetadata.imageUrls = JSON.parse(parsedMetadata.imageUrls);
          } catch {}
        }
        if (typeof parsedMetadata.mediaUrls === 'string') {
          try {
            parsedMetadata.mediaUrls = JSON.parse(parsedMetadata.mediaUrls);
          } catch {}
        }
        if (!Array.isArray(parsedMetadata.images) && Array.isArray(parsedMetadata.imageUrls) && parsedMetadata.imageUrls.length > 0) {
          parsedMetadata.images = parsedMetadata.imageUrls.map((u: any) => {
            const rawUrl = typeof u === 'string' ? u : u?.url || u?.imageUrl || '';
            const k = s3Service.extractKey(rawUrl);
            return {
              url: rawUrl ? s3Service.getPublicUrl(k) : '',
              imageUrl: rawUrl ? s3Service.getPublicUrl(k) : '',
              thumbnailUrl: rawUrl ? s3Service.getThumbnailUrl(k) : '',
              key: k,
            };
          });
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
            return decorateChatGalleryImage(img);
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
        receiptStatus: status,
        isDelivered: !!msg.isDelivered,
        deliveredAt: msg.deliveredAt || null,
        isRead: !!msg.isRead,
        readAt: msg.readAt || null,
        sentAt: msg.createdAt,
        isMine,
        isSender: isMine,
        isPinned: !!pinInfo,
        pinned: !!pinInfo,
        pinnedAt: pinInfo?.createdAt || null,
        pinnedBy: pinInfo?.pinnedBy || null,
        isEdited: !!parsedMetadata?.isEdited,
        editedAt: parsedMetadata?.editedAt || null,
        replyToMessageId: parsedMetadata?.replyToMessageId || null,
        replyTo: parsedMetadata?.replyTo || null,
        isForwarded: !!parsedMetadata?.isForwarded,
        forwardedFromMessageId: parsedMetadata?.forwardedFromMessageId || null,
        originalSenderId: parsedMetadata?.originalSenderId || null,
        originalSenderName: parsedMetadata?.originalSenderName || null,
        originalCreatedAt: parsedMetadata?.originalCreatedAt || null,
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
          const gallery = parsedMetadata.images.map(decorateChatGalleryImage);
          msgItem.images = gallery;
          msgItem.imageUrls = gallery.map((i: any) =>
            typeof i === 'string' ? i : i.url || i.imageUrl || ''
          );
        } else if (Array.isArray(parsedMetadata?.imageUrls) && parsedMetadata.imageUrls.length > 0) {
          const urls: string[] = parsedMetadata.imageUrls.map((i: any) =>
            typeof i === 'string' ? i : i.url || i.imageUrl || ''
          );
          msgItem.imageUrls = urls;
          msgItem.images = urls.map((u: string) => decorateChatGalleryImage(u));
        } else {
          msgItem.images = resolvedUrl
            ? [decorateChatGalleryImage({ url: resolvedUrl, imageUrl: resolvedUrl, thumbnailUrl: resolvedThumb, key: cleanKey })]
            : [];
          msgItem.imageUrls = resolvedUrl ? [resolvedUrl] : [];
        }
        msgItem.mediaUrls = msgItem.imageUrls;
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

    // Opening the thread marks incoming messages delivered so the sender gets double ticks.
    if (page === 1 && !query.before && !query.after && !query.cursor) {
      const incomingIds = chronologicalMessages
        .filter((m) => !m.isMine && m.status === 'sent')
        .map((m) => m.id);
      if (incomingIds.length > 0) {
        try {
          await this.acknowledgeDelivery(currentUserId, actualConversationId, incomingIds);
        } catch {
          // history must still return if the receipt update fails
        }
      }
    }

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
   * FCM push for a newly persisted chat message.
   * Failures stay off the send path so a missing token or Firebase error cannot fail delivery.
   */
  private dispatchChatPush(
    recipientId: string,
    senderId: string,
    senderUser: any,
    conversationId: string,
    preview: string
  ): void {
    const message =
      preview && preview !== '__FILE_ATTACHMENT__' ? preview : 'Sent you a message';
    const senderName = senderUser ? resolveChatDisplayName(senderUser) : 'Someone';

    void notificationService
      .sendMessageNotification(recipientId, {
        senderId,
        senderName,
        message,
        conversationId,
      })
      .then((result) => {
        if (result.pushStatus !== 'sent_to_fcm') {
          console.warn('[FCM] Chat push not delivered:', {
            recipientId,
            conversationId,
            pushStatus: result.pushStatus,
            successCount: result.successCount ?? 0,
            failureCount: result.failureCount ?? 0,
            message: result.message || null,
          });
        }
      })
      .catch((err: any) => {
        console.warn('[FCM] Chat push failed:', err?.message || err);
      });
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
      const targetUser = await User.findByPk(conversationId);
      if (targetUser && targetUser.isActive) {
        const res = await this.getOrCreateOneToOneConversation(senderId, targetUser.id, {
          unhideForUser: senderId,
        });
        conversation = res.conversation;
      } else {
        const [u1, u2] = [senderId, conversationId].sort();
        conversation = await Conversation.findOne({
          where: { user1Id: u1, user2Id: u2 },
        });
      }
    }

    if (!conversation || conversation.isDeletedForEveryone) {
      throw new ChatServiceError(
        'Conversation not found or has been deleted',
        conversation?.isDeletedForEveryone ? 400 : 404
      );
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

    let rawImages = coerceMediaList((data as any).images || metadataObj.images || metadataObj.photos || metadataObj.attachments);
    let rawImageUrls = coerceMediaList(
      (data as any).imageUrls ||
      (data as any).mediaUrls ||
      metadataObj.imageUrls ||
      metadataObj.mediaUrls ||
      metadataObj.photos ||
      metadataObj.attachments
    );

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
        if (!file || !file.buffer || file.buffer.length === 0) {
          throw new ChatServiceError('One or more attached files are invalid or empty', 400, 'INVALID_FILE_BUFFER');
        }
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
              item?.src ||
              item?.key ||
              '';
        if (!raw) continue;
        const cleanKey = validateMediaAttachmentKey(raw, senderId);
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
        const raw = typeof rawItem === 'string'
          ? rawItem
          : (rawItem as any)?.url ||
            (rawItem as any)?.imageUrl ||
            (rawItem as any)?.mediaUrl ||
            (rawItem as any)?.path ||
            (rawItem as any)?.uri ||
            (rawItem as any)?.src ||
            (rawItem as any)?.key ||
            '';
        if (!raw || typeof raw !== 'string') continue;
        const cleanKey = validateMediaAttachmentKey(raw, senderId);
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

    if (uploadedImages.length > 1) {
      const uniqueImages = dedupeChatImages(uploadedImages);
      uploadedImages.length = 0;
      uploadedImages.push(...uniqueImages);
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
      const cleanKey = validateMediaAttachmentKey(bodyAudio, senderId);
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
        const cleanKey = validateMediaAttachmentKey(messageContent, senderId);
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
        const cleanKey = validateMediaAttachmentKey(messageContent, senderId);
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
          receiptStatus: status,
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

    const galleryImages = uploadedImages.map(decorateChatGalleryImage);
    const galleryUrls = galleryImages.map((img) => img.imageUrl).filter(Boolean);

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
        images: galleryImages,
        imageUrls: galleryUrls,
        mediaUrls: galleryUrls,
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

      // Unarchive for sender so the conversation is immediately visible in sender's active chat list
      await ConversationUserState.update(
        { isArchived: false, archivedAt: null },
        {
          where: {
            conversationId,
            userId: senderId,
            isArchived: true,
          },
          transaction: t,
        }
      );

      // Ensure per-user ConversationUserState records exist for both participants
      for (const uid of [senderId, recipientId]) {
        await ConversationUserState.findOrCreate({
          where: { conversationId, userId: uid },
          defaults: {
            conversationId,
            userId: uid,
            isDeleted: false,
            isArchived: false,
          },
          transaction: t,
        });
      }

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
        receiptStatus: 'sent',
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

    const viewerGallery = galleryImages.length > 0 ? galleryImages : undefined;
    const viewerUrls = galleryUrls.length > 0 ? galleryUrls : undefined;
    const recipientMessages = allDtos.map((item) =>
      buildViewerChatMessage(item, false, viewerGallery, viewerUrls)
    );
    const senderMessages = allDtos.map((item) =>
      buildViewerChatMessage(item, true, viewerGallery, viewerUrls)
    );

    // 9. Real-Time Delivery via Socket.IO for every created message
    try {
      const io = getSocketServer();
      const recipientRoom = getUserRoomName(recipientId);
      const senderRoom = getUserRoomName(senderId);

      for (let i = 0; i < allDtos.length; i++) {
        const recipientPayload = {
          ...recipientMessages[i],
          messages: recipientMessages,
          totalCount: allDtos.length,
        };
        const senderPayload = {
          ...senderMessages[i],
          messages: senderMessages,
          totalCount: allDtos.length,
        };

        // Deliver to recipient's multi-device room across all standard event names.
        // Every nested message is isMine:false so the other user renders the full gallery.
        io.to(recipientRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(recipientRoom).emit('chat:message:new' as any, recipientPayload);
        io.to(recipientRoom).emit('message:received' as any, recipientPayload);
        io.to(recipientRoom).emit('new_message' as any, recipientPayload);
        if (recipientId && recipientId.toLowerCase() !== recipientId) {
          io.to(getUserRoomName(recipientId.toLowerCase())).emit('chat:message_received' as any, recipientPayload);
          io.to(getUserRoomName(recipientId.toLowerCase())).emit('message:received' as any, recipientPayload);
        }

        // Synchronize sender's other connected devices (e.g. tablet, web, mobile)
        io.to(senderRoom).emit('chat:message_sent' as any, senderPayload);
        io.to(senderRoom).emit('message:sent' as any, senderPayload);
        io.to(senderRoom).emit('new_message' as any, senderPayload);
        if (senderId && senderId.toLowerCase() !== senderId) {
          io.to(getUserRoomName(senderId.toLowerCase())).emit('chat:message_sent' as any, senderPayload);
          io.to(getUserRoomName(senderId.toLowerCase())).emit('message:sent' as any, senderPayload);
        }

        // Broadcast to conversation room subscribers (exclude senderRoom so sender does not receive message_received for own message)
        io.to(`conversation:${conversationId}`).except(senderRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(`conversation:${conversationId}`).except(senderRoom).emit('message:received' as any, recipientPayload);
        io.to(`conversation:${conversationId}`).except(senderRoom).emit('new_message' as any, recipientPayload);
        io.to(`chat:${conversationId}`).except(senderRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(`chat:${conversationId}`).except(senderRoom).emit('message:received' as any, recipientPayload);
        io.to(`chat:${conversationId}`).except(senderRoom).emit('new_message' as any, recipientPayload);
      }

      // If multiple messages (e.g. multi-image burst), also emit plural batch events so clients listening for batch updates get all messages at once
      if (allDtos.length > 1) {
        const batchRecipientPayload = {
          conversationId,
          senderId,
          recipientId,
          messages: recipientMessages,
          images: viewerGallery || recipientMessages[0].images,
          imageUrls: viewerUrls || recipientMessages[0].imageUrls,
          mediaUrls: viewerUrls || recipientMessages[0].mediaUrls,
          totalCount: allDtos.length,
        };
        io.to(recipientRoom).emit('chat:messages_received' as any, batchRecipientPayload);
        io.to(recipientRoom).emit('messages:received' as any, batchRecipientPayload);
        io.to(`conversation:${conversationId}`).emit('chat:messages_received' as any, batchRecipientPayload);
        io.to(`conversation:${conversationId}`).emit('messages:received' as any, batchRecipientPayload);
        io.to(`chat:${conversationId}`).emit('chat:messages_received' as any, batchRecipientPayload);
        io.to(`chat:${conversationId}`).emit('messages:received' as any, batchRecipientPayload);

        const batchSenderPayload = {
          conversationId,
          senderId,
          recipientId,
          messages: senderMessages,
          images: viewerGallery || senderMessages[0].images,
          imageUrls: viewerUrls || senderMessages[0].imageUrls,
          mediaUrls: viewerUrls || senderMessages[0].mediaUrls,
          totalCount: allDtos.length,
        };
        io.to(senderRoom).emit('chat:messages_sent' as any, batchSenderPayload);
        io.to(senderRoom).emit('messages:sent' as any, batchSenderPayload);
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
      ...senderMessages[0],
      messages: senderMessages,
      images: viewerGallery || senderMessages[0].images,
      imageUrls: viewerUrls || senderMessages[0].imageUrls,
      mediaUrls: viewerUrls || senderMessages[0].mediaUrls,
      totalCount: allDtos.length,
      results: senderMessages.map((d) => ({ message: d, status: 'sent' })),
    };
    if (uploadedAudios.length > 0 && !primaryDto.audioUrl) {
      primaryDto.audioUrl = uploadedAudios[0].audioUrl;
      primaryDto.voiceUrl = uploadedAudios[0].voiceUrl;
      primaryDto.duration = uploadedAudios[0].duration;
      primaryDto.durationMs = uploadedAudios[0].durationMs;
    }

    this.dispatchChatPush(recipientId, senderId, senderUser, conversationId, lastMessagePreview);
    await this.applyLiveReceipts(
      senderId,
      recipientId,
      conversationId,
      allDtos.map((d) => d.id)
    );
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
      } else if ((data as any).userId) {
        rawIds.push((data as any).userId);
      } else if ((data as any).targetUserId) {
        rawIds.push((data as any).targetUserId);
      } else if ((data as any).participantId) {
        rawIds.push((data as any).participantId);
      } else if ((data as any).toUserId) {
        rawIds.push((data as any).toUserId);
      } else if ((data as any).otherUserId) {
        rawIds.push((data as any).otherUserId);
      }
      // Deduplicate preserving order, then resolve compact UUIDs / usernames
      const uniqueRaw = Array.from(new Set(rawIds.map((id) => normalizeRecipientIdentifier(id)).filter(Boolean))) as string[];
      const uuidIds = uniqueRaw.filter((id) => isUuidIdentifier(id));
      const otherIds = uniqueRaw.filter((id) => !isUuidIdentifier(id));
      if (otherIds.length > 0) {
        const namedUsers = await User.findAll({
          where: { username: { [Op.in]: otherIds } },
          attributes: ['id', 'username'],
        });
        const byUsername = new Map(namedUsers.map((u) => [u.username, u.id]));
        targetRecipientIds = uniqueRaw.map((id) => (isUuidIdentifier(id) ? id : byUsername.get(id) || id));
      } else {
        targetRecipientIds = uuidIds;
      }
      targetRecipientIds = Array.from(new Set(targetRecipientIds));
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

    let rawImages = coerceMediaList((data as any).images || metadataObj.images || metadataObj.photos || metadataObj.attachments);
    let rawImageUrls = coerceMediaList(
      (data as any).imageUrls ||
      (data as any).mediaUrls ||
      metadataObj.imageUrls ||
      metadataObj.mediaUrls ||
      metadataObj.photos ||
      metadataObj.attachments
    );

    let msgType: ChatMessageType = (data.messageType || data.type || 'text') as ChatMessageType;
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
        if (!file || !file.buffer || file.buffer.length === 0) {
          throw new ChatServiceError('One or more attached files are invalid or empty', 400, 'INVALID_FILE_BUFFER');
        }
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
              item?.src ||
              item?.key ||
              '';
        if (!raw) continue;
        const cleanKey = validateMediaAttachmentKey(raw, senderId);
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
        const raw = typeof rawItem === 'string'
          ? rawItem
          : (rawItem as any)?.url ||
            (rawItem as any)?.imageUrl ||
            (rawItem as any)?.mediaUrl ||
            (rawItem as any)?.path ||
            (rawItem as any)?.uri ||
            (rawItem as any)?.src ||
            (rawItem as any)?.key ||
            '';
        if (!raw || typeof raw !== 'string') continue;
        const cleanKey = validateMediaAttachmentKey(raw, senderId);
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
      const cleanKey = validateMediaAttachmentKey(bodyAudio, senderId);
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
        const cleanKey = validateMediaAttachmentKey(messageContent, senderId);
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
        const cleanKey = validateMediaAttachmentKey(messageContent, senderId);
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

    if (uploadedImages.length > 1) {
      const uniqueImages = dedupeChatImages(uploadedImages);
      uploadedImages.length = 0;
      uploadedImages.push(...uniqueImages);
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
          const { conversation } = await this.getOrCreateOneToOneConversation(
            senderId,
            recipientId,
            { transaction: t, unhideForUser: senderId }
          );
          conv = conversation;
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
              receiptStatus: status,
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

        const galleryImages = uploadedImages.map(decorateChatGalleryImage);
        const galleryUrls = galleryImages.map((img) => img.imageUrl).filter(Boolean);

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
            images: galleryImages,
            imageUrls: galleryUrls,
            mediaUrls: galleryUrls,
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

        // Unhide conversation if previously deleted for participants
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

        // Unarchive for sender so conversation is visible in sender's active chat list
        await ConversationUserState.update(
          { isArchived: false, archivedAt: null },
          {
            where: {
              conversationId,
              userId: senderId,
              isArchived: true,
            },
            transaction: t,
          }
        );

        // Ensure per-user ConversationUserState records exist for both participants
        for (const uid of [senderId, recipientId]) {
          await ConversationUserState.findOrCreate({
            where: { conversationId, userId: uid },
            defaults: {
              conversationId,
              userId: uid,
              isDeleted: false,
              isArchived: false,
            },
            transaction: t,
          });
        }

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
            receiptStatus: 'sent',
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

        const viewerGallery = galleryImages.length > 0 ? galleryImages : undefined;
        const viewerUrls = galleryUrls.length > 0 ? galleryUrls : undefined;
        const receiverViews = recipientDtos.map((item) =>
          buildViewerChatMessage(item, false, viewerGallery, viewerUrls)
        );
        const senderViews = recipientDtos.map((item) =>
          buildViewerChatMessage(item, true, viewerGallery, viewerUrls)
        );

        // Real-Time Delivery via Socket.IO
        try {
          const io = getSocketServer();
          const recipientRoom = getUserRoomName(recipientId);
          const senderRoom = getUserRoomName(senderId);

          for (let i = 0; i < recipientDtos.length; i++) {
            const recipientPayload = {
              ...receiverViews[i],
              messages: receiverViews,
              totalCount: recipientDtos.length,
            };
            const senderPayload = {
              ...senderViews[i],
              messages: senderViews,
              totalCount: recipientDtos.length,
            };

            // Deliver to recipient's multi-device room across all standard event names.
            // Nested messages stay isMine:false so the other user shows every image.
            io.to(recipientRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(recipientRoom).emit('chat:message:new' as any, recipientPayload);
            io.to(recipientRoom).emit('message:received' as any, recipientPayload);
            io.to(recipientRoom).emit('new_message' as any, recipientPayload);
            if (recipientId && recipientId.toLowerCase() !== recipientId) {
              io.to(getUserRoomName(recipientId.toLowerCase())).emit('chat:message_received' as any, recipientPayload);
              io.to(getUserRoomName(recipientId.toLowerCase())).emit('message:received' as any, recipientPayload);
            }

            // Synchronize sender's other connected devices (e.g. tablet, web, mobile)
            io.to(senderRoom).emit('chat:message_sent' as any, senderPayload);
            io.to(senderRoom).emit('message:sent' as any, senderPayload);
            io.to(senderRoom).emit('new_message' as any, senderPayload);
            if (senderId && senderId.toLowerCase() !== senderId) {
              io.to(getUserRoomName(senderId.toLowerCase())).emit('chat:message_sent' as any, senderPayload);
              io.to(getUserRoomName(senderId.toLowerCase())).emit('message:sent' as any, senderPayload);
            }

            // Broadcast to conversation room subscribers (exclude senderRoom so sender does not receive message_received for own message)
            io.to(`conversation:${conversationId}`).except(senderRoom).emit('chat:message_received' as any, recipientPayload);
            io.to(`conversation:${conversationId}`).except(senderRoom).emit('message:received' as any, recipientPayload);
            io.to(`conversation:${conversationId}`).except(senderRoom).emit('new_message' as any, recipientPayload);
            io.to(`chat:${conversationId}`).except(senderRoom).emit('chat:message_received' as any, recipientPayload);
            io.to(`chat:${conversationId}`).except(senderRoom).emit('message:received' as any, recipientPayload);
            io.to(`chat:${conversationId}`).except(senderRoom).emit('new_message' as any, recipientPayload);
          }

          // If multiple messages, emit plural batch events for multi-message listeners
          if (recipientDtos.length > 1) {
            const batchRecipientPayload = {
              conversationId,
              senderId,
              recipientId,
              messages: receiverViews,
              images: viewerGallery || receiverViews[0].images,
              imageUrls: viewerUrls || receiverViews[0].imageUrls,
              mediaUrls: viewerUrls || receiverViews[0].mediaUrls,
              totalCount: recipientDtos.length,
            };
            io.to(recipientRoom).emit('chat:messages_received' as any, batchRecipientPayload);
            io.to(recipientRoom).emit('messages:received' as any, batchRecipientPayload);
            io.to(`conversation:${conversationId}`).emit('chat:messages_received' as any, batchRecipientPayload);
            io.to(`conversation:${conversationId}`).emit('messages:received' as any, batchRecipientPayload);
            io.to(`chat:${conversationId}`).emit('chat:messages_received' as any, batchRecipientPayload);
            io.to(`chat:${conversationId}`).emit('messages:received' as any, batchRecipientPayload);

            const batchSenderPayload = {
              conversationId,
              senderId,
              recipientId,
              messages: senderViews,
              images: viewerGallery || senderViews[0].images,
              imageUrls: viewerUrls || senderViews[0].imageUrls,
              mediaUrls: viewerUrls || senderViews[0].mediaUrls,
              totalCount: recipientDtos.length,
            };
            io.to(senderRoom).emit('chat:messages_sent' as any, batchSenderPayload);
            io.to(senderRoom).emit('messages:sent' as any, batchSenderPayload);
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
          ...senderViews[0],
          messages: senderViews,
          images: viewerGallery || senderViews[0].images,
          imageUrls: viewerUrls || senderViews[0].imageUrls,
          mediaUrls: viewerUrls || senderViews[0].mediaUrls,
          totalCount: recipientDtos.length,
          results: senderViews.map((d) => ({ message: d, status: 'sent' })),
        };
        if (uploadedAudios.length > 0 && !primaryRecipientDto.audioUrl) {
          primaryRecipientDto.audioUrl = uploadedAudios[0].audioUrl;
          primaryRecipientDto.voiceUrl = uploadedAudios[0].voiceUrl;
          primaryRecipientDto.duration = uploadedAudios[0].duration;
          primaryRecipientDto.durationMs = uploadedAudios[0].durationMs;
        }

        await this.applyLiveReceipts(
          senderId,
          recipientId,
          conversationId,
          recipientDtos.map((d) => d.id)
        );

        results.push({
          recipientId,
          conversationId,
          status: 'success',
          message: primaryRecipientDto,
        });

        const preview =
          lastMessagePreview && lastMessagePreview !== '__FILE_ATTACHMENT__'
            ? lastMessagePreview
            : uploadedImages.length > 0
            ? 'Sent an image 📷'
            : uploadedAudios.length > 0
            ? 'Sent a voice message 🎤'
            : 'Sent you a message';
        this.dispatchChatPush(recipientId, senderId, senderUser, conversationId, preview);
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
   * Push sent / delivered / seen ticks on the names this app and older clients listen for.
   * OneVibe mobile: chat:message:delivered, chat:message:seen, chat:message:status.
   * Existing clients: chat:delivery_receipt, chat:read_receipt.
   */
  private emitMessageReceipt(input: {
    kind: 'delivered' | 'read';
    conversationId: string;
    actorId: string;
    notifyUserId: string;
    messageIds: string[];
    cursorId?: string | null;
    at: Date;
    markedCount?: number;
  }): void {
    const io = getSocketServer();
    const ids = input.messageIds.filter(Boolean);
    const cursorId = input.cursorId || ids[ids.length - 1] || null;
    const atIso = input.at.toISOString();

    const legacy =
      input.kind === 'delivered'
        ? {
            conversationId: input.conversationId,
            recipientId: input.actorId,
            delivererId: input.actorId,
            userId: input.actorId,
            messageIds: ids,
            messageId: cursorId,
            deliveredAt: atIso,
            status: 'delivered' as const,
            receiptStatus: 'delivered' as const,
            isDelivered: true,
            deliveredCount: input.markedCount ?? ids.length,
          }
        : {
            conversationId: input.conversationId,
            readerId: input.actorId,
            userId: input.actorId,
            readBy: input.actorId,
            lastReadMessageId: cursorId,
            messageId: cursorId,
            messageIds: ids,
            markedCount: input.markedCount ?? ids.length,
            readAt: atIso,
            status: 'read' as const,
            receiptStatus: 'read' as const,
            isRead: true,
            seen: true,
          };

    const oneVibe =
      input.kind === 'delivered'
        ? {
            conversationId: input.conversationId,
            delivererId: input.actorId,
            recipientId: input.actorId,
            userId: input.actorId,
            messageId: cursorId,
            messageIds: ids,
            deliveredAt: atIso,
            status: 'delivered' as const,
            receiptStatus: 'delivered' as const,
            isDelivered: true,
          }
        : {
            conversationId: input.conversationId,
            readerId: input.actorId,
            userId: input.actorId,
            readBy: input.actorId,
            messageId: cursorId,
            messageIds: ids,
            lastReadMessageId: cursorId,
            readAt: atIso,
            status: 'seen' as const,
            receiptStatus: 'read' as const,
            isRead: true,
            seen: true,
            markedCount: input.markedCount ?? 0,
          };

    const rooms = [
      getUserRoomName(input.notifyUserId),
      getUserRoomName(input.actorId),
      `conversation:${input.conversationId}`,
      `chat:${input.conversationId}`,
    ];
    if (input.notifyUserId && input.notifyUserId.toLowerCase() !== input.notifyUserId) {
      rooms.push(getUserRoomName(input.notifyUserId.toLowerCase()));
    }
    if (input.actorId && input.actorId.toLowerCase() !== input.actorId) {
      rooms.push(getUserRoomName(input.actorId.toLowerCase()));
    }

    const legacyEvents =
      input.kind === 'delivered'
        ? ['chat:delivery_receipt', 'message:delivery_receipt']
        : ['chat:read_receipt', 'message:read_receipt'];
    const oneVibeEvents =
      input.kind === 'delivered'
        ? ['chat:message:delivered', 'chat:message:status', 'message:status']
        : ['chat:message:seen', 'chat:seen', 'message:seen', 'chat:message:status', 'message:status'];

    for (const room of rooms) {
      for (const event of legacyEvents) {
        io.to(room).emit(event as any, legacy);
      }
      for (const event of oneVibeEvents) {
        io.to(room).emit(event as any, oneVibe);
      }
    }

    if (ids.length > 1) {
      const perEvent = input.kind === 'delivered' ? 'chat:message:delivered' : 'chat:message:seen';
      for (const id of ids) {
        const perMessage = { ...oneVibe, messageId: id };
        for (const room of rooms) {
          io.to(room).emit(perEvent as any, perMessage);
        }
      }
    }

    io.to(getUserRoomName(input.notifyUserId)).emit('chat:inbox:refresh' as any, {
      conversationId: input.conversationId,
      reason: input.kind === 'delivered' ? 'delivered' : 'read',
      ...(input.kind === 'delivered'
        ? { delivererId: input.actorId }
        : { readerId: input.actorId }),
    });
  }

  /**
   * Online recipient → double tick. Open conversation → seen.
   * Failures stay off the send response.
   */
  private async applyLiveReceipts(
    senderId: string,
    recipientId: string,
    conversationId: string,
    messageIds: string[]
  ): Promise<void> {
    if (!recipientId || !conversationId || messageIds.length === 0) return;
    if (recipientId === senderId) return;
    try {
      const latestId = messageIds[messageIds.length - 1];
      if (isUserViewingConversation(recipientId, conversationId)) {
        await this.markMessagesAsRead(recipientId, conversationId, latestId);
        return;
      }
      if (isUserConnected(recipientId)) {
        await this.acknowledgeDelivery(recipientId, conversationId, messageIds);
      }
    } catch {
      // receipt side effects must not fail the send
    }
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
    messageId: string | null;
    readerId: string;
    markedCount: number;
    unreadCount: number;
    status: 'read';
    receiptStatus: 'read';
    readAt: string;
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
    let resolvedLastReadId = lastReadMessageId || boundaryMessage?.id || null;
    if (!resolvedLastReadId && markedCount > 0) {
      const latestRead = await ChatMessage.findOne({
        where: { conversationId, recipientId: currentUserId, isRead: true },
        order: [['createdAt', 'DESC']],
        attributes: ['id'],
      });
      resolvedLastReadId = latestRead?.id || null;
    }

    if (markedCount > 0 || lastReadMessageId) {
      try {
        const io = getSocketServer();
        this.emitMessageReceipt({
          kind: 'read',
          conversationId,
          actorId: currentUserId,
          notifyUserId: otherUserId,
          messageIds: resolvedLastReadId ? [resolvedLastReadId] : [],
          cursorId: resolvedLastReadId,
          at: now,
          markedCount,
        });

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
      lastReadMessageId: resolvedLastReadId,
      messageId: resolvedLastReadId,
      readerId: currentUserId,
      markedCount,
      unreadCount,
      status: 'read',
      receiptStatus: 'read',
      readAt: now.toISOString(),
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
    messageId?: string | null;
    delivererId?: string;
    deliveredCount: number;
    status?: 'delivered';
    receiptStatus?: 'delivered';
    deliveredAt?: string;
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
    const deliveredMessageIds = undeliveredIds.length > 0 ? undeliveredIds : eligibleMessages.map((m) => m.id);
    if (deliveredCount > 0 || eligibleMessages.length > 0) {
      try {
        this.emitMessageReceipt({
          kind: 'delivered',
          conversationId,
          actorId: currentUserId,
          notifyUserId: otherUserId,
          messageIds: deliveredMessageIds,
          cursorId: deliveredMessageIds[deliveredMessageIds.length - 1] || null,
          at: now,
          markedCount: deliveredCount > 0 ? deliveredCount : eligibleMessages.length,
        });
      } catch { }
    }

    return {
      conversationId,
      messageIds: eligibleMessages.map((m) => m.id),
      messageId: deliveredMessageIds[deliveredMessageIds.length - 1] || null,
      delivererId: currentUserId,
      deliveredCount,
      status: 'delivered',
      receiptStatus: 'delivered',
      deliveredAt: now.toISOString(),
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
        for (const [key, group] of groupedBySender.entries()) {
          const senderId = key.slice(0, key.indexOf(':'));
          this.emitMessageReceipt({
            kind: 'delivered',
            conversationId: group.conversationId,
            actorId: currentUserId,
            notifyUserId: senderId,
            messageIds: group.messageIds,
            cursorId: group.messageIds[group.messageIds.length - 1] || null,
            at: now,
            markedCount: group.messageIds.length,
          });
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
   * Chat-list row for one viewer. The mobile list reads participant.userId,
   * displayName, and name. A payload missing those fields renders as "Unknown"
   * and is then dropped on the next refresh.
   */
  private async buildViewerConversationPayload(
    viewerId: string,
    conversationId: string
  ): Promise<Record<string, any> | null> {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) return null;

    const otherUserId = getOtherParticipantId(conversation, viewerId);
    const otherUser = await User.findByPk(otherUserId, {
      attributes: [
        'id',
        'fullName',
        'firstName',
        'lastName',
        'nickName',
        'username',
        'profilePicture',
        'isFaceVerified',
        'isSubscribed',
        'isActive',
      ],
    });
    if (!otherUser || otherUser.isActive === false) return null;

    const [pin, state, unreadCount] = await Promise.all([
      ConversationPin.findOne({ where: { conversationId, userId: viewerId } }),
      ConversationUserState.findOne({ where: { conversationId, userId: viewerId } }),
      this.getConversationUnreadCount(viewerId, conversationId),
    ]);

    const sentAt = conversation.lastMessageAt
      ? new Date(conversation.lastMessageAt).toISOString()
      : null;
    const displayName = resolveChatDisplayName(otherUser);
    const photo = otherUser.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null;
    const pinnedAt = pin?.createdAt ? new Date(pin.createdAt).toISOString() : null;

    return {
      conversationId: conversation.id,
      id: conversation.id,
      lastMessage: conversation.lastMessage
        ? {
            content: conversation.lastMessage,
            messageType: 'text',
            sentAt: sentAt || new Date(conversation.updatedAt).toISOString(),
            createdAt: sentAt || new Date(conversation.updatedAt).toISOString(),
          }
        : null,
      lastMessageText: conversation.lastMessage || null,
      lastMessageAt: sentAt,
      unreadCount,
      participant: {
        userId: otherUser.id,
        id: otherUser.id,
        displayName,
        name: displayName,
        username: otherUser.username || otherUser.nickName || '',
        profileImageUrl: photo,
        profilePhotoUrl: photo,
        isOnline: isUserConnected(otherUser.id),
      },
      targetUser: {
        id: otherUser.id,
        name: displayName,
        username: otherUser.username || otherUser.nickName || '',
        profilePhotoUrl: photo,
        profilePicture: photo,
        isVerified: Boolean(otherUser.isFaceVerified),
        isSubscribed: Boolean(otherUser.isSubscribed),
      },
      isPinned: !!pin,
      pinned: !!pin,
      pinnedAt,
      isArchived: !!state?.isArchived,
      updatedAt: new Date().toISOString(),
    };
  }

  private emitToViewer(viewerId: string, eventName: string, payload: any): void {
    const io = getSocketServer();
    if (!io || !viewerId) return;
    const rooms = new Set<string>([getUserRoomName(viewerId)]);
    const lower = String(viewerId).toLowerCase();
    if (lower !== viewerId) {
      rooms.add(getUserRoomName(lower));
    }
    for (const room of rooms) {
      io.to(room).emit(eventName as any, payload);
    }
  }

  /**
   * Pushes the viewer's chat-list row immediately so an open list can insert
   * or move the conversation without leaving the screen and coming back.
   */
  private async pushViewerConversation(
    viewerId: string,
    conversationId: string
  ): Promise<Record<string, any> | null> {
    try {
      const payload = await this.buildViewerConversationPayload(viewerId, conversationId);
      if (!payload) return null;
      for (const eventName of [
        'conversation:updated',
        'chat:conversation_updated',
        'conversation_updated',
        'conversation:update',
        'conversations:update',
      ]) {
        this.emitToViewer(viewerId, eventName, payload);
      }
      return payload;
    } catch {
      return null;
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

    // Check existing pin state for idempotence
    const existingPin = await ConversationPin.findOne({
      where: { conversationId, userId: currentUserId },
    });
    const alreadyPinned = !!existingPin;
    const hasChanged = alreadyPinned !== isPinned;

    if (hasChanged) {
      const t = await sequelize.transaction();
      try {
        if (isPinned) {
          await ConversationPin.create(
            {
              conversationId,
              userId: currentUserId,
            },
            { transaction: t }
          );
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

      // Real-time synchronization only to requesting user's active sessions (never other participants)
      // and only emitted when state actually changed (idempotent guard).
      // conversation:updated carries the full list row (name + pin) so the open
      // chat list can move the person into the pinned section immediately.
      try {
        const snapshot = await this.pushViewerConversation(currentUserId, conversationId);
        const payload = {
          conversationId,
          isPinned,
          pinned: isPinned,
          pinnedAt: isPinned ? snapshot?.pinnedAt || new Date().toISOString() : null,
          participant: snapshot?.participant,
          targetUser: snapshot?.targetUser,
          lastMessage: snapshot?.lastMessage ?? null,
          lastMessageAt: snapshot?.lastMessageAt ?? null,
          unreadCount: snapshot?.unreadCount ?? 0,
          isArchived: snapshot?.isArchived ?? false,
        };
        this.emitToViewer(currentUserId, 'conversation:pin-updated', payload);
        this.emitToViewer(currentUserId, 'conversation:pin_updated', payload);
      } catch {
        // Socket server not available in test/offline environments
      }
    }

    return {
      conversationId,
      isPinned,
    };
  }

  /**
   * Pushes pin state to every open chat for this conversation.
   * The mobile client listens for `chat:message:pin:updated` on the conversation
   * room and on the user room. Legacy event names stay so older clients keep working.
   */
  private async broadcastMessagePinUpdate(options: {
    conversation: { user1Id: string; user2Id: string };
    conversationId: string;
    message: ChatMessage;
    actorId: string;
    isPinned: boolean;
    scope: 'user' | 'conversation';
    pinnedAt: Date | string | null;
    pinnedBy: string | null;
    metadata: any;
  }): Promise<ChatMessageDTO | null> {
    const {
      conversation,
      conversationId,
      message,
      actorId,
      isPinned,
      scope,
      pinnedAt,
      pinnedBy,
      metadata,
    } = options;

    let parsedMetadata = metadata;
    if (message.messageType === 'image' && message.content) {
      if (!parsedMetadata || typeof parsedMetadata !== 'object') {
        parsedMetadata = {};
      }
      const cleanKey = s3Service.extractKey(message.content);
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

    const senderUser = await User.findByPk(message.senderId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });
    const sender: ChatMessageSenderDTO = senderUser
      ? {
          id: senderUser.id,
          displayName: resolveChatDisplayName(senderUser),
          profileImageUrl: formatMediaUrl(senderUser.profilePicture),
        }
      : {
          id: message.senderId,
          displayName: 'Participant',
          profileImageUrl: null,
        };

    const pinnedAtIso =
      pinnedAt instanceof Date ? pinnedAt.toISOString() : pinnedAt ? String(pinnedAt) : null;

    const status: 'sent' | 'delivered' | 'read' = message.isRead
      ? 'read'
      : message.isDelivered
        ? 'delivered'
        : 'sent';

    const buildMessage = (viewerId: string): ChatMessageDTO => {
      const isMine =
        String(message.senderId || '').trim().toLowerCase() ===
        String(viewerId || '').trim().toLowerCase();
      return {
        id: message.id,
        conversationId,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        messageType: (message.messageType as any) || 'text',
        metadata: parsedMetadata,
        status,
        receiptStatus: status,
        isDelivered: !!message.isDelivered,
        deliveredAt: message.deliveredAt || null,
        isRead: !!message.isRead,
        readAt: message.readAt || null,
        sentAt: message.createdAt,
        createdAt: message.createdAt,
        isMine,
        isSender: isMine,
        isPinned,
        pinned: isPinned,
        pinnedAt: isPinned ? pinnedAtIso : null,
        pinnedBy: isPinned ? pinnedBy : null,
        isEdited: !!parsedMetadata?.isEdited,
        editedAt: parsedMetadata?.editedAt || null,
        replyToMessageId: parsedMetadata?.replyToMessageId || null,
        replyTo: parsedMetadata?.replyTo || null,
        sender,
      };
    };

    const actorMessage = buildMessage(actorId);

    try {
      const io = getSocketServer();
      const legacyEvent = isPinned ? 'chat:message_pinned' : 'chat:message_unpinned';
      const aliasEvent = isPinned ? 'message:pinned' : 'message:unpinned';
      const eventNames = ['chat:message:pin:updated', legacyEvent, aliasEvent];

      const buildPayload = (viewerId: string) => ({
        conversationId,
        messageId: message.id,
        isPinned,
        pinned: isPinned,
        pinnedBy: isPinned ? pinnedBy || actorId : null,
        pinnedAt: isPinned ? pinnedAtIso : null,
        scope: 'conversation' as const,
        message: buildMessage(viewerId),
      });

      const emitPayload = (room: string, payload: ReturnType<typeof buildPayload>) => {
        for (const eventName of eventNames) {
          io.to(room).emit(eventName as any, payload);
        }
      };

      // Each participant gets a message shaped for their own side of the chat.
      for (const userId of [conversation.user1Id, conversation.user2Id]) {
        if (!userId) continue;
        const payload = buildPayload(userId);
        const rooms = new Set([
          getUserRoomName(userId),
          getUserRoomName(String(userId).toLowerCase()),
        ]);
        for (const room of rooms) {
          emitPayload(room, payload);
        }
      }

      // Open chats join these rooms. Deliver a per-viewer payload so isMine stays correct.
      for (const room of [`conversation:${conversationId}`, `chat:${conversationId}`]) {
        let sockets: any[] = [];
        try {
          sockets = await io.in(room).fetchSockets();
        } catch {
          sockets = [];
        }

        if (sockets.length === 0) {
          emitPayload(room, buildPayload(actorId));
          continue;
        }

        for (const remote of sockets) {
          const viewerId = remote.data?.user?.userId || actorId;
          const payload = buildPayload(viewerId);
          for (const eventName of eventNames) {
            remote.emit(eventName, payload);
          }
        }
      }
    } catch (err) {
      socketLogger.error('Failed to emit message pin update', err, {
        conversationId,
        messageId: message.id,
      });
    }

    return actorMessage;
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
    scope: 'user' | 'conversation' = 'conversation'
  ): Promise<{
    conversationId: string;
    messageId: string;
    isPinned: boolean;
    pinnedAt: Date | string | null;
    pinnedBy: string | null;
    message: ChatMessageDTO | null;
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

    const message = await this.findMessageByIdOrClientMessageId(conversationId, messageId);

    if (!message || message.conversationId !== conversationId) {
      throw new ChatServiceError('Message not found in this conversation', 404);
    }

    const canonicalMessageId = message.id;

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
          messageId: canonicalMessageId,
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
            messageId: canonicalMessageId,
            userId: currentUserId,
            pinnedBy: currentUserId,
          });
        } catch (err: any) {
          // If created concurrently by another request, fetch existing
          existingPin = await ChatMessagePin.findOne({
            where: {
              conversationId,
              messageId: canonicalMessageId,
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
          where: { conversationId, messageId: canonicalMessageId, userId: otherUserId },
        });
        if (!otherPin) {
          try {
            await ChatMessagePin.create({
              conversationId,
              messageId: canonicalMessageId,
              userId: otherUserId,
              pinnedBy: currentUserId,
            });
          } catch { }
        }
      }
    } else {
      // Unpinning
      await ChatMessagePin.destroy({
        where: {
          conversationId,
          messageId: canonicalMessageId,
          userId: currentUserId,
        },
      });

      if (scope === 'conversation') {
        await ChatMessagePin.destroy({
          where: {
            conversationId,
            messageId: canonicalMessageId,
            userId: otherUserId,
          },
        });
      }
    }

    const messageSnapshot = await this.broadcastMessagePinUpdate({
      conversation,
      conversationId,
      message,
      actorId: currentUserId,
      isPinned,
      scope,
      pinnedAt: isPinned
        ? pinnedAt || now
        : null,
      pinnedBy: isPinned ? pinnedBy || currentUserId : null,
      metadata: msgMeta,
    });

    return {
      conversationId,
      messageId: canonicalMessageId,
      isPinned,
      pinnedAt,
      pinnedBy,
      message: messageSnapshot,
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
        receiptStatus: status,
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
   * Authoritative helper to get or create a 1-to-1 conversation between two users.
   * - Validates user IDs and ensures both user-order permutations resolve to the exact same conversation.
   * - Enforces database transaction and concurrency safety (handling unique constraint races).
   * - Revives conversations that were previously isDeletedForEveryone if needed.
   * - Initializes or un-hides ConversationUserState records for both participants.
   */
  public async getOrCreateOneToOneConversation(
    userAId: string,
    userBId: string,
    options: {
      transaction?: any;
      unhideForUser?: string;
      validateAccountStatus?: boolean;
    } = {}
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    const normA = String(userAId || '').trim();
    const normB = String(userBId || '').trim();

    if (!normA || !normB) {
      throw new ChatServiceError('Both user IDs are required to resolve a conversation', 400);
    }

    if (normA.toLowerCase() === normB.toLowerCase()) {
      throw new ChatServiceError('You cannot start a conversation with yourself', 400);
    }

    if (options.validateAccountStatus) {
      const targetUser = await User.findByPk(normB, {
        attributes: ['id', 'isActive'],
      });
      if (!targetUser || targetUser.isActive === false) {
        throw new ChatServiceError('User profile is unavailable', 404);
      }

      const isBlocked = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: normA, blockedUserId: normB },
            { userId: normB, blockedUserId: normA },
          ],
        },
      });
      if (isBlocked) {
        throw new ChatServiceError('You cannot chat with this user', 403);
      }
    }

    const [u1, u2] = [normA, normB].sort();

    const executeOperation = async (t?: any) => {
      let conv = await Conversation.findOne({
        where: { user1Id: u1, user2Id: u2 },
        transaction: t,
      });

      let isNew = false;
      if (!conv) {
        try {
          conv = await Conversation.create(
            {
              user1Id: u1,
              user2Id: u2,
              isDeletedForEveryone: false,
            },
            { transaction: t }
          );
          isNew = true;
        } catch (err: any) {
          // Handle concurrent creation race condition across PostgreSQL, SQLite, etc.
          const isUnique =
            err.name === 'SequelizeUniqueConstraintError' ||
            err.code === '23505' ||
            err.code === 'SQLITE_CONSTRAINT' ||
            (err.message && /unique/i.test(err.message)) ||
            (err.original && /unique/i.test(err.original.message));

          if (isUnique) {
            for (let retry = 0; retry < 5; retry++) {
              conv = await Conversation.findOne({
                where: { user1Id: u1, user2Id: u2 },
                transaction: t,
              });
              if (conv) break;
              await new Promise((r) => setTimeout(r, 25));
            }
            if (!conv) {
              throw err;
            }
            isNew = false;
          } else {
            throw err;
          }
        }
      }

      // If conversation existed but was deleted for everyone, revive it
      if (conv.isDeletedForEveryone) {
        conv.isDeletedForEveryone = false;
        conv.deletedForEveryoneAt = null;
        conv.deletedForEveryoneBy = null;
        await conv.save({ transaction: t });
      }

      // Ensure per-user ConversationUserState records exist for both users
      for (const uid of [u1, u2]) {
        const isUnhideTarget =
          options.unhideForUser && uid.toLowerCase() === options.unhideForUser.toLowerCase();
        let uState: ConversationUserState | null = null;
        let stateCreated = false;
        try {
          const res = await ConversationUserState.findOrCreate({
            where: { conversationId: conv.id, userId: uid },
            defaults: {
              conversationId: conv.id,
              userId: uid,
              isDeleted: false,
              isArchived: false,
            },
            transaction: t,
          });
          uState = res[0];
          stateCreated = res[1];
        } catch {
          uState = await ConversationUserState.findOne({
            where: { conversationId: conv.id, userId: uid },
            transaction: t,
          });
        }

        if (uState && !stateCreated && isUnhideTarget && (uState.isDeleted || uState.isArchived)) {
          uState.isDeleted = false;
          uState.isArchived = false;
          uState.archivedAt = null;
          await uState.save({ transaction: t });
        }
      }

      return { conversation: conv, isNew };
    };

    if (options.transaction) {
      return executeOperation(options.transaction);
    }

    return executeOperation();
  }

  private async resolveRecipientUser(rawRecipientId: string): Promise<User> {
    const resolvedRecipientId = normalizeRecipientIdentifier(rawRecipientId);
    if (!resolvedRecipientId) {
      throw new ChatServiceError('recipientId is required', 400);
    }

    const userLookupAttributes = [
      'id',
      'username',
      'firstName',
      'lastName',
      'fullName',
      'profilePicture',
      'isActive',
    ] as const;

    let recipient = isUuidIdentifier(resolvedRecipientId)
      ? await User.findByPk(resolvedRecipientId, { attributes: [...userLookupAttributes] })
      : null;

    if (!recipient) {
      recipient = await User.findOne({
        where: { username: resolvedRecipientId },
        attributes: [...userLookupAttributes],
      });
    }

    if (!recipient || recipient.isActive === false) {
      throw new ChatServiceError('User profile is unavailable', 404);
    }

    return recipient;
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
    participant?: any;
    targetUser?: any;
    lastMessage?: any;
    lastMessageAt?: string | null;
    unreadCount?: number;
    isPinned?: boolean;
    pinned?: boolean;
    isArchived?: boolean;
  }> {
    const recipient = await this.resolveRecipientUser(recipientId);
    recipientId = recipient.id;

    if (currentUserId === recipientId) {
      throw new ChatServiceError('You cannot start a conversation with yourself', 400);
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

    const { conversation, isNew } = await this.getOrCreateOneToOneConversation(
      currentUserId,
      recipientId,
      { unhideForUser: currentUserId }
    );

    const hadHistory = Boolean(
      (conversation.lastMessage && String(conversation.lastMessage).trim().length > 0) ||
        conversation.lastMessageAt
    );

    // Opening chat from a profile must keep the thread on the starter's list.
    // Until a real message exists, the other person does not see an empty row.
    if (!hadHistory) {
      const openedAt = new Date();
      const hiddenAt = new Date(openedAt.getTime() + 1000);
      conversation.lastMessageAt = openedAt;
      await conversation.save();
      await ConversationUserState.update(
        { isDeleted: true, deletedAt: hiddenAt, clearedAt: hiddenAt },
        { where: { conversationId: conversation.id, userId: recipientId } }
      );
    }

    const displayName = resolveChatDisplayName(recipient);
    const photo = formatMediaUrl(recipient.profilePicture);
    const snapshot = await this.pushViewerConversation(currentUserId, conversation.id);

    const participant = snapshot?.participant || {
      userId: recipient.id,
      id: recipient.id,
      displayName,
      name: displayName,
      username: recipient.username || '',
      profileImageUrl: photo,
      profilePhotoUrl: photo,
      isOnline: isUserConnected(recipient.id),
    };

    const targetUser = snapshot?.targetUser || {
      id: recipient.id,
      username: recipient.username,
      name: displayName,
      profilePicture: photo,
      profilePhotoUrl: photo,
      isVerified: Boolean((recipient as any).isFaceVerified),
      isSubscribed: Boolean((recipient as any).isSubscribed),
    };

    return {
      id: conversation.id,
      conversationId: conversation.id,
      isNew,
      user1Id: conversation.user1Id,
      user2Id: conversation.user2Id,
      recipientId,
      participant,
      targetUser,
      lastMessage: snapshot?.lastMessage ?? null,
      lastMessageAt: snapshot?.lastMessageAt ?? (conversation.lastMessageAt
        ? new Date(conversation.lastMessageAt).toISOString()
        : null),
      unreadCount: snapshot?.unreadCount ?? 0,
      isPinned: snapshot?.isPinned ?? false,
      pinned: snapshot?.pinned ?? false,
      isArchived: snapshot?.isArchived ?? false,
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
    const { content, messageType = 'text', metadata = null } = input;
    const resolvedRecipient = await this.resolveRecipientUser(input.recipientId);
    const recipientId = resolvedRecipient.id;

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

    // Fetch noped users to exclude from conversation list
    const nopedSwipes = await SwipeAction.findAll({
      where: {
        [Op.or]: [
          { userId, action: 'nope' },
          { targetUserId: userId, action: 'nope' },
        ],
      },
      attributes: ['userId', 'targetUserId'],
      raw: true,
    });
    const nopedUserIds = new Set<string>();
    nopedSwipes.forEach((s) => {
      if (s.userId === userId) nopedUserIds.add(s.targetUserId);
      if (s.targetUserId === userId) nopedUserIds.add(s.userId);
    });

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

    // Fetch pinned conversations for current user
    const pins = await ConversationPin.findAll({
      where: { userId },
      attributes: ['conversationId'],
      raw: true,
    });
    const pinnedConversationIdSet = new Set(pins.map((p) => p.conversationId));

    const results: ConversationSummaryDTO[] = [];

    const normViewerId = String(userId || '').trim().toLowerCase();

    for (const conv of conversations) {
      const normU1 = String(conv.user1Id || '').trim().toLowerCase();
      const normU2 = String(conv.user2Id || '').trim().toLowerCase();
      if (normU1 === normU2) continue;

      const partner = normU1 === normViewerId ? (conv as any).user2 : (conv as any).user1;
      if (!partner || !partner.isActive) continue;

      // Exclude noped users
      if (nopedUserIds.has(partner.id)) continue;

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
          name: resolveChatDisplayName(partner),
          username: partner.username || partner.nickName || '',
          profilePhotoUrl: this.resolvePrimaryPhoto(partner.profilePicture, partner.photos),
          isVerified: Boolean(partner.isFaceVerified),
          isSubscribed: Boolean(partner.isSubscribed),
        },
        lastMessage: conv.lastMessage || null,
        lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
        unreadCount,
        isMatched: Boolean(match),
        isPinned: pinnedConversationIdSet.has(conv.id),
      });
    }

    // Pinned conversations appear before unpinned conversations
    results.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });

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
   * Helper to locate a message within a conversation by primary key (case-insensitive)
   * or by clientMessageId stored in metadata for clients (e.g. iOS) that track local IDs.
   */
  public async findMessageByIdOrClientMessageId(
    conversationId: string,
    messageId: string
  ): Promise<ChatMessage | null> {
    if (!messageId) return null;
    const trimmedId = String(messageId).trim();

    // 1. Direct PK lookup
    let message = await ChatMessage.findByPk(trimmedId);
    if (message) {
      return message;
    }

    // 2. Lowercase PK lookup
    const lowerId = trimmedId.toLowerCase();
    if (lowerId !== trimmedId) {
      message = await ChatMessage.findByPk(lowerId);
      if (message) {
        return message;
      }
    }

    // 3. Fallback: Lookup by clientMessageId in metadata or id within conversation
    message = await ChatMessage.findOne({
      where: {
        [Op.or]: [
          { id: trimmedId },
          { id: lowerId },
          { metadata: { [Op.like]: `%"clientMessageId":"${trimmedId}"%` } },
          { metadata: { [Op.like]: `%"clientMessageId":"${lowerId}"%` } },
          { metadata: { [Op.like]: `%"clientMessageId":"${trimmedId.toUpperCase()}"%` } },
        ],
      },
    });

    return message;
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

    const message = await this.findMessageByIdOrClientMessageId(conversationId, messageId);
    if (!message) {
      throw new ChatServiceError('Message not found', 404, 'MESSAGE_NOT_FOUND');
    }

    if (message.conversationId !== conversationId) {
      throw new ChatServiceError('Message does not belong to this conversation', 400, 'INVALID_CONVERSATION');
    }

    if (String(message.senderId || '').trim().toLowerCase() !== normUserId) {
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
        const lockedMessage = await ChatMessage.findByPk(message.id, {
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
      where: { conversationId, messageId: message.id, userId },
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

    const message = await this.findMessageByIdOrClientMessageId(conversationId, messageId);
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
      throw new ChatServiceError('Reaction emoji is required', 400, 'VALIDATION_ERROR');
    }

    if (normalizedEmoji.length > 32) {
      throw new ChatServiceError('Reaction emoji cannot exceed 32 characters', 400, 'VALIDATION_ERROR');
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

    const message = await this.findMessageByIdOrClientMessageId(conversationId, messageId);
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

  /**
   * FORWARD MESSAGES TO SINGLE / MULTIPLE RECIPIENTS
   * Validates access to all source messages and original conversations.
   * Enforces recipient activity, block checks, and batch limits.
   * Reuses or creates 1-to-1 conversations transactionally.
   * Preserves content and attachments securely without duplicate IDs or ORM leakage.
   * Sets canonical forwarding metadata (isForwarded, forwardedFromMessageId, originalSenderId).
   * Dispatches real-time Socket.IO delivery events after database persistence succeeds.
   */
  public async forwardMessages(
    senderId: string,
    data: ForwardMessagesInput
  ): Promise<ForwardMessagesResultDTO> {
    // 1. Resolve & normalize target message IDs
    let targetMessageIds: string[] = [];
    if (Array.isArray(data.messageIds)) {
      targetMessageIds = data.messageIds;
    } else if (typeof (data as any).messageIds === 'string' && (data as any).messageIds.trim()) {
      const s = (data as any).messageIds.trim();
      targetMessageIds = s.includes(',') ? s.split(',').map((x: string) => x.trim()).filter(Boolean) : [s];
    } else if (data.messageId) {
      targetMessageIds = [data.messageId];
    }

    // Check for duplicate messageIds in request
    if (new Set(targetMessageIds).size !== targetMessageIds.length) {
      throw new ChatServiceError('Duplicate messageIds are not allowed', 400, 'DUPLICATE_MESSAGE_IDS');
    }

    if (targetMessageIds.length === 0) {
      throw new ChatServiceError('At least one valid messageId is required', 400, 'INVALID_MESSAGES');
    }

    const maxForwardMessages = 20;
    if (targetMessageIds.length > maxForwardMessages) {
      throw new ChatServiceError(
        `Message limit exceeded. Maximum ${maxForwardMessages} messages allowed per forward operation`,
        400,
        'MESSAGE_LIMIT_EXCEEDED'
      );
    }

    // 2. Resolve & normalize target recipient IDs
    let targetRecipientIds: string[] = [];
    if (Array.isArray(data.recipientIds)) {
      targetRecipientIds = data.recipientIds;
    } else if (typeof (data as any).recipientIds === 'string' && (data as any).recipientIds.trim()) {
      const s = (data as any).recipientIds.trim();
      targetRecipientIds = s.includes(',') ? s.split(',').map((x: string) => x.trim()).filter(Boolean) : [s];
    } else if (data.recipientId) {
      targetRecipientIds = [data.recipientId];
    }

    // Check for duplicate recipientIds in request
    if (new Set(targetRecipientIds).size !== targetRecipientIds.length) {
      throw new ChatServiceError('Duplicate recipientIds are not allowed', 400, 'DUPLICATE_RECIPIENT_IDS');
    }

    if (targetRecipientIds.length === 0) {
      throw new ChatServiceError('At least one valid recipient is required', 400, 'INVALID_RECIPIENTS');
    }

    const maxBulkRecipients = env.CHAT_MAX_BULK_RECIPIENTS || 50;
    if (targetRecipientIds.length > maxBulkRecipients) {
      throw new ChatServiceError(
        `Recipient limit exceeded. Maximum ${maxBulkRecipients} recipients allowed per operation`,
        400,
        'RECIPIENT_LIMIT_EXCEEDED'
      );
    }

    const normSenderId = String(senderId || '').trim().toLowerCase();

    // Check single self-forwarding
    if (targetRecipientIds.length === 1 && targetRecipientIds[0].trim().toLowerCase() === normSenderId) {
      throw new ChatServiceError('You cannot forward messages to yourself', 400, 'SELF_MESSAGING_PROHIBITED');
    }

    // 3. Batch fetch and validate all source messages FIRST (All-or-Nothing validation before any mutations)
    const sourceMessages = await ChatMessage.findAll({
      where: { id: { [Op.in]: targetMessageIds } },
    });
    const foundMessageMap = new Map(sourceMessages.map((m) => [m.id, m]));

    for (const msgId of targetMessageIds) {
      if (!foundMessageMap.has(msgId)) {
        throw new ChatServiceError('Source message not found or has been deleted', 404, 'MESSAGE_NOT_FOUND');
      }
    }

    // Fetch conversations for source messages to verify participant access
    const convIds = Array.from(new Set(sourceMessages.map((m) => m.conversationId)));
    const conversations = await Conversation.findAll({
      where: { id: { [Op.in]: convIds } },
    });
    const convMap = new Map(conversations.map((c) => [c.id, c]));

    // Fetch conversation user state for history cutoff verification
    const userStates = await ConversationUserState.findAll({
      where: {
        userId: senderId,
        conversationId: { [Op.in]: convIds },
      },
    });
    const userStateMap = new Map(userStates.map((s) => [s.conversationId, s]));

    for (const srcMsg of sourceMessages) {
      const conv = convMap.get(srcMsg.conversationId);
      if (!conv || conv.isDeletedForEveryone) {
        throw new ChatServiceError('Source message conversation not found or has been deleted', 404, 'CONVERSATION_NOT_FOUND');
      }

      const u1 = String(conv.user1Id || '').trim().toLowerCase();
      const u2 = String(conv.user2Id || '').trim().toLowerCase();
      if (u1 !== normSenderId && u2 !== normSenderId) {
        throw new ChatServiceError('You are not authorized to access this message', 403, 'FORBIDDEN');
      }

      const userState = userStateMap.get(srcMsg.conversationId);
      if (userState?.clearedAt && srcMsg.createdAt <= userState.clearedAt) {
        throw new ChatServiceError('Source message not found or has been deleted', 404, 'MESSAGE_NOT_FOUND');
      }

      let parsedMeta: Record<string, any> = {};
      if (srcMsg.metadata) {
        try {
          parsedMeta = JSON.parse(srcMsg.metadata);
        } catch {
          parsedMeta = {};
        }
      }

      if (
        parsedMeta.isDeleted ||
        parsedMeta.recalled ||
        parsedMeta.isDeletedForEveryone ||
        (Array.isArray(parsedMeta.deletedForUserIds) && parsedMeta.deletedForUserIds.includes(senderId))
      ) {
        throw new ChatServiceError('Cannot forward a deleted or recalled message', 400, 'MESSAGE_DELETED');
      }
    }

    // Preserve requested order of source messages
    const orderedSourceMessages = targetMessageIds.map((id) => foundMessageMap.get(id)!);

    // Fetch original senders' profiles for forwarding attribution
    const originalSenderIds = Array.from(new Set(orderedSourceMessages.map((m) => m.senderId)));
    const originalUsers = await User.findAll({
      where: { id: { [Op.in]: originalSenderIds } },
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName'],
    });
    const originalSenderNameMap = new Map(originalUsers.map((u) => [u.id, resolveChatDisplayName(u)]));

    // Fetch sender user profile
    const senderUser = await User.findByPk(senderId, {
      attributes: ['id', 'username', 'firstName', 'lastName', 'fullName', 'profilePicture'],
    });

    // 4. Batch query target users, blocks, and existing conversations (prevent N+1 queries)
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

    const eligibleRecipientIds = targetRecipientIds.filter(
      (rId) => rId.trim().toLowerCase() !== normSenderId
    );
    const convPairs = eligibleRecipientIds.map((rId) => {
      const [u1, u2] = [senderId, rId].sort();
      return { user1Id: u1, user2Id: u2 };
    });

    const destConvMap = new Map<string, Conversation>();
    if (convPairs.length > 0) {
      const existingConvs = await Conversation.findAll({
        where: { [Op.or]: convPairs },
      });
      for (const conv of existingConvs) {
        const otherId = getOtherParticipantId(conv, senderId);
        destConvMap.set(otherId, conv);
      }
    }

    // 5. Process each recipient independently with transaction safety
    const results: ForwardResultItemDTO[] = [];

    for (const recipientId of targetRecipientIds) {
      if (recipientId.trim().toLowerCase() === normSenderId) {
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: 'You cannot forward messages to yourself',
          errorCode: 'SELF_MESSAGING_PROHIBITED',
        });
        continue;
      }

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

      const baseClientMessageId =
        data.clientMessageIds?.[recipientId] ||
        (data.clientMessageId
          ? targetRecipientIds.length === 1
            ? data.clientMessageId
            : `${data.clientMessageId}:${recipientId}`
          : undefined);

      const t = await sequelize.transaction();
      try {
        let conv = destConvMap.get(recipientId);
        if (!conv) {
          const { conversation } = await this.getOrCreateOneToOneConversation(
            senderId,
            recipientId,
            { transaction: t, unhideForUser: senderId }
          );
          conv = conversation;
          destConvMap.set(recipientId, conv);
        } else if (conv.isDeletedForEveryone) {
          conv.isDeletedForEveryone = false;
          conv.deletedForEveryoneAt = null;
          conv.deletedForEveryoneBy = null;
          await conv.save({ transaction: t });
        }

        const conversationId = conv.id;
        const savedMessages: ChatMessage[] = [];
        let lastMessagePreview: string = '';

        for (let i = 0; i < orderedSourceMessages.length; i++) {
          const srcMsg = orderedSourceMessages[i];
          const perMessageClientId = baseClientMessageId
            ? orderedSourceMessages.length === 1
              ? baseClientMessageId
              : `${baseClientMessageId}-${i}`
            : undefined;

          // Idempotency check
          if (perMessageClientId) {
            const existingMessage = await ChatMessage.findOne({
              where: {
                conversationId,
                senderId,
                metadata: {
                  [Op.like]: `%"clientMessageId":"${perMessageClientId}"%`,
                },
              },
              transaction: t,
            });
            if (existingMessage) {
              savedMessages.push(existingMessage);
              continue;
            }
          }

          let srcMeta: Record<string, any> = {};
          if (srcMsg.metadata) {
            try {
              srcMeta = JSON.parse(srcMsg.metadata);
            } catch {
              srcMeta = {};
            }
          }

          // Build clean forwarding metadata copying media/attachment references
          const destMeta: Record<string, any> = {};
          const safeKeys = [
            'imageUrl',
            'thumbnailUrl',
            'mediaUrl',
            'url',
            'audioUrl',
            'voiceUrl',
            'duration',
            'durationMs',
            'caption',
            'images',
            'imageUrls',
            'name',
            'phoneNumber',
            'latitude',
            'longitude',
            'mimeType',
            'fileSize',
          ];
          for (const k of safeKeys) {
            if (srcMeta[k] !== undefined) {
              destMeta[k] = srcMeta[k];
            }
          }

          destMeta.isForwarded = true;
          destMeta.forwardedFromMessageId = srcMsg.id;
          destMeta.originalSenderId = srcMsg.senderId;
          destMeta.originalSenderName =
            originalSenderNameMap.get(srcMsg.senderId) || 'Participant';
          destMeta.originalCreatedAt = srcMsg.createdAt
            ? new Date(srcMsg.createdAt).toISOString()
            : new Date().toISOString();

          if (perMessageClientId) {
            destMeta.clientMessageId = perMessageClientId;
          }

          const createdMsg = await ChatMessage.create(
            {
              conversationId,
              senderId,
              recipientId,
              content: srcMsg.content,
              messageType: srcMsg.messageType,
              metadata: JSON.stringify(destMeta),
              isRead: false,
            },
            { transaction: t }
          );

          savedMessages.push(createdMsg);

          if (srcMsg.messageType === 'image') {
            lastMessagePreview = '📷 Photo';
          } else if (srcMsg.messageType === 'audio') {
            lastMessagePreview = '🎤 Voice message';
          } else if (srcMsg.messageType === 'location') {
            lastMessagePreview = destMeta.name ? `📍 ${destMeta.name}` : '📍 Location';
          } else if (srcMsg.messageType === 'contact') {
            lastMessagePreview = destMeta.name ? `👤 ${destMeta.name}` : '👤 Contact';
          } else {
            lastMessagePreview = srcMsg.content;
          }
        }

        const lastSaved = savedMessages[savedMessages.length - 1];
        if (lastSaved) {
          conv.lastMessage = lastMessagePreview;
          conv.lastMessageAt = lastSaved.createdAt;
          await conv.save({ transaction: t });
        }

        // Unhide conversation if previously deleted for participants
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

        // Unarchive for sender so conversation is visible in sender's active chat list
        await ConversationUserState.update(
          { isArchived: false, archivedAt: null },
          {
            where: {
              conversationId,
              userId: senderId,
              isArchived: true,
            },
            transaction: t,
          }
        );

        // Ensure per-user ConversationUserState records exist for both participants
        for (const uid of [senderId, recipientId]) {
          await ConversationUserState.findOrCreate({
            where: { conversationId, userId: uid },
            defaults: {
              conversationId,
              userId: uid,
              isDeleted: false,
              isArchived: false,
            },
            transaction: t,
          });
        }

        await t.commit();

        // Build response DTOs for successfully committed messages
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
            parsedMeta?.duration !== undefined ? Number(parsedMeta.duration) : undefined;
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
            status: savedMessage.status,
            isDelivered: !!savedMessage.isDelivered,
            deliveredAt: savedMessage.deliveredAt || null,
            isRead: savedMessage.isRead,
            readAt: savedMessage.readAt || null,
            sentAt: savedMessage.createdAt,
            createdAt: savedMessage.createdAt,
            isMine: true,
            isSender: true,
            isPinned: false,
            pinnedAt: null,
            pinnedBy: null,
            isForwarded: true,
            forwardedFromMessageId: parsedMeta?.forwardedFromMessageId || null,
            originalSenderId: parsedMeta?.originalSenderId || null,
            originalSenderName: parsedMeta?.originalSenderName || null,
            originalCreatedAt: parsedMeta?.originalCreatedAt || null,
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
            images: parsedMeta?.images,
            imageUrls: parsedMeta?.imageUrls,
          };

          recipientDtos.push(dto);
        }

        // Real-Time Delivery via Socket.IO after database persistence succeeds
        try {
          const io = getSocketServer();
          if (io) {
            const recipientRoom = getUserRoomName(recipientId);
            const senderRoom = getUserRoomName(senderId);

            for (const dto of recipientDtos) {
              const recipientPayload = {
                ...dto,
                isMine: false,
                isSender: false,
              };

              // Emit to recipient's multi-device room
              io.to(recipientRoom).emit('chat:message_received' as any, recipientPayload);
        io.to(recipientRoom).emit('chat:message:new' as any, recipientPayload);
              io.to(recipientRoom).emit('message:received' as any, recipientPayload);
              io.to(recipientRoom).emit('new_message' as any, recipientPayload);
              io.to(recipientRoom).emit('chat:message_forwarded' as any, recipientPayload);

              // Synchronize sender's other connected devices
              io.to(senderRoom).emit('chat:message_sent' as any, dto);
              io.to(senderRoom).emit('message:sent' as any, dto);
              io.to(senderRoom).emit('new_message' as any, dto);
              io.to(senderRoom).emit('chat:message_forwarded' as any, dto);

              // Broadcast to conversation room subscribers
              io.to(`conversation:${conversationId}`).emit('chat:message_received' as any, recipientPayload);
              io.to(`conversation:${conversationId}`).emit('message:received' as any, recipientPayload);
              io.to(`conversation:${conversationId}`).emit('new_message' as any, recipientPayload);
              io.to(`conversation:${conversationId}`).emit('chat:message_forwarded' as any, recipientPayload);
              io.to(`chat:${conversationId}`).emit('chat:message_received' as any, recipientPayload);
              io.to(`chat:${conversationId}`).emit('message:received' as any, recipientPayload);
              io.to(`chat:${conversationId}`).emit('new_message' as any, recipientPayload);
              io.to(`chat:${conversationId}`).emit('chat:message_forwarded' as any, recipientPayload);
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
          }
        } catch {
          // Socket server may not be bound in isolated test contexts; continue gracefully
        }

        this.dispatchChatPush(
          recipientId,
          senderId,
          senderUser,
          conversationId,
          lastMessagePreview || 'Forwarded a message'
        );

        results.push({
          recipientId,
          conversationId,
          status: 'success',
          messageId: recipientDtos[0]?.id,
          messageIds: recipientDtos.map((d) => d.id),
          isForwarded: true,
          messages: recipientDtos,
        });
      } catch (err: any) {
        await t.rollback();
        results.push({
          recipientId,
          conversationId: null,
          status: 'failed',
          error: err.message || 'Failed to forward messages',
          errorCode: 'FORWARD_ERROR',
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
   * FORWARD MESSAGE RECIPIENT SELECTION LIST
   * GET /api/v1/chats/forward/recipients
   * Fetches users eligible as forward message recipients:
   * 1. Mutual active matches with authenticated user
   * 2. Users who have sent an incoming super-like to authenticated user
   *
   * Enforces:
   * - Exclusion of current user
   * - Exclusion of bidirectional blocked users (blocked by or blocking current user)
   * - Exclusion of inactive/deleted/suspended accounts
   * - Exclusion of ordinary one-way likes and outgoing super-likes
   * - Deduplication: users qualifying for both are returned once with relationshipType: 'match'
   * - Search by participant name / username
   * - Pagination support
   * - 8-pillar Global API Response Standard (clean compact DTO, no ORM leakage)
   */
  public async getForwardRecipients(
    currentUserId: string,
    query: GetForwardRecipientsQuery
  ): Promise<ForwardRecipientsResponseDTO> {
    const normCurrentUserId = String(currentUserId || '').trim().toLowerCase();
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;

    // 1. Fetch blocked users to exclude (both directions)
    const blockedUserIds = await this.getBlockedUserIds(currentUserId);

    // 2. Fetch mutual active matches for current user
    const matches = await Match.findAll({
      where: {
        [Op.or]: [{ user1Id: currentUserId }, { user2Id: currentUserId }],
        isActive: true,
      },
      attributes: ['user1Id', 'user2Id', 'createdAt'],
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    // 3. Fetch incoming super-likes for current user (targetUserId = current user, action = 'super_like')
    const superLikes = await SwipeAction.findAll({
      where: {
        targetUserId: currentUserId,
        action: 'super_like',
      },
      attributes: ['userId', 'createdAt'],
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    // 4. Map candidate recipients and enforce deduplication + precedence:
    // If a user qualifies as both a match and incoming super-like, 'match' takes precedence.
    const candidateMap = new Map<
      string,
      { relationshipType: ForwardRecipientRelationshipType; interactionAt: Date }
    >();

    for (const m of matches) {
      const partnerId =
        String(m.user1Id || '').trim().toLowerCase() === normCurrentUserId
          ? m.user2Id
          : m.user1Id;
      if (!partnerId) continue;
      const normPartnerId = String(partnerId).trim().toLowerCase();
      if (normPartnerId === normCurrentUserId || blockedUserIds.has(partnerId)) continue;

      candidateMap.set(partnerId, {
        relationshipType: 'match',
        interactionAt: m.createdAt ? new Date(m.createdAt) : new Date(0),
      });
    }

    for (const sl of superLikes) {
      const senderId = sl.userId;
      if (!senderId) continue;
      const normSenderId = String(senderId).trim().toLowerCase();
      if (normSenderId === normCurrentUserId || blockedUserIds.has(senderId)) continue;

      if (!candidateMap.has(senderId)) {
        candidateMap.set(senderId, {
          relationshipType: 'super_like_received',
          interactionAt: sl.createdAt ? new Date(sl.createdAt) : new Date(0),
        });
      }
    }

    const candidateIds = Array.from(candidateMap.keys());
    if (candidateIds.length === 0) {
      return {
        recipients: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasMore: false,
        },
      };
    }

    // 5. Fetch active users matching candidate IDs (excluding inactive/deleted/suspended accounts)
    const userWhere: any = {
      id: { [Op.in]: candidateIds },
      isActive: true,
    };

    if (query?.search && query.search.trim().length > 0) {
      const dialect = sequelize.getDialect();
      const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;
      const searchTerm = `%${query.search.trim()}%`;
      userWhere[Op.or] = [
        { fullName: { [likeOp]: searchTerm } },
        { firstName: { [likeOp]: searchTerm } },
        { lastName: { [likeOp]: searchTerm } },
        { nickName: { [likeOp]: searchTerm } },
        { username: { [likeOp]: searchTerm } },
      ];
    }

    let matchingUsers = await User.findAll({
      where: userWhere,
      attributes: [
        'id',
        'fullName',
        'firstName',
        'lastName',
        'nickName',
        'username',
        'profilePicture',
        'isActive',
      ],
      include: [
        {
          model: UserPhoto,
          as: 'photos',
          where: { status: 'approved' },
          required: false,
          attributes: ['id', 'imageUrl', 'isPrimary', 'status'],
        },
      ],
    });

    // Additional in-memory display name search filter to support composite full names (e.g. "Jessica Parker")
    if (query?.search && query.search.trim().length > 0) {
      const s = query.search.trim().toLowerCase();
      matchingUsers = matchingUsers.filter((u) => {
        const dispName = resolveChatDisplayName(u).toLowerCase();
        const username = (u.username || '').toLowerCase();
        const fullName = (u.fullName || '').toLowerCase();
        const firstName = (u.firstName || '').toLowerCase();
        const lastName = (u.lastName || '').toLowerCase();
        const nickName = (u.nickName || '').toLowerCase();
        return (
          dispName.includes(s) ||
          username.includes(s) ||
          fullName.includes(s) ||
          firstName.includes(s) ||
          lastName.includes(s) ||
          nickName.includes(s)
        );
      });
    }

    // 6. Sort candidate users by interaction recency (newest interaction first), secondary by name
    matchingUsers.sort((a, b) => {
      const timeA = candidateMap.get(a.id)?.interactionAt.getTime() || 0;
      const timeB = candidateMap.get(b.id)?.interactionAt.getTime() || 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return resolveChatDisplayName(a).localeCompare(resolveChatDisplayName(b));
    });

    // 7. Paginate results
    const total = matchingUsers.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const offset = (page - 1) * limit;
    const pagedUsers = matchingUsers.slice(offset, offset + limit);
    const hasMore = page * limit < total;

    // 8. Build compact response DTO (8-pillar standard)
    const recipients: ForwardRecipientDTO[] = pagedUsers.map((user) => {
      const candidate = candidateMap.get(user.id);
      const photo = this.resolvePrimaryPhoto(user.profilePicture, (user as any).photos);
      return {
        userId: user.id,
        name: resolveChatDisplayName(user),
        profileImage: photo,
        relationshipType: candidate?.relationshipType || 'match',
      };
    });

    return {
      recipients,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
    };
  }
}

export const chatService = new ChatService();
