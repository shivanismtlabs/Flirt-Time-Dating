/**
 * FlirtTime audio/video call signaling.
 * Keeps the existing video_call:* events and speaks the same socket
 * contract as a working call client:
 *   call:create → call:create:ack
 *   call:incoming
 *   call:accept → call:join
 *   call:decline → call:declined / call:rejected / call:end:ack
 *   call:end → call:end:ack
 *   call:leave → call:leave:ack / call:participant:left
 *   call:cancelled
 */

import { AppSocket, AppSocketServer } from './socket.types';
import { getUserActiveSocketCount, getUserRoomName } from './socket.lifecycle';
import { socketLogger } from './socket.errors';

export interface VideoCallIncomingPayload {
  callId: string;
  channelName: string;
  caller: {
    id: string;
    name: string;
    avatarUrl: string | null;
    username?: string;
    fullName?: string | null;
    profilePicture?: string | null;
    isVerified?: boolean;
  };
  status: string;
  expiresAt: string;
  callType?: 'audio' | 'video';
  call?: any;
}

export interface CallSessionPayload {
  call: any;
  token: string;
  uid: string;
  appId: string;
}

export interface VideoCallAcceptedPayload {
  callId: string;
  status: string;
  participantJoined?: string;
  session?: CallSessionPayload;
}

export interface VideoCallRejectedPayload {
  callId: string;
  status: string;
  by?: string;
  reason?: string;
  call?: any;
}

export interface VideoCallEndedPayload {
  callId: string;
  status: string;
  endedBy?: string;
  reason?: string;
}

export interface VideoCallBusyPayload {
  callId?: string;
  calleeId?: string;
  message: string;
}

export interface VideoCallMissedPayload {
  callId: string;
  status: string;
  reason?: string;
}

const DISCONNECT_HANGUP_GRACE_MS = 900;
const disconnectHangups = new Map<string, ReturnType<typeof setTimeout>>();

function emitToUser(io: AppSocketServer, userId: string, event: string, payload: unknown): void {
  const room = getUserRoomName(userId);
  io.to(room).emit(event as any, payload);
  if (userId.toLowerCase() !== userId) {
    io.to(getUserRoomName(userId.toLowerCase())).emit(event as any, payload);
  }
}

