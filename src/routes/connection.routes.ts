import { Router } from 'express';
import {
  createConnectionRequestHandler,
  getConnectionReasonsHandler,
  registerDeviceTokenHandler,
} from '../controllers/connection.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createConnectionRequestSchema,
  getConnectionReasonsSchema,
  registerDeviceTokenSchema,
} from '../schemas/connection.schema';

const router = Router();

// All connection routes require authentication
router.use(authenticate);

// 1. Get connection reasons (Modal options: "Connect because...")
router.get(
  '/reasons',
  validate(getConnectionReasonsSchema),
  getConnectionReasonsHandler
);

// 2. Send connection request
router.post(
  '/request',
  validate(createConnectionRequestSchema),
  createConnectionRequestHandler
);

// 3. REST alias: Send connection request (POST /api/v1/connections)
router.post(
  '/',
  validate(createConnectionRequestSchema),
  createConnectionRequestHandler
);

// 4. Register FCM device token
router.post(
  '/device-token',
  validate(registerDeviceTokenSchema),
  registerDeviceTokenHandler
);

export default router;
