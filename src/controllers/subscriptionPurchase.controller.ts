import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  subscriptionPurchaseService,
  SubscriptionPurchaseServiceError,
} from '../services/subscriptionPurchase.service';
import {
  verifySubscriptionPurchaseSchema,
  subscriptionHistoryQuerySchema,
} from '../schemas/subscriptionPurchase.schema';
import { IAPServiceError } from '../services/iap.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to verify an in-app subscription purchase from Apple or Google
 * POST /api/v1/subscriptions/purchase/verify
 */
export const verifySubscriptionPurchaseHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: false,
        message: 'Unauthorized: Authentication required',
        errorCode: 'UNAUTHORIZED',
      });
    }

    const validationResult = verifySubscriptionPurchaseSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        status: false,
        message: 'Validation error: ' + validationResult.error.errors.map((e) => e.message).join(', '),
        errorCode: 'VALIDATION_ERROR',
        errors: validationResult.error.errors,
      });
    }

    const result = await subscriptionPurchaseService.verifyAndProcessSubscription(
      userId,
      validationResult.data
    );

    return res.status(200).json({
      status: true,
      success: true,
      message: result.alreadyProcessed
        ? 'Subscription purchase has already been verified and processed'
        : 'Subscription purchase verified and activated successfully',
      data: {
        alreadyProcessed: result.alreadyProcessed,
        subscriptionId: result.subscription.id,
        plan: {
          id: result.plan.id,
          name: result.plan.name,
          duration_days: result.plan.duration_days,
          billing_cycle: subscriptionPurchaseService.resolveBillingCycle(result.plan, result.subscription.productId),
          productId: result.subscription.productId,
        },
        status: result.subscription.status,
        isEntitled: result.isEntitled,
        isSubscribed: result.isEntitled,
        startsAt: result.subscription.startsAt instanceof Date ? result.subscription.startsAt.toISOString() : result.subscription.startsAt,
        expiresAt: result.subscription.expiresAt instanceof Date ? result.subscription.expiresAt.toISOString() : result.subscription.expiresAt,
        autoRenewing: result.subscription.autoRenewing,
        bonusCoinsCredited: result.bonusCoinsCredited,
        currentBalance: result.currentBalance,
      },
    });
  } catch (error: any) {
    if (error instanceof SubscriptionPurchaseServiceError || error instanceof IAPServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode || 'SUBSCRIPTION_VERIFICATION_FAILED',
      });
    }

    console.error('[SubscriptionPurchase Controller Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while processing subscription purchase',
    });
  }
};

/**
 * Controller to fetch authenticated user's current subscription and entitlement
 * GET /api/v1/subscriptions/my
 */
export const getMySubscriptionHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Unauthorized: Authentication required', 401);
    }

    const data = await subscriptionPurchaseService.getMySubscription(userId);

    return sendSuccess(res, 'Current subscription retrieved successfully', data, 200);
  } catch (error: any) {
    if (error instanceof SubscriptionPurchaseServiceError) {
      return sendError(res, error.message, error.statusCode);
    }

    console.error('[MySubscription Controller Error]:', error?.message || error);
    return sendError(res, 'Internal server error while retrieving current subscription', 500);
  }
};

/**
 * Controller to fetch paginated subscription history
 * GET /api/v1/subscriptions/history
 */
export const getSubscriptionHistoryHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        status: false,
        message: 'Unauthorized: Authentication required',
        errorCode: 'UNAUTHORIZED',
      });
    }

    const queryParsed = subscriptionHistoryQuerySchema.safeParse(req.query);
    const query = queryParsed.success ? queryParsed.data : { page: 1, limit: 10 };

    const result = await subscriptionPurchaseService.getSubscriptionHistory(userId, query);

    return res.status(200).json({
      status: true,
      success: true,
      message: 'Subscription history retrieved successfully',
      data: result,
    });
  } catch (error: any) {
    console.error('[SubscriptionHistory Controller Error]:', error?.message || error);
    return res.status(500).json({
      status: false,
      message: 'Internal server error while retrieving subscription history',
    });
  }
};

/**
 * Webhook endpoint for Apple App Store Server Notifications V2
 * POST /api/v1/subscriptions/webhook/apple
 */
export const appleWebhookHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const signedPayload = req.body?.signedPayload;
    if (!signedPayload) {
      return res.status(400).json({
        status: false,
        message: 'Missing signedPayload',
      });
    }

    const result = await subscriptionPurchaseService.handleAppleNotification(signedPayload);
    return res.status(200).json({ status: true, ...result });
  } catch (error: any) {
    console.error('[Apple Webhook Error]:', error?.message || error);
    return res.status(500).json({ status: false, message: 'Failed to process Apple notification' });
  }
};

/**
 * Webhook endpoint for Google Play Real-time Developer Notifications (Cloud Pub/Sub)
 * POST /api/v1/subscriptions/webhook/google
 */
export const googleWebhookHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await subscriptionPurchaseService.handleGoogleNotification(req.body);
    return res.status(200).json({ status: true, ...result });
  } catch (error: any) {
    console.error('[Google Webhook Error]:', error?.message || error);
    return res.status(500).json({ status: false, message: 'Failed to process Google notification' });
  }
};
