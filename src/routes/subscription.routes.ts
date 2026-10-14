import { Router } from 'express';
import { getSubscriptionsHandler } from '../controllers/subscription.controller';
import {
  verifySubscriptionPurchaseHandler,
  getMySubscriptionHandler,
  getSubscriptionHistoryHandler,
  appleWebhookHandler,
  googleWebhookHandler,
} from '../controllers/subscriptionPurchase.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';

const router = Router();

/**
 * GET /api/v1/subscriptions
 * Optional authentication: public access allowed, but attaches user context if Bearer token present
 */
router.get('/', optionalAuthenticate, getSubscriptionsHandler);

/**
 * POST /api/v1/subscriptions/purchase/verify (and alias /verify)
 * Authenticated endpoint to verify Apple App Store or Google Play subscription purchases
 */
router.post('/purchase/verify', authenticate, verifySubscriptionPurchaseHandler);
router.post('/verify', authenticate, verifySubscriptionPurchaseHandler);

/**
 * GET /api/v1/subscriptions/my
 * Authenticated endpoint to retrieve current subscription and entitlement status
 */
router.get('/my', authenticate, getMySubscriptionHandler);

/**
 * GET /api/v1/subscriptions/history
 * Authenticated endpoint to retrieve paginated subscription purchase history
 */
router.get('/history', authenticate, getSubscriptionHistoryHandler);

/**
 * Webhook endpoints for Apple App Store Server Notifications V2
 */
router.post('/webhook/apple', appleWebhookHandler);
router.post('/notifications/apple', appleWebhookHandler);

/**
 * Webhook endpoints for Google Play Real-time Developer Notifications (Cloud Pub/Sub)
 */
router.post('/webhook/google', googleWebhookHandler);
router.post('/notifications/google', googleWebhookHandler);

export default router;
