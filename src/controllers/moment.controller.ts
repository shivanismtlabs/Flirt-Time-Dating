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

    // Resolve location label from string or location object (supports string, JSON string, or object)
    let resolvedLocation: string | null = null;
    if (typeof location === 'string' && location.trim()) {
      const locStr = location.trim();
      if (locStr.startsWith('{') && locStr.endsWith('}')) {
        try {
          const parsed = JSON.parse(locStr);
          resolvedLocation = parsed.name || parsed.city || parsed.label || parsed.address || locStr;
        } catch (_e) {
          resolvedLocation = locStr;
        }
      } else {
        resolvedLocation = locStr;
      }
    } else if (location && typeof location === 'object') {
      resolvedLocation =
        (location.name && String(location.name).trim()) ||
        (location.city && String(location.city).trim()) ||
        (location.label && String(location.label).trim()) ||
        (location.address && String(location.address).trim()) ||
        null;
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
    const reaction = req.body?.reaction || 'like';

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
 * Controller to toggle Like / Unlike a Moment from a single endpoint
 * POST /api/v1/moments/:momentId/like or POST /api/v1/moments/:momentId/toggle-like
 */
export const likeMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    let action: 'like' | 'unlike' | 'toggle' | undefined;

    if (typeof req.body?.isLiked === 'boolean') {
      action = req.body.isLiked ? 'like' : 'unlike';
    } else if (typeof req.body?.like === 'boolean') {
      action = req.body.like ? 'like' : 'unlike';
    } else if (req.body?.action) {
      action = req.body.action;
    } else if (req.body?.type) {
      action = req.body.type;
    }

    const result = await momentService.toggleLikeMoment(
      viewerId,
      momentId,
      action
    );

    const message = result.isLiked
      ? 'Moment liked successfully'
      : 'Moment unliked successfully';

    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error processing like/unlike', 500);
  }
};

/**
 * Controller to send a comment or direct reply to a Moment
 * POST /api/v1/moments/:momentId/replies or POST /api/v1/moments/:momentId/comments
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
    const message = req.body.comment || req.body.message || req.body.text;

    const result = await momentService.replyToMoment(
      senderId,
      momentId,
      message
    );

    return sendSuccess(res, 'Comment posted successfully', result, 201);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error posting comment to moment', 500);
  }
};

/**
 * Controller to get all comments on a Moment
 * GET /api/v1/moments/:momentId/comments or GET /api/v1/moments/:momentId/replies
 */
export const getMomentCommentsHandler = async (
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

    const result = await momentService.getMomentComments(viewerId, momentId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return sendSuccess(res, 'Moment comments fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching moment comments', 500);
  }
};

/**
 * Controller to delete a comment/reply on a Moment
 * DELETE /api/v1/moments/:momentId/comments/:commentId
 */
export const deleteMomentCommentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const commentId = req.params.commentId as string;
    const momentId = req.params.momentId as string | undefined;
    const result = await momentService.deleteMomentComment(
      userId,
      commentId,
      momentId
    );

    return sendSuccess(res, result.message, result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error deleting comment', 500);
  }
};

/**
 * Controller to like or toggle like on a Moment Comment
 * POST /api/v1/moments/:momentId/comments/:commentId/like (or /toggle-like)
 */
export const likeMomentCommentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const commentId = (req.params.replyId || req.params.commentId) as string;
    const momentId = req.params.momentId as string | undefined;

    let action: 'like' | 'unlike' | 'toggle' | undefined;
    if (typeof req.body?.isLiked === 'boolean') {
      action = req.body.isLiked ? 'like' : 'unlike';
    } else if (typeof req.body?.like === 'boolean') {
      action = req.body.like ? 'like' : 'unlike';
    } else if (req.body?.action) {
      action = req.body.action;
    } else if (req.body?.type) {
      action = req.body.type;
    }

    const reaction = req.body?.reaction;

    const result = await momentService.toggleLikeMomentComment(
      userId,
      commentId,
      { action, reaction, momentId }
    );

    const message = result.isLiked
      ? 'Comment liked successfully'
      : 'Comment unliked successfully';

    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error processing comment like', 500);
  }
};

/**
 * Controller to explicitly unlike a Moment Comment
 * DELETE /api/v1/moments/:momentId/comments/:commentId/like or POST /api/v1/moments/:momentId/comments/:commentId/unlike
 */
export const unlikeMomentCommentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const commentId = (req.params.replyId || req.params.commentId) as string;
    const momentId = req.params.momentId as string | undefined;

    const result = await momentService.toggleLikeMomentComment(
      userId,
      commentId,
      { action: 'unlike', momentId }
    );

    return sendSuccess(res, 'Comment unliked successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error processing comment unlike', 500);
  }
};

