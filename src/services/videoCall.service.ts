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
} from '../realtime/socket.videoCall';
import { InitiateVideoCallInput } from '../schemas/videoCall.schema';
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

export interface InitiateVideoCallResponseDTO {
  callId: string;
  channelName: string;
  rtcToken: string;
  appId: string;
  uid: number;
  callee: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  status: string;
  expiresAt: string;
}

export interface AcceptVideoCallResponseDTO {
  callId: string;
  channelName: string;
  rtcToken: string;
  appId: string;
  uid: number;
  status: string;
  startedAt: string;
}

export interface RejectVideoCallResponseDTO {
  callId: string;
  status: string;
}

export interface EndVideoCallResponseDTO {
  callId: string;
  status: string;
  endedAt: string;
}

export interface ActiveVideoCallResponseDTO {
  callId: string;
  channelName: string;
  rtcToken: string;
  appId: string;
  uid: number;
  status: string;
  role: 'caller' | 'callee';
  otherParticipant: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  startedAt: string | null;
}

export class VideoCallService {
  /**
   * Helper to safely retrieve the Socket.IO server without crashing if offline (e.g. in test runner).
   */
  private getIoSafe() {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
  }

  /**
   * Cleans up stale ringing calls whose timeout has expired.
   */
  private async cleanupStaleRingingCalls(userId: string): Promise<void> {
    const now = new Date();
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
  }

  /**
   * 1. INITIATE VIDEO CALL
   * Validates target user, permissions, active call bounds, generates Agora token and emits socket event.
   */
  public async initiateCall(
    callerId: string,
    input: InitiateVideoCallInput
  ): Promise<InitiateVideoCallResponseDTO> {
    const { calleeId, conversationId } = input;

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
    const call = await VideoCall.create({
      callerId,
      calleeId,
      conversationId: resolvedConversationId,
      channelName: 'pending', // replaced immediately with deterministic channel name
      callerUid,
      calleeUid,
      status: 'ringing',
      expiresAt,
    });

    const channelName = agoraService.generateChannelName(call.id);
    call.channelName = channelName;
    await call.save();

    // 9. Generate Caller's Agora RTC token
    let rtcToken: string;
    try {
      rtcToken = agoraService.generateRtcToken({
        channelName,
        uid: callerUid,
      });
    } catch (tokenErr) {
      // If token generation fails (e.g. unconfigured Agora secrets), cleanup DB record & fail safely
      await call.destroy();
      throw tokenErr;
    }

    // 10. Real-time signaling to callee
    const io = this.getIoSafe();
    if (io) {
      emitVideoCallIncoming(io, calleeId, {
        callId: call.id,
        channelName,
        caller: {
          id: caller.id,
          name: resolveChatDisplayName(caller),
          avatarUrl: caller.profilePicture ? formatMediaUrl(caller.profilePicture) : null,
        },
        status: 'ringing',
        expiresAt: call.expiresAt.toISOString(),
      });
    }

    // 11. Return clean DTO
    return {
      callId: call.id,
      channelName: call.channelName,
      rtcToken,
      appId: agoraService.getAppId(),
      uid: callerUid,
      callee: {
        id: callee.id,
        name: resolveChatDisplayName(callee),
        avatarUrl: callee.profilePicture ? formatMediaUrl(callee.profilePicture) : null,
      },
      status: 'ringing',
      expiresAt: call.expiresAt.toISOString(),
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
      await call.update({ status: 'missed' });
      const io = this.getIoSafe();
      if (io) {
        emitVideoCallMissed(io, call.callerId, { callId: call.id, status: 'missed' });
        emitVideoCallMissed(io, call.calleeId, { callId: call.id, status: 'missed' });
      }
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

    // Generate Callee's Agora RTC token
    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: call.calleeUid,
    });

    // Notify caller through Socket.IO
    const io = this.getIoSafe();
    if (io) {
      emitVideoCallAccepted(io, call.callerId, {
        callId: call.id,
        status: 'accepted',
      });
    }

    return {
      callId: call.id,
      channelName: call.channelName,
      rtcToken,
      appId: agoraService.getAppId(),
      uid: call.calleeUid,
      status: 'accepted',
      startedAt: call.startedAt!.toISOString(),
    };
  }

  /**
   * 3. REJECT INCOMING VIDEO CALL
   * Recipient rejects ringing call; transitions state and notifies caller.
   */
  public async rejectCall(
    calleeId: string,
    callId: string
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
      return {
        callId: call.id,
        status: call.status,
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
    await call.update({
      status: 'rejected',
      endedAt: now,
      endedBy: calleeId,
    });

    // Notify caller through Socket.IO
    const io = this.getIoSafe();
    if (io) {
      emitVideoCallRejected(io, call.callerId, {
        callId: call.id,
        status: 'rejected',
      });
    }

    return {
      callId: call.id,
      status: 'rejected',
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
      return {
        callId: call.id,
        status: call.status,
        endedAt: call.endedAt ? call.endedAt.toISOString() : now.toISOString(),
      };
    }

    // Transition call to ended or missed
    const isCaller = call.callerId === userId;
    const finalStatus = call.status === 'ringing' && isCaller ? 'missed' : 'ended';

    await call.update({
      status: finalStatus,
      endedAt: now,
      endedBy: userId,
    });

    // Notify the other participant through Socket.IO
    const otherUserId = isCaller ? call.calleeId : call.callerId;
    const io = this.getIoSafe();
    if (io) {
      if (finalStatus === 'missed') {
        emitVideoCallMissed(io, otherUserId, { callId: call.id, status: 'missed' });
      } else {
        emitVideoCallEnded(io, otherUserId, {
          callId: call.id,
          status: 'ended',
          endedBy: userId,
        });
      }
    }

    return {
      callId: call.id,
      status: finalStatus,
      endedAt: now.toISOString(),
    };
  }

  /**
   * 5. GET ACTIVE VIDEO CALL
   * Retrieves user's currently ongoing call session and returns refreshed Agora token.
   */
  public async getActiveCall(
    userId: string
  ): Promise<ActiveVideoCallResponseDTO | null> {
    await this.cleanupStaleRingingCalls(userId);

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

    // Generate refreshed RTC token for participant
    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: myUid,
    });

    return {
      callId: call.id,
      channelName: call.channelName,
      rtcToken,
      appId: agoraService.getAppId(),
      uid: myUid,
      status: call.status,
      role: isCaller ? 'caller' : 'callee',
      otherParticipant: {
        id: otherUser ? otherUser.id : (isCaller ? call.calleeId : call.callerId),
        name: otherUser ? resolveChatDisplayName(otherUser) : 'User',
        avatarUrl: otherUser?.profilePicture ? formatMediaUrl(otherUser.profilePicture) : null,
      },
      startedAt: call.startedAt ? call.startedAt.toISOString() : null,
    };
  }
}

export const videoCallService = new VideoCallService();
