
/**
 * FlirtTime Real-Time Socket Infrastructure Types
 * Strict TypeScript definitions for socket contexts, server instances, and events.
 */

import { Socket, Server } from 'socket.io';
import { SocketErrorCode } from './socket.constants';

/**
 * Minimal authenticated user identity attached to the socket context.
 * Only non-sensitive, verified claims are stored.
 */
export interface AuthenticatedUserContext {
  /** Canonical User UUID */
  userId: string;
  /** User Role (e.g., 'user', 'admin') */
  role: string;
  /** User email (if present) */
  email?: string | null;
  /** User phone (if present) */
  phone?: string | null;
  /** Timestamp (epoch ms) when authentication succeeded */
  authenticatedAt: number;
  /** Token expiry timestamp (epoch s) from JWT payload */
  tokenExp?: number;
}

/**
 * Custom metadata attached to every authenticated socket instance via `socket.data`.
 */
export interface AppSocketData {
  /** Verified user identity */
  user: AuthenticatedUserContext;
  /** Remote client IP address */
  clientIp: string;
  /** Timestamp (epoch ms) when connection was accepted */
  connectedAt: number;
}

/**
 * Server-to-Client events emitted at infrastructure/setup level.
 * Chat-specific events will be declared in future feature milestones.
 */
export interface ServerToClientEvents {
  /**
   * Sanitized system error notification emitted to client on runtime/protocol violations.
   */
  'system:error': (data: { code: SocketErrorCode; message: string }) => void;

  /**
   * Emitted to recipient room when new message arrives.
   */
  'chat:message_received': (data: any) => void;

  /**
   * Emitted to sender room for multi-device synchronization.
   */
  'chat:message_sent': (data: any) => void;

  /**
   * Emitted to participant notifying that messages were read.
   */
  'chat:read_receipt': (data: {
    conversationId: string;
    readerId: string;
    lastReadMessageId?: string | null;
    markedCount: number;
    readAt: string;
  }) => void;

  'message:read_receipt': (data: {
    conversationId: string;
    readerId: string;
    lastReadMessageId?: string | null;
    markedCount: number;
    readAt: string;
  }) => void;

  /**
   * Emitted to sender notifying that messages were acknowledged as delivered.
   */
  'chat:delivery_receipt': (data: {
    conversationId: string;
    recipientId: string;
    messageIds: string[];
    deliveredAt: string;
  }) => void;

  'message:delivery_receipt': (data: {
    conversationId: string;
    recipientId: string;
    messageIds: string[];
    deliveredAt: string;
  }) => void;

  /**
   * Emitted to user active sessions to synchronize updated unread badge counts.
   */
  'conversation:unread_updated': (data: {
    conversationId: string;
    unreadCount: number;
  }) => void;

  /**
   * Real-time Conversation List Update Events
   * Emitted to both sender and recipient user rooms whenever a message is sent,
   * edited, deleted, or unread status changes so the conversation list updates in real-time.
   */
  'conversation:updated': (data: any) => void;
  'chat:conversation_updated': (data: any) => void;
  'conversation_updated': (data: any) => void;
  'conversation:update': (data: any) => void;
  'conversations:update': (data: any) => void;

  /**
   * Emitted to participant notifying typing status change.
   */
  'chat:typing': (data: { conversationId: string; userId: string; isTyping: boolean }) => void;

  /**
   * Video Calling Real-Time Events
   */
  'video_call:incoming': (data: {
    callId: string;
    channelName: string;
    caller: { id: string; name: string; avatarUrl: string | null };
    status: string;
    expiresAt: string;
  }) => void;

  'video_call:accepted': (data: { callId: string; status: string }) => void;

  'video_call:rejected': (data: { callId: string; status: string }) => void;

  'video_call:ended': (data: { callId: string; status: string; endedBy?: string }) => void;

  'video_call:busy': (data: { callId?: string; calleeId?: string; message: string }) => void;

  'video_call:missed': (data: { callId: string; status: string }) => void;

  /**
   * Conversation Archive, Deletion & Pin Events
   */
  'conversation:archived': (data: { conversationId: string; isArchived: boolean }) => void;

  'conversation:deleted': (data: { conversationId: string; deleteType: 'me' | 'everyone' }) => void;

  /**
   * Emitted to requesting user's active sessions when conversation pin status is updated.
   */
  'conversation:pin-updated': (data: {
    conversationId: string;
    isPinned: boolean;
    pinned?: boolean;
    pinnedAt?: string | null;
  }) => void;
  'conversation:pin_updated': (data: {
    conversationId: string;
    isPinned: boolean;
    pinned?: boolean;
    pinnedAt?: string | null;
  }) => void;

  /**
   * Emitted to authorized conversation participants when a message is pinned.
   */
  'chat:message_pinned': (data: {
    conversationId: string;
    messageId: string;
    isPinned: boolean;
    pinned?: boolean;
    pinnedBy: string;
    pinnedAt: string;
    message?: any;
  }) => void;

