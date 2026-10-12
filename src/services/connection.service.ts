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

export interface CreateConnectionRequestResult {
  requestId: string;
  targetUserId: string;
  status: 'pending' | 'accepted';
  isMatched: boolean;
  matchId?: string | null;
  notification: PushNotificationResult;
}

export class ConnectionService {
  /**
   * Creates a connection request from the authenticated requester to the target user.
   * Handles self-connection prevention, block checks, mutual auto-matching, and push notifications.
   */
  public async createConnectionRequest(
    requesterId: string,
    targetUserId: string
  ): Promise<CreateConnectionRequestResult> {
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
          }
        );

        return {
          requestId: reversePendingRequest.id,
          targetUserId,
          status: 'accepted',
          isMatched: true,
          matchId: match.id,
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
      }
    );

    return {
      requestId: savedRequest.id,
      targetUserId,
      status: 'pending',
      isMatched: false,
      matchId: null,
      notification: pushResult,
    };
  }
}

export const connectionService = new ConnectionService();
