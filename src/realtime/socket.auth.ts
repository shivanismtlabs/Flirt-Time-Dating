/**
 * FlirtTime Real-Time Socket Authentication Middleware
 * Reuses production JWT verification, enforces identity security, and attaches minimal trusted context.
 */

import { AppSocket } from './socket.types';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { User } from '../models/user.model';
import { SOCKET_ERROR_CODES } from './socket.constants';
import { SocketAuthError, socketLogger } from './socket.errors';
import { getActiveLifecycleConfig, getUserActiveSocketCount } from './socket.lifecycle';

/**
 * Extracts candidate JWT string from handshake auth payload, headers, or query parameters.
 * Does not expose or log raw token values.
 */
export const extractHandshakeToken = (socket: AppSocket): string | null => {
  const { auth, headers, query } = socket.handshake;

  // 1. Primary: Socket.IO v4 client auth payload `io({ auth: { token: '...' } })`
  if (auth && typeof auth.token === 'string' && auth.token.trim().length > 0) {
    const raw = auth.token.trim();
    return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  }

  // 2. HTTP Authorization header: `Bearer <token>`
  const authHeader = headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    const raw = authHeader.trim();
    return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  }

  // 3. Reverse-proxy / custom headers: `x-access-token` or `x-authorization`
  const altHeader =
    (headers?.['x-access-token'] as string) ||
    (headers?.['x-authorization'] as string);
  if (typeof altHeader === 'string' && altHeader.trim().length > 0) {
    const raw = altHeader.trim();
    return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  }

  // 4. Query parameter fallback: `?token=...`
  const queryToken = query?.token || query?.access_token;
  if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
    const raw = queryToken.trim();
    return raw.startsWith('Bearer ') ? raw.slice(7).trim() : raw;
  }

  return null;
};

/**
 * Resolves the real remote client IP address from proxy headers or handshake connection.
 */
export const resolveClientIp = (socket: AppSocket): string => {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  return socket.handshake.address || 'unknown';
};

/**
 * Socket.IO Handshake Authentication Middleware.
 * Executes ONCE per connection handshake (never on heartbeats/pings).
 */
export const socketAuthMiddleware = async (
  socket: AppSocket,
  next: (err?: Error) => void
): Promise<void> => {
  const clientIp = resolveClientIp(socket);

  try {
    const token = extractHandshakeToken(socket);

    if (!token) {
      socketLogger.warn('Connection rejected: Authentication token missing', {
        clientIp,
        socketId: socket.id,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.AUTH_TOKEN_MISSING,
          'Authentication token is required to establish real-time connection'
        )
      );
    }

    // 1. Verify token cryptographic signature and expiration using production JWT helper
    let payload: TokenPayload;
    try {
      payload = verifyToken(token);
    } catch (jwtErr: any) {
      if (jwtErr?.name === 'TokenExpiredError') {
        socketLogger.warn('Connection rejected: Token expired', {
          clientIp,
          socketId: socket.id,
        });
        return next(
          new SocketAuthError(
            SOCKET_ERROR_CODES.AUTH_TOKEN_EXPIRED,
            'Authentication token has expired. Please refresh your credentials.'
          )
        );
      }

      socketLogger.warn('Connection rejected: Invalid token signature', {
        clientIp,
        socketId: socket.id,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.AUTH_TOKEN_INVALID,
          'Authentication token is invalid or malformed'
        )
      );
    }

    // 2. Validate payload claims (must have valid user id)
    if (!payload?.id || typeof payload.id !== 'string') {
      socketLogger.warn('Connection rejected: Missing user ID in token payload', {
        clientIp,
        socketId: socket.id,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.AUTH_TOKEN_INVALID,
          'Invalid identity payload in token'
        )
      );
    }

    // 3. Verify user account state in database (single lightweight lookup during handshake only)
    const user = await User.findByPk(payload.id, {
      attributes: ['id', 'isActive', 'role'],
    });

    if (!user) {
      socketLogger.warn('Connection rejected: User not found in database', {
        clientIp,
        userId: payload.id,
        socketId: socket.id,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.USER_NOT_FOUND,
          'User account associated with this token no longer exists'
        )
      );
    }

    if (user.isActive === false) {
      socketLogger.warn('Connection rejected: Inactive / suspended account', {
        clientIp,
        userId: user.id,
        socketId: socket.id,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.USER_INACTIVE,
          'User account is suspended or deactivated'
        )
      );
    }

    // 4. Enforce per-user active connection concurrency limit at handshake
    const config = getActiveLifecycleConfig();
    const currentSockets = getUserActiveSocketCount(user.id);
    if (currentSockets >= config.maxConnectionsPerUser) {
      socketLogger.warn('Connection rejected: User connection limit exceeded', {
        clientIp,
        userId: user.id,
        currentConnections: currentSockets,
        maxAllowed: config.maxConnectionsPerUser,
      });
      return next(
        new SocketAuthError(
          SOCKET_ERROR_CODES.CONNECTION_LIMIT_EXCEEDED,
          `Maximum concurrent connections per account (${config.maxConnectionsPerUser}) exceeded`
        )
      );
    }

    // 5. Attach minimum trusted identity context to socket.data (sanitized, no secrets)
    const tokenExp = (payload as any).exp ? Number((payload as any).exp) : undefined;

    socket.data = {
      user: {
        userId: user.id,
        role: user.role || 'user',
        email: payload.email || null,
        phone: payload.phone || null,
        authenticatedAt: Date.now(),
        tokenExp,
      },
      clientIp,
      connectedAt: Date.now(),
    };

    return next();
  } catch (error: any) {
    socketLogger.error('Unexpected error during socket handshake authentication', error, {
      clientIp,
      socketId: socket.id,
    });
    return next(
      new SocketAuthError(
        SOCKET_ERROR_CODES.INTERNAL_ERROR,
        'Internal authentication verification failure'
      )
    );
  }
};
