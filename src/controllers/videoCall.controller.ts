/**
 * FlirtTime Video Call Controller
 * Handles HTTP requests for Agora Video Calling: initiate, accept, reject, end, and active call.
 */

import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import {
  videoCallService,
  VideoCallServiceError,
} from '../services/videoCall.service';
import { AgoraServiceError } from '../services/agora.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * 1. POST /api/v1/calls/video/initiate
 * Initiates a new one-to-one video call, generates caller RTC credentials, and notifies recipient.
 */
export const initiateVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const callerId = req.user!.id;
    const result = await videoCallService.initiateCall(callerId, req.body);
    return sendSuccess(res, 'Video call initiated successfully', result, 201);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to initiate video call', 500);
  }
};

/**
 * 2. POST /api/v1/calls/video/:callId/accept
 * Recipient accepts incoming video call, transitions call to accepted, and generates callee RTC token.
 */
export const acceptVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const calleeId = req.user!.id;
    const callId = req.params.callId as string;
    const result = await videoCallService.acceptCall(calleeId, callId);
    return sendSuccess(res, 'Video call accepted successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to accept video call', 500);
  }
};

/**
 * 3. POST /api/v1/calls/video/:callId/reject
 * Recipient rejects incoming ringing call.
 */
export const rejectVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const calleeId = req.user!.id;
    const callId = req.params.callId as string;
    const result = await videoCallService.rejectCall(calleeId, callId);
    return sendSuccess(res, 'Video call rejected successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to reject video call', 500);
  }
};

/**
 * 4. POST /api/v1/calls/video/:callId/end
 * Participant ends ongoing or ringing call session idempotently.
 */
export const endVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user!.id;
    const callId = req.params.callId as string;
    const result = await videoCallService.endCall(userId, callId);
    return sendSuccess(res, 'Video call ended successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to end video call', 500);
  }
};

/**
 * 5. GET /api/v1/calls/video/active
 * Retrieves current active call session for reconnecting / restoring ongoing call.
 */
export const getActiveVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user!.id;
    const result = await videoCallService.getActiveCall(userId);
    const message = result
      ? 'Active call retrieved successfully'
      : 'No active call found';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to retrieve active call', 500);
  }
};
