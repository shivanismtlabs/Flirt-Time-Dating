import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { momentService, MomentServiceError } from '../services/moment.service';
import {
  moderationService,
  ModerationServiceError,
} from '../services/moderation.service';

/**
 * Controller to create and publish a new Moment
 * POST /api/v1/moments
 */
export const createMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const creatorId = req.user?.id;
    if (!creatorId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    // Extract uploaded files from Multer
    let files: Express.Multer.File[] = [];
    if (req.files) {
      if (Array.isArray(req.files)) {
        files = req.files;
      } else {
        const fileFields = req.files as Record<string, Express.Multer.File[]>;
        if (fileFields.images) {
          files = files.concat(fileFields.images);
        }
        if (fileFields.image) {
          files = files.concat(fileFields.image);
        }
      }
    }

    const {
      caption,
      audience,
      locationLabel,
      location,
      imageKey,
      imageKeys,
      mediaUrls,
      mediaUrl,
      images,
    } = req.body || {};

    // Resolve location label from string or location object
    let resolvedLocation: string | null = null;
    if (typeof location === 'string' && location.trim()) {
      resolvedLocation = location.trim();
    } else if (location && typeof location === 'object' && location.name) {
      resolvedLocation = String(location.name).trim();
    } else if (typeof locationLabel === 'string' && locationLabel.trim()) {
      resolvedLocation = locationLabel.trim();
    }

    // Collect pre-uploaded URLs or S3 keys
    let preUploadedUrls: string[] = [];

    if (typeof imageKey === 'string' && imageKey.trim()) {
      preUploadedUrls.push(imageKey.trim());
    }

    if (Array.isArray(imageKeys)) {
      preUploadedUrls = preUploadedUrls.concat(
        imageKeys.filter((k) => typeof k === 'string' && k.trim())
      );
    } else if (typeof imageKeys === 'string' && imageKeys.trim()) {
      preUploadedUrls.push(imageKeys.trim());
    }

    if (Array.isArray(mediaUrls)) {
      preUploadedUrls = preUploadedUrls.concat(mediaUrls);
    } else if (typeof mediaUrls === 'string' && mediaUrls.trim()) {
      preUploadedUrls.push(mediaUrls.trim());
    }

    if (Array.isArray(images)) {
      preUploadedUrls = preUploadedUrls.concat(
        images.filter((img) => typeof img === 'string')
      );
    } else if (typeof images === 'string' && images.trim()) {
      preUploadedUrls.push(images.trim());
    }

    if (
      typeof mediaUrl === 'string' &&
      mediaUrl.trim() &&
      !preUploadedUrls.includes(mediaUrl.trim())
    ) {
      preUploadedUrls.push(mediaUrl.trim());
    }

    const result = await momentService.createMoment({
      creatorId,
      caption,
      audience,
      locationLabel: resolvedLocation,
      files,
      mediaUrls: preUploadedUrls,
    });

    return sendSuccess(res, 'Moment published successfully', result, 201);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(
      res,
      error.message || 'Error publishing Moment',
      error.statusCode || 500
    );
  }
};

/**
 * Controller to fetch all active moments for the discovery / stories feed
 * GET /api/v1/moments (supports scope=others, scope=self, scope=matches, scope=all)
 */
export const getAllMomentsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { page, limit, type, scope } = req.query as any;

    const result = await momentService.getAllMoments(viewerId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as 'feed' | 'stories',
      scope: scope as 'all' | 'others' | 'self' | 'matches' | 'friends',
    });

    return sendSuccess(res, 'Moments retrieved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(
      res,
      error.message || 'Error fetching moments feed',
      error.statusCode || 500
    );
  }
};

/**
 * Controller to fetch authenticated user's own moments
 * GET /api/v1/moments/me, GET /api/v1/moments/my
 */
export const getMyMomentsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { page, limit } = req.query as any;

    const result = await momentService.getUserMoments(viewerId, viewerId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return sendSuccess(res, 'My moments fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching your moments', 500);
  }
};

/**
 * Controller to fetch an individual user's moments
 * GET /api/v1/moments/user/:userId, GET /api/v1/users/:userId/moments
 */
export const getUserMomentsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const rawUserId = req.params.userId as string;
    const targetUserId = rawUserId === 'me' ? viewerId : rawUserId;
    const { page, limit } = req.query as any;

    const result = await momentService.getUserMoments(viewerId, targetUserId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return sendSuccess(res, 'User moments fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching user moments', 500);
  }
};

/**
 * Controller to retrieve full-screen Moment details
 * GET /api/v1/moments/:momentId
 */
export const getMomentDetailHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;

    const result = await momentService.getMomentDetail(viewerId, momentId);

    return sendSuccess(res, 'Moment fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching moment details', 500);
  }
};

/**
 * Controller to react to a Moment
 * POST /api/v1/moments/:momentId/reactions
 */
export const reactMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { reaction } = req.body;

    const result = await momentService.reactToMoment(
      viewerId,
      momentId,
      reaction
    );

    return sendSuccess(res, 'Reaction saved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error saving moment reaction', 500);
  }
};

/**
 * Controller to send a direct reply to a Moment
 * POST /api/v1/moments/:momentId/replies
 */
export const replyMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const senderId = req.user?.id;
    if (!senderId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { message } = req.body;

    const result = await momentService.replyToMoment(
      senderId,
      momentId,
      message
    );

    return sendSuccess(res, 'Reply sent successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error replying to moment', 500);
  }
};

/**
 * Controller to securely report a Moment
 * POST /api/v1/moments/:momentId/report
 */
export const reportMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const reporterId = req.user?.id;
    if (!reporterId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { reason, description } = req.body || {};

    const result = await moderationService.reportMoment(
      reporterId,
      momentId,
      reason,
      description
    );

    return sendSuccess(res, 'Moment reported successfully', result, 201);
  } catch (error: any) {
    if (error instanceof ModerationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(
      res,
      error.message || 'Error submitting Moment report',
      error.statusCode || 500
    );
  }
};
