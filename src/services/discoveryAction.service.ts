import { Op } from 'sequelize';
import { sequelize, User, SwipeAction, Match, UserBlock, CoinTransaction } from '../models';
import { notificationService } from './notification.service';
import {
  getStartOfTodayIST,
  getNextMidnightIST,
  FREE_TIER_DAILY_LIKE_LIMIT,
  SUPER_LIKE_COIN_COST,
} from './freeTierLimit.service';

export interface RecordActionResult {
  targetUserId: string;
  action: 'like' | 'nope' | 'super_like';
  isMatched: boolean;
  matchId: string | null;
}

export class DiscoveryActionError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'DiscoveryActionError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, DiscoveryActionError.prototype);
  }
}

export class DiscoveryActionService {
  /**
   * Persists a discovery swipe action (like, nope, super_like), prevents self-action,
   * validates user eligibility and block lists, and handles mutual match creation safely.
   */
  public async recordAction(
    currentUserId: string,
    targetUserId: string,
    action: 'like' | 'nope' | 'super_like'
  ): Promise<RecordActionResult> {
    // 1. Prevent self-swiping
    if (currentUserId === targetUserId) {
      throw new DiscoveryActionError(
        'You cannot perform a discovery action on yourself',
        400,
        'SELF_ACTION_NOT_ALLOWED'
      );
    }

    // 2. Target user eligibility & active status check
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new DiscoveryActionError(
        'Target user does not exist or is unavailable',
        404,
        'TARGET_USER_NOT_FOUND'
      );
    }

