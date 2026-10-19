import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User, DEFAULT_NOTIFY_SETTINGS, NotificationSettings } from '../models/user.model';
import { UserDevice } from '../models/userDevice.model';
import { NotificationSetting } from '../models/notificationSetting.model';
import { notificationService } from '../services/notification.service';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  updateUserProfile,
  ServiceError,
  getOtherUserProfile,
  getOtherUserPhotos,
  calculateProfileCompletion,
  parseLocation,
  formatMoreAboutMe,
} from '../services/user.service';
import {
  moderationService,
  ModerationServiceError,
} from '../services/moderation.service';
import { s3Service, formatMediaUrl, formatThumbnailUrl, extractS3Key } from '../services/s3.service';
import { calculateAge } from '../services/discovery.service';
import { otpService } from '../services/otp.service';
import { normalizeEmail } from '../utils/normalization';
import { combineAndNormalizePhone, normalizePhone } from '../utils/phone';

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

    const rawBody = req.body || {};
    const nestedProfile =
      typeof rawBody.profile === 'object' && rawBody.profile !== null
        ? rawBody.profile
        : typeof rawBody.user === 'object' && rawBody.user !== null
        ? rawBody.user
        : {};

    const payload = {
      ...nestedProfile,
      ...rawBody,
    };

    const updatedProfile = await updateUserProfile(userId, payload);

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

    const coverPhotoKey =
      user.coverPicture ||
      (rawUser.photos || []).find(
        (p: any) => !p.isPrimary && p.imageUrl !== primaryPhotoKey
      )?.imageUrl ||
      (rawUser.photos && rawUser.photos.length > 1 ? rawUser.photos[1]?.imageUrl : null) ||
      null;

    const coverPhoto = coverPhotoKey
      ? {
          url: formatMediaUrl(coverPhotoKey),
          thumbnailUrl: formatThumbnailUrl(coverPhotoKey),
        }
      : null;

    // 2. Display Name, Age, Location and Profile Completion Calculation
    const displayName =
      user.nickName ||
      user.firstName ||
      (user.fullName ? user.fullName.split(' ')[0] : null) ||
      user.username;

    const age = calculateAge(user.dateOfBirth);
    const location = parseLocation(user.city, user.latitude, user.longitude);
    const completionPercentage = calculateProfileCompletion(
      user,
      (rawUser.interests || []).length,
      (rawUser.photos || []).length
    );

    // 3. User Selected Interests
    const formattedInterests = (rawUser.interests || []).map(
      (interest: any, index: number) => ({
        id: interest.id,
        interestId: interest.id,
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
        duration: user.voicePromptDuration ?? 30,
        durationSeconds: user.voicePromptDuration ?? 30,
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

    let userNotifySettings = user.notificationSettings || DEFAULT_NOTIFY_SETTINGS;
    try {
      const settingRecord = await NotificationSetting.findOne({ where: { userId } });
      if (settingRecord) {
        userNotifySettings = {
          ...userNotifySettings,
          ...settingRecord.toResponseJSON(),
        };
      }
    } catch {}

    const profileData = {
      id: user.id,
      username: user.username,
      displayName,
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      nickName: user.nickName || null,
      email: user.email || null,
      phone: user.phone || null,
      isPhoneVerified: !!user.isPhoneVerified,
      dateOfBirth: user.dateOfBirth || null,
      age,
      gender: user.gender || null,
      bio: user.about || null,
      location,
      city: user.city || null,
      state: location.state || null,
      country: location.country || null,
      county: location.county || null,
      fullLocation: location.fullLocation || user.city || null,
      latitude: user.latitude ?? null,
      longitude: user.longitude ?? null,
      profilePhoto: primaryProfilePhoto,
      profilePicture: primaryPhotoKey ? formatMediaUrl(primaryPhotoKey) : null,
      coverPhoto,
      coverPicture: coverPhotoKey ? formatMediaUrl(coverPhotoKey) : null,
      coverPhotoUrl: coverPhotoKey ? formatMediaUrl(coverPhotoKey) : null,
      coverPictureKey: user.coverPicture || null,
      photos: formattedPhotos,
      interests: formattedInterests,
      isVerified: !!user.isFaceVerified,
      completionPercentage,
      // Subscription & Wallet fields
      isSubscribed: !!user.isSubscribed,
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
      activeSubscriptionPlanId: user.activeSubscriptionPlanId || null,
      coins: typeof user.coins === 'number' ? user.coins : 0,
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
      children: user.children || null,
      moreAboutMe,
      notify_settings: userNotifySettings,
      notificationSettings: userNotifySettings,
    };

    // 8. Clean response payload with no internal or redundant data
    const profileResponse = {
      id: user.id,
      username: user.username,
      isSubscribed: !!user.isSubscribed,
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
      activeSubscriptionPlanId: user.activeSubscriptionPlanId || null,
      coins: typeof user.coins === 'number' ? user.coins : 0,
      profilePhoto: primaryProfilePhoto,
      profilePicture: primaryPhotoKey ? formatMediaUrl(primaryPhotoKey) : null,
      coverPhoto,
      coverPicture: coverPhotoKey ? formatMediaUrl(coverPhotoKey) : null,
      coverPhotoUrl: coverPhotoKey ? formatMediaUrl(coverPhotoKey) : null,
      profile: profileData,
      location,
      city: user.city || null,
      state: location.state || null,
      country: location.country || null,
      county: location.county || null,
      fullLocation: location.fullLocation || user.city || null,
      latitude: user.latitude ?? null,
      longitude: user.longitude ?? null,
      moreAboutMe,
      interests: formattedInterests,
      moments: permanentMoments,
      voiceIntro,
      quickMoments: quickMomentsSummary,
      notify_settings: user.notificationSettings || DEFAULT_NOTIFY_SETTINGS,
      notificationSettings: user.notificationSettings || DEFAULT_NOTIFY_SETTINGS,
    };

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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

    if (viewerUserId !== targetUserId) {
      // Asynchronously dispatch profile visit notification without blocking profile response
      const viewerUser = req.user as any;
      const viewerName =
        viewerUser?.firstName || viewerUser?.nickName || viewerUser?.username || 'Someone';
      notificationService
        .sendProfileVisitNotification(targetUserId, {
          visitorId: viewerUserId,
          visitorName: viewerName,
        })
        .catch((err) => {
          console.warn('[Profile Visit Notification Warn]:', err.message);
        });
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return sendSuccess(res, 'Profile fetched successfully', profileData);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, 'Error fetching profile', 500);
  }
};

/**
 * Controller to retrieve another user's photos gallery
 * GET /api/v1/users/:userId/photos (and /api/users/:userId/photos)
 */
export const getOtherUserPhotosHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const viewerUserId = req.user?.id;

    if (!viewerUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    if (!targetUserId) {
      return sendError(res, 'Target user ID is required', 400);
    }

    const photosData = await getOtherUserPhotos(viewerUserId, targetUserId);

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return sendSuccess(res, 'Profile photos retrieved successfully', photosData);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, 'Error fetching user photos', 500);
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
    const { reason, description, conversationId } = req.body;

    const result = await moderationService.reportUser(
      reporterId,
      targetUserId,
      reason,
      description,
      conversationId
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

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

    const result = await moderationService.getBlockedUsers(userId, { page, limit });
    return sendSuccess(res, 'Blocked users retrieved successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error retrieving blocked users', 500);
  }
};

