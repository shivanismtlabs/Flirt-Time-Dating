import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  interactionService,
  InteractionServiceError,
} from '../services/interaction.service';
import {
  complimentService,
  ComplimentServiceError,
} from '../services/compliment.service';
import { InteractionType } from '../schemas/interaction.schema';

/**
 * Common Interactions Listing API
 * GET /api/v1/interactions?type=likes|you_liked|matches|compliments&limit=20&cursor=...&sort=recent
 */
export const getInteractionsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const type = req.query.type as InteractionType;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = req.query.cursor as string | undefined;
    const sort = req.query.sort as string | undefined;

    const result = await interactionService.getInteractions(currentUserId, {
      type,
      limit,
      cursor,
      sort,
    });

    return sendSuccess(res, 'Interactions fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof InteractionServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Interactions Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching interactions',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Tab Badge Counts API
 * GET /api/v1/interactions/counts
 */
export const getInteractionCountsHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const counts = await interactionService.getInteractionCounts(currentUserId);
    return sendSuccess(res, 'Interaction counts fetched successfully', counts, 200);
  } catch (error: any) {
    if (error instanceof InteractionServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Interaction Counts Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching interaction counts',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Mark Interaction Read / Seen
 * POST /api/v1/interactions/:interactionId/read
 */
export const markInteractionReadHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const interactionId = req.params.interactionId as string;
    const result = await interactionService.markInteractionRead(currentUserId, interactionId);

    return sendSuccess(res, 'Interaction marked as read', result, 200);
  } catch (error: any) {
    if (error instanceof InteractionServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Mark Interaction Read Error]:', error);
    return sendError(
      res,
      error.message || 'Error marking interaction as read',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Send Compliment to a User's Profile
 * POST /api/v1/users/:userId/compliment
 * POST /api/v1/interactions/compliments
 */
export const sendComplimentHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const targetUserId =
      req.params.userId || req.body.targetUserId || req.body.userId;
    const { message, reason, momentId } = req.body;

    if (!targetUserId) {
      return sendError(
        res,
        'Target user ID must be provided in URL parameter (:userId) or request body (targetUserId)',
        400,
        'TARGET_USER_REQUIRED'
      );
    }

    const result = await complimentService.sendCompliment(currentUserId, targetUserId, {
      message,
      reason,
      momentId,
    });

    const successMessage = result.isNewMatch
      ? 'Compliment accepted! You have a new match'
      : 'Compliment sent successfully';

    return sendSuccess(res, successMessage, result, 201);
  } catch (error: any) {
    if (error instanceof ComplimentServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Compliment Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error sending compliment',
      error.statusCode || 500,
      error.errorCode || 'INTERNAL_SERVER_ERROR'
    );
  }
};

