/**
 * FlirtTime Video Call Service
 * Production-ready business logic for Agora Video Calling lifecycle, authorization, and signaling.
 */

import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Conversation,
  UserBlock,
  VideoCall,
  ChatMessage,
} from '../models';
import { agoraService, AgoraServiceError } from './agora.service';
import { formatMediaUrl } from './s3.service';
import { resolveChatDisplayName } from './chat.service';
import { getSocketServer } from '../realtime/socket.server';
import {
  emitVideoCallIncoming,
  emitVideoCallAccepted,
  emitVideoCallRejected,
  emitVideoCallEnded,
  emitVideoCallBusy,
  emitVideoCallMissed,
  emitCallChatMessage,
} from '../realtime/socket.videoCall';
import { InitiateVideoCallInput, GetCallHistoryQuery, resolveCallMediaType } from '../schemas/videoCall.schema';
import { env } from '../config/env';

export class VideoCallServiceError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(message: string, statusCode = 400, errorCode = 'VIDEO_CALL_ERROR') {
    super(message);
    this.name = 'VideoCallServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, VideoCallServiceError.prototype);
  }
}

export interface CallUserSummary {
  id: string;
  username: string;
  fullName: string | null;
  profilePicture: string | null;
  isVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

export interface PublicCallDto {
  id: string;
  conversationId: string | null;
  conversationType: 'direct';
  type: 'audio' | 'video';
  status: string;
  channelName: string;
  callerId: string;
  calleeId: string;
  caller: CallUserSummary | null;
  callee: CallUserSummary | null;
  participants: Array<{
    userId: string;
    role: 'caller' | 'member';
    state: string;
    user: CallUserSummary | null;
  }>;
  appId: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface CallSessionPayload {
  call: PublicCallDto;
  token: string;
  uid: string;
  appId: string;
  type: 'audio' | 'video';
}

export interface InitiateVideoCallResponseDTO {
  callId: string;
  channelName: string;
  channel?: string;
  rtcToken: string;
  token?: string;
  appId: string;
  agoraAppId?: string;
  uid: number;
  callee: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  status: string;
  expiresAt: string;
  callType: 'audio' | 'video';
  account: string;
  accountToken: string;
  call: PublicCallDto;
  session: CallSessionPayload;
}

export interface AcceptVideoCallResponseDTO {
  callId: string;
  channelName: string;
  channel?: string;
  rtcToken: string;
  token?: string;
  appId: string;
  agoraAppId?: string;
  uid: number;
  status: string;
  startedAt: string;
  callType: 'audio' | 'video';
  account: string;
  accountToken: string;
  call: PublicCallDto;
  session: CallSessionPayload;
}

export interface RejectVideoCallResponseDTO {
  callId: string;
  status: string;
  callEnded: boolean;
  call: PublicCallDto | null;
}

export interface EndVideoCallResponseDTO {
  callId: string;
  status: string;
  endedAt: string;
  reason: 'cancelled' | 'rejected' | 'missed' | 'ended';
  callEnded: boolean;
}

export interface ActiveVideoCallResponseDTO {
  callId: string;
  channelName: string;
  channel?: string;
  rtcToken: string;
  token?: string;
  appId: string;
  agoraAppId?: string;
  uid: number;
  status: string;
  role: 'caller' | 'callee';
  otherParticipant: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  startedAt: string | null;
  callType: 'audio' | 'video';
  account: string;
  accountToken: string;
  call: PublicCallDto;
  session: CallSessionPayload;
}

export interface CallHistoryUserDTO {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CallHistoryItemDTO {
  id: string;
  user: CallHistoryUserDTO;
  callType: 'video' | 'audio';
  direction: 'incoming' | 'outgoing' | 'missed';
  status: string;
  duration: number;
  createdAt: string;
}

export interface CallHistoryResponseDTO {
  calls: CallHistoryItemDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export class VideoCallService {
  /**
   * Helper to safely retrieve the Socket.IO server without crashing if offline (e.g. in test runner).
   */
  private readonly ringTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private getIoSafe() {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
  }

  private clearRingTimeout(callId: string): void {
    const timer = this.ringTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.ringTimers.delete(callId);
    }
  }

  private scheduleRingTimeout(callId: string, expiresAt: Date): void {
    this.clearRingTimeout(callId);
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    const timer = setTimeout(() => {
      this.ringTimers.delete(callId);
      void this.expireRingingCall(callId).catch(() => undefined);
    }, delay);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.ringTimers.set(callId, timer);
  }

