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
} from '../controllers/user.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getUserByIdSchema,
  updateUserSchema,
  updateProfileSchema,
  getOtherUserProfileSchema,
  blockUserSchema,
  reportUserSchema,
} from '../schemas/user.schema';
import { getUserMomentsHandler } from '../controllers/moment.controller';
import { getUserMomentsSchema } from '../schemas/moment.schema';
import { registerDeviceTokenHandler } from '../controllers/connection.controller';
import { registerDeviceTokenSchema } from '../schemas/connection.schema';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Device token registration for push notifications
router.post('/device-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);

// Profile Onboarding Endpoints
router.get('/profile', getProfile);
router.patch('/profile', validate(updateProfileSchema), updateProfile);

// Target / Other User Profile Detail Screen
router.get('/:userId/profile', validate(getOtherUserProfileSchema), getOtherUserProfileHandler);

// User Visible Moments Thumbnails Screen
router.get(
  '/:userId/moments',
  validate(getUserMomentsSchema),
  getUserMomentsHandler
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
