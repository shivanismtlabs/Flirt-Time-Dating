/**
 * FlirtTime Video Call Routes
 * Mounts endpoints for Agora video call lifecycle: initiate, accept, reject, end, active.
 */

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  initiateVideoCallSchema,
  callIdParamSchema,
} from '../schemas/videoCall.schema';
import {
  initiateVideoCallHandler,
  acceptVideoCallHandler,
  rejectVideoCallHandler,
  endVideoCallHandler,
  getActiveVideoCallHandler,
} from '../controllers/videoCall.controller';

const router = Router();

// 1. POST /api/v1/calls/video/initiate
router.post('/initiate', authenticate, validate(initiateVideoCallSchema), initiateVideoCallHandler);

// 2. GET /api/v1/calls/video/active
router.get('/active', authenticate, getActiveVideoCallHandler);

// 3. POST /api/v1/calls/video/:callId/accept
router.post('/:callId/accept', authenticate, validate(callIdParamSchema), acceptVideoCallHandler);

// 4. POST /api/v1/calls/video/:callId/reject
router.post('/:callId/reject', authenticate, validate(callIdParamSchema), rejectVideoCallHandler);

// 5. POST /api/v1/calls/video/:callId/end
router.post('/:callId/end', authenticate, validate(callIdParamSchema), endVideoCallHandler);

export default router;
