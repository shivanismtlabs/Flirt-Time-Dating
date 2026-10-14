import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { coinPurchaseService, CoinPurchaseServiceError } from '../services/coinPurchase.service';
import { sendSuccess, sendError } from '../utils/response';
import { IAPServiceError } from '../services/iap.service';

/**
 * Controller to verify in-app coin purchase from Apple App Store or Google Play
 * POST /api/v1/coins/purchase/verify
 */
export const verifyPurchaseHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const result = await coinPurchaseService.verifyAndCreditPurchase(userId, req.body);

    return res.status(200).json({
      status: true,
      success: true,
      alreadyProcessed: result.alreadyProcessed,
      message: result.message,
      data: result.data,
    });
  } catch (error: any) {
    if (error instanceof CoinPurchaseServiceError || error instanceof IAPServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    console.error('[CoinPurchase Controller Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while verifying coin purchase',
      errorCode: 'INTERNAL_ERROR',
    });
  }
};

/**
 * Controller to fetch paginated coin purchase history for authenticated user
 * GET /api/v1/coins/purchase/history
 */
export const getPurchaseHistoryHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const result = await coinPurchaseService.getPurchaseHistory(userId, req.query as any);

    return res.status(200).json({
      status: true,
      success: true,
      message: 'Coin purchase history retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error: any) {
    if (error instanceof CoinPurchaseServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    console.error('[CoinPurchase History Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while retrieving purchase history',
    });
  }
};

/**
 * Controller to retrieve user wallet balance and recent ledger transactions
 * GET /api/v1/wallet/balance (and /api/v1/coins/balance)
 */
export const getWalletBalanceHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const result = await coinPurchaseService.getWalletBalance(userId);

    return res.status(200).json({
      status: true,
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: result,
    });
  } catch (error: any) {
    if (error instanceof CoinPurchaseServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    console.error('[Wallet Balance Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while retrieving wallet balance',
    });
  }
};

/**
 * Controller to retry store acknowledgement / consumption if previous attempt failed
 * POST /api/v1/coins/purchase/:purchaseId/acknowledge
 */
export const retryAcknowledgeHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const purchaseId = req.params.purchaseId as string;
    if (!purchaseId) {
      return sendError(res, 'purchaseId is required in URL parameter', 400, 'MISSING_PARAM');
    }

    const result = await coinPurchaseService.retryAcknowledgement(userId, purchaseId);

    return res.status(200).json({
      status: true,
      success: result.success,
      message: result.message,
      data: { acknowledged: result.acknowledged },
    });
  } catch (error: any) {
    if (error instanceof CoinPurchaseServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    console.error('[Retry Acknowledge Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while retrying purchase acknowledgement',
    });
  }
};