  private wireStatus(status: string, reason?: string): string {
    if (reason === 'cancelled') return 'cancelled';
    if (status === 'accepted') return 'ongoing';
    if (status === 'rejected') return 'declined';
    return status;
  }

  private toCallUser(user: any): CallUserSummary | null {
    if (!user) return null;
    const name = resolveChatDisplayName(user);
    const avatarUrl = user.profilePicture ? formatMediaUrl(user.profilePicture) : null;
    return {
      id: user.id,
      username: user.username || '',
      fullName: user.fullName || name || null,
      profilePicture: avatarUrl,
      isVerified: false,
      name,
      avatarUrl,
    };
  }

  private participantState(call: VideoCall, userId: string): string {
    const isCaller = call.callerId === userId;
    if (call.status === 'ringing') return isCaller ? 'joined' : 'ringing';
    if (call.status === 'accepted') return 'joined';
    if (call.status === 'rejected') return isCaller ? 'left' : 'declined';
    if (call.status === 'missed') return isCaller ? 'left' : 'missed';
    return 'left';
  }

  private toCallDto(
    call: VideoCall,
    caller: any,
    callee: any,
    reason?: string
  ): PublicCallDto {
    const callType = call.callType === 'audio' ? 'audio' : 'video';
    const callerSummary = this.toCallUser(caller);
    const calleeSummary = this.toCallUser(callee);
    return {
      id: call.id,
      conversationId: call.conversationId || null,
      conversationType: 'direct',
      type: callType,
      status: this.wireStatus(call.status, reason),
      channelName: call.channelName,
      callerId: call.callerId,
      calleeId: call.calleeId,
      caller: callerSummary,
      callee: calleeSummary,
      participants: [
        {
          userId: call.callerId,
          role: 'caller',
          state: this.participantState(call, call.callerId),
          user: callerSummary,
        },
        {
          userId: call.calleeId,
          role: 'member',
          state: this.participantState(call, call.calleeId),
          user: calleeSummary,
        },
      ],
      appId: agoraService.getAppId(),
      startedAt: call.startedAt ? new Date(call.startedAt).toISOString() : null,
      endedAt: call.endedAt ? new Date(call.endedAt).toISOString() : null,
      createdAt: call.createdAt ? new Date(call.createdAt).toISOString() : new Date().toISOString(),
      expiresAt: call.expiresAt ? new Date(call.expiresAt).toISOString() : null,
    };
  }

  private buildSession(
    call: VideoCall,
    actorId: string,
    caller: any,
    callee: any,
    reason?: string
  ): CallSessionPayload {
    const callType = call.callType === 'audio' ? 'audio' : 'video';
    return {
      call: this.toCallDto(call, caller, callee, reason),
      token: agoraService.generateRtcTokenWithUserAccount(call.channelName, actorId),
      uid: actorId,
      appId: agoraService.getAppId(),
      type: callType,
    };
  }

  private async loadCallUsers(call: VideoCall): Promise<{ caller: any; callee: any }> {
    const [caller, callee] = await Promise.all([
      User.findByPk(call.callerId, {
        attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
      }),
      User.findByPk(call.calleeId, {
        attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
      }),
    ]);
    return { caller, callee };
  }

  private async notifyIncomingCall(
    calleeId: string,
    call: VideoCall,
    caller: any,
    callType: 'audio' | 'video'
  ): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    const callerName = resolveChatDisplayName(caller);
    try {
      const { notificationService } = await import('./notification.service');
      await notificationService.dispatchNotification(calleeId, {
        type: 'incoming_call',
        title: callerName || 'Incoming call',
        body: callType === 'video' ? 'Incoming video call' : 'Incoming voice call',
        senderId: call.callerId,
        entityId: call.id,
        idempotencyKey: `incoming_call:${call.id}`,
        data: {
          type: 'incoming_call',
          callId: call.id,
          conversationId: call.conversationId || '',
          callType,
          callerId: call.callerId,
          calleeId,
          callerName: callerName || '',
          channelName: call.channelName,
        },
        navigation: { type: 'incoming_call', targetId: call.id },
      });
    } catch {
      // A missing push provider must not fail the call itself.
    }
  }

