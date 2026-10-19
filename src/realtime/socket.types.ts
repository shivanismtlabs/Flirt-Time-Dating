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
  'chat:read_receipt': (data: { conversationId: string; readerId: string; readAt: string }) => void;

  /**
   * Emitted to participant notifying typing status change.
   */
  'chat:typing': (data: { conversationId: string; userId: string; isTyping: boolean }) => void;
}

/**
 * Client-to-Server events accepted by real-time engine.
 */
export interface ClientToServerEvents {
  'chat:send_message': (
    data: {
      conversationId: string;
      content?: string;
      messageType?: 'text' | 'audio' | 'image' | 'location' | 'contact' | 'moment_reply' | 'moment_gift';
      clientMessageId?: string;
      metadata?: any;
    },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:mark_read': (
    data: { conversationId: string },
    callback?: (response: { success: boolean; data?: any; error?: string }) => void
  ) => void;

  'chat:typing': (data: { conversationId: string; isTyping: boolean }) => void;
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
