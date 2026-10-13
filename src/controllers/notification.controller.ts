import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { notificationService } from '../services/notification.service';

/**
 * Register FCM device token
 * POST /api/v1/notifications/device-token
 */
export const registerNotificationDeviceTokenHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const rawToken =
      req.body.deviceToken ||
      req.body.fcmToken ||
      req.body.token ||
      req.body.device_token;

    const platform = (req.body.platform || 'android').toLowerCase() as
      | 'ios'
      | 'android'
      | 'web';
    const deviceId = req.body.deviceId;

    const result = await notificationService.registerDeviceToken(userId, {
      deviceToken: rawToken,
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

/**
 * Fetch current user notifications
 * GET /api/v1/notifications
 */
export const getUserNotificationsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.getUserNotifications(userId, {
      page,
      limit,
      unreadOnly,
    });

    return sendSuccess(res, 'Notifications retrieved successfully', result, 200);
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error fetching notifications',
      error.statusCode || 500
    );
  }
};

/**
 * Mark a single notification as read
 * PATCH /api/v1/notifications/:id/read
 */
export const markNotificationReadHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const notificationId = req.params.id as string;
    const result = await notificationService.markAsRead(userId, notificationId);

    if (!result) {
      return sendError(res, 'Notification not found', 404);
    }

    return sendSuccess(res, 'Notification marked as read', result, 200);
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error updating notification status',
      error.statusCode || 500
    );
  }
};

/**
 * Mark all notifications as read
 * PATCH /api/v1/notifications/read-all
 */
export const markAllNotificationsReadHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const result = await notificationService.markAllAsRead(userId);
    return sendSuccess(res, 'All notifications marked as read', result, 200);
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error marking all notifications as read',
      error.statusCode || 500
    );
  }
};

/**
 * Send a test push notification
 * POST /api/v1/notifications/test-push
 */
export const sendTestPushNotificationHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { deviceToken, fcmToken, token, title, body, platform } = req.body;
    const rawToken = deviceToken || fcmToken || token;

    const result = await notificationService.sendTestPush(userId, {
      deviceToken: rawToken,
      title,
      body,
      platform,
    });

    return sendSuccess(res, 'Test push dispatched', result, 200);
  } catch (error: any) {
    return sendError(
      res,
      error.message || 'Error sending test push notification',
      error.statusCode || 500
    );
  }
};
