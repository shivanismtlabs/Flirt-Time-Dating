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
import { getUserActiveSocketCount, getUserRoomName, getUserSocketIds } from './socket.lifecycle';
import { socketLogger } from './socket.errors';
import { resolveCallMediaType } from '../schemas/videoCall.schema';

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
  type?: 'audio' | 'video';
}

export interface VideoCallAcceptedPayload {
  callId: string;
  status: string;
  participantJoined?: string;
  session?: CallSessionPayload;
  callType?: 'audio' | 'video';
  call?: any;
}

export interface VideoCallRejectedPayload {
  callId: string;
  status: string;
  by?: string;
  reason?: string;
  callType?: 'audio' | 'video';
  call?: any;
}

export interface VideoCallEndedPayload {
  callId: string;
  status: string;
  endedBy?: string;
  reason?: string;
  callType?: 'audio' | 'video';
  call?: any;
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
  callType?: 'audio' | 'video';
  call?: any;
}

/** Socket a call snapshot should update, instead of every device for that user. */
export type DirectCallEmitter = { emit: (event: string, payload?: unknown) => void };

/**
 * A voice or video call often blips the socket for several seconds.
 * Ending the call at 900ms emitted "call ended" into an empty room, so neither
 * phone updated. Explicit hangup is still immediate. This only covers a drop.
 */
const DISCONNECT_HANGUP_GRACE_MS = 12000;
const disconnectHangups = new Map<string, ReturnType<typeof setTimeout>>();

function emitToUser(
  io: AppSocketServer,
  userId: string,
  event: string,
  payload: unknown,
  direct?: DirectCallEmitter | null
): void {
  if (!userId) return;
  if (direct) {
    direct.emit(event, payload);
    return;
  }
  // Deliver on the socket id. Room join is async, so a room-only emit during
  // connect (or after a call blip) never reached the phone.
  const socketIds = getUserSocketIds(userId);
  if (socketIds.length > 0) {
    for (const socketId of socketIds) {
      io.to(socketId).emit(event as any, payload);
    }
    return;
  }
  const room = getUserRoomName(userId);
  io.to(room).emit(event as any, payload);
  if (userId.toLowerCase() !== userId) {
    io.to(getUserRoomName(userId.toLowerCase())).emit(event as any, payload);
  }
}

function resolveMediaType(
  explicit?: string | null,
  nested?: { type?: string } | null
): 'audio' | 'video' {
  return asMediaType(explicit) || asMediaType(nested?.type) || (isAudioCall(explicit, nested) ? 'audio' : 'video');
}

function asMediaType(value: unknown): 'audio' | 'video' | undefined {
  if (value === 'audio' || value === 'video') return value;
  return undefined;
}

/**
 * A voice call must not emit `video_call:*`. The app treats that event as a
 * video call. OneVibe voice calls use only `call:*` and `type: "audio"`.
 */
function isAudioCall(callType?: string | null, call?: { type?: string } | null): boolean {
  return asMediaType(callType) === 'audio' || asMediaType(call?.type) === 'audio';
}

export const emitVideoCallIncoming = (
  io: AppSocketServer,
  calleeId: string,
  payload: VideoCallIncomingPayload,
  direct?: DirectCallEmitter | null
): void => {
  try {
    const callType = resolveMediaType(payload.callType, payload.call);
    const outgoing = { ...payload, callType, type: callType };
    if (callType === 'video') {
      emitToUser(io, calleeId, 'video_call:incoming', outgoing, direct);
    }
    emitToUser(io, calleeId, 'call:incoming', outgoing, direct);
    socketLogger.info('Emitted call:incoming', { calleeId, callId: payload.callId, callType });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:incoming', error, { calleeId, callId: payload.callId });
  }
};

export const emitVideoCallAccepted = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallAcceptedPayload,
  direct?: DirectCallEmitter | null
): void => {
  try {
    const nested = payload.session?.call || payload.call;
    const callType = resolveMediaType(payload.callType, nested);
    const legacy = {
      callId: payload.callId,
      status: payload.status,
      callType,
      type: callType,
      ...(payload.participantJoined ? { participantJoined: payload.participantJoined } : {}),
      ...(nested ? { call: nested } : {}),
    };
    if (callType === 'video') {
      emitToUser(io, callerId, 'video_call:accepted', legacy, direct);
    }
    emitToUser(io, callerId, 'call:accepted', legacy, direct);
    if (payload.session) {
      emitToUser(io, callerId, 'call:join', {
        success: true,
        data: payload.session,
        participantJoined: payload.participantJoined,
      }, direct);
    }
    socketLogger.info('Emitted call:accepted', { callerId, callId: payload.callId, callType });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:accepted', error, { callerId, callId: payload.callId });
  }
};

