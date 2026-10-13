import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  deepLinkService,
  DeepLinkServiceError,
} from '../services/deepLink.service';

/**
 * POST /api/v1/deep-links
 * Generates an unpredictable, secure, shareable deep link.
 */
export const createDeepLinkHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const creatorId = req.user?.id;
    if (!creatorId) {
      return sendError(res, 'Authentication token missing or invalid', 401);
    }

    const { contentType, contentId, metadata } = req.body;

    const result = await deepLinkService.createDeepLink({
      creatorId,
      contentType,
      contentId,
      metadata,
    });

    return sendSuccess(res, 'Share link created successfully', result, 201);
  } catch (error: any) {
    if (error instanceof DeepLinkServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error creating deep link', 500);
  }
};

/**
 * GET /api/v1/deep-links/:code
 * Resolves a deep link code and returns target navigation identifier,
 * current availability, safe display metadata, and authentication requirements.
 */
export const resolveDeepLinkHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const code = req.params.code as string;
    const viewerUserId = req.user?.id;

    const result = await deepLinkService.resolveDeepLink(code, viewerUserId);

    return sendSuccess(res, 'Deep link resolved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DeepLinkServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error resolving deep link', 500);
  }
};

/**
 * GET /api/v1/deep-links/:code/preview
 * Returns safe metadata suitable for share previews and social crawlers.
 */
export const getPreviewMetadataHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const code = req.params.code as string;

    const result = await deepLinkService.getPreviewMetadata(code);

    return sendSuccess(res, 'Link preview metadata fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DeepLinkServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error fetching preview metadata', 500);
  }
};

/**
 * POST /api/v1/deep-links/:code/track
 * Records permitted deep link interaction and navigation events.
 */
export const trackDeepLinkHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const code = req.params.code as string;
    const { event, platform, metadata } = req.body;

    const result = await deepLinkService.trackEvent(code, event, platform, metadata);

    return sendSuccess(res, 'Deep link event recorded successfully', result, 200);
  } catch (error: any) {
    if (error instanceof DeepLinkServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Error tracking deep link', 500);
  }
};