  /**
   * Mobile contract. Emitted to the open conversation and both participants
   * when a message is pinned or unpinned. `pinned` is the canonical flag.
   */
  'chat:message:pin:updated': (data: {
    conversationId: string;
    messageId: string;
    pinned: boolean;
    isPinned: boolean;
    pinnedBy: string | null;
    pinnedAt: string | null;
    message: any;
  }) => void;
  'chat:message:pin:ack': (data: { success: boolean; requestId?: string | null; data?: any; error?: string }) => void;
  'message:pinned': (data: any) => void;
  'message:unpinned': (data: any) => void;

  /**
   * Emitted to authorized conversation participants when a message is unpinned.
   */
  'chat:message_unpinned': (data: {
    conversationId: string;
    messageId: string;
    isPinned: boolean;
    pinned?: boolean;
    message?: any;
  }) => void;

  /**
   * Emitted to authorized conversation participants when a message is edited.
   */
  'chat:message_edited': (data: any) => void;
  'message:edited': (data: any) => void;

  /**
   * Emitted to authorized conversation participants when a message is forwarded.
   */
  'chat:message_forwarded': (data: any) => void;
  'message:forwarded': (data: any) => void;

  /**
   * Emitted to authorized conversation participant(s) when an individual message is deleted.
   */
  'chat:message_deleted': (data: {
    conversationId: string;
    messageId: string;
    deleteType: 'me' | 'everyone';
  }) => void;
  'message:deleted': (data: {
    conversationId: string;
    messageId: string;
    deleteType: 'me' | 'everyone';
  }) => void;

  /**
   * Emitted to authorized conversation participants when a reaction is added, updated, or removed on a message.
   */
  'message:reaction:updated': (data: {
    action: 'added' | 'updated' | 'removed';
    messageId: string;
    conversationId: string;
    emoji: string | null;
    reaction: {
      id: string;
      messageId: string;
      conversationId: string;
      userId: string;
      emoji: string;
      createdAt: string;
    } | null;
    user: {
      id: string;
      fullName: string;
      nickName: string | null;
      profilePicture: string | null;
    };
    reactionCounts: Record<string, number>;
  }) => void;
  'chat:message_reaction': (data: any) => void;
  'message:reaction': (data: any) => void;
  'chat:reaction': (data: any) => void;
  'chat:message_reaction_updated': (data: any) => void;
  'chat:reaction:updated': (data: any) => void;
  'reaction:updated': (data: any) => void;

  /**
   * Moment feed / detail live updates.
   * `moment:updated` fires for every activity. Specific events carry the same payload.
   * `isLiked` is intentionally omitted: that flag belongs to each viewer, not the actor.
   */
  'moment:updated': (data: MomentLiveUpdate) => void;
  'moment:like_updated': (data: MomentLiveUpdate) => void;
  'moment:comment_created': (data: MomentLiveUpdate) => void;
  'moment:comment_deleted': (data: MomentLiveUpdate) => void;
  'moment:comment_like_updated': (data: MomentLiveUpdate) => void;
  'moment:gift_sent': (data: MomentLiveUpdate) => void;
  'moment:deleted': (data: MomentLiveUpdate) => void;
}

/**
 * Payload pushed when a moment is liked, commented, gifted, or removed.
 * Counts are moment-level. Comment-row likes use `commentLikesCount`.
 */
export interface MomentLiveUpdate {
  type:
    | 'like'
    | 'unlike'
    | 'reaction'
    | 'comment'
    | 'reply'
    | 'comment_deleted'
    | 'comment_like'
    | 'gift'
    | 'deleted';
  momentId: string;
  ownerId: string;
  actor: {
    id: string;
    name: string;
    username: string | null;
    profilePhoto: string | null;
  };
  likesCount: number;
  commentsCount: number;
  giftsCount: number;
  reaction: string | null;
  reactionCounts: Record<string, number> | null;
  comment: Record<string, unknown> | null;
  gift: Record<string, unknown> | null;
  commentId: string | null;
  replyId: string | null;
  parentCommentId: string | null;
  commentLikesCount: number | null;
  updatedAt: string;
}

/**
 * Client-to-Server events accepted by real-time engine.
 */
