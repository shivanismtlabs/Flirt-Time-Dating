import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { discoveryService, DiscoveryServiceError } from '../services/discovery.service';
import {
  discoveryActionService,
  DiscoveryActionError,
} from '../services/discoveryAction.service';
import { discoveryActionSchema } from '../schemas/discoveryAction.schema';

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

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

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

/**
 * Controller to record a discovery swipe action (like, nope, super_like)
 * POST /api/v1/discovery/actions (and /api/discovery/actions)
 */
export const recordDiscoveryAction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const parseResult = discoveryActionSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Invalid request body';
      return sendError(res, firstError, 400, 'VALIDATION_ERROR');
    }

    const { targetUserId, action } = parseResult.data;

    const result = await discoveryActionService.recordAction(
      currentUserId,
      targetUserId,
      action
    );

    let message = 'Action recorded successfully';
    if (result.action === 'nope') {
      message = 'Nope saved successfully';
    } else if (result.isMatched) {
      message = "It's a match!";
    } else if (result.action === 'like') {
      message = 'Like saved successfully';
    } else if (result.action === 'super_like') {
      message = 'Super Like saved successfully';
    }

    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryActionError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Discovery Action Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error recording discovery action',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to fetch Discover by Interests cards with real people counts
 * GET /api/v1/discovery/interests (and /api/discovery/interests)
 * Supports ?selectedInterestId=<uuid>&search=<string>
 */
export const getDiscoveryInterests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const selectedInterestId = req.query.selectedInterestId as string | undefined;
    const search = req.query.search as string | undefined;

    const result = await discoveryService.getDiscoveryInterests({
      currentUserId,
      selectedInterestId,
      search,
    });

    return sendSuccess(res, 'Interests fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Discovery Interests Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching discovery interests',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to fetch users for a selected interest with cursor/page pagination
 * GET /api/v1/discovery/interests/:interestId/users (and /api/discovery/interests/:interestId/users)
 * Supports ?limit=20&cursor=<string>&page=1&gender=<string>&minAge=18&maxAge=35
 */
export const getInterestUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const { interestId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const cursor = req.query.cursor as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const gender = req.query.gender as string | undefined;
    const minAge = req.query.minAge ? parseInt(req.query.minAge as string, 10) : undefined;
    const maxAge = req.query.maxAge ? parseInt(req.query.maxAge as string, 10) : undefined;

    const result = await discoveryService.getUsersForInterest({
      currentUserId,
      interestId: typeof interestId === 'string' ? interestId : String(interestId),
      limit,
      cursor,
      page,
      gender,
      minAge,
      maxAge,
    });

    return sendSuccess(res, 'Users for interest fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Interest Users Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching users for selected interest',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to fetch featured interests and preview users
 * GET /api/v1/discovery/interests/featured (and /api/discovery/interests/featured)
 * Supports ?userLimit=3
 */
export const getFeaturedInterests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const userLimit = req.query.userLimit ? parseInt(req.query.userLimit as string, 10) : 3;

    const result = await discoveryService.getFeaturedInterestsPreview(currentUserId, userLimit);

    return sendSuccess(res, 'Featured interests fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Featured Interests Controller Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching featured discovery interests',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to seed 50 dummy users for people discovery
 * POST /api/v1/discovery/seed-dummy-data (and /api/discovery/seed-dummy-data)
 */
export const seedDummyUsersHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const force = req.query.force === 'true' || req.body?.force === true;
    const { seed50DiscoveryUsers } = await import('../services/seedDiscovery.service');
    const result = await seed50DiscoveryUsers(force);

    return sendSuccess(
      res,
      '50 dummy discovery users seeded successfully',
      result,
      200
    );
  } catch (error: any) {
    console.error('[Seed Dummy Users Error]:', error);
    return sendError(
      res,
      error.message || 'Error seeding dummy discovery users',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
