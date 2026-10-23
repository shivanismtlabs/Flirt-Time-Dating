import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  notificationService,
  NotificationServiceError,
} from '../services/notification.service';
import { readVoipToken } from '../utils/voipToken';

/**
 * Fetch current user notifications with sectional date grouping
 * GET /api/v1/notifications?limit=20&cursor=...&timezone=Asia/Kolkata
 */
export const getUserNotificationsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = req.query.cursor as string | undefined;
    const timezone = (req.query.timezone as string) || 'UTC';
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.getGroupedNotifications(userId, {
      limit,
      cursor,
      timezone,
      unreadOnly,
    });

    return sendSuccess(res, 'Notifications fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof NotificationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Get Notifications Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching notifications',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Get unread notification counts
 * GET /api/v1/notifications/counts
 */
export const getNotificationCountsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const unreadCount = await notificationService.getUnreadCount(userId);
    return sendSuccess(
      res,
      'Notification counts fetched successfully',
      {
        unreadCount,
        count: unreadCount,
        unread: unreadCount,
      },
      200
    );
  } catch (error: any) {
    console.error('[Notification Counts Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching notification counts',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Mark a single notification as read
 * PATCH /api/v1/notifications/:id/read (or :notificationId/read)
 */
export const markNotificationReadHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const notificationId = (req.params.id || req.params.notificationId) as string;
    const result = await notificationService.markAsRead(userId, notificationId);

    if (!result) {
      return sendError(res, 'Notification not found', 404, 'NOT_FOUND');
    }

    return sendSuccess(res, 'Notification marked as read', result, 200);
  } catch (error: any) {
    console.error('[Mark Read Error]:', error);
    return sendError(
      res,
      error.message || 'Error updating notification status',
      500,
      'INTERNAL_SERVER_ERROR'
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
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const result = await notificationService.markAllAsRead(userId);
    return sendSuccess(res, 'All notifications marked as read', result, 200);
  } catch (error: any) {
    console.error('[Mark All Read Error]:', error);
    return sendError(
      res,
      error.message || 'Error marking all notifications as read',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Delete a notification
 * DELETE /api/v1/notifications/:id (or :notificationId)
 */
export const deleteNotificationHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const notificationId = (req.params.id || req.params.notificationId) as string;
    await notificationService.deleteNotification(userId, notificationId);

    return sendSuccess(res, 'Notification deleted successfully', { id: notificationId }, 200);
  } catch (error: any) {
    if (error instanceof NotificationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Delete Notification Error]:', error);
    return sendError(
      res,
      error.message || 'Error deleting notification',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

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
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const rawToken =
      req.body.token ||
      req.body.deviceToken ||
      req.body.fcmToken ||
      req.body.device_token ||
      req.body.fcm_token ||
      req.body.registrationToken ||
      req.body.registration_token ||
      req.body.pushToken ||
      req.body.push_token;

    const platform = (
      req.body.platform ||
      req.body.deviceType ||
      req.body.device_type ||
      'android'
    ).toLowerCase() as 'ios' | 'android' | 'web';
    const deviceId = req.body.deviceId;

    const result = await notificationService.registerDeviceToken(userId, {
      deviceToken: rawToken,
      platform,
      deviceId,
      voipToken: readVoipToken(req.body),
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
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const { deviceToken, fcmToken, token, fcm_token, title, body, platform } = req.body;
    const rawToken = deviceToken || fcmToken || token || fcm_token;

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
