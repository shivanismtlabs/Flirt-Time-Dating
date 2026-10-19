/**
 * FlirtTime Real-Time Socket.IO Configuration Factory
 * Produces validated, high-performance ServerOptions for Socket.IO.
 */

import { ServerOptions } from 'socket.io';
import { SOCKET_DEFAULTS } from './socket.constants';
import { SocketServerConfigOptions } from './socket.types';
import { getValidatedSocketConfig, ValidatedSocketEnv } from '../config/env.validation';

/**
 * Resolves full socket configuration by merging runtime options with environment defaults.
 */
export const getResolvedSocketConfig = (
  customOptions?: SocketServerConfigOptions
): ValidatedSocketEnv => {
  const envConfig = getValidatedSocketConfig();
  return {
    path: customOptions?.path || envConfig.path,
    allowedOrigins: customOptions?.corsOrigin ?? envConfig.allowedOrigins,
    pingTimeoutMs: customOptions?.pingTimeout || envConfig.pingTimeoutMs,
    pingIntervalMs: customOptions?.pingInterval || envConfig.pingIntervalMs,
    connectTimeoutMs: customOptions?.connectTimeout || envConfig.connectTimeoutMs,
    maxHttpBufferSize: customOptions?.maxHttpBufferSize || envConfig.maxHttpBufferSize,
    maxConnectionsPerUser:
      customOptions?.maxConnectionsPerUser !== undefined
        ? customOptions.maxConnectionsPerUser
        : envConfig.maxConnectionsPerUser,
    maxConnectionsPerIp:
      customOptions?.maxConnectionsPerIp !== undefined
        ? customOptions.maxConnectionsPerIp
        : envConfig.maxConnectionsPerIp,
    perMessageDeflate: customOptions?.perMessageDeflate ?? envConfig.perMessageDeflate,
  };
};

/**
 * Builds the complete Socket.IO server configuration object.
 */
export const buildSocketServerOptions = (
  customOptions?: SocketServerConfigOptions
): Partial<ServerOptions> => {
  const resolved = getResolvedSocketConfig(customOptions);

  const path = resolved.path;
  const pingTimeout = resolved.pingTimeoutMs;
  const pingInterval = resolved.pingIntervalMs;
  const connectTimeout = resolved.connectTimeoutMs;
  const maxHttpBufferSize = resolved.maxHttpBufferSize;
  const allowedOrigins = resolved.allowedOrigins;

  // Configure CORS origin verification
  const corsConfig: ServerOptions['cors'] = {
    origin: (origin, callback) => {
      // If allowedOrigins is wildcard '*', accept all
      if (allowedOrigins === '*' || allowedOrigins === true) {
        return callback(null, true);
      }

      // If no origin header is provided (e.g., native mobile apps on iOS / Android)
      if (!origin) {
        return callback(null, true);
      }

      // If allowedOrigins is an array of allowed domains
      if (Array.isArray(allowedOrigins)) {
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin not allowed: ${origin}`));
      }

      // If single string
      if (typeof allowedOrigins === 'string') {
        if (allowedOrigins === origin) {
          return callback(null, true);
        }
        return callback(new Error(`CORS origin not allowed: ${origin}`));
      }

      return callback(new Error('CORS origin rejected'));
    },
    credentials: true,
    methods: ['GET', 'POST'],
  };

  return {
    path,
    cors: corsConfig,
    transports: [...SOCKET_DEFAULTS.TRANSPORTS],
    pingTimeout,
    pingInterval,
    connectTimeout,
    maxHttpBufferSize,
    // Disable perMessageDeflate compression overhead for high-frequency small chat packets
    perMessageDeflate: resolved.perMessageDeflate,
    // Do not serve the client JS bundle from the API server
    serveClient: false,
    // Cleanup dynamically created child namespaces to prevent memory leaks
    cleanupEmptyChildNamespaces: true,
  };
};
