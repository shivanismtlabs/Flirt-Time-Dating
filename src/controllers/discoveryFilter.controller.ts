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

    // Helper functions to parse query parameters for GET requests
    const parseArrayParam = (val: any): string[] | undefined => {
      if (!val) return undefined;
      if (Array.isArray(val)) return val.map(String).map((s) => s.trim()).filter(Boolean);
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return undefined;
    };

    const parseBoolParam = (val: any): boolean | undefined => {
      if (val === undefined || val === null || val === '') return undefined;
      return val === true || val === 'true' || val === '1' || val === 1;
    };

    const parseIntParam = (val: any): number | undefined => {
      if (val === undefined || val === null || val === '') return undefined;
      const parsed = parseInt(String(val), 10);
      return isNaN(parsed) ? undefined : parsed;
    };

    const rawInput: any = { ...bodyData };

    if (queryData.genders !== undefined && rawInput.genders === undefined) {
      rawInput.genders = parseArrayParam(queryData.genders);
    }
    if (queryData.ageMin !== undefined && rawInput.ageMin === undefined) {
      rawInput.ageMin = parseIntParam(queryData.ageMin);
    }
    if (queryData.ageMax !== undefined && rawInput.ageMax === undefined) {
      rawInput.ageMax = parseIntParam(queryData.ageMax);
    }
    if (queryData.maxDistanceKm !== undefined && rawInput.maxDistanceKm === undefined) {
      if (queryData.maxDistanceKm === 'null' || queryData.maxDistanceKm === 'anywhere') {
        rawInput.maxDistanceKm = null;
      } else {
        rawInput.maxDistanceKm = parseIntParam(queryData.maxDistanceKm);
      }
    }
    if (queryData.lookingFor !== undefined && rawInput.lookingFor === undefined) {
      rawInput.lookingFor = parseArrayParam(queryData.lookingFor);
    }
    if (queryData.interestIds !== undefined && rawInput.interestIds === undefined) {
      rawInput.interestIds = parseArrayParam(queryData.interestIds);
    }
    if (queryData.verifiedOnly !== undefined && rawInput.verifiedOnly === undefined) {
      rawInput.verifiedOnly = parseBoolParam(queryData.verifiedOnly);
    }
    if (queryData.onlineOnly !== undefined && rawInput.onlineOnly === undefined) {
      rawInput.onlineOnly = parseBoolParam(queryData.onlineOnly);
    }
    if (queryData.countOnly !== undefined && rawInput.countOnly === undefined) {
      rawInput.countOnly = parseBoolParam(queryData.countOnly);
    }
    if (queryData.page !== undefined && rawInput.page === undefined) {
      rawInput.page = parseIntParam(queryData.page);
    }
    if (queryData.limit !== undefined && rawInput.limit === undefined) {
      rawInput.limit = parseIntParam(queryData.limit);
    }

    const parseResult = discoverySearchBodySchema.safeParse(rawInput);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Validation failed';
      return sendError(res, firstError, 400, parseResult.error.errors);
    }

    const result = await discoveryFilterService.search(currentUserId, parseResult.data);
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
