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
   * Conversation Archive & Deletion Events
   */
  'conversation:archived': (data: { conversationId: string; isArchived: boolean }) => void;

  'conversation:deleted': (data: { conversationId: string; deleteType: 'me' | 'everyone' }) => void;

  /**
   * Emitted to authorized conversation participants when a message is pinned.
   */
  'chat:message_pinned': (data: {
    conversationId: string;
    messageId: string;
    isPinned: boolean;
    pinnedBy: string;
    pinnedAt: string;
  }) => void;

  /**
   * Emitted to authorized conversation participants when a message is unpinned.
   */
  'chat:message_unpinned': (data: {
    conversationId: string;
    messageId: string;
    isPinned: boolean;
  }) => void;

  /**
   * Emitted to authorized conversation participants when a message is edited.
   */
  'chat:message_edited': (data: any) => void;
  'message:edited': (data: any) => void;

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
}

/**
 * Client-to-Server events accepted by real-time engine.
 */
export interface ClientToServerEvents {
  'chat:send_message': (
    data: {
      conversationId?: string;
      recipientId?: string;
      recipientIds?: string[];
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
      recipientId?: string;
      recipientIds?: string[];
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
      isPinned: boolean;
      scope?: 'user' | 'conversation';
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:typing': (data: { conversationId: string; isTyping: boolean }) => void;

  'conversation:archive': (
    data: { conversationId: string; isArchived: boolean },
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
