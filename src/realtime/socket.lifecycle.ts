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
 * Chats somebody currently has open. Kept even after one person drops,
 * so the friend still on that screen can be told they went offline.
 * Map<lowercase conversationId, peers + watcher user ids>
 */
const presenceChats = new Map<
  string,
  { conversationId: string; user1Id: string; user2Id: string; watchers: Set<string> }
>();

const sameUserId = (left?: string | null, right?: string | null): boolean =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

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
  const sockets = userSocketsMap.get(target);
  if (sockets && sockets.size > 0) return [...sockets];
  // Fallback scan for existing mixed-casing entries
  const ids = new Set<string>();
  for (const [key, s] of userSocketsMap) {
    if (String(key).trim().toLowerCase() === target) {
      for (const id of s) ids.add(id);
    }
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
  const sockets = userSocketsMap.get(target);
  if (sockets && sockets.size > 0) return true;
  for (const [key, s] of userSocketsMap) {
    if (String(key).trim().toLowerCase() === target && s.size > 0) return true;
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
  const normUser = String(userId).trim().toLowerCase();
  const normConv = String(conversationId).trim().toLowerCase();
  let open = viewingConversations.get(normUser);
  if (!open) {
    open = new Set<string>();
    viewingConversations.set(normUser, open);
  }
  if (active) {
    open.add(normConv);
  } else {
    open.delete(normConv);
    if (open.size === 0) viewingConversations.delete(normUser);
  }
};

export const isUserViewingConversation = (
  userId: string,
  conversationId: string
): boolean => {
  const target = String(userId || '').trim().toLowerCase();
  const conv = String(conversationId || '').trim().toLowerCase();
  if (!target || !conv) return false;
  const open = viewingConversations.get(target);
  if (open && open.has(conv)) return true;
  for (const [key, s] of viewingConversations) {
    if (String(key).trim().toLowerCase() === target) {
      for (const id of s) {
        if (String(id).trim().toLowerCase() === conv) return true;
      }
    }
  }
  return false;
};

export const clearUserViewing = (userId: string): void => {
  const target = String(userId || '').trim().toLowerCase();
  if (!target) return;
  for (const key of [...viewingConversations.keys()]) {
    if (sameUserId(key, target)) viewingConversations.delete(key);
  }
};

/**
 * Remember that this user has a chat thread open, and who the two people are.
 * Read receipts stay on `setConversationViewing`. This map is only for presence.
 */
export const setPresenceWatch = (
  userId: string,
  conversationId: string,
  active: boolean,
  peers?: { user1Id: string; user2Id: string }
): void => {
  const convKey = String(conversationId || '').trim().toLowerCase();
  if (!userId || !convKey) return;

  let entry = presenceChats.get(convKey);
  if (!active) {
    if (!entry) return;
    for (const watcher of [...entry.watchers]) {
      if (sameUserId(watcher, userId)) entry.watchers.delete(watcher);
    }
    if (entry.watchers.size === 0) presenceChats.delete(convKey);
    return;
  }

  if (!entry) {
    entry = {
      conversationId,
      user1Id: peers?.user1Id || '',
      user2Id: peers?.user2Id || '',
      watchers: new Set<string>(),
    };
    presenceChats.set(convKey, entry);
  }

  entry.conversationId = conversationId;
  if (peers?.user1Id && peers?.user2Id) {
    entry.user1Id = peers.user1Id;
    entry.user2Id = peers.user2Id;
  }
  for (const watcher of [...entry.watchers]) {
    if (sameUserId(watcher, userId)) entry.watchers.delete(watcher);
  }
  entry.watchers.add(userId);
};

export const clearUserPresenceWatch = (userId: string): void => {
  for (const [key, entry] of [...presenceChats.entries()]) {
    for (const watcher of [...entry.watchers]) {
      if (sameUserId(watcher, userId)) entry.watchers.delete(watcher);
    }
    if (entry.watchers.size === 0) presenceChats.delete(key);
  }
};

/**
 * People who already have this user's thread open hear online/offline
 * before any database work. The chat-list refresh still follows.
 */
const publishOpenChatPresence = (userId: string, isOnline: boolean): void => {
  const open = getOpenChatsInvolving(userId);
  if (open.length === 0) return;
  const lastSeenAt = isOnline ? null : new Date().toISOString();
  void import('./socket.server')
    .then(({ getSocketServer }) => {
      let io: AppSocketServer;
      try {
        io = getSocketServer();
      } catch {
        return;
      }
      for (const chat of open) {
        const payload = {
          conversationId: chat.conversationId,
          userId,
          isOnline,
          lastSeenAt,
        };
        const rooms = new Set<string>([getUserRoomName(chat.otherUserId)]);
        const lower = String(chat.otherUserId).toLowerCase();
        if (lower !== chat.otherUserId) rooms.add(getUserRoomName(lower));
        for (const room of rooms) {
          io.to(room).emit('chat:presence' as any, payload);
          io.to(room).emit('chat:user:status' as any, payload);
        }
      }
    })
    .catch(() => undefined);
};

export const getOpenChatsInvolving = (
  userId: string
): Array<{ conversationId: string; otherUserId: string }> => {
  const open: Array<{ conversationId: string; otherUserId: string }> = [];
  for (const entry of presenceChats.values()) {
    if (!entry.user1Id || !entry.user2Id || entry.watchers.size === 0) continue;
    if (sameUserId(entry.user1Id, userId)) {
      open.push({ conversationId: entry.conversationId, otherUserId: entry.user2Id });
    } else if (sameUserId(entry.user2Id, userId)) {
      open.push({ conversationId: entry.conversationId, otherUserId: entry.user1Id });
    }
  }
  return open;
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
  presenceChats.clear();
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

  const normUserId = String(user.userId || '').trim().toLowerCase();

  // 1. Enforce Per-User connection limit
  let userSockets = userSocketsMap.get(normUserId);
  if (!userSockets) {
    userSockets = new Set<string>();
    userSocketsMap.set(normUserId, userSockets);
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
  const cameOnline = userSockets.size === 1;

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

  if (cameOnline) {
    publishOpenChatPresence(user.userId, true);
    void import('../services/chat.service')
      .then(({ chatService }) => {
        void chatService.notifyChatPresence(user.userId, true);
        void chatService.syncDeliveredMessages(user.userId).catch(() => undefined);
      })
      .catch(() => undefined);
  }

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
    const sockets = userSocketsMap.get(normUserId) || userSocketsMap.get(user.userId);
    let wentOffline = false;
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSocketsMap.delete(normUserId);
        userSocketsMap.delete(user.userId);
        clearUserViewing(user.userId);
        clearUserPresenceWatch(user.userId);
        wentOffline = true;
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
      remainingUserSockets: (userSocketsMap.get(normUserId) || userSocketsMap.get(user.userId))?.size ?? 0,
    });

    if (wentOffline) {
      publishOpenChatPresence(user.userId, false);
      void import('../services/chat.service')
        .then(({ chatService }) => chatService.notifyChatPresence(user.userId, false))
        .catch(() => undefined);
    }
  });

  // 7. Handle generic socket errors
  socket.on(SOCKET_LIFECYCLE_EVENTS.ERROR, (err: any) => {
    socketLogger.error('Unhandled socket error event', err, {
      socketId: socket.id,
      userId: user.userId,
    });
  });
};