  private async insertCallHistoryMessage(call: VideoCall, reason: string): Promise<void> {
    if (!call.conversationId) return;
    try {
      const existing = await ChatMessage.findOne({
        where: {
          conversationId: call.conversationId,
          messageType: 'call',
          metadata: { [Op.like]: `%${call.id}%` },
        },
        attributes: ['id'],
      });
      if (existing) return;

      const callType = call.callType === 'audio' ? 'audio' : 'video';
      const wire = this.wireStatus(call.status, reason);
      let durationSec = 0;
      const start = call.acceptedAt || call.startedAt;
      if (start && call.endedAt && wire !== 'missed' && wire !== 'declined' && wire !== 'cancelled') {
        durationSec = Math.max(
          0,
          Math.round((new Date(call.endedAt).getTime() - new Date(start).getTime()) / 1000)
        );
      }
      const kind = callType === 'video' ? 'Video call' : 'Voice call';
      let body = kind;
      if (wire === 'missed') body = callType === 'video' ? 'Missed video call' : 'Missed voice call';
      else if (wire === 'declined') body = callType === 'video' ? 'Declined video call' : 'Declined voice call';
      else if (wire === 'cancelled') body = callType === 'video' ? 'Cancelled video call' : 'Cancelled voice call';
      else if (durationSec > 0) {
        const minutes = Math.floor(durationSec / 60);
        const seconds = durationSec % 60;
        body = `${kind} · ${minutes}:${String(seconds).padStart(2, '0')}`;
      }

      const saved = await ChatMessage.create({
        conversationId: call.conversationId,
        senderId: call.callerId,
        recipientId: call.calleeId,
        content: body,
        messageType: 'call',
        metadata: JSON.stringify({
          call: {
            id: call.id,
            callType,
            status: wire,
            durationSec,
            isGroup: false,
          },
        }),
        isDelivered: false,
        isRead: false,
      });

      await Conversation.update(
        { lastMessage: body, lastMessageAt: saved.createdAt || new Date() },
        { where: { id: call.conversationId } }
      );

      const io = this.getIoSafe();
      if (io) {
        emitCallChatMessage(io, [call.callerId, call.calleeId], {
          id: saved.id,
          conversationId: call.conversationId,
          senderId: call.callerId,
          recipientId: call.calleeId,
          content: body,
          messageType: 'call',
          metadata: saved.metadata,
          createdAt: saved.createdAt ? new Date(saved.createdAt).toISOString() : new Date().toISOString(),
        });
      }
    } catch {
      // Call state is already saved. A chat-log failure must not roll the call back.
    }
  }

  private async expireRingingCall(callId: string): Promise<void> {
    const call = await VideoCall.findByPk(callId);
    if (!call || call.status !== 'ringing') return;
    const now = new Date();
    await call.update({ status: 'missed', endedAt: now });
    const io = this.getIoSafe();
    if (io) {
      const callType = call.callType === 'audio' ? 'audio' : 'video';
      emitVideoCallMissed(io, call.callerId, { callId: call.id, status: 'missed', reason: 'missed', callType });
      emitVideoCallMissed(io, call.calleeId, { callId: call.id, status: 'missed', reason: 'missed', callType });
    }
    await this.insertCallHistoryMessage(call, 'missed');
  }

  /**
   * Cleans up stale ringing calls whose timeout has expired and abandoned calls.
   */
  private async cleanupStaleRingingCalls(userId: string): Promise<void> {
    const now = new Date();
    // 1. Mark expired ringing calls as missed
    await VideoCall.update(
      { status: 'missed' },
      {
        where: {
          [Op.or]: [{ callerId: userId }, { calleeId: userId }],
          status: 'ringing',
          expiresAt: { [Op.lt]: now },
        },
      }
    );

    // 2. Mark abandoned calls (> 30 min in accepted state) as ended so user is never permanently stuck
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await VideoCall.update(
      { status: 'ended', endedAt: now },
      {
        where: {
          [Op.or]: [{ callerId: userId }, { calleeId: userId }],
          status: 'accepted',
          startedAt: { [Op.lt]: thirtyMinutesAgo },
        },
      }
    );
  }

