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

  // Liveness check / ping from client for video call session
  socket.on('disconnect', (reason: string) => {
    socketLogger.info('Video calling socket listener cleaned up on disconnect', {
      userId: currentUserId,
      reason,
    });
  });
};
