import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadSelfie } from '../middlewares/upload.middleware';
import {
  uploadFaceVerification,
  getGestureVerificationInfo,
} from '../controllers/faceVerification.controller';

const router = Router();

// GET & POST /api/v1/face-verification/upload
router.get('/upload', authenticate, getGestureVerificationInfo);
router.post('/upload', authenticate, handleUploadSelfie, uploadFaceVerification);

// GET & POST /api/v1/face-verification/gesture-upload
router.get('/gesture-upload', authenticate, getGestureVerificationInfo);
router.post('/gesture-upload', authenticate, handleUploadSelfie, uploadFaceVerification);

// GET /api/v1/face-verification/status
router.get('/status', authenticate, getGestureVerificationInfo);

export default router;
