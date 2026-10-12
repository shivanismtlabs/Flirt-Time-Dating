import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  connectionService,
  ConnectionServiceError,
} from '../services/connection.service';
import { notificationService } from '../services/notification.service';

/**
 * Controller to send a connection request to another user
 * POST /api/v1/connections/request
 */
export const createConnectionRequestHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const requesterId = req.user?.id;
    if (!requesterId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { targetUserId } = req.body;

    const result = await connectionService.createConnectionRequest(
      requesterId,
      targetUserId
    );

    const message = result.isMatched
      ? 'Connection request accepted! You have a new match'
      : 'Connection request sent successfully';

    return sendSuccess(res, message, result, 201);
  } catch (error: any) {
    if (error instanceof ConnectionServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(
      res,
      error.message || 'Error processing connection request',
      error.statusCode || 500
    );
  }
};

/**
 * Controller to register an FCM device token for push notifications
 * POST /api/v1/users/device-token
 */
export const registerDeviceTokenHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { deviceToken, platform, deviceId } = req.body;

    const result = await notificationService.registerDeviceToken(userId, {
      deviceToken,
      platform,
      deviceId,
    });

    return sendSuccess(res, 'Device token registered successfully', result, 200);
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error registering device token',
      error.statusCode || 500
    );
  }
};
