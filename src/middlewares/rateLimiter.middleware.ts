import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitBuckets = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitBuckets.entries()) {
    if (record.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Reusable sliding rate limiter middleware to prevent brute-force and enumeration attacks
 */
export const createRateLimiter = (options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyPrefix?: string;
}) => {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
    keyPrefix = 'rl',
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // In test environment, allow high throughput
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown_ip';

    const bucketKey = `${keyPrefix}:${ip}`;
    const now = Date.now();

    const record = rateLimitBuckets.get(bucketKey);

    if (!record || record.resetAt <= now) {
      rateLimitBuckets.set(bucketKey, {
        count: 1,
        resetAt: now + windowMs,
      });
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', 0);
      return sendError(res, message, 429, 'RATE_LIMIT_EXCEEDED');
    }

    record.count++;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
    return next();
  };
};

// Deep link creation limiter (e.g. 30 links per minute per IP)
export const deepLinkCreationLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Too many share links created. Please slow down.',
  keyPrefix: 'dl_create',
});

// Deep link resolution limiter (e.g. 120 queries per minute per IP to prevent enumeration)
export const deepLinkResolutionLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  message: 'Too many link lookups. Please try again in a moment.',
  keyPrefix: 'dl_resolve',
});
