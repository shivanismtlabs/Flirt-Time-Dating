import { Router } from 'express';
import {
  createConnectionRequestHandler,
  registerDeviceTokenHandler,
} from '../controllers/connection.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createConnectionRequestSchema,
  registerDeviceTokenSchema,
} from '../schemas/connection.schema';

const router = Router();

// All connection routes require authentication
router.use(authenticate);

// 1. Send connection request
router.post(
  '/request',
  validate(createConnectionRequestSchema),
  createConnectionRequestHandler
);

// 2. Register FCM device token
router.post(
  '/device-token',
  validate(registerDeviceTokenSchema),
  registerDeviceTokenHandler
);

export default router;
