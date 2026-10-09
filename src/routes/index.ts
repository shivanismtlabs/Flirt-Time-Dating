import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import faceVerificationRoutes from './faceVerification.routes';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadSelfie } from '../middlewares/upload.middleware';
import { uploadFaceVerification } from '../controllers/faceVerification.controller';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/face-verification', faceVerificationRoutes);

// Direct Laravel-compatible gesture-upload endpoint: POST /api/v1/gesture-upload (and /api/gesture-upload)
router.post('/gesture-upload', authenticate, handleUploadSelfie, uploadFaceVerification);

export default router;
