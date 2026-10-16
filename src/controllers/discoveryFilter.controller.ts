import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  discoveryFilterService,
  DiscoveryFilterServiceError,
} from '../services/discoveryFilter.service';
import {
  updateDiscoveryFiltersBodySchema,
  discoverySearchBodySchema,
} from '../schemas/discoveryFilter.schema';

/**
 * Controller to fetch supported filter options and limits
 * GET /api/v1/discovery/filters/options (and /api/discovery/filters/options)
 */
export const getDiscoveryFilterOptions = async (
  _req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const options = await discoveryFilterService.getFilterOptions();
    return sendSuccess(res, 'Discovery filter options retrieved successfully', options, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryFilterServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[DiscoveryFilter Controller getFilterOptions Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching discovery filter options',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to fetch authenticated user's saved filter preferences
 * GET /api/v1/discovery/filters (and /api/discovery/filters)
 */
export const getDiscoveryFilters = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const filters = await discoveryFilterService.getFilters(currentUserId);
    return sendSuccess(
      res,
      'Discovery filter preferences retrieved successfully',
      filters,
      200
    );
  } catch (error: any) {
    if (error instanceof DiscoveryFilterServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[DiscoveryFilter Controller getFilters Error]:', error);
    return sendError(
      res,
      error.message || 'Error fetching discovery filter preferences',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to save authenticated user's filter preferences
 * PUT /api/v1/discovery/filters (and /api/discovery/filters)
 */
export const updateDiscoveryFilters = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const parseResult = updateDiscoveryFiltersBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Validation failed';
      return sendError(res, firstError, 400, parseResult.error.errors);
    }

    const updated = await discoveryFilterService.updateFilters(
      currentUserId,
      parseResult.data
    );

    return sendSuccess(
      res,
      'Discovery filter preferences updated successfully',
      updated,
      200
    );
  } catch (error: any) {
    if (error instanceof DiscoveryFilterServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[DiscoveryFilter Controller updateFilters Error]:', error);
    return sendError(
      res,
      error.message || 'Error updating discovery filter preferences',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to reset authenticated user's filter preferences to documented defaults
 * POST /api/v1/discovery/filters/reset (and /api/discovery/filters/reset)
 */
export const resetDiscoveryFilters = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const reset = await discoveryFilterService.resetFilters(currentUserId);
    return sendSuccess(
      res,
      'Discovery filters reset to defaults successfully',
      reset,
      200
    );
  } catch (error: any) {
    if (error instanceof DiscoveryFilterServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[DiscoveryFilter Controller resetFilters Error]:', error);
    return sendError(
      res,
      error.message || 'Error resetting discovery filter preferences',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};

/**
 * Controller to search discovery profiles matching saved preferences or request overrides
 * POST /api/v1/discovery/search (and /api/discovery/search)
 */
export const searchDiscoveryProfiles = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const bodyData = req.body || {};
    const queryData = req.query || {};

    // If text search or name/city search query is specified, delegate to searchUsersHandler
    const hasTextSearch = Boolean(
      queryData.query ||
      queryData.search ||
      queryData.q ||
      queryData.name ||
      queryData.city ||
      bodyData.query ||
      bodyData.search ||
      bodyData.q ||
      bodyData.name ||
      bodyData.city
    );

    if (hasTextSearch) {
      const { searchUsersHandler } = await import('./userSearch.controller');
      return searchUsersHandler(req, res);
    }

    const parseResult = discoverySearchBodySchema.safeParse(bodyData);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Validation failed';
      return sendError(res, firstError, 400, parseResult.error.errors);
    }

    // Merge query params for pagination / countOnly if supplied via URL
    const queryPage = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const queryLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const queryCountOnly =
      req.query.countOnly === 'true' || req.query.countOnly === '1' ? true : undefined;

    const mergedInput = {
      ...parseResult.data,
      page: queryPage !== undefined && !isNaN(queryPage) ? queryPage : parseResult.data.page,
      limit: queryLimit !== undefined && !isNaN(queryLimit) ? queryLimit : parseResult.data.limit,
      countOnly: queryCountOnly !== undefined ? queryCountOnly : parseResult.data.countOnly,
    };

    const result = await discoveryFilterService.search(currentUserId, mergedInput);
    return sendSuccess(res, 'Discovery search results retrieved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DiscoveryFilterServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[DiscoveryFilter Controller searchProfiles Error]:', error);
    return sendError(
      res,
      error.message || 'Error executing discovery search',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
