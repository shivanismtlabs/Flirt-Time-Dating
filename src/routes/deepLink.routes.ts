import { Router } from 'express';
import {
  createDeepLinkHandler,
  resolveDeepLinkHandler,
  getPreviewMetadataHandler,
  trackDeepLinkHandler,
} from '../controllers/deepLink.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createDeepLinkSchema,
  resolveDeepLinkSchema,
  trackDeepLinkSchema,
} from '../schemas/deepLink.schema';
import {
  deepLinkCreationLimiter,
  deepLinkResolutionLimiter,
} from '../middlewares/rateLimiter.middleware';

const router = Router();

// 1. Create a shareable deep link (requires authentication & rate limiting)
router.post(
  '/',
  authenticate,
  deepLinkCreationLimiter,
  validate(createDeepLinkSchema),
  createDeepLinkHandler
);

// 2. Resolve a deep link (supports optional authentication to check permissions)
router.get(
  '/:code',
  optionalAuthenticate,
  deepLinkResolutionLimiter,
  validate(resolveDeepLinkSchema),
  resolveDeepLinkHandler
);

// 3. Share preview metadata (safe public Open Graph metadata)
router.get(
  '/:code/preview',
  deepLinkResolutionLimiter,
  validate(resolveDeepLinkSchema),
  getPreviewMetadataHandler
);

// 4. Track deep link event
router.post(
  '/:code/track',
  deepLinkResolutionLimiter,
  validate(trackDeepLinkSchema),
  trackDeepLinkHandler
);

export default router;