export const emitVideoCallIncoming = (
  io: AppSocketServer,
  calleeId: string,
  payload: VideoCallIncomingPayload
): void => {
  try {
    emitToUser(io, calleeId, 'video_call:incoming', payload);
    emitToUser(io, calleeId, 'call:incoming', payload);
    socketLogger.info('Emitted video_call:incoming', { calleeId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:incoming', error, { calleeId, callId: payload.callId });
  }
};

export const emitVideoCallAccepted = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallAcceptedPayload
): void => {
  try {
    const legacy = { callId: payload.callId, status: payload.status };
    emitToUser(io, callerId, 'video_call:accepted', legacy);
    emitToUser(io, callerId, 'call:accepted', legacy);
    if (payload.session) {
      emitToUser(io, callerId, 'call:join', {
        success: true,
        data: payload.session,
        participantJoined: payload.participantJoined,
      });
    }
    socketLogger.info('Emitted video_call:accepted', { callerId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:accepted', error, { callerId, callId: payload.callId });
  }
};

export const emitVideoCallRejected = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallRejectedPayload
): void => {
  try {
    const legacy = { callId: payload.callId, status: payload.status };
    emitToUser(io, callerId, 'video_call:rejected', legacy);
    const declined = {
      callId: payload.callId,
      status: payload.status,
      by: payload.by,
      callEnded: true,
      reason: payload.reason || 'rejected',
      call: payload.call ?? null,
    };
    emitToUser(io, callerId, 'call:rejected', declined);
    emitToUser(io, callerId, 'call:declined', declined);
    emitToUser(io, callerId, 'call:end:ack', {
      callId: payload.callId,
      status: payload.call?.status || 'declined',
      reason: payload.reason === 'busy' ? 'busy' : 'rejected',
      callEnded: true,
    });
    socketLogger.info('Emitted video_call:rejected', { callerId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:rejected', error, { callerId, callId: payload.callId });
  }
};

export const emitVideoCallEnded = (
  io: AppSocketServer,
  targetUserId: string,
  payload: VideoCallEndedPayload
): void => {
  try {
    const legacy = { callId: payload.callId, status: payload.status, endedBy: payload.endedBy };
    emitToUser(io, targetUserId, 'video_call:ended', legacy);
    emitToUser(io, targetUserId, 'call:ended', legacy);
    emitToUser(io, targetUserId, 'call:end:ack', {
      callId: payload.callId,
      status: payload.status === 'accepted' ? 'ongoing' : payload.status,
      reason: payload.reason || 'ended',
      callEnded: true,
      endedBy: payload.endedBy,
    });
    emitToUser(io, targetUserId, 'call:participant:left', {
      callId: payload.callId,
      userId: payload.endedBy,
      callEnded: true,
      status: payload.status,
    });
    socketLogger.info('Emitted video_call:ended', { targetUserId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:ended', error, { targetUserId, callId: payload.callId });
  }
};

export const emitVideoCallBusy = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallBusyPayload
): void => {
  try {
    emitToUser(io, callerId, 'video_call:busy', payload);
    emitToUser(io, callerId, 'call:busy', payload);
    socketLogger.info('Emitted video_call:busy', { callerId, calleeId: payload.calleeId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:busy', error, { callerId, calleeId: payload.calleeId });
  }
};

export const emitVideoCallMissed = (
  io: AppSocketServer,
  targetUserId: string,
  payload: VideoCallMissedPayload
): void => {
  try {
    emitToUser(io, targetUserId, 'video_call:missed', payload);
    emitToUser(io, targetUserId, 'call:missed', payload);
    emitToUser(io, targetUserId, 'call:end:ack', {
      callId: payload.callId,
      status: 'missed',
      reason: payload.reason || 'missed',
      callEnded: true,
    });
    if (payload.reason === 'cancelled') {
      emitToUser(io, targetUserId, 'call:cancelled', {
        callId: payload.callId,
        status: 'cancelled',
        reason: 'cancelled',
      });
    }
    socketLogger.info('Emitted video_call:missed', { targetUserId, callId: payload.callId });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:missed', error, { targetUserId, callId: payload.callId });
  }
};

export const emitCallChatMessage = (
  io: AppSocketServer,
  userIds: string[],
  payload: Record<string, unknown>
): void => {
  for (const userId of userIds) {
    emitToUser(io, userId, 'chat:message_received', payload);
    emitToUser(io, userId, 'chat:message_sent', payload);
  }
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function isBusyError(err: unknown): boolean {
  const anyErr = err as { statusCode?: number; errorCode?: string; message?: string };
  return (
    anyErr?.statusCode === 409 ||
    anyErr?.errorCode === 'CALLER_BUSY' ||
    anyErr?.errorCode === 'CALLEE_BUSY' ||
    /busy|another call|active call/i.test(anyErr?.message || '')
  );
}

function clearDisconnectHangup(userId: string): void {
  const t = disconnectHangups.get(userId);
  if (t) {
    clearTimeout(t);
    disconnectHangups.delete(userId);
  }
}

function scheduleDisconnectHangup(userId: string): void {
  clearDisconnectHangup(userId);
  const timer = setTimeout(() => {
    disconnectHangups.delete(userId);
    void (async () => {
      try {
        if (getUserActiveSocketCount(userId) > 0) return;
        const { videoCallService } = await import('../services/videoCall.service');
        await videoCallService.leaveActiveCallOnDisconnect(userId);
      } catch (err) {
        socketLogger.warn('Disconnect call hangup failed', {
          userId,
          error: errorMessage(err, 'hangup failed'),
        });
      }
    })();
  }, DISCONNECT_HANGUP_GRACE_MS);
  if (typeof timer.unref === 'function') timer.unref();
  disconnectHangups.set(userId, timer);
}

/**
 * Registers real-time audio/video call listeners on the socket.
 */
export const registerVideoCallSocketHandlers = (
  socket: AppSocket,
  _io: AppSocketServer
): void => {
  const currentUserId = socket.data.user.userId;

  const handleCreateCall = async (data: {
    conversationId?: string;
    calleeId?: string;
    userId?: string;
    type?: string;
    callType?: string;
    requestId?: string;
  }) => {
    const requestId = data?.requestId;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const callType = (data?.type || data?.callType || 'audio').toString().toLowerCase() === 'video'
        ? 'video'
        : 'audio';
      const result = await videoCallService.initiateCall(currentUserId, {
        calleeId: data?.calleeId || data?.userId,
        conversationId: data?.conversationId,
        callType,
      } as any);

      (socket.data as { activeCallId?: string }).activeCallId = result.callId;
      socket.emit('call:create:ack' as any, {
        requestId,
        success: true,
        data: result.session,
      });
    } catch (err: any) {
      const busy = isBusyError(err);
      socket.emit('call:create:ack' as any, {
        requestId,
        success: false,
        error: {
          code: busy ? 'BUSY' : 'CREATE_FAILED',
          message: busy ? 'User is busy' : errorMessage(err, 'Could not start call'),
        },
      });
      socketLogger.warn('call:create failed', { userId: currentUserId, error: err?.message });
    }
  };

  const handleAcceptCall = async (data: { callId?: string; id?: string; requestId?: string }) => {
    const callId = data?.callId || data?.id;
    const requestId = data?.requestId;
    if (!callId) {
      socket.emit('call:join' as any, {
        requestId,
        success: false,
        error: { code: 'VALIDATION', message: 'callId is required' },
      });
      return;
    }
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const result = await videoCallService.acceptCall(currentUserId, callId);
      (socket.data as { activeCallId?: string }).activeCallId = callId;
      socket.emit('call:join' as any, {
        requestId,
        success: true,
        data: result.session,
      });
    } catch (err: any) {
      socket.emit('call:join' as any, {
        requestId,
        success: false,
        error: {
          code: 'ACCEPT_FAILED',
          message: errorMessage(err, 'Could not accept call'),
        },
      });
      socketLogger.warn('call:accept failed', { userId: currentUserId, callId, error: err?.message });
    }
  };

  const handleRejectCall = async (data: {
    callId?: string;
    id?: string;
    requestId?: string;
    reason?: string;
  }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const result = await videoCallService.rejectCall(currentUserId, callId, data?.reason);
      if ((socket.data as { activeCallId?: string }).activeCallId === callId) {
        delete (socket.data as { activeCallId?: string }).activeCallId;
      }
      const payload = {
        requestId: data?.requestId,
        callId,
        by: currentUserId,
        callEnded: true,
        reason: (data?.reason || 'declined').toLowerCase() === 'busy' ? 'busy' : 'declined',
        status: result.status,
        call: result.call ?? null,
      };
      socket.emit('call:declined' as any, payload);
    } catch (err: any) {
      socketLogger.warn('call:decline failed', { userId: currentUserId, callId, error: err?.message });
    }
  };

  const handleEndCall = async (data: { callId?: string; id?: string; requestId?: string }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const result = await videoCallService.endCall(currentUserId, callId);
      if ((socket.data as { activeCallId?: string }).activeCallId === callId) {
        delete (socket.data as { activeCallId?: string }).activeCallId;
      }
      socket.emit('call:end:ack' as any, {
        requestId: data?.requestId,
        callId,
        status: result.reason === 'cancelled' ? 'cancelled' : result.status,
        reason: result.reason,
      });
    } catch (err: any) {
      socketLogger.warn('call:end failed', { userId: currentUserId, callId, error: err?.message });
    }
  };

  const handleLeaveCall = async (data: { callId?: string; id?: string; requestId?: string }) => {
    const callId = data?.callId || data?.id;
    if (!callId) return;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const result = await videoCallService.leaveCall(currentUserId, callId);
      if ((socket.data as { activeCallId?: string }).activeCallId === callId) {
        delete (socket.data as { activeCallId?: string }).activeCallId;
      }
      const ack = {
        requestId: data?.requestId,
        callId,
        status: result.status,
        reason: result.reason,
        callEnded: true,
        userId: currentUserId,
      };
      socket.emit('call:leave:ack' as any, ack);
      socket.emit('call:end:ack' as any, ack);
    } catch (err: any) {
      socketLogger.warn('call:leave failed', { userId: currentUserId, callId, error: err?.message });
    }
  };

  socket.on('call:create' as any, handleCreateCall);
  socket.on('video_call:create' as any, handleCreateCall);

  socket.on('call:accept' as any, handleAcceptCall);
  socket.on('video_call:accept' as any, handleAcceptCall);

  socket.on('call:decline' as any, handleRejectCall);
  socket.on('call:reject' as any, handleRejectCall);
  socket.on('video_call:reject' as any, handleRejectCall);

  socket.on('call:end' as any, handleEndCall);
  socket.on('video_call:end' as any, handleEndCall);

  socket.on('call:leave' as any, handleLeaveCall);
  socket.on('video_call:leave' as any, handleLeaveCall);

  socket.on('disconnect', () => {
    scheduleDisconnectHangup(currentUserId);
  });
};
