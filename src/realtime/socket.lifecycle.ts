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
 * Returns the number of currently active sockets for a given user.
 */
export const getUserActiveSocketCount = (userId: string): number => {
  return userSocketsMap.get(userId)?.size ?? 0;
};

/**
 * Checks if a user has at least one active socket connection.
 */
export const isUserConnected = (userId: string): boolean => {
  return (userSocketsMap.get(userId)?.size ?? 0) > 0;
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
  socket.join(userRoom);
  if (user.userId && user.userId.toLowerCase() !== user.userId) {
    socket.join(getUserRoomName(user.userId.toLowerCase()));
  }

  socketLogger.info('Socket connection established and authenticated', {
    socketId: socket.id,
    userId: user.userId,
    userRoom,
    role: user.role,
    userSocketCount: userSockets.size,
    transport: socket.conn.transport.name,
  });

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