/**
 * Controller to unblock a user
 * DELETE /api/v1/users/:userId/block (and POST /api/v1/users/:userId/unblock)
 */
export const unblockUserHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const blockerId = req.user?.id;
    if (!blockerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    const result = await moderationService.unblockUser(blockerId, targetUserId);

    return sendSuccess(res, 'User unblocked successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error processing unblock request', 500);
  }
};

/**
 * Controller to retrieve reports filed by authenticated user
 * GET /api/v1/users/reports (and /api/v1/reports/my-reports)
 */
export const getUserReportsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const status = req.query.status as string | undefined;
    const targetType = req.query.targetType as string | undefined;

    const result = await moderationService.getUserReports(userId, {
      page,
      limit,
      status,
      targetType,
    });

    return sendSuccess(res, 'Reports retrieved successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error retrieving reports', 500);
  }
};

/**
 * Controller to retrieve all reports for moderation/admin dashboard
 * GET /api/v1/moderation/reports (and /api/v1/reports)
 */
export const getAllReportsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const status = req.query.status as string | undefined;
    const targetType = req.query.targetType as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await moderationService.getAllReports({
      page,
      limit,
      status,
      targetType,
      search,
    });

    return sendSuccess(res, 'Moderation reports retrieved successfully', result);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error retrieving moderation reports', 500);
  }
};

