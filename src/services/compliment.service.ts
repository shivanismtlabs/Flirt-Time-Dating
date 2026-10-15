import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  ConnectionRequest,
  User,
  UserBlock,
  Match,
  SwipeAction,
} from '../models';
import { ConnectionRequestStatus } from '../models/connectionRequest.model';
import { notificationService } from './notification.service';

export interface SendComplimentResult {
  complimentId: string;
  targetUserId: string;
  message: string;
  reason: string | null;
  status: ConnectionRequestStatus;
  isMatched: boolean;
  matchId: string | null;
  createdAt: string;
}

export class ComplimentServiceError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number = 400, errorCode: string = 'BAD_REQUEST') {
    super(message);
    this.name = 'ComplimentServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ComplimentServiceError.prototype);
  }
}

export class ComplimentService {
  /**
   * Sends a profile compliment from the authenticated user to a target user.
   * Handles self-compliment check, block checks, mutual auto-matching, and push/in-app notifications.
   */
  public async sendCompliment(
    requesterId: string,
    targetUserId: string,
    options: {
      message: string;
      reason?: string | null;
      momentId?: string | null;
    }
  ): Promise<SendComplimentResult> {
    const finalMessage = options.message.trim();
    const finalReason = options.reason?.trim() || 'Compliment';
    const momentId = options.momentId || null;

    if (!finalMessage) {
      throw new ComplimentServiceError('Compliment message cannot be empty', 400, 'EMPTY_MESSAGE');
    }

    // 1. Prevent self-compliment
    if (requesterId === targetUserId) {
      throw new ComplimentServiceError(
        'You cannot compliment your own profile',
        400,
        'SELF_COMPLIMENT_NOT_ALLOWED'
      );
    }

    // 2. Validate requester and target user status
    const [requester, targetUser] = await Promise.all([
      User.findByPk(requesterId),
      User.findByPk(targetUserId),
    ]);

    if (!requester || !requester.isActive) {
      throw new ComplimentServiceError(
        'Requester account is invalid or unavailable',
        401,
        'UNAUTHORIZED'
      );
    }

    if (!targetUser || !targetUser.isActive) {
      throw new ComplimentServiceError(
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
      throw new ComplimentServiceError(
        'Compliment cannot be sent due to privacy or block restrictions',
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
      throw new ComplimentServiceError(
        'You are already matched with this user',
        400,
        'ALREADY_MATCHED'
      );
    }

    // 5. Check if requester has already sent a pending compliment/request
    const existingRequest = await ConnectionRequest.findOne({
      where: {
        requesterId,
        targetUserId,
        status: 'pending',
      },
    });

    if (existingRequest) {
      throw new ComplimentServiceError(
        'A compliment is already pending for this user',
        409,
        'COMPLIMENT_ALREADY_PENDING'
      );
    }

    const requesterName =
      requester.nickName ||
      requester.firstName ||
      requester.fullName ||
      requester.username ||
      'Someone';

    // 6. Check if target user has ALREADY sent a pending request to requester (Mutual Connect -> Instant Match)
    const reversePendingRequest = await ConnectionRequest.findOne({
      where: {
        requesterId: targetUserId,
        targetUserId: requesterId,
        status: 'pending',
      },
    });

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

        await SwipeAction.upsert(
          { userId: requesterId, targetUserId, action: 'super_like' },
          { transaction: t }
        );

        await t.commit();

        // Dispatch compliment notification to targetUser
        try {
          await notificationService.sendComplimentNotification(targetUserId, {
            requesterId,
            requesterName,
            complimentId: reversePendingRequest.id,
            message: finalMessage,
          });

          // Dispatch match notifications to both users
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
        } catch (_notifErr) {
          // Notifications fail-safe
        }

        return {
          complimentId: reversePendingRequest.id,
          targetUserId,
          message: finalMessage,
          reason: finalReason,
          status: 'accepted',
          isMatched: true,
          matchId: match.id,
          createdAt: reversePendingRequest.createdAt
            ? reversePendingRequest.createdAt.toISOString()
            : new Date().toISOString(),
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
          message: finalMessage,
          reason: finalReason,
          momentId,
        },
        { transaction: t }
      );

      // Record discovery swipe action as super_like
      await SwipeAction.upsert(
        { userId: requesterId, targetUserId, action: 'super_like' },
        { transaction: t }
      );

      await t.commit();
    } catch (dbErr: any) {
      await t.rollback();
      throw dbErr;
    }

    // 8. Dispatch In-App & Push Notification to target user
    try {
      await notificationService.sendComplimentNotification(targetUserId, {
        requesterId,
        requesterName,
        complimentId: savedRequest.id,
        message: finalMessage,
      });
    } catch (notifErr: any) {
      console.error('[Send Compliment Notification Error]:', notifErr.message);
    }

    return {
      complimentId: savedRequest.id,
      targetUserId,
      message: savedRequest.message || finalMessage,
      reason: savedRequest.reason,
      status: savedRequest.status,
      isMatched: false,
      matchId: null,
      createdAt: savedRequest.createdAt
        ? savedRequest.createdAt.toISOString()
        : new Date().toISOString(),
    };
  }
}

export const complimentService = new ComplimentService();
