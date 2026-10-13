import { Router } from 'express';
import {
  getUserNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
  registerNotificationDeviceTokenHandler,
  sendTestPushNotificationHandler,
} from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { registerDeviceTokenSchema } from '../schemas/connection.schema';

const router = Router();

// All notification endpoints require authentication
router.use(authenticate);

// 1. Fetch current user notifications: GET /api/v1/notifications
router.get('/', getUserNotificationsHandler);

// 2. Mark single notification as read: PATCH /api/v1/notifications/:id/read
router.patch('/:id/read', markNotificationReadHandler);

// 3. Mark all notifications as read: PATCH /api/v1/notifications/read-all
router.patch('/read-all', markAllNotificationsReadHandler);

// 4. Register FCM device token: POST /api/v1/notifications/device-token
router.post(
  '/device-token',
  validate(registerDeviceTokenSchema),
  registerNotificationDeviceTokenHandler
);

// 5. Aliases for token registration: /fcm-token, /token
router.post(
  '/fcm-token',
  validate(registerDeviceTokenSchema),
  registerNotificationDeviceTokenHandler
);
router.post(
  '/token',
  validate(registerDeviceTokenSchema),
  registerNotificationDeviceTokenHandler
);

// 6. Send test push notification: POST /api/v1/notifications/test-push
router.post('/test-push', sendTestPushNotificationHandler);

export default router;