/**
 * Controller to update report status (admin/moderator)
 * PATCH /api/v1/reports/:reportId/status
 */
export const updateReportStatusHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reportId = req.params.reportId as string;
    const { status, reviewNotes } = req.body;

    const result = await moderationService.updateReportStatus(reportId, status, reviewNotes);

    return sendSuccess(res, 'Report status updated successfully', { report: result });
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, 'Error updating report status', 500);
  }
};

/**
 * Controller to retrieve standard report reasons list
 * GET /api/v1/reports/reasons (and /api/v1/users/report-reasons)
 */
export const getReportReasonsHandler = async (_req: Request, res: Response) => {
  try {
    const reasons = moderationService.getReportReasons();
    return sendSuccess(res, 'Report reasons retrieved successfully', reasons);
  } catch (error: any) {
    return sendError(res, 'Error retrieving report reasons', 500);
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

/**
 * Dedicated cover photo upload handler
 * POST /api/v1/users/cover-photo (and aliases)
 */
export const uploadCoverPhotoHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const photoFile =
      files?.['coverPhoto']?.[0] ||
      files?.['coverPicture']?.[0] ||
      files?.['cover_photo']?.[0] ||
      files?.['cover_picture']?.[0] ||
      files?.['cover']?.[0] ||
      files?.['photo']?.[0] ||
      files?.['image']?.[0] ||
      files?.['file']?.[0] ||
      req.file;

    const { imageKey, imageUrl } = req.body || {};
    const preUploadedKey = imageKey || imageUrl;

    if ((!photoFile || !photoFile.buffer || photoFile.buffer.length === 0) && !preUploadedKey) {
      return sendError(
        res,
        'Cover image is required. Attach image in "coverPhoto" field or pass "imageKey"',
        400,
        'MISSING_FILE'
      );
    }

    let s3Key: string;
    if (photoFile && photoFile.buffer && photoFile.buffer.length > 0) {
      s3Key = await s3Service.uploadMedia(
        photoFile.buffer,
        userId,
        photoFile.mimetype || 'image/jpeg',
        'covers'
      );
      await s3Service.generateAndUploadThumbnail(s3Key, photoFile.buffer);
    } else {
      const cleanKey = extractS3Key(preUploadedKey);
      if (!cleanKey.startsWith(`${userId}/`) && !cleanKey.includes(`/${userId}/`)) {
        return sendError(res, 'You are not authorized to use this image key', 403, 'UNAUTHORIZED_IMAGE_KEY');
      }
      const existsMeta = await s3Service.checkObjectExists(cleanKey);
      if (!existsMeta.exists) {
        return sendError(res, 'Uploaded cover image not found in storage', 400, 'S3_OBJECT_NOT_FOUND');
      }
      s3Key = cleanKey;
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    const oldCover = user.coverPicture;
    user.coverPicture = s3Key;
    await user.save();

    if (oldCover && oldCover !== s3Key) {
      s3Service.deleteObject(oldCover).catch(() => {});
    }

    const coverUrl = formatMediaUrl(s3Key);
    const thumbnailUrl = formatThumbnailUrl(s3Key);

    return sendSuccess(
      res,
      'Cover picture uploaded successfully',
      {
        coverPicture: coverUrl,
        coverPictureUrl: coverUrl,
        coverPhotoUrl: coverUrl,
        thumbnailUrl,
        key: s3Key,
        coverPhoto: {
          url: coverUrl,
          thumbnailUrl,
        },
      },
      201
    );
  } catch (err: any) {
    return sendError(res, err.message || 'Error uploading cover picture', 500);
  }
};

/**
 * Request an Email OTP to add or update email from Profile Edit
 * POST /api/v1/users/profile/email/request-otp
 */
export const requestProfileEmailOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !email.trim()) {
      return sendError(res, 'Email is required', 400);
    }

    const normalizedEmail = normalizeEmail(email);

    // Check if this email is already registered to another account
    const conflictUser = await User.findOne({
      where: {
        email: normalizedEmail,
        id: { [Op.ne]: userId },
      },
    });

    if (conflictUser) {
      return sendError(
        res,
        'This email address is already associated with another account',
        409,
        'EMAIL_ALREADY_IN_USE'
      );
    }

    const result = await otpService.requestEmailOtp(normalizedEmail, {
      purpose: 'profile_email_change',
      userId,
    });

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      'Verification code sent to your email',
      { ...result.data, email: normalizedEmail },
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Error requesting email OTP', 500);
  }
};

