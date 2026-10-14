import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  subscriptionService,
  SubscriptionServiceError,
} from '../services/subscription.service';
import { GetSubscriptionsQuery } from '../schemas/subscription.schema';

/**
 * Controller to fetch Subscriptions
 * GET /api/v1/subscriptions (and /api/subscriptions)
 *
 * Matches Laravel response:
 * {
 *   "status": true,
 *   "img_base_url": "https://flirttime.s3.ap-south-1.amazonaws.com",
 *   "message": "Subscriptions retrieved successfully",
 *   "data": [ ... ]
 * }
 */
export const getSubscriptionsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const query = req.query as unknown as GetSubscriptionsQuery;
    const includeInactive = query?.includeInactive === true || (query as any)?.includeInactive === 'true';

    const result = await subscriptionService.getSubscriptions({ includeInactive });

    return res.status(200).json({
      status: true,
      img_base_url: result.img_base_url,
      message: result.message,
      data: result.data,
    });
  } catch (error: any) {
    if (error instanceof SubscriptionServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    // Secure production error handling: never leak SQL statements or stack traces
    console.error(
      '[Subscriptions Controller Error]:',
      error?.message || 'Unknown database error'
    );

    return res.status(500).json({
      status: false,
      message: 'Internal server error while retrieving subscriptions',
    });
  }
};
