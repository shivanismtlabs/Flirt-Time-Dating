/**
 * FlirtTime Real-Time Socket Infrastructure Constants
 * Centralized, immutable configuration defaults and lifecycle event names.
 * NOTE: Strictly setup-level constants only. No chat message events are defined here.
 */

export const SOCKET_DEFAULTS = {
  /** Socket.IO path (defaults to standard /socket.io) */
  PATH: '/socket.io',

  /**
   * Transport strategies: WebSocket-first with polling fallback.
   * Direct WebSocket eliminates HTTP handshake overhead, but polling fallback
   * ensures mobile connectivity across restrictive cellular firewalls and proxies.
   */
  TRANSPORTS: ['websocket', 'polling'] as ('websocket' | 'polling')[],

  /**
   * Heartbeat ping interval: 25 seconds.
   * Engine.io sends ping packet every 25s to detect connection liveness.
   */
  PING_INTERVAL_MS: 25000,

  /**
   * Heartbeat ping timeout: 20 seconds.
   * If client does not respond with pong within 20s, connection is considered dead.
   */
  PING_TIMEOUT_MS: 20000,

  /** Maximum time allowed for client to complete handshake & auth (10s) */
  CONNECT_TIMEOUT_MS: 10000,

  /**
   * Maximum permitted incoming payload size in bytes: 1 MB.
   * Prevents memory exhaustion attacks while permitting reasonable JSON metadata.
   */
  MAX_HTTP_BUFFER_SIZE_BYTES: 1048576, // 1MB

  /**
   * Maximum concurrent active sockets allowed per user account.
   * Accommodates multiple legitimate devices (phone + tablet + web) while bounding resources.
   */
  MAX_CONNECTIONS_PER_USER: 5,

  /**
   * Maximum concurrent active sockets allowed per remote IP address.
   * Mitigates aggressive connection flooding from a single origin.
   */
  MAX_CONNECTIONS_PER_IP: 50,

  /**
   * Room prefix used for multi-device user routing.
   * e.g., 'user:00000000-0000-0000-0000-000000000000'
   */
  USER_ROOM_PREFIX: 'user:',
} as const;

/**
 * Standard setup-level lifecycle events.
 */
export const SOCKET_LIFECYCLE_EVENTS = {
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  DISCONNECTING: 'disconnecting',
  ERROR: 'error',
  CONNECT_ERROR: 'connect_error',
} as const;

/**
 * Standardized, sanitized error codes for socket connections.
 * These codes are safe to return to clients without leaking sensitive internal details.
 */
export const SOCKET_ERROR_CODES = {
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_INACTIVE: 'USER_INACTIVE',
  CONNECTION_LIMIT_EXCEEDED: 'CONNECTION_LIMIT_EXCEEDED',
  IP_LIMIT_EXCEEDED: 'IP_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVER_SHUTTING_DOWN: 'SERVER_SHUTTING_DOWN',
} as const;

export type SocketErrorCode =
  (typeof SOCKET_ERROR_CODES)[keyof typeof SOCKET_ERROR_CODES];