    // 3. Block checks in both directions
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: currentUserId, blockedUserId: targetUserId },
          { userId: targetUserId, blockedUserId: currentUserId },
        ],
      },
    });

    if (blockRecord) {
      throw new DiscoveryActionError(
        'Action cannot be performed due to block or privacy restrictions',
        403,
        'ACTION_FORBIDDEN'
      );
    }

    // 4. Atomic transaction for swipe recording & match evaluation
    const t = await sequelize.transaction();
    let isCommitted = false;

    try {
      // Check existing swipe from current user to target user
      const existingSwipe = await SwipeAction.findOne({
        where: {
          userId: currentUserId,
          targetUserId,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existingSwipe) {
        // If the same action is repeated, treat as idempotent
        if (existingSwipe.action === action) {
          const [u1, u2] = [currentUserId, targetUserId].sort();
          const existingMatch = await Match.findOne({
            where: {
              user1Id: u1,
              user2Id: u2,
              isActive: true,
            },
            transaction: t,
          });

          await t.commit();
          isCommitted = true;
          return {
            targetUserId,
            action: existingSwipe.action,
            isMatched: !!existingMatch,
            matchId: existingMatch ? existingMatch.id : null,
          };
        }

        // If trying to change an existing action, reject with conflict
        await t.rollback();
        isCommitted = true;
        throw new DiscoveryActionError(
          `Conflicting action: you have already submitted '${existingSwipe.action}' for this user`,
          409,
          'ACTION_CONFLICT'
        );
      }

      // Fetch current user details with lock for quota and coin evaluations
      const currentUserRecord = await User.findByPk(currentUserId, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!currentUserRecord || !currentUserRecord.isActive) {
        await t.rollback();
        isCommitted = true;
        throw new DiscoveryActionError(
          'Authenticated user account is unavailable',
          401,
          'UNAUTHORIZED'
        );
      }

      const isSubscribed = Boolean(currentUserRecord.isSubscribed);
      let coinsSpent = 0;
      let remainingLikesAfterAction: number | null = null;

      // Rule 1: Free Tier Daily Like Limit (10/day, resets 00:00 IST)
      if (action === 'like' && !isSubscribed) {
        const startOfTodayIST = getStartOfTodayIST();
        const likesCountToday = await SwipeAction.count({
          where: {
            userId: currentUserId,
            action: 'like',
            createdAt: { [Op.gte]: startOfTodayIST },
          },
          transaction: t,
        });

        if (likesCountToday >= FREE_TIER_DAILY_LIKE_LIMIT) {
          await t.rollback();
          isCommitted = true;
          throw new DiscoveryActionError(
            `Daily like limit reached (${FREE_TIER_DAILY_LIKE_LIMIT}/${FREE_TIER_DAILY_LIKE_LIMIT}). Resets at midnight IST.`,
            403,
            'DAILY_LIKE_LIMIT_REACHED'
          );
        }

        remainingLikesAfterAction = Math.max(0, FREE_TIER_DAILY_LIKE_LIMIT - (likesCountToday + 1));
      }

      // Rule 3: Free Tier Super Like (1 free one-time, extra = 20 coins)
      if (action === 'super_like' && !isSubscribed) {
        const lifetimeSuperLikes = await SwipeAction.count({
          where: {
            userId: currentUserId,
            action: 'super_like',
          },
          transaction: t,
        });

        if (lifetimeSuperLikes >= 1) {
          // Free Super Like already consumed! Requires 20 coins
          const currentCoins =
            typeof currentUserRecord.coins === 'number' ? currentUserRecord.coins : 0;

          if (currentCoins < SUPER_LIKE_COIN_COST) {
            await t.rollback();
            isCommitted = true;
            throw new DiscoveryActionError(
              `Insufficient coins. Extra Super Like requires ${SUPER_LIKE_COIN_COST} coins.`,
              403,
              'INSUFFICIENT_COINS'
            );
          }

          currentUserRecord.coins = currentCoins - SUPER_LIKE_COIN_COST;
          await currentUserRecord.save({ transaction: t });

          await CoinTransaction.create(
            {
              userId: currentUserId,
              type: 'super_like',
              amount: SUPER_LIKE_COIN_COST,
              balanceBefore: currentCoins,
              balanceAfter: currentUserRecord.coins,
              referenceId: targetUserId,
              referenceType: 'super_like',
              description: `Super Like sent to ${targetUser.firstName || targetUser.fullName || targetUser.username || 'User'}`,
            },
            { transaction: t }
          );

          coinsSpent = SUPER_LIKE_COIN_COST;
        }
      }

      // Record the new swipe action
      await SwipeAction.create(
        {
          userId: currentUserId,
          targetUserId,
          action,
        },
        { transaction: t }
      );

      // Nope actions never create matches
      if (action === 'nope') {
        await t.commit();
        isCommitted = true;
        return {
          targetUserId,
          action: 'nope',
          isMatched: false,
          matchId: null,
        };
      }

      // Check for reciprocal like / super_like from the target user
      const reciprocalSwipe = await SwipeAction.findOne({
        where: {
          userId: targetUserId,
          targetUserId: currentUserId,
          action: {
            [Op.in]: ['like', 'super_like'],
          },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (reciprocalSwipe) {
        // Reciprocal like exists -> create or retrieve canonical Match
        const [u1, u2] = [currentUserId, targetUserId].sort();
        const [match] = await Match.findOrCreate({
          where: {
            user1Id: u1,
            user2Id: u2,
          },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            matchedBy: action,
            isActive: true,
          },
          transaction: t,
        });

        await t.commit();
        isCommitted = true;

        // Post-commit notification dispatch for mutual match
        try {
          const currentUser = await User.findByPk(currentUserId, {
            attributes: ['id', 'firstName', 'fullName', 'nickName'],
          });
          const currentName =
            currentUser?.firstName ||
            currentUser?.nickName ||
            (currentUser?.fullName ? currentUser.fullName.split(' ')[0] : 'Someone');
          const targetName =
            targetUser.firstName ||
            targetUser.nickName ||
            (targetUser.fullName ? targetUser.fullName.split(' ')[0] : 'Someone');

          // Notify target user
          await notificationService.dispatchNotification(targetUserId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${currentName} liked each other. Say hi!`,
            senderId: currentUserId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: currentName },
          });

          // Notify current user
          await notificationService.dispatchNotification(currentUserId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${targetName} liked each other. Say hi!`,
            senderId: targetUserId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: targetName },
          });
        } catch (_notifErr) {
          // Safe to ignore notification error
        }

        return {
          targetUserId,
          action,
          isMatched: true,
          matchId: match.id,
        };
      }

      // No reciprocal like yet
      await t.commit();
      isCommitted = true;

      // Post-commit notification for like / super_like
      try {
        const currentUser = await User.findByPk(currentUserId, {
          attributes: ['id', 'firstName', 'fullName', 'nickName'],
        });
        const currentName =
          currentUser?.firstName ||
          currentUser?.nickName ||
          (currentUser?.fullName ? currentUser.fullName.split(' ')[0] : 'Someone');
        const isSuper = action === 'super_like';

        await notificationService.dispatchNotification(targetUserId, {
          type: isSuper ? 'super_like' : 'like',
          title: isSuper ? 'New Super Like!' : 'New Like',
          body: `${currentName} ${isSuper ? 'super liked' : 'liked'} your profile!`,
          senderId: currentUserId,
          entityId: currentUserId,
          navigation: { type: isSuper ? 'super_like' : 'like', targetId: currentUserId },
          data: { action, senderName: currentName },
        });
      } catch (_likeNotifErr) {
        // Safe to ignore notification error
      }

      return {
        targetUserId,
        action,
        isMatched: false,
        matchId: null,
      };
    } catch (err: any) {
      if (!isCommitted) {
        try {
          await t.rollback();
        } catch {
          // ignore already completed rollback
        }
      }
      if (err instanceof DiscoveryActionError) {
        throw err;
      }
      // Handle race condition unique constraint error gracefully
      if (err.name === 'SequelizeUniqueConstraintError') {
        const [u1, u2] = [currentUserId, targetUserId].sort();
        const existingMatch = await Match.findOne({
          where: { user1Id: u1, user2Id: u2, isActive: true },
        });
        return {
          targetUserId,
          action,
          isMatched: !!existingMatch,
          matchId: existingMatch ? existingMatch.id : null,
        };
      }
      throw err;
    }
  }
}

export const discoveryActionService = new DiscoveryActionService();
