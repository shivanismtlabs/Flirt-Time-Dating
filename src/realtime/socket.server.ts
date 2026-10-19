/**
 * FlirtTime Real-Time Socket.IO Server Initialization
 * Centralized, singleton Socket.IO server attachment, lifecycle binding, and graceful shutdown.
 */

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import {
  AppSocketServer,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData,
  SocketServerConfigOptions,
} from './socket.types';
import { buildSocketServerOptions, getResolvedSocketConfig } from './socket.config';
import { socketAuthMiddleware } from './socket.auth';
import {
  handleSocketConnection,
  clearLifecycleTracking,
  setLifecycleConfig,
} from './socket.lifecycle';
import { socketLogger } from './socket.errors';
import { SOCKET_ERROR_CODES } from './socket.constants';
import { registerChatSocketHandlers } from './socket.chat';

/**
 * Singleton Socket.IO server reference.
 */
let ioInstance: AppSocketServer | null = null;

/**
 * Initializes and attaches Socket.IO to the provided HTTP server.
 * Ensures singleton initialization: will not attach multiple times or create duplicate listeners.
 */
export const initSocketServer = (
  httpServer: HttpServer,
  customOptions?: SocketServerConfigOptions
): AppSocketServer => {
  if (ioInstance) {
    socketLogger.warn('initSocketServer called when instance already exists. Returning active instance.');
    return ioInstance;
  }

  const resolvedConfig = getResolvedSocketConfig(customOptions);
  setLifecycleConfig(resolvedConfig);
  const serverOptions = buildSocketServerOptions(customOptions);

  const io: AppSocketServer = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    AppSocketData
  >(httpServer, serverOptions);

  // 1. Mount Handshake Authentication Middleware
  io.use(socketAuthMiddleware);

  // 2. Mount Connection Lifecycle Listener & Chat Event Handlers
  io.on('connection', (socket: AppSocket) => {
    handleSocketConnection(socket, io);
    registerChatSocketHandlers(socket, io);
  });

  ioInstance = io;

  socketLogger.info('Socket.IO real-time server attached and initialized successfully', {
    path: serverOptions.path,
    transports: serverOptions.transports,
    pingTimeout: serverOptions.pingTimeout,
    pingInterval: serverOptions.pingInterval,
  });

  return ioInstance;
};

/**
 * Retrieves the active singleton Socket.IO server instance.
 * Throws an explicit error if accessed prior to initialization.
 */
export const getSocketServer = (): AppSocketServer => {
  if (!ioInstance) {
    throw new Error(
      'Socket.IO server has not been initialized. Call initSocketServer(httpServer) during application bootstrap.'
    );
  }
  return ioInstance;
};

/**
 * Gracefully shuts down the Socket.IO server and disconnects active clients cleanly.
 */
export const closeSocketServer = async (): Promise<void> => {
  if (!ioInstance) {
    return;
  }

  socketLogger.info('Closing Socket.IO server and disconnecting active clients...');

  try {
    // Notify all connected sockets of impending shutdown
    ioInstance.emit('system:error', {
      code: SOCKET_ERROR_CODES.SERVER_SHUTTING_DOWN,
      message: 'Server is undergoing maintenance. Please reconnect shortly.',
    });

    // Disconnect all sockets
    ioInstance.disconnectSockets(true);

    // Close the Socket.IO engine cleanly
    await new Promise<void>((resolve) => {
      ioInstance!.close(() => {
        resolve();
      });
    });

    // Clear lifecycle maps
    clearLifecycleTracking();

    ioInstance = null;
    socketLogger.info('Socket.IO server closed cleanly.');
  } catch (error) {
    socketLogger.error('Error during Socket.IO server close', error);
    ioInstance = null;
    clearLifecycleTracking();
  }
};