/**
 * Verify Email OTP from Profile Edit and update user's email
 * POST /api/v1/users/profile/email/verify-otp
 */
export const verifyProfileEmailOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { otp, verificationId, email } = req.body || {};

    const result = await otpService.verifyProfileEmailOtp(
      userId,
      otp,
      verificationId,
      email
    );

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      result.message || 'Email verified and updated successfully',
      result.data,
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Error verifying email OTP', 500);
  }
};

/**
 * Resend Email OTP for profile email verification
 * POST /api/v1/users/profile/email/resend-otp
 */
export const resendProfileEmailOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { verificationId, email } = req.body || {};

    if (verificationId) {
      const result = await otpService.resendEmailOtp(verificationId, {
        purpose: 'profile_email_change',
        userId,
      });
      if (result.error) {
        return sendError(res, result.error, result.statusCode);
      }
      return sendSuccess(res, 'Verification code resent successfully', result.data, result.statusCode);
    }

    if (email) {
      const normalizedEmail = normalizeEmail(email);
      const conflictUser = await User.findOne({
        where: {
          email: normalizedEmail,
          id: { [Op.ne]: userId },
        },
      });

      if (conflictUser) {
        return sendError(
          res,
          'This email address is already associated with another account',
          409,
          'EMAIL_ALREADY_IN_USE'
        );
      }

      const result = await otpService.requestEmailOtp(normalizedEmail, {
        purpose: 'profile_email_change',
        userId,
      });
      if (result.error) {
        return sendError(res, result.error, result.statusCode);
      }
      return sendSuccess(
        res,
        'Verification code resent successfully',
        { ...result.data, email: normalizedEmail },
        result.statusCode
      );
    }

    return sendError(res, 'Either verificationId or email must be provided', 400);
  } catch (error: any) {
    return sendError(res, error.message || 'Error resending email OTP', 500);
  }
};

/**
 * Request a Phone OTP to add or update phone from Profile Edit
 * POST /api/v1/users/profile/phone/request-otp
 */
export const requestProfilePhoneOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { phone, countryCode } = req.body || {};
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return sendError(res, 'Phone number is required', 400);
    }

    const normalizedPhone = phone.trim().startsWith('+')
      ? normalizePhone(phone)
      : combineAndNormalizePhone(countryCode || '+91', phone);

    if (!normalizedPhone || normalizedPhone.length < 5) {
      return sendError(res, 'Invalid phone number format', 400);
    }

    // Check if this phone is already registered to another account
    const conflictUser = await User.findOne({
      where: {
        phone: normalizedPhone,
        id: { [Op.ne]: userId },
      },
    });

    if (conflictUser) {
      return sendError(
        res,
        'This phone number is already associated with another account',
        409,
        'PHONE_ALREADY_IN_USE'
      );
    }

    const cc = countryCode ? (countryCode.startsWith('+') ? countryCode : `+${countryCode}`) : '+91';
    const cleanCountry = cc.replace(/\D/g, '');
    let cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanCountry && cleanPhone.startsWith(cleanCountry) && cleanPhone.length > cleanCountry.length) {
      cleanPhone = cleanPhone.slice(cleanCountry.length);
    }
    const result = await otpService.requestPhoneOtp(cc, cleanPhone, {
      purpose: 'profile_phone_change',
      userId,
    });

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      'Verification code sent to your phone number',
      { ...result.data, phone: normalizedPhone },
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Error requesting phone OTP', 500);
  }
};

