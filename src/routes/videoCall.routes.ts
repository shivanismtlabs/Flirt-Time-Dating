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
  getCallHistorySchema,
} from '../schemas/videoCall.schema';
import {
  initiateVideoCallHandler,
  acceptVideoCallHandler,
  rejectVideoCallHandler,
  endVideoCallHandler,
  getActiveVideoCallHandler,
  getCallHistoryHandler,
  deleteCallHandler,
} from '../controllers/videoCall.controller';

const router = Router();

// 1. GET /api/v1/calls & /api/v1/calls/history - Call history list (Calls Tab)
router.get('/', authenticate, validate(getCallHistorySchema), getCallHistoryHandler);
router.get('/history', authenticate, validate(getCallHistorySchema), getCallHistoryHandler);

// 2. GET /api/v1/calls/video/active or /api/v1/calls/active - Active ongoing call
router.get('/active', authenticate, getActiveVideoCallHandler);

// 3. POST /api/v1/calls/video/initiate or /api/v1/calls/initiate - Initiate call
router.post('/initiate', authenticate, validate(initiateVideoCallSchema), initiateVideoCallHandler);

// 4. DELETE /api/v1/calls/:callId - Delete call log entry
router.delete('/:callId', authenticate, validate(callIdParamSchema), deleteCallHandler);
router.delete('/', authenticate, validate(callIdParamSchema), deleteCallHandler);

// 5. POST /api/v1/calls/video/:callId/accept & /accept
router.post('/:callId/accept', authenticate, validate(callIdParamSchema), acceptVideoCallHandler);
router.post('/accept', authenticate, validate(callIdParamSchema), acceptVideoCallHandler);

// 6. POST /api/v1/calls/video/:callId/reject & /reject
router.post('/:callId/reject', authenticate, validate(callIdParamSchema), rejectVideoCallHandler);
router.post('/reject', authenticate, validate(callIdParamSchema), rejectVideoCallHandler);

// 7. POST /api/v1/calls/video/:callId/end & /end
router.post('/:callId/end', authenticate, validate(callIdParamSchema), endVideoCallHandler);
router.post('/end', authenticate, validate(callIdParamSchema), endVideoCallHandler);

export default router;
