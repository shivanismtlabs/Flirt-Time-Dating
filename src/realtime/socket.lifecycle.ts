/**
 * FlirtTime Real-Time Socket Lifecycle and Resource Management
 * Handles connection registration, per-user/IP concurrency bounds, room joining, and clean teardown.
 */

import { AppSocket, AppSocketServer } from './socket.types';
import {
  SOCKET_DEFAULTS,
  SOCKET_ERROR_CODES,
  SOCKET_LIFECYCLE_EVENTS,
} from './socket.constants';
import { socketLogger } from './socket.errors';
import { ValidatedSocketEnv, getValidatedSocketConfig } from '../config/env.validation';

/**
 * Tracks active socket IDs for each authenticated user.
 * Map<userId, Set<socketId>>
 */
const userSocketsMap = new Map<string, Set<string>>();

/**
 * Conversations a user currently has open (chat:conversation:viewing).
 * Map<userId, Set<conversationId>>
 */
const viewingConversations = new Map<string, Set<string>>();

/**
 * Tracks connection count per client IP.
 * Map<clientIp, count>
 */
const ipSocketsMap = new Map<string, number>();

/**
 * Active resolved configuration for connection bounds.
 */
let activeLifecycleConfig: ValidatedSocketEnv | null = null;

export const setLifecycleConfig = (config: ValidatedSocketEnv): void => {
  activeLifecycleConfig = config;
};

export const getActiveLifecycleConfig = (): ValidatedSocketEnv => {
  return activeLifecycleConfig || getValidatedSocketConfig();
};

/**
 * Helper to get the canonical room name for a specific user ID.
 */
export const getUserRoomName = (userId: string): string => {
  return `${SOCKET_DEFAULTS.USER_ROOM_PREFIX}${userId}`;
};

/**
 * Live socket ids for a user. Matching ignores id casing so a call event
 * still reaches the phone when the token and the call row differ by case.
 */
export const getUserSocketIds = (userId: string): string[] => {
  const target = String(userId || '').trim().toLowerCase();
  if (!target) return [];
  const ids = new Set<string>();
  for (const [key, sockets] of userSocketsMap) {
    if (String(key).trim().toLowerCase() !== target) continue;
    for (const id of sockets) ids.add(id);
  }
  return [...ids];
};

/**
 * Returns the number of currently active sockets for a given user.
 */
export const getUserActiveSocketCount = (userId: string): number => {
  return getUserSocketIds(userId).length;
};

/**
 * Checks if a user has at least one active socket connection.
 */
export const isUserConnected = (userId: string): boolean => {
  const target = String(userId || '').trim().toLowerCase();
  if (!target) return false;
  for (const [key, sockets] of userSocketsMap) {
    if (String(key).trim().toLowerCase() === target && sockets.size > 0) return true;
  }
  return false;
};

/** Mark whether this user currently has a conversation open on screen. */
export const setConversationViewing = (
  userId: string,
  conversationId: string,
  active: boolean
): void => {
  if (!userId || !conversationId) return;
  let open = viewingConversations.get(userId);
  if (!open) {
    open = new Set<string>();
    viewingConversations.set(userId, open);
  }
  if (active) {
    open.add(conversationId);
  } else {
    open.delete(conversationId);
    if (open.size === 0) viewingConversations.delete(userId);
  }
};

export const isUserViewingConversation = (
  userId: string,
  conversationId: string
): boolean => {
  const target = String(userId || '').trim().toLowerCase();
  const conv = String(conversationId || '').trim().toLowerCase();
  if (!target || !conv) return false;
  for (const [key, open] of viewingConversations) {
    if (String(key).trim().toLowerCase() !== target) continue;
    for (const id of open) {
      if (String(id).trim().toLowerCase() === conv) return true;
    }
  }
  return false;
};

export const clearUserViewing = (userId: string): void => {
  viewingConversations.delete(userId);
};

/**
 * Returns total number of active authenticated sockets tracked by lifecycle.
 */
export const getTotalActiveConnections = (): number => {
  let total = 0;
  for (const sockets of userSocketsMap.values()) {
    total += sockets.size;
  }
  return total;
};

/**
 * Clears all in-memory lifecycle maps (used during graceful shutdown and tests).
 */
export const clearLifecycleTracking = (): void => {
  userSocketsMap.clear();
  ipSocketsMap.clear();
  viewingConversations.clear();
  activeLifecycleConfig = null;
};

