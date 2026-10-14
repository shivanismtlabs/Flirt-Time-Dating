import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  registerDeviceHandler,
  unregisterDeviceHandler,
} from '../controllers/device.controller';
import {
  deviceRegisterSchema,
  deviceUnregisterSchema,
} from '../schemas/notification.schema';

const router = Router();

// All device routes require authentication
router.use(authenticate);

// 1. POST /api/v1/devices/register
router.post('/register', validate(deviceRegisterSchema), registerDeviceHandler);

// 2. DELETE /api/v1/devices/unregister
router.delete('/unregister', validate(deviceUnregisterSchema), unregisterDeviceHandler);

export default router;
