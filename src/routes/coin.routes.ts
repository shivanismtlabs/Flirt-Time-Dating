import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  verifyPurchaseHandler,
  getPurchaseHistoryHandler,
  getWalletBalanceHandler,
  retryAcknowledgeHandler,
} from '../controllers/coinPurchase.controller';
import {
  verifyCoinPurchaseSchema,
  getPurchaseHistorySchema,
} from '../schemas/coinPurchase.schema';

const router = Router();

/**
 * POST /api/v1/coins/purchase/verify
 * Authenticated endpoint to verify Apple App Store or Google Play coin purchase and credit wallet
 */
router.post(
  '/purchase/verify',
  authenticate,
  validate(verifyCoinPurchaseSchema),
  verifyPurchaseHandler
);

/**
 * Convenience alias for purchase verification: POST /api/v1/coins/verify
 */
router.post(
  '/verify',
  authenticate,
  validate(verifyCoinPurchaseSchema),
  verifyPurchaseHandler
);

/**
 * GET /api/v1/coins/purchase/history
 * Authenticated endpoint to retrieve user's coin purchase history
 */
router.get(
  '/purchase/history',
  authenticate,
  validate(getPurchaseHistorySchema),
  getPurchaseHistoryHandler
);

/**
 * Convenience alias: GET /api/v1/coins/history
 */
router.get(
  '/history',
  authenticate,
  validate(getPurchaseHistorySchema),
  getPurchaseHistoryHandler
);

/**
 * GET /api/v1/coins/balance
 * Authenticated endpoint to retrieve user's wallet coin balance
 */
router.get(
  '/balance',
  authenticate,
  getWalletBalanceHandler
);

/**
 * POST /api/v1/coins/purchase/:purchaseId/acknowledge
 * Authenticated endpoint to retry store acknowledgement if consumption previously failed
 */
router.post(
  '/purchase/:purchaseId/acknowledge',
  authenticate,
  retryAcknowledgeHandler
);

export default router;
