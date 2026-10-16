import { Op } from 'sequelize';
import moment from 'moment-timezone';
import {
  sequelize,
  User,
  SwipeAction,
  Match,
  UserBlock,
  UserSubscription,
  SubscriptionPlan,
  SubscriptionFeature,
} from '../models';
import { notificationService } from './notification.service';

export const DAILY_SWIPE_LIMIT = 10;

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

class AsyncKeyLock {
  private promises = new Map<string, Promise<void>>();

  public async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    while (this.promises.has(key)) {
      try {
        await this.promises.get(key);
      } catch (_) {
        // ignore errors from previous holder
      }
    }

    let resolveFn!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });
    this.promises.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.promises.delete(key);
      resolveFn();
    }
  }
}

export const swipeActionLock = new AsyncKeyLock();

export class DiscoveryActionService {
  /**
   * Authoritatively determines server-side whether a user has an active, valid subscription
   * granting unlimited discovery swipes.
   */
  public async hasUnlimitedSwipes(
    userId: string,
    transaction?: any
  ): Promise<boolean> {
    const now = new Date();

    // 1. Check UserSubscription table for authoritative store purchases
    const latestSub = await UserSubscription.findOne({
      where: { userId },
      order: [['created_at', 'DESC']],
      include: [
        {
          model: SubscriptionPlan,
          as: 'plan',
          include: [
            {
              model: SubscriptionFeature,
              as: 'features',
              through: { attributes: [] },
              required: false,
            },
          ],
        },
      ],
      transaction,
    });

    if (latestSub) {
      const isRevokedOrRefunded =
        latestSub.status === 'revoked' || latestSub.status === 'refunded';
      if (isRevokedOrRefunded) {
        return false;
      }

      const expiresAt = new Date(latestSub.expiresAt);
      const isNotExpired = expiresAt.getTime() > now.getTime();
      const isGracePeriodActive =
        latestSub.status === 'in_grace_period' &&
        (!latestSub.gracePeriodExpiresAt ||
          new Date(latestSub.gracePeriodExpiresAt).getTime() > now.getTime());

      const isEntitledNow =
        Boolean(latestSub.isEntitled) && (isNotExpired || isGracePeriodActive);

      if (!isEntitledNow) {
        return false;
      }

      // In FlirtTime, all active entitled subscriptions grant unlimited discovery swipes
      return true;
    }

    // 2. Fallback check for user record (unit tests or direct manual subscription grants)
    const user = await User.findByPk(userId, { transaction });
    if (!user) return false;

    if (user.subscriptionExpiresAt) {
      const expiry = new Date(user.subscriptionExpiresAt);
      return expiry.getTime() > now.getTime() && Boolean(user.isSubscribed);
    }

    // If isSubscribed is true without an expiry timestamp or UserSubscription record
    return Boolean(user.isSubscribed);
  }

  /**
   * Persists a discovery swipe action (like, nope, super_like), prevents self-action,
   * validates user eligibility and block lists, enforces atomic daily swipe limits,
   * and handles mutual match creation safely.
   */
  public async recordAction(
    currentUserId: string,
    targetUserId: string,
    action: 'like' | 'nope' | 'super_like'
  ): Promise<RecordActionResult> {
    return swipeActionLock.acquire(currentUserId, async () => {
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
      const isPostgres = sequelize.getDialect() === 'postgres';
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
          ...(isPostgres && { lock: t.LOCK.UPDATE }),
        });

        if (existingSwipe) {
          // If the same action is repeated, treat as idempotent retry
          // Prevent duplicate retries from consuming additional quota
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

        // 5. Atomic Daily Swipe Limit Enforcement (under concurrency)
        // Lock current user record to serialize concurrent swipe requests
        await User.findByPk(currentUserId, {
          transaction: t,
          ...(isPostgres && { lock: t.LOCK.UPDATE }),
        });

        const isUnlimited = await this.hasUnlimitedSwipes(currentUserId, t);

        if (!isUnlimited) {
          const configuredTz = process.env.APP_TIMEZONE || process.env.TIMEZONE || 'UTC';
          const tz = moment.tz.zone(configuredTz) ? configuredTz : 'UTC';
          const now = new Date();
          const startOfDay = moment.tz(now, tz).startOf('day').toDate();
          const endOfDay = moment.tz(now, tz).endOf('day').toDate();

          const todaySwipesCount = await SwipeAction.count({
            where: {
              userId: currentUserId,
              createdAt: {
                [Op.gte]: startOfDay,
                [Op.lte]: endOfDay,
              },
            },
            transaction: t,
          });

          if (todaySwipesCount >= DAILY_SWIPE_LIMIT) {
            await t.rollback();
            isCommitted = true;
            throw new DiscoveryActionError(
              'Daily swipe limit reached. Upgrade to a subscription for unlimited swipes.',
              429,
              'DAILY_SWIPE_LIMIT_REACHED'
            );
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
    });
  }
}

export const discoveryActionService = new DiscoveryActionService();