export const emitVideoCallRejected = (
  io: AppSocketServer,
  callerId: string,
  payload: VideoCallRejectedPayload,
  direct?: DirectCallEmitter | null
): void => {
  try {
    const callType = resolveMediaType(payload.callType, payload.call);
    const legacy = {
      callId: payload.callId,
      status: payload.status,
      callType,
      type: callType,
      callEnded: true,
      ...(payload.call ? { call: payload.call } : {}),
    };
    if (callType === 'video') {
      emitToUser(io, callerId, 'video_call:rejected', legacy, direct);
    }
    const declined = {
      callId: payload.callId,
      status: payload.status,
      by: payload.by,
      callEnded: true,
      reason: payload.reason || 'rejected',
      callType,
      type: callType,
      call: payload.call ?? null,
    };
    emitToUser(io, callerId, 'call:rejected', declined, direct);
    emitToUser(io, callerId, 'call:declined', declined, direct);
    emitToUser(io, callerId, 'call:end:ack', {
      callId: payload.callId,
      status: payload.call?.status || 'declined',
      reason: payload.reason === 'busy' ? 'busy' : 'rejected',
      callEnded: true,
      callType,
      type: callType,
      ...(payload.call ? { call: payload.call } : {}),
    }, direct);
    socketLogger.info('Emitted call:rejected', { callerId, callId: payload.callId, callType });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:rejected', error, { callerId, callId: payload.callId });
  }
};