  /**
   * 1. INITIATE VIDEO CALL
   * Validates target user, permissions, active call bounds, generates Agora token and emits socket event.
   */
  public async initiateCall(
    callerId: string,
    input: InitiateVideoCallInput,
    fallback: 'audio' | 'video' = 'video'
  ): Promise<InitiateVideoCallResponseDTO> {
    let calleeId =
      input.calleeId ||
      (input as any).userId ||
      (input as any).receiverId ||
      (input as any).callee_id ||
      (input as any).recipientId;
    const conversationId = input.conversationId;

    if (!calleeId && conversationId) {
      const seedConv = await Conversation.findByPk(conversationId, {
        attributes: ['id', 'user1Id', 'user2Id'],
      });
      if (!seedConv) {
        throw new VideoCallServiceError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      if (seedConv.user1Id !== callerId && seedConv.user2Id !== callerId) {
        throw new VideoCallServiceError('Not a participant', 403, 'FORBIDDEN');
      }
      calleeId = seedConv.user1Id === callerId ? seedConv.user2Id : seedConv.user1Id;
    }

    if (!calleeId) {
      throw new VideoCallServiceError('calleeId or conversationId is required', 400, 'VALIDATION');
    }

    // 1. Prevent self-call
    if (callerId === calleeId) {
      throw new VideoCallServiceError('You cannot call yourself', 400, 'SELF_CALL_NOT_ALLOWED');
    }

    // 2. Fetch caller and callee
    const [caller, callee] = await Promise.all([
      User.findByPk(callerId, {
        attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture', 'isActive'],
      }),
      User.findByPk(calleeId, {
        attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture', 'isActive'],
      }),
    ]);

    if (!caller || caller.isActive === false) {
      throw new VideoCallServiceError('Your account is inactive or not found', 401, 'USER_INACTIVE');
    }

    if (!callee || callee.isActive === false) {
      throw new VideoCallServiceError('Recipient user profile is unavailable', 404, 'USER_NOT_FOUND');
    }

    // 3. Block check: verify neither participant has blocked the other
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: callerId, blockedUserId: calleeId },
          { userId: calleeId, blockedUserId: callerId },
        ],
      },
    });

    if (isBlocked) {
      throw new VideoCallServiceError('You cannot call this user', 403, 'USER_BLOCKED');
    }

    // 4. Conversation relationship validation
    let resolvedConversationId: string | null = null;
    if (conversationId) {
      const conv = await Conversation.findByPk(conversationId, {
        attributes: ['id', 'user1Id', 'user2Id'],
      });
      if (!conv) {
        throw new VideoCallServiceError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      const isParticipant =
        (conv.user1Id === callerId && conv.user2Id === calleeId) ||
        (conv.user2Id === callerId && conv.user1Id === calleeId);

      if (!isParticipant) {
        throw new VideoCallServiceError(
          'Specified conversation does not belong to these participants',
          403,
          'INVALID_CONVERSATION_PARTICIPANTS'
        );
      }
      resolvedConversationId = conv.id;
    } else {
      // Find existing conversation if one exists
      const existingConv = await Conversation.findOne({
        where: {
          [Op.or]: [
            { user1Id: callerId, user2Id: calleeId },
            { user1Id: calleeId, user2Id: callerId },
          ],
        },
        attributes: ['id'],
      });
      if (existingConv) {
        resolvedConversationId = existingConv.id;
      }
    }

    // 5. Cleanup stale ringing calls for both participants
    await Promise.all([
      this.cleanupStaleRingingCalls(callerId),
      this.cleanupStaleRingingCalls(calleeId),
    ]);

    const now = new Date();

    // 6. Check if caller already has an ongoing active call
    const callerActiveCall = await VideoCall.findOne({
      where: {
        [Op.and]: [
          { [Op.or]: [{ callerId }, { calleeId: callerId }] },
          {
            [Op.or]: [
              { status: 'accepted' },
              { status: 'ringing', expiresAt: { [Op.gt]: now } },
            ],
          },
        ],
      },
      attributes: ['id', 'status'],
    });

    if (callerActiveCall) {
      throw new VideoCallServiceError(
        'You already have an active call in progress',
        409,
        'CALLER_BUSY'
      );
    }

    // 7. Check if callee is currently busy on another call
    const calleeActiveCall = await VideoCall.findOne({
      where: {
        [Op.and]: [
          { [Op.or]: [{ callerId: calleeId }, { calleeId }] },
          {
            [Op.or]: [
              { status: 'accepted' },
              { status: 'ringing', expiresAt: { [Op.gt]: now } },
            ],
          },
        ],
      },
      attributes: ['id', 'status'],
    });

    if (calleeActiveCall) {
      const io = this.getIoSafe();
      if (io) {
        emitVideoCallBusy(io, callerId, {
          calleeId,
          message: 'User is currently in another call',
        });
      }
      throw new VideoCallServiceError(
        'User is currently in another call',
        409,
        'CALLEE_BUSY'
      );
    }

    // 8. Generate credentials & server-side call state
    const { callerUid, calleeUid } = agoraService.generateParticipantUids();
    const ringingSeconds = env.AGORA_RINGING_EXPIRATION_SECONDS || 60;
    const expiresAt = new Date(Date.now() + ringingSeconds * 1000);

    // Create call record to obtain canonical call ID
    const callType = resolveCallMediaType(input, fallback);
    const call = await VideoCall.create({
      callerId,
      calleeId,
      conversationId: resolvedConversationId,
      channelName: 'pending', // replaced immediately with deterministic channel name
      callerUid,
      calleeUid,
      callType,
      status: 'ringing',
      expiresAt,
    });

    const channelName = agoraService.generateChannelName(call.id);
    call.channelName = channelName;
    await call.save();

    // 9. Numeric token matches `uid`. User-account token is `session.token` (join with user id).
    let rtcToken: string;
    let session: CallSessionPayload;
    try {
      rtcToken = agoraService.generateRtcToken({
        channelName,
        uid: callerUid,
      });
      session = this.buildSession(call, callerId, caller, callee);
    } catch (tokenErr) {
      await call.destroy();
      throw tokenErr;
    }

    this.scheduleRingTimeout(call.id, call.expiresAt);

    const callerSummary = this.toCallUser(caller);
    const io = this.getIoSafe();
    if (io && callerSummary) {
      emitVideoCallIncoming(io, calleeId, {
        callId: call.id,
        channelName,
        caller: callerSummary,
        status: 'ringing',
        expiresAt: call.expiresAt.toISOString(),
        callType,
        call: session.call as unknown as Record<string, unknown>,
      });
    }

    void this.notifyIncomingCall(calleeId, call, caller, callType);

    return {
      callId: call.id,
      channelName: call.channelName,
      channel: call.channelName,
      rtcToken,
      token: rtcToken,
      appId: agoraService.getAppId(),
      agoraAppId: agoraService.getAppId(),
      uid: callerUid,
      callee: {
        id: callee.id,
        name: resolveChatDisplayName(callee),
        avatarUrl: callee.profilePicture ? formatMediaUrl(callee.profilePicture) : null,
      },
      status: 'ringing',
      expiresAt: call.expiresAt.toISOString(),
      callType,
      account: callerId,
      accountToken: session.token,
      call: session.call,
      session,
    };
  }

  /**
   * 2. ACCEPT INCOMING VIDEO CALL
   * Recipient securely accepts call, generates callee RTC token and transitions state.
   */
  public async acceptCall(
    calleeId: string,
    callId: string
  ): Promise<AcceptVideoCallResponseDTO> {
    const call = await VideoCall.findByPk(callId);
    if (!call) {
      throw new VideoCallServiceError('Call not found', 404, 'CALL_NOT_FOUND');
    }

    // Verify authenticated user is the intended recipient
    if (call.calleeId !== calleeId) {
      throw new VideoCallServiceError(
        'You are not authorized to accept this call',
        403,
        'FORBIDDEN'
      );
    }

    // Prevent accepting call multiple times
    if (call.status === 'accepted') {
      throw new VideoCallServiceError(
        'Call has already been accepted',
        400,
        'ALREADY_ACCEPTED'
      );
    }

    // Check if call has expired
    const now = new Date();
    if (call.status === 'ringing' && call.expiresAt && call.expiresAt < now) {
      this.clearRingTimeout(call.id);
      await call.update({ status: 'missed', endedAt: now });
      const io = this.getIoSafe();
      if (io) {
        const callType = call.callType === 'audio' ? 'audio' : 'video';
        emitVideoCallMissed(io, call.callerId, { callId: call.id, status: 'missed', reason: 'missed', callType });
        emitVideoCallMissed(io, call.calleeId, { callId: call.id, status: 'missed', reason: 'missed', callType });
      }
      await this.insertCallHistoryMessage(call, 'missed');
      throw new VideoCallServiceError('Call has expired', 410, 'CALL_EXPIRED');
    }

    if (call.status !== 'ringing') {
      throw new VideoCallServiceError(
        `Call cannot be accepted in its current state (${call.status})`,
        400,
        'INVALID_CALL_STATE'
      );
    }

    // Atomic transition from ringing -> accepted
    const [affectedRows] = await VideoCall.update(
      {
        status: 'accepted',
        startedAt: now,
        acceptedAt: now,
      },
      {
        where: {
          id: callId,
          status: 'ringing',
        },
      }
    );

    if (affectedRows === 0) {
      throw new VideoCallServiceError(
        'Call state conflict: call was already accepted, rejected, or ended',
        409,
        'CALL_STATE_CONFLICT'
      );
    }

    await call.reload();
    this.clearRingTimeout(call.id);

    const { caller, callee } = await this.loadCallUsers(call);
    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: call.calleeUid,
    });
    const session = this.buildSession(call, calleeId, caller, callee);
    const callerSession = this.buildSession(call, call.callerId, caller, callee);

    const io = this.getIoSafe();
    if (io) {
      emitVideoCallAccepted(io, call.callerId, {
        callId: call.id,
        status: 'accepted',
        participantJoined: calleeId,
        session: callerSession,
      });
    }

    return {
      callId: call.id,
      channelName: call.channelName,
      channel: call.channelName,
      rtcToken,
      token: rtcToken,
      appId: agoraService.getAppId(),
      agoraAppId: agoraService.getAppId(),
      uid: call.calleeUid,
      status: 'accepted',
      startedAt: call.startedAt!.toISOString(),
      callType: call.callType === 'audio' ? 'audio' : 'video',
      account: calleeId,
      accountToken: session.token,
      call: session.call,
      session,
    };
  }

  /**
   * 3. REJECT INCOMING VIDEO CALL
   * Recipient rejects ringing call; transitions state and notifies caller.
   */
  public async rejectCall(
    calleeId: string,
    callId: string,
    reason?: string
  ): Promise<RejectVideoCallResponseDTO> {
    const call = await VideoCall.findByPk(callId);
    if (!call) {
      throw new VideoCallServiceError('Call not found', 404, 'CALL_NOT_FOUND');
    }

    // Only the intended recipient can reject
    if (call.calleeId !== calleeId) {
      throw new VideoCallServiceError(
        'You are not authorized to reject this call',
        403,
        'FORBIDDEN'
      );
    }

    // Idempotent rejection: if already rejected, ended, or missed, return current state safely
    if (call.status === 'rejected' || call.status === 'ended' || call.status === 'missed') {
      const { caller, callee } = await this.loadCallUsers(call);
      return {
        callId: call.id,
        status: call.status,
        callEnded: true,
        call: this.toCallDto(call, caller, callee),
      };
    }

    if (call.status !== 'ringing') {
      throw new VideoCallServiceError(
        `Call cannot be rejected in its current state (${call.status})`,
        400,
        'INVALID_CALL_STATE'
      );
    }

    const now = new Date();
    this.clearRingTimeout(call.id);
    await call.update({
      status: 'rejected',
      endedAt: now,
      endedBy: calleeId,
    });

    const declineReason = String(reason || '').trim().toLowerCase() === 'busy' ? 'busy' : 'rejected';
    const { caller, callee } = await this.loadCallUsers(call);
    const callDto = this.toCallDto(call, caller, callee);

    const io = this.getIoSafe();
    if (io) {
      emitVideoCallRejected(io, call.callerId, {
        callId: call.id,
        status: 'rejected',
        by: calleeId,
        reason: declineReason,
        call: callDto as unknown as Record<string, unknown>,
      });
    }

    await this.insertCallHistoryMessage(call, 'declined');

    return {
      callId: call.id,
      status: 'rejected',
      callEnded: true,
      call: callDto,
    };
  }

  /**
   * 4. END VIDEO CALL
   * Either caller or callee terminates active or ringing call.
   */
  public async endCall(
    userId: string,
    callId: string
  ): Promise<EndVideoCallResponseDTO> {
    const call = await VideoCall.findByPk(callId);
    if (!call) {
      throw new VideoCallServiceError('Call not found', 404, 'CALL_NOT_FOUND');
    }

    // Only participants can end the call
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw new VideoCallServiceError(
        'You are not a participant in this call',
        403,
        'FORBIDDEN'
      );
    }

    const now = new Date();

    // Idempotency: if call is already terminated, return gracefully
    if (['ended', 'rejected', 'missed', 'failed'].includes(call.status)) {
      const reason =
        call.status === 'rejected' ? 'rejected' : call.status === 'missed' ? 'missed' : 'ended';
      return {
        callId: call.id,
        status: call.status,
        endedAt: call.endedAt ? call.endedAt.toISOString() : now.toISOString(),
        reason,
        callEnded: true,
      };
    }

    this.clearRingTimeout(call.id);
    const isCaller = call.callerId === userId;
    const cancelWhileRinging = call.status === 'ringing' && isCaller;
    const finalStatus = cancelWhileRinging ? 'missed' : 'ended';
    const reason = cancelWhileRinging ? 'cancelled' : 'ended';

    await call.update({
      status: finalStatus,
      endedAt: now,
      endedBy: userId,
    });

    const otherUserId = isCaller ? call.calleeId : call.callerId;
    const io = this.getIoSafe();
    if (io) {
      const callType = call.callType === 'audio' ? 'audio' : 'video';
      if (finalStatus === 'missed') {
        emitVideoCallMissed(io, otherUserId, {
          callId: call.id,
          status: 'missed',
          reason: 'cancelled',
          callType,
        });
      } else {
        emitVideoCallEnded(io, otherUserId, {
          callId: call.id,
          status: 'ended',
          endedBy: userId,
          reason: 'ended',
          callType,
        });
      }
    }

    await this.insertCallHistoryMessage(call, reason);

    return {
      callId: call.id,
      status: finalStatus,
      endedAt: now.toISOString(),
      reason,
      callEnded: true,
    };
  }

  /**
   * 5. GET ACTIVE VIDEO CALL
   * Retrieves user's currently ongoing call session and returns refreshed Agora token.
   */
  public async getActiveCall(
    userId: string,
    conversationId?: string | null
  ): Promise<ActiveVideoCallResponseDTO | null> {
    if (conversationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
      throw new VideoCallServiceError('conversationId must be a valid UUID', 400, 'VALIDATION');
    }

    await this.cleanupStaleRingingCalls(userId);

    const now = new Date();
    const andConditions: any[] = [
      { [Op.or]: [{ callerId: userId }, { calleeId: userId }] },
      {
        [Op.or]: [
          { status: 'accepted' },
          { status: 'ringing', expiresAt: { [Op.gt]: now } },
        ],
      },
    ];
    if (conversationId) {
      andConditions.push({ conversationId });
    }

    const call = await VideoCall.findOne({
      where: { [Op.and]: andConditions },
      include: [
        {
          model: User,
          as: 'caller',
          attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
        },
        {
          model: User,
          as: 'callee',
          attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    if (!call) {
      return null;
    }

    const isCaller = call.callerId === userId;
    const myUid = isCaller ? call.callerUid : call.calleeUid;
    const otherUser = isCaller ? call.callee : call.caller;
    const session = this.buildSession(call, userId, call.caller, call.callee);

    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: myUid,
    });

    return {
      callId: call.id,
      channelName: call.channelName,
      channel: call.channelName,
      rtcToken,
      token: rtcToken,
      appId: agoraService.getAppId(),
      agoraAppId: agoraService.getAppId(),
      uid: myUid,
      status: call.status,
      role: isCaller ? 'caller' : 'callee',
      otherParticipant: {
        id: otherUser ? otherUser.id : (isCaller ? call.calleeId : call.callerId),
        name: otherUser ? resolveChatDisplayName(otherUser) : 'User',
        avatarUrl: otherUser?.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
      },
      startedAt: call.startedAt ? call.startedAt.toISOString() : null,
      callType: call.callType === 'audio' ? 'audio' : 'video',
      account: userId,
      accountToken: session.token,
      call: session.call,
      session,
    };
  }

  /**
   * 1:1 leave is the same as ending the call for both people.
   */
  public async leaveCall(userId: string, callId: string): Promise<EndVideoCallResponseDTO> {
    return this.endCall(userId, callId);
  }

  /**
   * Socket dropped and did not reconnect. Direct calls end for both people.
   * A callee who never picked up is treated as a decline.
   */
  public async leaveActiveCallOnDisconnect(userId: string): Promise<EndVideoCallResponseDTO | RejectVideoCallResponseDTO | null> {
    const now = new Date();
    const call = await VideoCall.findOne({
      where: {
        [Op.and]: [
          { [Op.or]: [{ callerId: userId }, { calleeId: userId }] },
          {
            [Op.or]: [
              { status: 'accepted' },
              { status: 'ringing', expiresAt: { [Op.gt]: now } },
            ],
          },
        ],
      },
      order: [['createdAt', 'DESC']],
    });
    if (!call) return null;

    if (call.status === 'ringing' && call.calleeId === userId) {
      return this.rejectCall(userId, call.id);
    }
    return this.endCall(userId, call.id);
  }

  /**
   * Helper to retrieve all user IDs currently blocked by or blocking the given user.
   */
  private async getBlockedUserIds(userId: string): Promise<string[]> {
    const blocks = await UserBlock.findAll({
      where: {
        [Op.or]: [{ userId }, { blockedUserId: userId }],
      },
      attributes: ['userId', 'blockedUserId'],
      raw: true,
    });

    const blockedSet = new Set<string>();
    for (const b of blocks) {
      if (b.userId === userId) {
        blockedSet.add(b.blockedUserId);
      } else {
        blockedSet.add(b.userId);
      }
    }
    return Array.from(blockedSet);
  }

  /**
   * 6. GET CALL HISTORY (Calls Tab)
   * Returns compact call history matching the Calls screen design with no redundant/duplicate keys.
   */
  public async getCallHistory(
    currentUserId: string,
    query: GetCallHistoryQuery = {}
  ): Promise<CallHistoryResponseDTO> {
    const page = Math.max(1, parseInt(String(query?.page || 1), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(query?.limit || 20), 10) || 20));
    const offset = (page - 1) * limit;

    const rawSearch = (query?.search || query?.query || query?.q || '').trim();
    const callTypeFilter = query?.callType;

    // Fetch blocked users to exclude from call history
    const blockedUserIds = await this.getBlockedUserIds(currentUserId);

    // If search is specified, find matching participant IDs
    let participantIdFilter: string[] | null = null;
    if (rawSearch) {
      const dialect = sequelize.getDialect();
      const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;
      const searchTerm = `%${rawSearch}%`;

      const matchedUsers = await User.findAll({
        where: {
          [Op.or]: [
            { fullName: { [likeOp]: searchTerm } },
            { firstName: { [likeOp]: searchTerm } },
            { lastName: { [likeOp]: searchTerm } },
            { nickName: { [likeOp]: searchTerm } },
            { username: { [likeOp]: searchTerm } },
          ],
        },
        attributes: ['id'],
        raw: true,
      });

      participantIdFilter = matchedUsers.map((u) => u.id);
      if (participantIdFilter.length === 0) {
        return {
          calls: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
            hasMore: false,
          },
        };
      }
    }

    // Build WHERE clause
    const andConditions: any[] = [];

    // User must be caller or callee
    if (participantIdFilter !== null) {
      andConditions.push({
        [Op.or]: [
          {
            callerId: currentUserId,
            calleeId: { [Op.in]: participantIdFilter },
          },
          {
            calleeId: currentUserId,
            callerId: { [Op.in]: participantIdFilter },
          },
        ],
      });
    } else {
      andConditions.push({
        [Op.or]: [{ callerId: currentUserId }, { calleeId: currentUserId }],
      });
    }

    // Exclude blocked users
    if (blockedUserIds.length > 0) {
      andConditions.push({
        callerId: { [Op.notIn]: blockedUserIds },
        calleeId: { [Op.notIn]: blockedUserIds },
      });
    }

    // Filter by callType if specified
    if (callTypeFilter) {
      andConditions.push({ callType: callTypeFilter });
    }

    const where = { [Op.and]: andConditions };

    const { count, rows } = await VideoCall.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'caller',
          attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
        },
        {
          model: User,
          as: 'callee',
          attributes: ['id', 'fullName', 'firstName', 'lastName', 'nickName', 'username', 'profilePicture'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const calls: CallHistoryItemDTO[] = rows.map((call) => {
      const isCaller = call.callerId === currentUserId;
      const otherUser = isCaller ? call.callee : call.caller;
      const otherUserId = isCaller ? call.calleeId : call.callerId;

      // Calculate duration in seconds
      let duration = 0;
      if (call.status !== 'missed' && call.status !== 'rejected' && call.status !== 'failed') {
        const start = call.acceptedAt || call.startedAt;
        const end = call.endedAt;
        if (start && end) {
          duration = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
        }
      }

      // Resolve direction
      let direction: 'incoming' | 'outgoing' | 'missed' = isCaller ? 'outgoing' : 'incoming';
      if (!isCaller && call.status === 'missed') {
        direction = 'missed';
      }

      const callType = call.callType === 'audio' ? 'audio' : 'video';

      return {
        id: call.id,
        user: {
          id: otherUser ? otherUser.id : otherUserId,
          name: otherUser ? resolveChatDisplayName(otherUser) : 'User',
          avatarUrl: otherUser?.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
        },
        callType,
        direction,
        status: call.status,
        duration,
        createdAt: call.createdAt ? new Date(call.createdAt).toISOString() : new Date().toISOString(),
      };
    });

    const totalPages = Math.ceil(count / limit);

    return {
      calls,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * 7. DELETE CALL LOG
   * Deletes a call log entry for the authenticated participant.
   */
  public async deleteCall(
    currentUserId: string,
    callId: string
  ): Promise<{ id: string }> {
    const call = await VideoCall.findByPk(callId);
    if (!call) {
      throw new VideoCallServiceError('Call log not found', 404, 'CALL_NOT_FOUND');
    }

    if (call.callerId !== currentUserId && call.calleeId !== currentUserId) {
      throw new VideoCallServiceError(
        'You are not authorized to delete this call log',
        403,
        'FORBIDDEN'
      );
    }

    await call.destroy();

    return {
      id: callId,
    };
  }
}

export const videoCallService = new VideoCallService();
export const callService = videoCallService;

