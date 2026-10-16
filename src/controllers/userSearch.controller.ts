import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  userSearchService,
  UserSearchServiceError,
} from '../services/userSearch.service';

/**
 * Controller to search users by name or city with pagination
 * Supports GET /api/v1/users/search and POST /api/v1/users/search
 * Query / Body parameters:
 *  - query / search / q: search term matching name or city
 *  - name: explicit name filter
 *  - city: explicit city filter
 *  - page: page number (default 1)
 *  - limit: items per page (default 10, max 50)
 *  - gender: gender filter
 *  - minAge: minimum age
 *  - maxAge: maximum age
 *  - onlineOnly: boolean
 *  - verifiedOnly: boolean
 *  - includeSwiped: boolean
 */
export const searchUsersHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    // Merge query and body params with query taking precedence for GET
    const query = req.query || {};
    const body = req.body || {};

    const pageRaw = query.page !== undefined ? query.page : body.page;
    const limitRaw = query.limit !== undefined ? query.limit : body.limit;
    const minAgeRaw = query.minAge !== undefined ? query.minAge : body.minAge;
    const maxAgeRaw = query.maxAge !== undefined ? query.maxAge : body.maxAge;

    const parseBool = (val: any) => {
      if (val === undefined || val === null) return undefined;
      return val === true || val === 'true' || val === 1 || val === '1';
    };

    const onlineOnly =
      query.onlineOnly !== undefined ? parseBool(query.onlineOnly) : parseBool(body.onlineOnly);
    const verifiedOnly =
      query.verifiedOnly !== undefined ? parseBool(query.verifiedOnly) : parseBool(body.verifiedOnly);
    const includeSwiped =
      query.includeSwiped !== undefined ? parseBool(query.includeSwiped) : parseBool(body.includeSwiped);

    const mergedInput = {
      query: (query.query || body.query || query.search || body.search || query.q || body.q) as string | undefined,
      name: (query.name || body.name) as string | undefined,
      city: (query.city || body.city) as string | undefined,
      page: pageRaw ? parseInt(String(pageRaw), 10) : 1,
      limit: limitRaw ? parseInt(String(limitRaw), 10) : 10,
      gender: (query.gender || body.gender) as string | undefined,
      minAge: minAgeRaw ? parseInt(String(minAgeRaw), 10) : undefined,
      maxAge: maxAgeRaw ? parseInt(String(maxAgeRaw), 10) : undefined,
      onlineOnly,
      verifiedOnly,
      includeSwiped,
    };

    const result = await userSearchService.searchUsers(currentUserId, mergedInput);

    return sendSuccess(res, 'Users retrieved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof UserSearchServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[UserSearch Controller searchUsers Error]:', error);
    return sendError(
      res,
      error.message || 'Error executing user search',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