export const emitVideoCallEnded = (
  io: AppSocketServer,
  targetUserId: string,
  payload: VideoCallEndedPayload,
  direct?: DirectCallEmitter | null
): void => {
  try {
    const callType = resolveMediaType(payload.callType, payload.call);
    const legacy = {
      callId: payload.callId,
      status: payload.status,
      endedBy: payload.endedBy,
      reason: payload.reason || 'ended',
      callType,
      type: callType,
      callEnded: true,
      ...(payload.call ? { call: payload.call } : {}),
    };
    if (callType === 'video') {
      emitToUser(io, targetUserId, 'video_call:ended', legacy, direct);
    }
    emitToUser(io, targetUserId, 'call:ended', legacy, direct);
    emitToUser(io, targetUserId, 'call:end:ack', {
      callId: payload.callId,
      status: payload.status === 'accepted' ? 'ongoing' : payload.status,
      reason: payload.reason || 'ended',
      callEnded: true,
      endedBy: payload.endedBy,
      callType,
      type: callType,
      ...(payload.call ? { call: payload.call } : {}),
    }, direct);
    emitToUser(io, targetUserId, 'call:participant:left', {
      callId: payload.callId,
      userId: payload.endedBy,
      callEnded: true,
      status: payload.status,
      callType,
      type: callType,
    }, direct);
    socketLogger.info('Emitted call:ended', { targetUserId, callId: payload.callId, callType });
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
  payload: VideoCallMissedPayload,
  direct?: DirectCallEmitter | null
): void => {
  try {
    const callType = resolveMediaType(payload.callType, payload.call);
    const outgoing = { ...payload, callType, type: callType, callEnded: true };
    if (callType === 'video') {
      emitToUser(io, targetUserId, 'video_call:missed', outgoing, direct);
    }
    emitToUser(io, targetUserId, 'call:missed', outgoing, direct);
    emitToUser(io, targetUserId, 'call:end:ack', {
      callId: payload.callId,
      status: 'missed',
      reason: payload.reason || 'missed',
      callEnded: true,
      callType,
      type: callType,
      ...(payload.call ? { call: payload.call } : {}),
    }, direct);
    if (payload.reason === 'cancelled') {
      emitToUser(io, targetUserId, 'call:cancelled', {
        callId: payload.callId,
        status: 'cancelled',
        reason: 'cancelled',
        callEnded: true,
        callType,
        type: callType,
        ...(payload.call ? { call: payload.call } : {}),
      }, direct);
    }
    socketLogger.info('Emitted call:missed', { targetUserId, callId: payload.callId, callType });
  } catch (error) {
    socketLogger.error('Failed to emit video_call:missed', error, { targetUserId, callId: payload.callId });
  }
};

/** `${userId}:${messageId}` already received this call log on a live socket. */
const deliveredCallChatUsers = new Set<string>();

function rememberCallChatDelivery(userId: string, messageId: string): void {
  if (!userId || !messageId) return;
  const key = `${String(userId).trim().toLowerCase()}:${messageId}`;
  if (deliveredCallChatUsers.has(key)) return;
  deliveredCallChatUsers.add(key);
  const timer = setTimeout(() => deliveredCallChatUsers.delete(key), 90_000);
  if (typeof timer.unref === 'function') timer.unref();
}

function callChatAlreadyDelivered(userId: string, messageId: string): boolean {
  if (!userId || !messageId) return false;
  return deliveredCallChatUsers.has(`${String(userId).trim().toLowerCase()}:${messageId}`);
}

function emitChatOnce(
  io: AppSocketServer,
  event: string,
  payload: unknown,
  rooms: string[],
  exceptRooms: string[],
  exceptSocketIds: string[],
  deliverSocketIds: string[]
): void {
  const uniqueRooms = [...new Set(rooms.filter(Boolean))];
  if (uniqueRooms.length > 0) {
    let op = io.to(uniqueRooms[0]);
    for (let i = 1; i < uniqueRooms.length; i++) op = op.to(uniqueRooms[i]);
    for (const room of exceptRooms) {
      if (room) op = op.except(room);
    }
    for (const socketId of exceptSocketIds) {
      if (socketId) op = op.except(socketId);
    }
    op.emit(event as any, payload);
  }
  for (const socketId of deliverSocketIds) {
    if (socketId) io.to(socketId).emit(event as any, payload);
  }
}

/**
 * Call log for the open chat. Same events as a normal message, with `type: "call"`.
 * A missing type is treated as a live voice call, so the bubble never appears until
 * the thread is fetched again. Socket-id delivery covers the call-screen blip, and
 * the conversation room covers the chat that is already open.
 */
export const emitCallChatMessage = (
  io: AppSocketServer | null,
  callerId: string,
  calleeId: string,
  conversationId: string,
  sent: Record<string, unknown>,
  received: Record<string, unknown>,
  options?: { direct?: DirectCallEmitter | null; onlyUserId?: string | null }
): void => {
  const messageId = String(sent.id || received.id || '');
  const onlyUserId = options?.onlyUserId ? String(options.onlyUserId).trim().toLowerCase() : '';
  const sameUser = (userId: string) => String(userId || '').trim().toLowerCase() === onlyUserId;
  const targets: Array<{ userId: string; payload: Record<string, unknown>; incoming: boolean }> = [];
  if (!onlyUserId || sameUser(callerId)) {
    targets.push({ userId: callerId, payload: sent, incoming: false });
  }
  if (!onlyUserId || sameUser(calleeId)) {
    targets.push({ userId: calleeId, payload: received, incoming: true });
  }

  for (const target of targets) {
    const outgoingEvents = ['chat:message_sent', 'message:sent', 'chat:message:new', 'new_message'];
    const incomingEvents = ['chat:message_received', 'chat:message:new', 'message:received', 'new_message'];
    const events = target.incoming ? incomingEvents : outgoingEvents;

    if (options?.direct) {
      if (callChatAlreadyDelivered(target.userId, messageId)) continue;
      for (const event of events) options.direct.emit(event, target.payload);
      rememberCallChatDelivery(target.userId, messageId);
      continue;
    }

    if (!io || !target.userId) continue;
    const socketIds = getUserSocketIds(target.userId);
    const rooms = [getUserRoomName(target.userId)];
    if (target.userId.toLowerCase() !== target.userId) {
      rooms.push(getUserRoomName(target.userId.toLowerCase()));
    }
    const exceptRooms: string[] = [];
    const exceptSocketIds = [...socketIds];
    if (target.incoming && conversationId) {
      rooms.push(`conversation:${conversationId}`, `chat:${conversationId}`);
      exceptRooms.push(getUserRoomName(callerId));
      if (callerId.toLowerCase() !== callerId) exceptRooms.push(getUserRoomName(callerId.toLowerCase()));
      exceptSocketIds.push(...getUserSocketIds(callerId));
    }

    for (const event of events) {
      emitChatOnce(io, event, target.payload, rooms, exceptRooms, exceptSocketIds, socketIds);
    }
    if (socketIds.length > 0) rememberCallChatDelivery(target.userId, messageId);
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
  clearDisconnectHangup(currentUserId);
  void import('../services/videoCall.service')
    .then(({ videoCallService }) =>
      videoCallService.syncConnectedCallSocket(currentUserId, {
        emit: (event, payload) => {
          socket.emit(event as any, payload);
        },
      })
    )
    .catch((err) => {
      socketLogger.warn('Call socket sync failed', {
        userId: currentUserId,
        error: errorMessage(err, 'sync failed'),
      });
    });

  const handleCreateCall = async (
    data: {
      conversationId?: string;
      calleeId?: string;
      userId?: string;
      type?: string;
      callType?: string;
      mediaType?: string;
      requestId?: string;
    },
    fallback: 'audio' | 'video'
  ) => {
    const requestId = data?.requestId;
    try {
      const { videoCallService } = await import('../services/videoCall.service');
      const callType = resolveCallMediaType(data, fallback);
      const result = await videoCallService.initiateCall(currentUserId, {
        calleeId: data?.calleeId || data?.userId,
        conversationId: data?.conversationId,
        callType,
        type: data?.type,
      } as any, fallback);

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
        callEnded: true,
        endedBy: currentUserId,
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

  socket.on('call:create' as any, (data: any) => {
    void handleCreateCall(data, 'audio');
  });
  socket.on('video_call:create' as any, (data: any) => {
    void handleCreateCall(data, 'video');
  });

  socket.on('call:accept' as any, handleAcceptCall);
  socket.on('video_call:accept' as any, handleAcceptCall);

  socket.on('call:decline' as any, handleRejectCall);
  socket.on('call:reject' as any, handleRejectCall);
  socket.on('video_call:reject' as any, handleRejectCall);

  socket.on('call:end' as any, handleEndCall);
  socket.on('video_call:end' as any, handleEndCall);

  socket.on('call:leave' as any, handleLeaveCall);
  socket.on('video_call:leave' as any, handleLeaveCall);

  socket.on('disconnecting', () => {
    scheduleDisconnectHangup(currentUserId);
  });
  socket.on('disconnect', () => {
    scheduleDisconnectHangup(currentUserId);
  });
};