/**
 * Verify Phone OTP from Profile Edit and update user's phone
 * POST /api/v1/users/profile/phone/verify-otp
 */
export const verifyProfilePhoneOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { otp, verificationId, phone, countryCode } = req.body || {};

    const result = await otpService.verifyProfilePhoneOtp(
      userId,
      otp,
      verificationId,
      phone,
      countryCode
    );

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      result.message || 'Phone number verified and updated successfully',
      result.data,
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Error verifying phone OTP', 500);
  }
};

/**
 * Resend Phone OTP for profile phone verification
 * POST /api/v1/users/profile/phone/resend-otp
 */
export const resendProfilePhoneOtpHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { verificationId, phone, countryCode } = req.body || {};

    if (verificationId) {
      const result = await otpService.resendPhoneOtp(verificationId, {
        purpose: 'profile_phone_change',
        userId,
      });
      if (result.error) {
        return sendError(res, result.error, result.statusCode);
      }
      return sendSuccess(res, 'Verification code resent successfully', result.data, result.statusCode);
    }

    if (phone) {
      const normalizedPhone = phone.trim().startsWith('+')
        ? normalizePhone(phone)
        : combineAndNormalizePhone(countryCode || '+91', phone);

      const conflictUser = await User.findOne({
        where: {
          phone: normalizedPhone,
          id: { [Op.ne]: userId },
        },
      });

      if (conflictUser) {
        return sendError(
          res,
          'This phone number is already associated with another account',
          409,
          'PHONE_ALREADY_IN_USE'
        );
      }

      const cc = countryCode ? (countryCode.startsWith('+') ? countryCode : `+${countryCode}`) : '+91';
      const cleanCountry = cc.replace(/\D/g, '');
      let cleanPhone = phone.trim().replace(/\D/g, '');
      if (cleanCountry && cleanPhone.startsWith(cleanCountry) && cleanPhone.length > cleanCountry.length) {
        cleanPhone = cleanPhone.slice(cleanCountry.length);
      }
      const result = await otpService.requestPhoneOtp(cc, cleanPhone, {
        purpose: 'profile_phone_change',
        userId,
      });
      if (result.error) {
        return sendError(res, result.error, result.statusCode);
      }
      return sendSuccess(
        res,
        'Verification code resent successfully',
        { ...result.data, phone: normalizedPhone },
        result.statusCode
      );
    }

    return sendError(res, 'Either verificationId or phone must be provided', 400);
  } catch (error: any) {
    return sendError(res, error.message || 'Error resending phone OTP', 500);
  }
};

/**
 * Delete Account API
 * DELETE /api/v1/users/account (and aliases /api/v1/users/me, /api/v1/auth/delete-account)
 * Permanently removes user account, deactivates device push tokens, and cascade deletes associated data.
 */
export const deleteAccountHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    // 1. Immediately deactivate all registered devices for push notifications
    await UserDevice.update({ isActive: false }, { where: { userId } });

    // 2. Permanently delete user record (foreign keys with CASCADE clean up related records)
    await user.destroy();

    return sendSuccess(res, 'Account deleted successfully', { deleted: true });
  } catch (error: any) {
    return sendError(res, error.message || 'Error deleting account', 500);
  }
};

/**
 * Controller to get user's notification preferences
 * GET /api/v1/users/notification-settings
 */
