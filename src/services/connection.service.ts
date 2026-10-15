import { Op } from 'sequelize';
import {
  sequelize,
  User,
  ConnectionRequest,
  Match,
  UserBlock,
  SwipeAction,
} from '../models';
import { notificationService, PushNotificationResult } from './notification.service';

export class ConnectionServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'ConnectionServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ConnectionServiceError.prototype);
  }
}

import { CONNECTION_REASONS } from '../schemas/connection.schema';

export interface CreateConnectionRequestResult {
  requestId: string;
  targetUserId: string;
  status: 'pending' | 'accepted';
  isMatched: boolean;
  matchId?: string | null;
  reason?: string | null;
  message?: string | null;
  momentId?: string | null;
  notification: PushNotificationResult;
}

export class ConnectionService {
  /**
   * Creates a connection request from the authenticated requester to the target user.
   * Handles self-connection prevention, block checks, mutual auto-matching, and push notifications.
   */
  public async createConnectionRequest(
    requesterId: string,
    targetUserId: string,
    options?: {
      reason?: string | null;
      message?: string | null;
      momentId?: string | null;
    }
  ): Promise<CreateConnectionRequestResult> {
    const rawReason = options?.reason?.trim() || null;
    const rawMessage = options?.message?.trim() || null;
    const momentId = options?.momentId || null;

    // Normalize reason (support both ID like 'love_their_vibe' and full label like 'Love their vibe')
    const matchedReason = rawReason
      ? CONNECTION_REASONS.find(
          (r) =>
            r.id === rawReason.toLowerCase() ||
            r.label.toLowerCase() === rawReason.toLowerCase()
        )
      : null;
    const finalReason = matchedReason ? matchedReason.label : rawReason;
    const finalMessage = rawMessage || finalReason || null;
    // 1. Prevent self-connection
    if (requesterId === targetUserId) {
      throw new ConnectionServiceError(
        'You cannot send a connection request to yourself',
        400,
        'SELF_CONNECTION_NOT_ALLOWED'
      );
    }

    // 2. Target user eligibility & active status check
    const [requester, targetUser] = await Promise.all([
      User.findByPk(requesterId),
      User.findByPk(targetUserId),
    ]);

    if (!requester || !requester.isActive) {
      throw new ConnectionServiceError(
        'Requester account is invalid or unavailable',
        401,
        'UNAUTHORIZED'
      );
    }

    if (!targetUser || !targetUser.isActive) {
      throw new ConnectionServiceError(
        'Target user does not exist or is unavailable',
        404,
        'TARGET_USER_NOT_FOUND'
      );
    }

    // 3. Bidirectional block check
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: requesterId, blockedUserId: targetUserId },
          { userId: targetUserId, blockedUserId: requesterId },
        ],
      },
    });

    if (blockRecord) {
      throw new ConnectionServiceError(
        'Connection request cannot be sent due to privacy or block restrictions',
        403,
        'ACTION_FORBIDDEN'
      );
    }

    // 4. Check if already matched
    const [u1, u2] = [requesterId, targetUserId].sort();
    const existingMatch = await Match.findOne({
      where: {
        user1Id: u1,
        user2Id: u2,
        isActive: true,
      },
    });

    if (existingMatch) {
      throw new ConnectionServiceError(
        'You are already matched with this user',
        400,
        'ALREADY_MATCHED'
      );
    }

    // 5. Check if requester has already sent a pending request
    const existingRequest = await ConnectionRequest.findOne({
      where: {
        requesterId,
        targetUserId,
        status: 'pending',
      },
    });

    if (existingRequest) {
      throw new ConnectionServiceError(
        'A connection request is already pending for this user',
        409,
        'REQUEST_ALREADY_PENDING'
      );
    }

    // 6. Check if target user has ALREADY sent a pending request to requester (Mutual Connect -> Match)
    const reversePendingRequest = await ConnectionRequest.findOne({
      where: {
        requesterId: targetUserId,
        targetUserId: requesterId,
        status: 'pending',
      },
    });

    const requesterName =
      requester.nickName ||
      requester.firstName ||
      requester.fullName ||
      requester.username ||
      'Someone';

    // If reverse request exists, accept it atomically and create a Match
    if (reversePendingRequest) {
      const t = await sequelize.transaction();
      try {
        reversePendingRequest.status = 'accepted';
        reversePendingRequest.respondedAt = new Date();
        await reversePendingRequest.save({ transaction: t });

        const [match] = await Match.findOrCreate({
          where: { user1Id: u1, user2Id: u2 },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            matchedBy: 'super_like',
            isActive: true,
          },
          transaction: t,
        });

        // Ensure swipe actions reflect mutual connection
        await SwipeAction.upsert(
          { userId: requesterId, targetUserId, action: 'super_like' },
          { transaction: t }
        );

        await t.commit();

        // Dispatch notification asynchronously
        const pushResult = await notificationService.sendConnectionRequestNotification(
          targetUserId,
          {
            requesterId,
            requesterName,
            requestId: reversePendingRequest.id,
            reason: finalReason,
          }
        );

        // Also notify both users of the mutual match
        try {
          const targetUserDisplayName =
            targetUser.nickName ||
            targetUser.firstName ||
            targetUser.fullName ||
            'Someone';

          await notificationService.dispatchNotification(targetUserId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${requesterName} connected! Say hi!`,
            senderId: requesterId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: requesterName },
          });

          await notificationService.dispatchNotification(requesterId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${targetUserDisplayName} connected! Say hi!`,
            senderId: targetUserId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: targetUserDisplayName },
          });
        } catch (_mErr) {
          // Safe to ignore
        }

        return {
          requestId: reversePendingRequest.id,
          targetUserId,
          status: 'accepted',
          isMatched: true,
          matchId: match.id,
          reason: finalReason,
          message: finalMessage,
          momentId,
          notification: pushResult,
        };
      } catch (err: any) {
        await t.rollback();
        throw err;
      }
    }

    // 7. Atomic transaction for new ConnectionRequest persistence
    const t = await sequelize.transaction();
    let savedRequest: ConnectionRequest;
    try {
      savedRequest = await ConnectionRequest.create(
        {
          requesterId,
          targetUserId,
          status: 'pending',
          reason: finalReason,
          message: finalMessage,
          momentId,
        },
        { transaction: t }
      );

      // Record discovery swipe action as super_like / connect
      await SwipeAction.upsert(
        { userId: requesterId, targetUserId, action: 'super_like' },
        { transaction: t }
      );

      await t.commit();
    } catch (dbErr: any) {
      await t.rollback();
      throw dbErr;
    }

    // 8. Dispatch In-App & Firebase push notification (DB persistence is safe)
    const pushResult = await notificationService.sendConnectionRequestNotification(
      targetUserId,
      {
        requesterId,
        requesterName,
        requestId: savedRequest.id,
        reason: finalReason,
      }
    );

    return {
      requestId: savedRequest.id,
      targetUserId,
      status: 'pending',
      isMatched: false,
      matchId: null,
      reason: finalReason,
      message: finalMessage,
      momentId,
      notification: pushResult,
    };
  }
}

export const connectionService = new ConnectionService();
