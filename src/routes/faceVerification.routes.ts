import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadSelfie } from '../middlewares/upload.middleware';
import { uploadFaceVerification } from '../controllers/faceVerification.controller';

const router = Router();

// POST /api/v1/face-verification/upload
router.post('/upload', authenticate, handleUploadSelfie, uploadFaceVerification);

// POST /api/v1/face-verification/gesture-upload
router.post('/gesture-upload', authenticate, handleUploadSelfie, uploadFaceVerification);

export default router;
