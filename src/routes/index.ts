import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import faceVerificationRoutes from './faceVerification.routes';
import onboardingRoutes from './onboarding.routes';
import discoveryRoutes from './discovery.routes';
import interestRoutes from './interest.routes';
import momentRoutes from './moment.routes';
import quickMomentRoutes from './quickMoment.routes';
import connectionRoutes from './connection.routes';
import mediaRoutes from './media.routes';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadSelfie } from '../middlewares/upload.middleware';
import { uploadFaceVerification } from '../controllers/faceVerification.controller';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/face-verification', faceVerificationRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/discovery', discoveryRoutes);
router.use('/interests', interestRoutes);
router.use('/moments', momentRoutes);
router.use('/quick-moments', quickMomentRoutes);
router.use('/connections', connectionRoutes);
router.use('/media', mediaRoutes);

// Direct Laravel-compatible gesture-upload endpoint: POST /api/v1/gesture-upload (and /api/gesture-upload)
router.post('/gesture-upload', authenticate, handleUploadSelfie, uploadFaceVerification);

export default router;
