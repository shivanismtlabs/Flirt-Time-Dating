import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateProfile,
  getProfile,
  getOtherUserProfileHandler,
  blockUserHandler,
  reportUserHandler,
  getMoreAboutMeHandler,
  updateMoreAboutMeHandler,
} from '../controllers/user.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getUserByIdSchema,
  updateUserSchema,
  updateProfileSchema,
  updateMoreAboutMeSchema,
  getOtherUserProfileSchema,
  blockUserSchema,
  reportUserSchema,
} from '../schemas/user.schema';
import { getUserMomentsHandler } from '../controllers/moment.controller';
import { getUserMomentsSchema } from '../schemas/moment.schema';
import { registerDeviceTokenHandler } from '../controllers/connection.controller';
import { registerDeviceTokenSchema } from '../schemas/connection.schema';
import { handleUploadProfilePhoto } from '../middlewares/upload.middleware';
import { uploadProfilePhoto } from '../controllers/onboarding.controller';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Device token registration for push notifications (and aliases)
router.post('/device-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/fcm-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);

// Profile Onboarding Endpoints
router.get('/profile', (req, res) => getProfile(req, res));
router.patch('/profile', validate(updateProfileSchema), updateProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);
router.post('/profile-photo', handleUploadProfilePhoto, uploadProfilePhoto);

// More About Me Screen Endpoints
router.get('/more-about-me', getMoreAboutMeHandler);
router.patch('/more-about-me', validate(updateMoreAboutMeSchema), updateMoreAboutMeHandler);
router.put('/more-about-me', validate(updateMoreAboutMeSchema), updateMoreAboutMeHandler);

// Target / Other User Profile Detail Screen
router.get('/:userId/profile', validate(getOtherUserProfileSchema), (req, res) => getOtherUserProfileHandler(req, res));

// User Visible Moments Thumbnails Screen
router.get(
  '/:userId/moments',
  validate(getUserMomentsSchema),
  (req, res) => getUserMomentsHandler(req, res)
);

// Moderation Endpoints: Block and Report User
router.post('/:userId/block', validate(blockUserSchema), blockUserHandler);
router.post('/:userId/report', validate(reportUserSchema), reportUserHandler);

// Admin / User Management Endpoints
router.get('/', authorize('admin'), getAllUsers);
router.get('/:id', validate(getUserByIdSchema), getUserById);
router.put('/:id', authorize('admin'), validate(updateUserSchema), updateUser);
router.delete('/:id', authorize('admin'), validate(getUserByIdSchema), deleteUser);

export default router;
