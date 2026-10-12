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

    const { caption, audience, locationLabel } = req.body || {};

    const result = await momentService.createMoment({
      creatorId,
      caption,
      audience,
      locationLabel,
      files,
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
 * GET /api/v1/moments
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

    const { page, limit, type } = req.query as any;

    const result = await momentService.getAllMoments(viewerId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      type: type as 'feed' | 'stories',
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
 * Controller to fetch a user's visible Moment thumbnails
 * GET /api/v1/users/:userId/moments
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

    const targetUserId = req.params.userId as string;

    const result = await momentService.getUserMoments(viewerId, targetUserId);

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
