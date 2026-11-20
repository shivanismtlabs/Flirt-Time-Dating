/**
 * FlirtTime Real-Time Socket Error Handling and Sanitized Logging
 * Ensures no internal stack traces, DB errors, or credentials leak to clients or logs.
 */

import { SOCKET_ERROR_CODES, SocketErrorCode } from './socket.constants';

/**
 * Custom Error class for socket authentication and authorization failures.
 */
export class SocketAuthError extends Error {
  public readonly code: SocketErrorCode;

  constructor(code: SocketErrorCode, message: string) {
    super(message);
    this.name = 'SocketAuthError';
    this.code = code;
    Object.setPrototypeOf(this, SocketAuthError.prototype);
  }
}

/**
 * Sanitizes errors into a clean, safe payload suitable for returning across the socket.
 */
export const sanitizeSocketError = (
  error: unknown
): { code: SocketErrorCode; message: string } => {
  if (error instanceof SocketAuthError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    if (error.name === 'TokenExpiredError') {
      return {
        code: SOCKET_ERROR_CODES.AUTH_TOKEN_EXPIRED,
        message: 'Authentication token has expired',
      };
    }
    if (error.name === 'JsonWebTokenError') {
      return {
        code: SOCKET_ERROR_CODES.AUTH_TOKEN_INVALID,
        message: 'Authentication token is invalid or malformed',
      };
    }
  }

  // Fallback for unhandled or internal runtime errors
  return {
    code: SOCKET_ERROR_CODES.INTERNAL_ERROR,
    message: 'An unexpected internal error occurred on the socket connection',
  };
};

/**
 * Keys that should never be logged under any circumstances.
 */
const SENSITIVE_KEY_REGEX = /(password|token|secret|jwt|auth|key|credit|cvv)/i;

/**
 * Deeply sanitizes metadata object to ensure no credentials or tokens appear in log files.
 */
export const sanitizeLogMetadata = (
  meta?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!meta) return undefined;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogMetadata(value as Record<string, unknown>);
    } else if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = `${value.slice(0, 30)}...[TRUNCATED]`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Structured, sanitized logging helper for real-time socket events.
 * Does not emit noisy logs on routine heartbeats.
 */
export const socketLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    const cleanMeta = sanitizeLogMetadata(meta);
    console.log(
      `[Socket.IO][INFO] ${message}`,
      cleanMeta && Object.keys(cleanMeta).length > 0 ? JSON.stringify(cleanMeta) : ''
    );
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    const cleanMeta = sanitizeLogMetadata(meta);
    console.warn(
      `[Socket.IO][WARN] ${message}`,
      cleanMeta && Object.keys(cleanMeta).length > 0 ? JSON.stringify(cleanMeta) : ''
    );
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const cleanMeta = sanitizeLogMetadata(meta) || {};
    const errorDetails =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { rawError: String(error) };

    console.error(
      `[Socket.IO][ERROR] ${message}`,
      JSON.stringify({ ...cleanMeta, ...errorDetails })
    );
  },
};
