import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { discoveryService, DiscoveryServiceError } from '../services/discovery.service';

/**
 * Controller to fetch people discovery feed
 * GET /api/v1/discovery/people (and /api/discovery/people)
 * Supports ?interestId=<uuid>&page=1&limit=10
 */
export const getDiscoveryPeople = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const interestId = req.query.interestId as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const result = await discoveryService.getDiscoveryPeople({
      currentUserId,
      interestId,
      page,
      limit,
    });

    return sendSuccess(res, 'Discovery profiles retrieved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Discovery Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error retrieving discovery profiles',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
