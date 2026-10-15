import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getWalletBalanceHandler,
  getPurchaseHistoryHandler,
} from '../controllers/coinPurchase.controller';
import { getPurchaseHistorySchema } from '../schemas/coinPurchase.schema';

const router = Router();

/**
 * GET /api/v1/wallet/balance
 * Authenticated endpoint to retrieve user's coin wallet balance and recent ledger entries
 */
router.get(
  '/balance',
  authenticate,
  getWalletBalanceHandler
);

/**
 * GET /api/v1/wallet/history
 * Authenticated endpoint to retrieve user's wallet purchase history
 */
router.get(
  '/history',
  authenticate,
  validate(getPurchaseHistorySchema),
  getPurchaseHistoryHandler
);

export default router;
