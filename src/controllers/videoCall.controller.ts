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
    const requestPath = `${req.baseUrl || ''}${req.originalUrl || ''}`.toLowerCase();
    const fallback = requestPath.includes('video') ? 'video' : 'audio';
    const result = await videoCallService.initiateCall(callerId, req.body, fallback);
    const label = result.callType === 'audio' ? 'Audio call' : 'Video call';
    return sendSuccess(res, `${label} initiated successfully`, result, 201);
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
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
    const result = await videoCallService.acceptCall(calleeId, callId);
    const label = result.callType === 'audio' ? 'Audio call' : 'Video call';
    return sendSuccess(res, `${label} accepted successfully`, result, 200);
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
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
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
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
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
    const conversationId =
      typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
    const result = await videoCallService.getActiveCall(userId, conversationId);
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

/**
 * 6. GET /api/v1/calls (Calls Tab / Call History)
 * Returns compact call history matching the Calls screen design with no redundant/duplicate keys.
 */
export const getCallHistoryHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user!.id;
    const result = await videoCallService.getCallHistory(currentUserId, req.query as any);
    return sendSuccess(res, 'Call history fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to fetch call history', 500);
  }
};

/**
 * 7. DELETE /api/v1/calls/:callId
 * Deletes a call log entry for the authenticated participant.
 */
export const deleteCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const currentUserId = req.user!.id;
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
    const result = await videoCallService.deleteCall(currentUserId, callId);
    return sendSuccess(res, 'Call log deleted successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to delete call log', 500);
  }
};

/**
 * POST /api/v1/calls/:callId/decline
 * Same as reject. Direct calls end as declined for both people.
 */
export const declineVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const calleeId = req.user!.id;
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = await videoCallService.rejectCall(calleeId, callId, reason);
    return sendSuccess(res, 'Call declined successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to decline call', 500);
  }
};

/**
 * POST /api/v1/calls/:callId/leave
 * Direct leave ends the call for both people.
 */
export const leaveVideoCallHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user!.id;
    const callId = (req.params.callId || req.params.id || req.body?.callId || req.body?.id) as string;
    const result = await videoCallService.leaveCall(userId, callId);
    return sendSuccess(res, 'Call left successfully', result, 200);
  } catch (error: any) {
    if (error instanceof VideoCallServiceError || error instanceof AgoraServiceError) {
      return sendError(res, error.message || 'Failed to leave call', error.statusCode);
    }
    return sendError(res, error.message || 'Failed to leave call', 500);
  }
};

