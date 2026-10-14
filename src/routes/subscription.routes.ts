import { Router } from 'express';
import { getSubscriptionsHandler } from '../controllers/subscription.controller';
import { optionalAuthenticate } from '../middlewares/auth.middleware';

const router = Router();

/**
 * GET /api/v1/subscriptions
 * Optional authentication: public access allowed, but attaches user context if Bearer token present
 */
router.get('/', optionalAuthenticate, getSubscriptionsHandler);

export default router;