/**
 * Controller to get all users who liked a Moment Comment
 * GET /api/v1/moments/:momentId/comments/:commentId/likes
 */
export const getMomentCommentLikesHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const commentId = (req.params.replyId || req.params.commentId) as string;
    const momentId = req.params.momentId as string | undefined;
    const { page, limit } = req.query as any;

    const result = await momentService.getMomentCommentLikes(viewerId, commentId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      momentId,
    });

    return sendSuccess(res, 'Comment likes fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching comment likes', 500);
  }
};

/**
 * Controller to reply to an existing comment on a Moment
 * POST /api/v1/moments/:momentId/comments/:commentId/replies
 */
export const replyMomentCommentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const senderId = req.user?.id;
    if (!senderId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const commentId = req.params.commentId as string;
    const message =
      req.body?.reply || req.body?.comment || req.body?.message || req.body?.text;
    const parentReplyId = req.body?.parentReplyId || null;

    const result = await momentService.replyToMomentComment(
      senderId,
      momentId,
      commentId,
      message,
      { parentReplyId }
    );

    return sendSuccess(res, 'Reply posted successfully', result, 201);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error replying to comment', 500);
  }
};

/**
 * Controller to get replies for a specific Comment
 * GET /api/v1/moments/:momentId/comments/:commentId/replies
 */
export const getMomentCommentRepliesHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const commentId = req.params.commentId as string;
    const { page, limit } = req.query as any;

    const result = await momentService.getMomentCommentReplies(
      viewerId,
      momentId,
      commentId,
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      }
    );

    return sendSuccess(res, 'Comment replies fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching comment replies', 500);
  }
};

/**
 * Controller to delete a specific reply to a Moment Comment
 * DELETE /api/v1/moments/:momentId/comments/:commentId/replies/:replyId
 */
export const deleteMomentCommentReplyHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const commentId = req.params.commentId as string;
    const replyId = req.params.replyId as string;

    const result = await momentService.deleteMomentCommentReply(
      userId,
      momentId,
      commentId,
      replyId
    );

    return sendSuccess(res, 'Reply deleted successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error deleting reply', 500);
  }
};

/**
 * Controller to get all users who liked / reacted to a Moment
 * GET /api/v1/moments/:momentId/likes or GET /api/v1/moments/:momentId/reactions
 */
export const getMomentLikesHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { page, limit, reaction } = req.query as any;

    const result = await momentService.getMomentLikes(viewerId, momentId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      reaction: reaction ? String(reaction) : undefined,
    });

    return sendSuccess(res, 'Moment likes fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching moment likes', 500);
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

/**
 * Controller to unlike or remove reaction from a Moment
 * DELETE /api/v1/moments/:momentId/reactions or POST /api/v1/moments/:momentId/unlike
 */
export const unlikeMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const result = await momentService.unlikeMoment(viewerId, momentId);

    return sendSuccess(res, 'Moment unliked successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error removing moment reaction', 500);
  }
};

/**
 * Controller to delete a Moment (Author only)
 * DELETE /api/v1/moments/:momentId
 */
export const deleteMomentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const result = await momentService.deleteMoment(userId, momentId);

    return sendSuccess(res, result.message, result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error deleting moment', 500);
  }
};

/**
 * Controller to get available Gifts catalog and current user coin balance
 * GET /api/v1/moments/gifts or GET /api/v1/moments/:momentId/gifts
 */
export const getMomentGiftsCatalogHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string | undefined;
    const result = await momentService.getMomentGiftsCatalog(viewerId, momentId);

    return sendSuccess(res, 'Gifts catalog fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching gifts catalog', 500);
  }
};

/**
 * Controller to send a gift on a Moment with full validation checks
 * POST /api/v1/moments/:momentId/gifts
 */
export const sendMomentGiftHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const senderId = req.user?.id;
    if (!senderId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const momentId = req.params.momentId as string;
    const { giftCode, giftId, gift, quantity, message } = req.body || {};

    const result = await momentService.sendMomentGift(senderId, momentId, {
      giftCode,
      giftId,
      gift,
      quantity,
      message,
    });

    return sendSuccess(res, 'Gift sent successfully! 🎁', result, 201);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.data || error.errorCode);
    }
    return sendError(res, error.message || 'Error sending gift to moment', 500);
  }
};

/**
 * Controller to get list of gifts received on a Moment
 * GET /api/v1/moments/:momentId/gifts/received
 */
export const getMomentGiftsReceivedHandler = async (
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

    const result = await momentService.getMomentGiftsReceived(viewerId, momentId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    return sendSuccess(res, 'Moment gifts fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof MomentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching received gifts', 500);
  }
};

