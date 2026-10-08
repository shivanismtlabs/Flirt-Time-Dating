import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateProfile,
} from '../controllers/user.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getUserByIdSchema,
  updateUserSchema,
  updateProfileSchema,
} from '../schemas/user.schema';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Profile Onboarding Endpoint
router.patch('/profile', validate(updateProfileSchema), updateProfile);

// Admin / User Management Endpoints
router.get('/', authorize('admin'), getAllUsers);
router.get('/:id', validate(getUserByIdSchema), getUserById);
router.put('/:id', authorize('admin'), validate(updateUserSchema), updateUser);
router.delete('/:id', authorize('admin'), validate(getUserByIdSchema), deleteUser);

export default router;