export interface ClientToServerEvents {
  'chat:send_message': (
    data: {
      conversationId?: string;
      recipientIds?: string[] | string;
      content?: string;
      type?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      messageType?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      clientMessageId?: string;
      clientMessageIds?: Record<string, string>;
      replyToMessageId?: string;
      parentMessageId?: string;
      replyToId?: string;
      metadata?: any;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:send': (
    data: {
      conversationId?: string;
      recipientIds?: string[] | string;
      content?: string;
      type?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      messageType?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      clientMessageId?: string;
      clientMessageIds?: Record<string, string>;
      replyToMessageId?: string;
      parentMessageId?: string;
      replyToId?: string;
      metadata?: any;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:forward_message': (
    data: {
      messageIds?: string[];
      messageId?: string;
      recipientIds?: string[];
      recipientId?: string;
      clientMessageId?: string;
      clientMessageIds?: Record<string, string>;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:forward': (
    data: {
      messageIds?: string[];
      messageId?: string;
      recipientIds?: string[];
      recipientId?: string;
      clientMessageId?: string;
      clientMessageIds?: Record<string, string>;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:mark_read': (
    data: { conversationId: string; lastReadMessageId?: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:read': (
    data: { conversationId: string; lastReadMessageId?: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:message_delivered': (
    data: { conversationId: string; messageIds: string[] },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:delivered': (
    data: { conversationId: string; messageIds: string[] },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:delivered_sync': (
    data: { conversationId?: string; messageIds?: string[]; deliveredMessageIds?: string[]; messageId?: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:delivered_sync': (
    data: { conversationId?: string; messageIds?: string[]; deliveredMessageIds?: string[]; messageId?: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:pin_message': (
    data: {
      conversationId: string;
      messageId: string;
      isPinned?: boolean;
      pinned?: boolean;
      scope?: 'user' | 'conversation';
      requestId?: string;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:message:pin': (
    data: {
      conversationId?: string;
      conversation_id?: string;
      messageId?: string;
      message_id?: string;
      isPinned?: boolean;
      pinned?: boolean;
      scope?: 'user' | 'conversation';
      requestId?: string;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:typing': (data: { conversationId: string; isTyping: boolean }) => void;

  'conversation:archive': (
    data: { conversationId: string; isArchived: boolean },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'conversation:pin': (
    data: { conversationId: string; isPinned: boolean },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'conversation:delete': (
    data: { conversationId: string; deleteType: 'me' | 'everyone' },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:edit_message': (
    data: { conversationId: string; messageId: string; content: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:edit': (
    data: { conversationId: string; messageId: string; content: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:reply_message': (
    data: {
      conversationId: string;
      replyToMessageId?: string;
      parentMessageId?: string;
      content: string;
      messageType?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      clientMessageId?: string;
      metadata?: any;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:reply': (
    data: {
      conversationId: string;
      replyToMessageId?: string;
      parentMessageId?: string;
      content: string;
      messageType?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      clientMessageId?: string;
      metadata?: any;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:delete_message': (
    data: {
      conversationId: string;
      messageId: string;
      deleteType: 'me' | 'everyone';
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'message:delete': (
    data: {
      conversationId: string;
      messageId: string;
      deleteType: 'me' | 'everyone';
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  /**
   * Message Reaction via WebSocket
   */
  'message:reaction': (
    data: {
      conversationId?: string;
      conversation_id?: string;
      messageId?: string;
      message_id?: string;
      emoji?: string;
      reaction?: string;
      reactionEmoji?: string;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:message_reaction': (
    data: {
      conversationId?: string;
      conversation_id?: string;
      messageId?: string;
      message_id?: string;
      emoji?: string;
      reaction?: string;
      reactionEmoji?: string;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:reaction': (
    data: {
      conversationId?: string;
      conversation_id?: string;
      messageId?: string;
      message_id?: string;
      emoji?: string;
      reaction?: string;
      reactionEmoji?: string;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  /**
   * Conversation List Retrieval over WebSocket
   */
  'conversation:get_list': (
    data?: any,
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:get_conversations': (
    data?: any,
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'conversations:get': (
    data?: any,
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:list': (
    data?: any,
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  /**
   * Subscribe the current socket to live updates for one open moment.
   */
  'moment:join': (
    data: { momentId?: string },
    callback?: (response: { success: boolean; error?: string; momentId?: string }) => void
  ) => void;

  'moment:leave': (
    data: { momentId?: string },
    callback?: (response: { success: boolean; error?: string; momentId?: string }) => void
  ) => void;

  /**
   * Subscribe to the moments currently visible on the feed (max 30).
   */
  'moment:watch': (
    data: { momentIds?: string[] },
    callback?: (response: {
      success: boolean;
      error?: string;
      joined?: string[];
      rejected?: string[];
    }) => void
  ) => void;

  'moment:unwatch': (
    data?: { momentIds?: string[] },
    callback?: (response: { success: boolean; left?: string[] }) => void
  ) => void;
}

/**
 * Inter-server events for future multi-instance adapters (e.g. Redis Adapter).
 */
export interface InterServerEvents {
  ping: () => void;
}

/**
 * Fully typed Socket.IO Socket instance for FlirtTime backend.
 */
export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>;

/**
 * Fully typed Socket.IO Server instance for FlirtTime backend.
 */
export type AppSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>;

/**
 * Options accepted when creating the Socket.IO server.
 */
export interface SocketServerConfigOptions {
  path?: string;
  corsOrigin?: string | string[] | boolean;
  pingTimeout?: number;
  pingInterval?: number;
  connectTimeout?: number;
  maxHttpBufferSize?: number;
  maxConnectionsPerUser?: number;
  maxConnectionsPerIp?: number;
  perMessageDeflate?: boolean;
}
