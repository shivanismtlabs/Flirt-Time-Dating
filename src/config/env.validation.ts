/**
 * FlirtTime Real-Time Environment Validation
 * Validates socket-specific environment configurations and CORS policies.
 */

import { env } from './env';
import { SOCKET_DEFAULTS } from '../realtime/socket.constants';

export interface ValidatedSocketEnv {
  path: string;
  allowedOrigins: string[] | string | boolean;
  pingTimeoutMs: number;
  pingIntervalMs: number;
  connectTimeoutMs: number;
  maxHttpBufferSize: number;
  maxConnectionsPerUser: number;
  maxConnectionsPerIp: number;
  perMessageDeflate: boolean;
}

/**
 * Parses and sanitizes allowed CORS origins for Socket.IO.
 * In production, wildcards '*' should be discouraged or restricted to trusted domains.
 */
export const getAllowedSocketOrigins = (): string[] | string | boolean => {
  const rawOrigins = env.SOCKET_CORS_ORIGIN;

  if (!rawOrigins || rawOrigins === '*') {
    // If running in development/test, allow wildcard
    if (env.NODE_ENV !== 'production') {
      return '*';
    }
    // In production, warn if wildcard is used
    console.warn(
      '[Socket.IO][SECURITY WARN] SOCKET_CORS_ORIGIN is set to "*". In production, specify explicit allowed domain origins.'
    );
    return '*';
  }

  // Parse comma-separated list of allowed origins
  const parsed = rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return parsed.length > 0 ? parsed : '*';
};

/**
 * Validates and clamps socket configuration values within healthy production bounds.
 */
export const getValidatedSocketConfig = (): ValidatedSocketEnv => {
  const pingTimeout =
    !isNaN(env.SOCKET_PING_TIMEOUT_MS) && env.SOCKET_PING_TIMEOUT_MS >= 5000
      ? env.SOCKET_PING_TIMEOUT_MS
      : SOCKET_DEFAULTS.PING_TIMEOUT_MS;

  const pingInterval =
    !isNaN(env.SOCKET_PING_INTERVAL_MS) && env.SOCKET_PING_INTERVAL_MS >= 5000
      ? env.SOCKET_PING_INTERVAL_MS
      : SOCKET_DEFAULTS.PING_INTERVAL_MS;

  const connectTimeout =
    !isNaN(env.SOCKET_CONNECT_TIMEOUT_MS) && env.SOCKET_CONNECT_TIMEOUT_MS >= 2000
      ? env.SOCKET_CONNECT_TIMEOUT_MS
      : SOCKET_DEFAULTS.CONNECT_TIMEOUT_MS;

  const maxHttpBufferSize =
    !isNaN(env.SOCKET_MAX_HTTP_BUFFER_SIZE) && env.SOCKET_MAX_HTTP_BUFFER_SIZE > 0
      ? env.SOCKET_MAX_HTTP_BUFFER_SIZE
      : SOCKET_DEFAULTS.MAX_HTTP_BUFFER_SIZE_BYTES;

  const maxConnectionsPerUser =
    !isNaN(env.SOCKET_MAX_CONNECTIONS_PER_USER) && env.SOCKET_MAX_CONNECTIONS_PER_USER > 0
      ? env.SOCKET_MAX_CONNECTIONS_PER_USER
      : SOCKET_DEFAULTS.MAX_CONNECTIONS_PER_USER;

  const maxConnectionsPerIp =
    !isNaN(env.SOCKET_MAX_CONNECTIONS_PER_IP) && env.SOCKET_MAX_CONNECTIONS_PER_IP > 0
      ? env.SOCKET_MAX_CONNECTIONS_PER_IP
      : SOCKET_DEFAULTS.MAX_CONNECTIONS_PER_IP;

  return {
    path: env.SOCKET_PATH || SOCKET_DEFAULTS.PATH,
    allowedOrigins: getAllowedSocketOrigins(),
    pingTimeoutMs: pingTimeout,
    pingIntervalMs: pingInterval,
    connectTimeoutMs: connectTimeout,
    maxHttpBufferSize,
    maxConnectionsPerUser,
    maxConnectionsPerIp,
    perMessageDeflate: env.SOCKET_PER_MESSAGE_DEFLATE,
  };
};
