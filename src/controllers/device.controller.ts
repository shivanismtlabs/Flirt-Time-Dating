import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { notificationService } from '../services/notification.service';

/**
 * Register or update device token
 * POST /api/v1/devices/register
 */
export const registerDeviceHandler = async (
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
    });

    return sendSuccess(res, 'Device registered successfully', result, 200);
  } catch (error: any) {
    console.error('[Device Register Error]:', error);
    return sendError(
      res,
      error.message || 'Error registering device',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Unregister device token
 * DELETE /api/v1/devices/unregister
 */
export const unregisterDeviceHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const rawToken =
      req.body?.token ||
      req.body?.deviceToken ||
      req.body?.fcmToken ||
      req.body?.device_token ||
      req.query?.token ||
      req.query?.deviceToken;

    if (rawToken && typeof rawToken === 'string' && rawToken.trim()) {
      const result = await notificationService.deactivateDeviceToken(rawToken.trim(), userId);
      return sendSuccess(res, 'Device unregistered successfully', result, 200);
    }

    // If no specific token was provided (e.g. general logout), deactivate all devices for the user
    const result = await notificationService.deactivateAllUserDevices(userId);
    return sendSuccess(res, 'All devices unregistered successfully', result, 200);
  } catch (error: any) {
    console.error('[Device Unregister Error]:', error);
    return sendError(
      res,
      error.message || 'Error unregistering device',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
