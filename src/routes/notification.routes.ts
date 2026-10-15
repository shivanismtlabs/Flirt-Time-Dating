import { Router } from 'express';
import {
  getUserNotificationsHandler,
  getNotificationCountsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
  deleteNotificationHandler,
  registerNotificationDeviceTokenHandler,
  sendTestPushNotificationHandler,
} from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getNotificationsSchema,
  notificationIdParamSchema,
  deviceRegisterSchema,
} from '../schemas/notification.schema';

const router = Router();

// All notification endpoints require authentication
router.use(authenticate);

// 1. Get notification badge counts: GET /api/v1/notifications/counts
router.get('/counts', getNotificationCountsHandler);

// 2. Mark all notifications as read: PATCH /api/v1/notifications/read-all
router.patch('/read-all', markAllNotificationsReadHandler);

// 3. Fetch notifications listing: GET /api/v1/notifications?limit=20&cursor=...&timezone=...
router.get('/', validate(getNotificationsSchema), getUserNotificationsHandler);

// 4. Mark single notification as read: PATCH /api/v1/notifications/:id/read & /:notificationId/read
router.patch('/:id/read', validate(notificationIdParamSchema), markNotificationReadHandler);
router.patch('/:notificationId/read', validate(notificationIdParamSchema), markNotificationReadHandler);

// 5. Delete notification: DELETE /api/v1/notifications/:id & /:notificationId
router.delete('/:id', validate(notificationIdParamSchema), deleteNotificationHandler);
router.delete('/:notificationId', validate(notificationIdParamSchema), deleteNotificationHandler);

// 6. Device token registration aliases under /notifications
router.post(
  '/device-token',
  validate(deviceRegisterSchema),
  registerNotificationDeviceTokenHandler
);
router.post(
  '/fcm-token',
  validate(deviceRegisterSchema),
  registerNotificationDeviceTokenHandler
);
router.post(
  '/token',
  validate(deviceRegisterSchema),
  registerNotificationDeviceTokenHandler
);

// 7. Send test push notification: POST /api/v1/notifications/test-push
router.post('/test-push', sendTestPushNotificationHandler);

export default router;
