/**
 * FlirtTime Real-Time Socket Video Calling Event Handlers
 * Attaches real-time video call signaling listeners and provides signaling dispatchers.
 */

import { AppSocket, AppSocketServer } from './socket.types';
import { getUserRoomName } from './socket.lifecycle';
import { socketLogger } from './socket.errors';

export interface VideoCallIncomingPayload {
  callId: string;
  channelName: string;
  caller: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  status: string;
  expiresAt: string;
}

export interface VideoCallAcceptedPayload {
  callId: string;
  status: string;
}

export interface VideoCallRejectedPayload {
  callId: string;
  status: string;
}

export interface VideoCallEndedPayload {
  callId: string;
  status: string;
  endedBy?: string;
}

export interface VideoCallBusyPayload {
  callId?: string;
  calleeId?: string;
  message: string;
}

export interface VideoCallMissedPayload {
  callId: string;
  status: string;
}

/**
 * Dispatches video_call:incoming event to the callee's authenticated room.
 */
export const emitVideoCallIncoming = (
  io: AppSocketServer,
  calleeId: string,
  payload: VideoCallIncomingPayload
): void => {
  try {
    const room = getUserRoomName(calleeId);
    io.to(room).emit('video_call:incoming', payload);
    io.to(room).emit('call:incoming' as any, payload);
    socketLogger.info('Emitted video_call:incoming', { calleeId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:incoming', error, { calleeId, callId: payload.callId });
  }
};

/**
 * Dispatches video_call:accepted event to the caller's room.
 */
export const emitVideoCallAccepted = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallAcceptedPayload
): void => {
  try {
    const room = getUserRoomName(callerId);
    io.to(room).emit('video_call:accepted', payload);
    io.to(room).emit('call:accepted' as any, payload);
    socketLogger.info('Emitted video_call:accepted', { callerId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:accepted', error, { callerId, callId: payload.callId });
  }
};

/**
 * Dispatches video_call:rejected event to the caller's room.
 */
export const emitVideoCallRejected = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallRejectedPayload
): void => {
  try {
    const room = getUserRoomName(callerId);
    io.to(room).emit('video_call:rejected', payload);
    io.to(room).emit('call:rejected' as any, payload);
    socketLogger.info('Emitted video_call:rejected', { callerId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:rejected', error, { callerId, callId: payload.callId });
  }
};

/**
 * Dispatches video_call:ended event to a participant's room.
 */
export const emitVideoCallEnded = (
  io: AppSocketServer,
  targetUserId: string,
  payload: VideoCallEndedPayload
): void => {
  try {
    const room = getUserRoomName(targetUserId);
    io.to(room).emit('video_call:ended', payload);
    io.to(room).emit('call:ended' as any, payload);
    socketLogger.info('Emitted video_call:ended', { targetUserId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:ended', error, { targetUserId, callId: payload.callId });
  }
};

/**
 * Dispatches video_call:busy event to the caller's room.
 */
export const emitVideoCallBusy = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallBusyPayload
): void => {
  try {
    const room = getUserRoomName(callerId);
    io.to(room).emit('video_call:busy', payload);
    io.to(room).emit('call:busy' as any, payload);
    socketLogger.info('Emitted video_call:busy', { callerId, calleeId: payload.calleeId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:busy', error, { callerId, calleeId: payload.calleeId });
  }
};

/**
 * Dispatches video_call:missed event to a user's room.
 */
export const emitVideoCallMissed = (
  io: AppSocketServer,
  targetUserId: string,
  payload: VideoCallMissedPayload
): void => {
  try {
    const room = getUserRoomName(targetUserId);
    io.to(room).emit('video_call:missed', payload);
    io.to(room).emit('call:missed' as any, payload);
    socketLogger.info('Emitted video_call:missed', { targetUserId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:missed', error, { targetUserId, callId: payload.callId });
  }
};

/**
 * Registers real-time video call event listeners on the socket.
 */
export const registerVideoCallSocketHandlers = (
  socket: AppSocket,
  _io: AppSocketServer
): void => {
  const currentUserId = socket.data.user.userId;

  // Real-time client signal: End ongoing or ringing call
  const handleEndCall = async (data: { callId?: string; id?: string }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      await videoCallService.endCall(currentUserId, callId);
    } catch (err: any) {
      socketLogger.warn('Socket handleEndCall failed', { userId: currentUserId, callId, error: err.message });
    }
  };

  // Real-time client signal: Reject incoming call
  const handleRejectCall = async (data: { callId?: string; id?: string }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      await videoCallService.rejectCall(currentUserId, callId);
    } catch (err: any) {
      socketLogger.warn('Socket handleRejectCall failed', { userId: currentUserId, callId, error: err.message });
    }
  };

  // Real-time client signal: Accept incoming call
  const handleAcceptCall = async (data: { callId?: string; id?: string }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      await videoCallService.acceptCall(currentUserId, callId);
    } catch (err: any) {
      socketLogger.warn('Socket handleAcceptCall failed', { userId: currentUserId, callId, error: err.message });
    }
  };

  socket.on('video_call:end' as any, handleEndCall);
  socket.on('call:end' as any, handleEndCall);
  socket.on('video_call:reject' as any, handleRejectCall);
  socket.on('call:reject' as any, handleRejectCall);
  socket.on('video_call:accept' as any, handleAcceptCall);
  socket.on('call:accept' as any, handleAcceptCall);

  // Liveness check / ping from client for video call session
  socket.on('disconnect', (reason: string) => {
    socketLogger.info('Video calling socket listener cleaned up on disconnect', {
      userId: currentUserId,
      reason,
    });
  });
};
