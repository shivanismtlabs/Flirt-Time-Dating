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

    const { UserPhoto, Interest } = await import('../models');
    const { momentService } = await import('../services/moment.service');

    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password'] },
      include: [
        {
          model: Interest,
          as: 'interests',
          through: { attributes: [] },
          where: { isActive: true },
          required: false,
        },
        {
          model: UserPhoto,
          as: 'photos',
          where: { status: 'approved' },
          required: false,
        },
      ],
      order: [
        [{ model: UserPhoto, as: 'photos' }, 'displayOrder', 'ASC'],
        [{ model: UserPhoto, as: 'photos' }, 'createdAt', 'DESC'],
      ],
    });

    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    let moments: any[] = [];
    try {
      const myMomentsResult = await momentService.getUserMoments(userId, userId, {
        limit: 20,
      });
      moments = myMomentsResult.moments || [];
    } catch {}

    const profileResponse = {
      ...user.toJSON(),
      moments,
    };

    return sendSuccess(res, 'Profile retrieved successfully', profileResponse);
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

/**
 * Controller to retrieve list of blocked users
 * GET /api/v1/users/blocked (and /api/users/blocked)
 */
export const getBlockedUsersHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const blockedUsers = await moderationService.getBlockedUsers(userId);

    return sendSuccess(res, 'Blocked users retrieved successfully', {
      blockedUsers,
      total: blockedUsers.length,
    });
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching blocked users', 500);
  }
};

/**
 * Controller to retrieve list of reports
 * GET /api/v1/users/reports (and /api/users/reports)
 */
export const getUserReportsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const reports = await moderationService.getUserReports(userId, req.user?.role);

    return sendSuccess(res, 'Reports retrieved successfully', {
      reports,
      total: reports.length,
    });
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching reports', 500);
  }
};

/**
 * Controller to block a user via POST /api/v1/users/blocked (with targetUserId in body)
 */
export const blockUserBodyHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockerId = req.user?.id;
    if (!blockerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = (req.body?.targetUserId || req.body?.userId) as string;
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
 * Controller to report a user via POST /api/v1/users/reports (with targetUserId in body)
 */
export const reportUserBodyHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reporterId = req.user?.id;
    if (!reporterId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = (req.body?.targetUserId || req.body?.userId) as string;
    const { reason, description } = req.body;

    const result = await moderationService.reportUser(
      reporterId,
      targetUserId,
      reason,
      description
    );

    const targetUser = await User.findByPk(targetUserId, {
      attributes: ['id', 'username', 'fullName', 'firstName', 'lastName'],
    });

    const targetFullName =
      targetUser?.fullName ||
      (targetUser?.firstName && targetUser?.lastName
        ? `${targetUser.firstName} ${targetUser.lastName}`
        : targetUser?.firstName || null);

    return sendSuccess(res, 'Report submitted successfully', {
      reportId: result.reportId,
      status: result.status,
      targetUserId,
      username: targetUser?.username || null,
      fullName: targetFullName,
    });
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
