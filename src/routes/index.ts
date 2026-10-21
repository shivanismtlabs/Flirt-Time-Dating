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
import deepLinkRoutes from './deepLink.routes';
import notificationRoutes from './notification.routes';
import interactionRoutes from './interaction.routes';
import deviceRoutes from './device.routes';
import coinPackageRoutes from './coinPackage.routes';
import subscriptionRoutes from './subscription.routes';
import coinRoutes from './coin.routes';
import walletRoutes from './wallet.routes';
import chatRoutes from './chat.routes';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadSelfie } from '../middlewares/upload.middleware';
import {
  uploadFaceVerification,
  getGestureVerificationInfo,
} from '../controllers/faceVerification.controller';

import { getMomentGiftsCatalogHandler } from '../controllers/moment.controller';
import { getProfile, updateProfile } from '../controllers/user.controller';
import { updateProfileSchema } from '../schemas/user.schema';
import { validate } from '../middlewares/validate.middleware';

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
router.use('/notifications', notificationRoutes);
router.use('/interactions', interactionRoutes);
router.use('/devices', deviceRoutes);
router.use('/media', mediaRoutes);
router.use('/deep-links', deepLinkRoutes);
router.use('/coin-packages', coinPackageRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/coins', coinRoutes);
router.use('/wallet', walletRoutes);
router.use('/chat', chatRoutes);

// General Gifts Catalog API: /api/v1/gifts
router.get('/gifts', authenticate, getMomentGiftsCatalogHandler);

// Direct Laravel-compatible gesture endpoints: /api/v1/gesture-upload, /api/gesture-upload, /api/v1/gesture
router.get('/gesture-upload', authenticate, getGestureVerificationInfo);
router.post('/gesture-upload', authenticate, handleUploadSelfie, uploadFaceVerification);
router.get('/gesture', authenticate, getGestureVerificationInfo);
router.post('/gesture', authenticate, handleUploadSelfie, uploadFaceVerification);

// Direct Profile aliases: /api/v1/profile, /api/profile
router.get('/profile', authenticate, getProfile);
router.patch('/profile', authenticate, validate(updateProfileSchema), updateProfile);
router.put('/profile', authenticate, validate(updateProfileSchema), updateProfile);

export default router;
