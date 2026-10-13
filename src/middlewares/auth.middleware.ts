import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/jwt';
import { sendError } from '../utils/response';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  // Support standard Authorization, reverse-proxy headers (Apache/cPanel/Nginx), and query fallback
  const rawAuth =
    (req.headers.authorization as string) ||
    ((req.headers as any).Authorization as string) ||
    ((req.headers as any)['x-access-token'] as string) ||
    ((req.headers as any)['x-authorization'] as string) ||
    ((req.headers as any)['http_authorization'] as string) ||
    ((req.query?.token || req.query?.access_token) as string);

  if (!rawAuth || typeof rawAuth !== 'string' || !rawAuth.trim()) {
    return sendError(res, 'Authentication token missing or malformed', 401);
  }

  const cleanHeader = rawAuth.trim();
  const token = cleanHeader.startsWith('Bearer ')
    ? cleanHeader.slice(7).trim()
    : cleanHeader;

  if (!token) {
    return sendError(res, 'Authentication token missing or malformed', 401);
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
    return next();
  } catch (error) {
    return sendError(res, 'Invalid or expired token', 401);
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendError(res, 'User not authenticated', 401);
    }
    if (!roles.includes(req.user.role)) {
      return sendError(res, 'Forbidden: insufficient permissions', 403);
    }
    return next();
  };
};

/**
 * Optional authentication: Populates req.user if valid bearer token is present,
 * but allows unauthenticated callers to proceed if no token is provided.
 */
export const optionalAuthenticate = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  const rawAuth =
    (req.headers.authorization as string) ||
    ((req.headers as any).Authorization as string) ||
    ((req.headers as any)['x-access-token'] as string) ||
    ((req.headers as any)['x-authorization'] as string) ||
    ((req.headers as any)['http_authorization'] as string) ||
    ((req.query?.token || req.query?.access_token) as string);

  if (!rawAuth || typeof rawAuth !== 'string' || !rawAuth.trim()) {
    return next();
  }

  const cleanHeader = rawAuth.trim();
  const token = cleanHeader.startsWith('Bearer ')
    ? cleanHeader.slice(7).trim()
    : cleanHeader;

  if (!token) {
    return next();
  }

  try {
    const payload = verifyToken(token);
    req.user = payload;
  } catch {
    // If token is invalid or expired in optional auth, ignore it and treat as guest
    req.user = undefined;
  }

  return next();
};

