import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  quickMomentService,
  QuickMomentServiceError,
} from '../services/quickMoment.service';
import { s3Service } from '../services/s3.service';

/**
 * GET /api/v1/quick-moments/tray (and /api/v1/quick-moments)
 * Screen 1: Quick Moments story tray / bar with active story avatars, unread rings, and reaction badges
 */
export const getTrayHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const result = await quickMomentService.getTray(viewerId);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return sendSuccess(res, 'Quick moments tray fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching quick moments tray', 500);
  }
};

/**
 * GET /api/v1/quick-moments/me
 * Screen 2: View our own active Quick Moments with story progress bars, reaction summary badge ("😍🔥 3 · 💬 2 replies"), and up-drawer data
 */
export const getMyQuickMomentsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const result = await quickMomentService.getMyQuickMoments(viewerId);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return sendSuccess(res, 'My quick moments fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching my quick moments', 500);
  }
};

/**
 * GET /api/v1/quick-moments/user/:userId
 * Screen 3: View other user's (e.g. Cindy) active Quick Moments with media, caption, location, reaction emojis bar, and reply input
 */
export const getUserQuickMomentsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const userId = req.params.userId as string;
    const targetUserId = userId === 'me' ? viewerId : userId;

    if (targetUserId === viewerId) {
      const result = await quickMomentService.getMyQuickMoments(viewerId);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return sendSuccess(res, 'My quick moments fetched successfully', result, 200);
    }

    if (req.query.markViewed === 'true' || req.query.markViewed === '1') {
      try {
        await quickMomentService.markUserMomentsViewed(viewerId, targetUserId);
      } catch {
        // Best effort
      }
    }

    const result = await quickMomentService.getUserQuickMoments(viewerId, targetUserId);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return sendSuccess(res, 'User quick moments fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching user quick moments', 500);
  }
};

/**
 * GET /api/v1/quick-moments/:momentId/reactions
 * Screen 1 reaction list popup: "1 image me jo reaction wo kisne hme reaction diye wo he if more than willopen list"
 * Returns who gave reactions to this quick moment with user info, emoji, and timestamps
 */
export const getQuickMomentReactionsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { page, limit, emoji } = req.query as any;

    const result = await quickMomentService.getQuickMomentReactions(
      viewerId,
      momentId,
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        emoji: emoji ? String(emoji) : undefined,
      }
    );

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return sendSuccess(res, 'Quick moment reactions fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching quick moment reactions', 500);
  }
};

/**
 * POST /api/v1/quick-moments/:momentId/react
 * React to a quick moment with emoji (😍, 🔥, 😂, 😮, 👏, ❤️)
 */
export const reactQuickMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const emoji = req.body.emoji || req.body.reaction;

    const result = await quickMomentService.reactToQuickMoment(
      viewerId,
      momentId,
      emoji
    );

    return sendSuccess(res, `Reaction ${result.action} successfully`, result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error reacting to quick moment', 500);
  }
};

/**
 * POST /api/v1/quick-moments/:momentId/reply
 * Reply to a quick moment
 */
export const replyQuickMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { message } = req.body;

    const result = await quickMomentService.replyToQuickMoment(
      viewerId,
      momentId,
      message
    );

    return sendSuccess(res, 'Reply sent successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error replying to quick moment', 500);
  }
};

/**
 * GET /api/v1/quick-moments/:momentId/replies?page=1&limit=30
 * Owner activity sheet: replies, viewers, and reactions for one quick moment.
 */
export const getQuickMomentRepliesHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { page, limit } = req.query as any;

    const result = await quickMomentService.getQuickMomentReplies(viewerId, momentId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return sendSuccess(res, 'Quick moment replies fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching quick moment replies', 500);
  }
};

/**
 * POST /api/v1/quick-moments/:momentId/view (also POST /api/v1/quick-moments/view)
 * Mark a quick moment (or list of quick moments) as seen / viewed
 */
export const markViewedHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentIds = req.body?.momentIds;
    if (Array.isArray(momentIds) && momentIds.length > 0) {
      const results = [];
      for (const id of momentIds) {
        if (typeof id === 'string' && id.trim()) {
          results.push(await quickMomentService.markViewed(viewerId, id.trim()));
        }
      }
      return sendSuccess(res, 'Quick moments marked as viewed', { results }, 200);
    }

    const momentId = (req.params.momentId || req.body?.momentId || req.body?.id) as string;
    if (!momentId || momentId === 'view') {
      return sendError(res, 'Moment ID is required', 400);
    }
    const result = await quickMomentService.markViewed(viewerId, momentId);

    return sendSuccess(res, 'Quick moment marked as viewed', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error recording view', 500);
  }
};

/**
 * POST /api/v1/quick-moments/user/:userId/view
 * Mark all active quick moments of a user as seen / viewed
 */
export const markUserMomentsViewedHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const targetUserId = req.params.userId as string;
    if (!targetUserId) {
      return sendError(res, 'User ID is required', 400);
    }

    const result = await quickMomentService.markUserMomentsViewed(viewerId, targetUserId);
    return sendSuccess(res, 'User quick moments marked as viewed', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error marking user quick moments as viewed', 500);
  }
};

/**
 * GET /api/v1/quick-moments/:momentId/viewers
 * Get list of viewers for story author
 */
export const getViewersHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const result = await quickMomentService.getViewers(viewerId, momentId);

    return sendSuccess(res, 'Viewers fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching viewers', 500);
  }
};

/**
 * POST /api/v1/quick-moments
 * Create new Quick Moment (Image upload or Text story)
 */
export const createQuickMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const file = req.file;
    const result = await quickMomentService.createQuickMoment(
      userId,
      req.body || {},
      file
    );

    return sendSuccess(res, 'Quick moment created successfully', result, 201);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error creating quick moment', 500);
  }
};

/**
 * DELETE /api/v1/quick-moments/:momentId
 * Delete own quick moment before 24h
 */
export const deleteQuickMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const result = await quickMomentService.deleteQuickMoment(userId, momentId);

    return sendSuccess(res, result.message, null, 200);
  } catch (error: any) {
    if (error instanceof QuickMomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error deleting quick moment', 500);
  }
};

/**
 * POST /api/v1/quick-moments/upload-url
 * S3 Presigned URL generator for client-side direct image uploads
 */
export const getPresignedUploadUrlHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { mimeType, folder } = req.body || {};
    const result = await s3Service.generatePresignedUploadUrl(
      userId,
      mimeType || 'image/jpeg',
      folder || 'quick_moments'
    );

    return sendSuccess(res, 'Presigned upload URL generated successfully', result, 200);
  } catch (error: any) {
    return sendError(res, error.message || 'Error generating presigned upload URL', 500);
  }
};