/**
 * Connection event handler attached to Socket.IO server.
 * Manages resource bounds, joins user rooms, and sets up disconnection cleanup.
 */
export const handleSocketConnection = (
  socket: AppSocket,
  io: AppSocketServer
): void => {
  const { user, clientIp } = socket.data;
  const config = getActiveLifecycleConfig();

  // 1. Enforce Per-User connection limit
  let userSockets = userSocketsMap.get(user.userId);
  if (!userSockets) {
    userSockets = new Set<string>();
    userSocketsMap.set(user.userId, userSockets);
  }

  if (userSockets.size >= config.maxConnectionsPerUser) {
    socketLogger.warn('Connection rejected: User connection limit exceeded', {
      userId: user.userId,
      socketId: socket.id,
      currentConnections: userSockets.size,
      maxAllowed: config.maxConnectionsPerUser,
    });

    socket.emit('system:error', {
      code: SOCKET_ERROR_CODES.CONNECTION_LIMIT_EXCEEDED,
      message: `Maximum concurrent connections per account (${config.maxConnectionsPerUser}) exceeded.`,
    });

    setTimeout(() => {
      socket.disconnect(true);
    }, 50);
    return;
  }

  // 2. Enforce Per-IP connection limit
  const currentIpCount = ipSocketsMap.get(clientIp) || 0;
  if (currentIpCount >= config.maxConnectionsPerIp) {
    socketLogger.warn('Connection rejected: IP connection limit exceeded', {
      clientIp,
      socketId: socket.id,
      currentConnections: currentIpCount,
      maxAllowed: config.maxConnectionsPerIp,
    });

    socket.emit('system:error', {
      code: SOCKET_ERROR_CODES.IP_LIMIT_EXCEEDED,
      message: 'Maximum connections from your network address exceeded.',
    });

    socket.disconnect(true);
    return;
  }

  // 3. Register socket into tracking registries
  userSockets.add(socket.id);
  ipSocketsMap.set(clientIp, currentIpCount + 1);

  // 4. Automatically join user's private multi-device room (e.g. 'user:<uuid>')
  const userRoom = getUserRoomName(user.userId);
  const lowercaseRoom =
    user.userId && user.userId.toLowerCase() !== user.userId
      ? getUserRoomName(user.userId.toLowerCase())
      : null;

  socketLogger.info('Socket connection established and authenticated', {
    socketId: socket.id,
    userId: user.userId,
    userRoom,
    role: user.role,
    userSocketCount: userSockets.size,
    transport: socket.conn.transport.name,
  });

  void (async () => {
    await socket.join(userRoom);
    if (lowercaseRoom) {
      await socket.join(lowercaseRoom);
    }
    const { notificationService } = await import('../services/notification.service');
    await notificationService.publishUnreadCount(user.userId);
  })().catch(() => undefined);

  // 5. Track transport upgrades (e.g., polling -> websocket) without logging sensitive data
  socket.conn.on('upgrade', (transport: any) => {
    socketLogger.info('Socket transport upgraded', {
      socketId: socket.id,
      userId: user.userId,
      newTransport: transport?.name,
    });
  });

  // 6. Handle Disconnection and Clean Teardown
  socket.on(SOCKET_LIFECYCLE_EVENTS.DISCONNECT, (reason: string) => {
    // Remove from user sockets map
    const sockets = userSocketsMap.get(user.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSocketsMap.delete(user.userId);
        viewingConversations.delete(user.userId);
      }
    }

    // Decrement IP count
    const ipCount = ipSocketsMap.get(clientIp);
    if (ipCount !== undefined) {
      if (ipCount <= 1) {
        ipSocketsMap.delete(clientIp);
      } else {
        ipSocketsMap.set(clientIp, ipCount - 1);
      }
    }

    // Clean up event listeners on this socket to prevent memory leaks
    socket.removeAllListeners();

    socketLogger.info('Socket disconnected and cleaned up', {
      socketId: socket.id,
      userId: user.userId,
      reason,
      remainingUserSockets: userSocketsMap.get(user.userId)?.size ?? 0,
    });
  });

  // 7. Handle generic socket errors
  socket.on(SOCKET_LIFECYCLE_EVENTS.ERROR, (err: any) => {
    socketLogger.error('Unhandled socket error event', err, {
      socketId: socket.id,
      userId: user.userId,
    });
  });
};
