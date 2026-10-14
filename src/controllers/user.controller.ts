import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  updateUserProfile,
  ServiceError,
  getOtherUserProfile,
  calculateProfileCompletion,
  parseLocation,
  formatMoreAboutMe,
} from '../services/user.service';
import {
  moderationService,
  ModerationServiceError,
} from '../services/moderation.service';
import { formatMediaUrl, formatThumbnailUrl } from '../services/s3.service';
import { calculateAge } from '../services/discovery.service';

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
 * Controller to retrieve authenticated user's complete profile for Profile Screen
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

    const rawUser = user.toJSON() as any;

    // 1. Photos formatting
    const formattedPhotos = (rawUser.photos || []).map((p: any) => ({
      id: p.id,
      url: formatMediaUrl(p.imageUrl),
      thumbnailUrl: formatThumbnailUrl(p.imageUrl),
      isPrimary: !!p.isPrimary,
      displayOrder: p.displayOrder,
    }));

    const primaryPhotoObj =
      (rawUser.photos || []).find((p: any) => p.isPrimary) ||
      (rawUser.photos || [])[0];

    const primaryPhotoKey =
      rawUser.profilePicture || primaryPhotoObj?.imageUrl || null;

    const primaryProfilePhoto = primaryPhotoKey
      ? {
          url: formatMediaUrl(primaryPhotoKey),
          thumbnailUrl: formatThumbnailUrl(primaryPhotoKey),
        }
      : null;

    const coverPhotoObj =
      (rawUser.photos || []).find(
        (p: any) => !p.isPrimary && p.imageUrl !== primaryPhotoKey
      ) ||
      (rawUser.photos && rawUser.photos.length > 1 ? rawUser.photos[1] : null);

    const coverPhoto = coverPhotoObj
      ? {
          url: formatMediaUrl(coverPhotoObj.imageUrl),
          thumbnailUrl: formatThumbnailUrl(coverPhotoObj.imageUrl),
        }
      : null;

    // 2. Display Name, Age, Location and Profile Completion Calculation
    const displayName =
      user.nickName ||
      user.firstName ||
      (user.fullName ? user.fullName.split(' ')[0] : null) ||
      user.username;

    const age = calculateAge(user.dateOfBirth);
    const location = parseLocation(user.city);
    const completionPercentage = calculateProfileCompletion(
      user,
      (rawUser.interests || []).length,
      (rawUser.photos || []).length
    );

    // 3. User Selected Interests
    const formattedInterests = (rawUser.interests || []).map(
      (interest: any, index: number) => ({
        id: interest.id,
        name: interest.name,
        icon: interest.icon || null,
        displayOrder: index + 1,
      })
    );

    // 4. Permanent Moments: Maximum 4 permanent moments ordered by newest first
    let permanentMoments: any[] = [];
    try {
      const myMomentsResult = await momentService.getUserMoments(userId, userId, {
        page: 1,
        limit: 4,
      });
      const rawMoments = (myMomentsResult?.moments || []).slice(0, 4);
      permanentMoments = rawMoments.map((m: any) => ({
        id: m.id,
        caption: m.caption || '',
        createdAt: m.createdAt || m.publishedAt,
        firstImageUrl: m.firstImageUrl || m.imageUrl || null,
        thumbnailUrl: m.thumbnailUrl || null,
        imageCount: m.imageCount || m.mediaCount || 1,
        likeCount: m.likeCount ?? m.likesCount ?? 0,
        commentCount: m.commentCount ?? m.commentsCount ?? 0,
        isLiked: !!m.isLiked,
        hasMultipleImages: (m.imageCount || m.mediaCount || 1) > 1,
      }));
    } catch {}

    // 5. Voice Intro
    let voiceIntro: any = null;
    if (user.voicePromptUrl) {
      voiceIntro = {
        id: `voice-${user.id}`,
        playbackUrl: formatMediaUrl(user.voicePromptUrl),
        duration: user.voicePromptDuration || 30,
        status: 'ready',
      };
    }

    // 6. Quick Moments: 24-hr tray summary
    let quickMomentsSummary: any = {
      items: [],
      canAdd: true,
    };

    try {
      const { quickMomentService } = await import('../services/quickMoment.service');
      const trayResult = await quickMomentService.getTray(userId);

      const myStories = (trayResult.myStatus?.stories || []).map((s: any) => ({
        id: s.id,
        author: {
          id: user.id,
          name: displayName,
          avatar: primaryProfilePhoto?.thumbnailUrl || null,
          isVerified: !!user.isFaceVerified,
        },
        mediaThumbnail: s.thumbnailUrl || s.imageUrl,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt || null,
        isViewed: true,
        isSelf: true,
      }));

      const otherMomentsList = trayResult.otherUsers || (trayResult as any).tray || [];
      const otherItems = otherMomentsList.map((t: any) => ({
        id: t.firstMomentId || t.userId,
        author: {
          id: t.userId,
          name: t.name,
          avatar: t.avatar,
          isVerified: !!t.isVerified,
        },
        mediaThumbnail: t.preview?.thumbnailUrl || t.preview?.imageUrl || null,
        createdAt: t.preview?.createdAt || null,
        isViewed: !t.hasUnread,
        isSelf: false,
      }));

      quickMomentsSummary = {
        items: [...myStories, ...otherItems],
        canAdd: true,
      };
    } catch {}

    // 7. Structured Profile Object (only requested fields, no redundant data)
    const moreAboutMe = formatMoreAboutMe(user);

    const profileData = {
      id: user.id,
      displayName,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      dateOfBirth: user.dateOfBirth || null,
      age,
      gender: user.gender || null,
      bio: user.about || null,
      location,
      profilePhoto: primaryProfilePhoto,
      coverPhoto,
      photos: formattedPhotos,
      isVerified: !!user.isFaceVerified,
      completionPercentage,
      // More about me direct fields
      drinking: user.drinking || null,
      education: user.education || null,
      height: user.height || null,
      religion: user.religion || null,
      sexuality: user.sexuality || null,
      smoking: user.smoking || null,
      weight: user.weight || null,
      eyeColor: user.eyeColor || null,
      eyecolor: user.eyeColor || null,
      hairColor: user.hairColor || null,
      haircolor: user.hairColor || null,
      living: user.living || null,
      relationship: user.relationship || null,
      moreAboutMe,
    };

    // 8. Clean response payload with no internal or redundant data
    const profileResponse = {
      id: user.id,
      profile: profileData,
      moreAboutMe,
      interests: formattedInterests,
      moments: permanentMoments,
      voiceIntro,
      quickMoments: quickMomentsSummary,
    };

    return sendSuccess(res, 'Profile fetched successfully', profileResponse);
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

/**
 * Controller to get authenticated user's More About Me details
 * GET /api/v1/users/more-about-me
 */
export const getMoreAboutMeHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }
    const user = await User.findByPk(userId);
    if (!user) {
      return sendError(res, 'User not found', 404);
    }
    const moreAboutMe = formatMoreAboutMe(user);
    return sendSuccess(res, 'More about me retrieved successfully', moreAboutMe);
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching more about me', 500);
  }
};

/**
 * Controller to update authenticated user's More About Me details
 * PATCH /api/v1/users/more-about-me (and PUT /api/v1/users/more-about-me)
 */
export const updateMoreAboutMeHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }
    const updatedUser = await updateUserProfile(userId, req.body);
    return sendSuccess(res, 'More about me updated successfully', updatedUser.moreAboutMe);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error updating more about me', 500);
  }
};
