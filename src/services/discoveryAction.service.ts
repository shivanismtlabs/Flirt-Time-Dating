import { Op } from 'sequelize';
import { sequelize, User, SwipeAction, Match, UserBlock } from '../models';

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