export const getNotificationSettingsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const [setting] = await NotificationSetting.findOrCreate({
      where: { userId },
      defaults: {
        userId,
        newMessages: true,
        newMatches: true,
        likeComments: true,
        profileVisits: true,
        datingTips: false,
        pushNotifications: true,
      },
    });

    const responseData = setting.toResponseJSON();

    return sendSuccess(res, 'Notification settings fetched successfully', responseData);
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching notification settings', 500);
  }
};

/**
 * Controller to update user's notification preferences
 * PATCH /api/v1/users/notification-settings (and PUT /api/v1/users/notification-settings)
 */
export const updateNotificationSettingsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const [setting] = await NotificationSetting.findOrCreate({
      where: { userId },
      defaults: {
        userId,
        newMessages: true,
        newMatches: true,
        likeComments: true,
        profileVisits: true,
        datingTips: false,
        pushNotifications: true,
      },
    });

    const incoming =
      req.body?.notify_settings ||
      req.body?.notificationSettings ||
      req.body ||
      {};

    // 1. New Messages
    if (incoming.new_messages !== undefined) {
      setting.newMessages = Boolean(incoming.new_messages);
    } else if (incoming.new_message !== undefined) {
      setting.newMessages = Boolean(incoming.new_message);
    } else if (incoming.newMessages !== undefined) {
      setting.newMessages = Boolean(incoming.newMessages);
    }

    // 2. New Matches
    if (incoming.new_matches !== undefined) {
      setting.newMatches = Boolean(incoming.new_matches);
    } else if (incoming.newMatches !== undefined) {
      setting.newMatches = Boolean(incoming.newMatches);
    }

    // 3. Likes & comments (not for calls)
    if (incoming.like_comments !== undefined) {
      setting.likeComments = Boolean(incoming.like_comments);
    } else if (incoming.likes_comments_calls !== undefined) {
      setting.likeComments = Boolean(incoming.likes_comments_calls);
    } else if (incoming.likeComments !== undefined) {
      setting.likeComments = Boolean(incoming.likeComments);
    }

    // 4. Profile visits
    if (incoming.profile_visits !== undefined) {
      setting.profileVisits = Boolean(incoming.profile_visits);
    } else if (incoming.profile_visit !== undefined) {
      setting.profileVisits = Boolean(incoming.profile_visit);
    } else if (incoming.profileVisits !== undefined) {
      setting.profileVisits = Boolean(incoming.profileVisits);
    }

    // 5. Dating tips
    if (incoming.dating_tips !== undefined) {
      setting.datingTips = Boolean(incoming.dating_tips);
    } else if (incoming.new_tips_available !== undefined) {
      setting.datingTips = Boolean(incoming.new_tips_available);
    } else if (incoming.datingTips !== undefined) {
      setting.datingTips = Boolean(incoming.datingTips);
    }

    // 6. Global Push notifications switch
    if (incoming.push_notifications !== undefined) {
      setting.pushNotifications = Boolean(incoming.push_notifications);
    } else if (incoming.push !== undefined) {
      setting.pushNotifications = Boolean(incoming.push);
    } else if (incoming.pushNotifications !== undefined) {
      setting.pushNotifications = Boolean(incoming.pushNotifications);
    }

    await setting.save();

    const responseData = setting.toResponseJSON();

    // Also update legacy user.notificationSettings column for complete backward compatibility
    try {
      const user = await User.findByPk(userId);
      if (user) {
        user.notificationSettings = {
          ...(user.notificationSettings || DEFAULT_NOTIFY_SETTINGS),
          new_message: setting.newMessages,
          new_matches: setting.newMatches,
          likes_comments_calls: setting.likeComments,
          profile_visit: setting.profileVisits,
          new_tips_available: setting.datingTips,
          push: setting.pushNotifications,
        };
        await user.save();
      }
    } catch {}

    return sendSuccess(res, 'Notification settings updated successfully', responseData);
  } catch (error: any) {
    return sendError(res, error.message || 'Error updating notification settings', 500);
  }
};


