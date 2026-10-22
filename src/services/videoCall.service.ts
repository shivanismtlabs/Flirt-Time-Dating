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
import { InitiateVideoCallInput, GetCallHistoryQuery } from '../schemas/videoCall.schema';
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
  private getIoSafe() {
    try {
      return getSocketServer();
    } catch {
      return null;
    }
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
    input: InitiateVideoCallInput
  ): Promise<InitiateVideoCallResponseDTO> {
    const calleeId =
      input.calleeId ||
      (input as any).userId ||
      (input as any).receiverId ||
      (input as any).callee_id ||
      (input as any).recipientId;
    const conversationId = input.conversationId;

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
    const callType = (input as any)?.callType === 'audio' ? 'audio' : 'video';
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

    // 9. Generate Caller's Agora RTC token
    // Using uid 0 creates a wildcard token so mobile clients that join with uid 0 (standard Flutter default)
    // or with callerUid can both join successfully without token rejection.
    let rtcToken: string;
    try {
      rtcToken = agoraService.generateRtcToken({
        channelName,
        uid: 0,
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

    // Generate Callee's Agora RTC token (wildcard uid 0 so mobile callee can join with 0 or calleeUid)
    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: 0,
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
      channel: call.channelName,
      rtcToken,
      token: rtcToken,
      appId: agoraService.getAppId(),
      agoraAppId: agoraService.getAppId(),
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

    // Generate refreshed RTC token for participant (wildcard uid 0 for reliable connection)
    const rtcToken = agoraService.generateRtcToken({
      channelName: call.channelName,
      uid: 0,
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
    };
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

