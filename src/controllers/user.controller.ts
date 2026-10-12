import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { updateUserProfile, ServiceError, getOtherUserProfile } from '../services/user.service';
import {
  moderationService,
  ModerationServiceError,
} from '../services/moderation.service';

/**
 * Controller to update authenticated user's profile (Introduce Yourself onboarding)
 * PATCH /api/v1/users/profile (and /api/users/profile)
 */
export const updateProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const updatedProfile = await updateUserProfile(userId, req.body);

    return sendSuccess(res, 'Profile updated successfully', updatedProfile);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error updating profile', 500);
  }
};

/**
 * Controller to retrieve authenticated user's profile
 * GET /api/v1/users/profile (and /api/users/profile)
 */
export const getProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    const userData = user.toJSON();

    return sendSuccess(res, 'Profile retrieved successfully', userData);
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching profile', 500);
  }
};

/**
 * Controller to retrieve another user's profile details
 * GET /api/v1/users/:userId/profile (and /api/users/:userId/profile)
 */
export const getOtherUserProfileHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const viewerUserId = req.user?.id;

    if (!viewerUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    if (!targetUserId) {
      return sendError(res, 'Target user ID is required', 400);
    }

    const profileData = await getOtherUserProfile(viewerUserId, targetUserId);

    return sendSuccess(res, 'Profile fetched successfully', profileData);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, 'Error fetching profile', 500);
  }
};

/**
 * Controller to block another user
 * POST /api/v1/users/:userId/block (and /api/users/:userId/block)
 */
export const blockUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockerId = req.user?.id;
    if (!blockerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    const { reason } = req.body || {};

    const result = await moderationService.blockUser(blockerId, targetUserId, reason);

    return sendSuccess(res, 'User blocked successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error processing block request', 500);
  }
};

/**
 * Controller to report another user for abuse or policy violations
 * POST /api/v1/users/:userId/report (and /api/users/:userId/report)
 */
export const reportUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reporterId = req.user?.id;
    if (!reporterId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    const { reason, description } = req.body;

    const result = await moderationService.reportUser(
      reporterId,
      targetUserId,
      reason,
      description
    );

    return sendSuccess(res, 'Report submitted successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error submitting report', 500);
  }
};

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']],
    });
    return sendSuccess(res, 'Users retrieved successfully', { users });
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching users', 500);
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    return sendSuccess(res, 'User retrieved successfully', { user });
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching user', 500);
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { username, email, role, isActive } = req.body;

    const user = await User.findByPk(id);
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    if (username) user.username = username;
    if (email) user.email = email;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;

    await user.save();

    return sendSuccess(res, 'User updated successfully', { user: user.toJSON() });
  } catch (error: any) {
    return sendError(res, error.message || 'Error updating user', 500);
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const user = await User.findByPk(id);

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    await user.destroy();
    return sendSuccess(res, 'User deleted successfully');
  } catch (error: any) {
    return sendError(res, error.message || 'Error deleting user', 500);
  }
};
