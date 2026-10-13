import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  connectionService,
  ConnectionServiceError,
} from '../services/connection.service';
import { notificationService } from '../services/notification.service';
import { CONNECTION_REASONS } from '../schemas/connection.schema';
import { User } from '../models';

/**
 * Controller to fetch predefined connection reasons (Screen: "Connect because...")
 * GET /api/v1/connections/reasons?targetUserId=:userId
 */
export const getConnectionReasonsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const targetUserId = req.query.targetUserId as string | undefined;
    let targetName = 'them';

    if (targetUserId) {
      const targetUser = await User.findByPk(targetUserId, {
        attributes: ['id', 'firstName', 'fullName', 'nickName'],
      });
      if (targetUser) {
        targetName =
          targetUser.firstName ||
          (targetUser.fullName ? targetUser.fullName.split(' ')[0] : null) ||
          targetUser.nickName ||
          'them';
      }
    }

    return sendSuccess(
      res,
      'Connection reasons fetched successfully',
      {
        title: 'Connect because...',
        subtitle: `Optional: let ${targetName} know what caught your eye.`,
        targetName,
        options: CONNECTION_REASONS,
      },
      200
    );
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error fetching connection reasons',
      error.statusCode || 500
    );
  }
};

/**
 * Controller to send a connection request to another user
 * POST /api/v1/connections/request (and POST /api/v1/connections)
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

    const { targetUserId, reason, message, momentId } = req.body;

    const result = await connectionService.createConnectionRequest(
      requesterId,
      targetUserId,
      { reason, message, momentId }
    );

    const successMessage = result.isMatched
      ? 'Connection request accepted! You have a new match'
      : 'Connection request sent successfully';

    return sendSuccess(res, successMessage, result, 201);
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
