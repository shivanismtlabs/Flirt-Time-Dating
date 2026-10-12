import { Op } from 'sequelize';
import { sequelize, User, UserBlock, UserReport } from '../models';
import { ReportReason } from '../models/userReport.model';

export interface BlockUserResult {
  userId: string;
  isBlocked: boolean;
}

export interface ReportUserResult {
  reportId: string;
  status: string;
}

export class ModerationServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'ModerationServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ModerationServiceError.prototype);
  }
}

export class ModerationService {
  /**
   * Blocks a user, ensuring self-block prevention, target existence check,
   * idempotency, and concurrent request safety.
   */
  public async blockUser(
    blockerId: string,
    targetUserId: string,
    reason?: string | null
  ): Promise<BlockUserResult> {
    // 1. Prevent self-blocking
    if (blockerId === targetUserId) {
      throw new ModerationServiceError(
        'You cannot block yourself',
        400,
        'SELF_BLOCK_NOT_ALLOWED'
      );
    }

    // 2. Validate target user existence and active status
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new ModerationServiceError(
        'User not found or unavailable',
        404,
        'TARGET_USER_NOT_FOUND'
      );
    }

    // 3. Fast-path check for existing block (idempotency)
    const existing = await UserBlock.findOne({
      where: {
        userId: blockerId,
        blockedUserId: targetUserId,
      },
    });

    if (existing) {
      if (reason && existing.reason !== reason.trim()) {
        existing.reason = reason.trim();
        await existing.save();
      }
      return {
        userId: targetUserId,
        isBlocked: true,
      };
    }

    // 4. Create new block record with unique constraint race handling
    try {
      await UserBlock.create({
        userId: blockerId,
        blockedUserId: targetUserId,
        reason: reason ? reason.trim() : null,
      });

      return {
        userId: targetUserId,
        isBlocked: true,
      };
    } catch (err: any) {
      // Handle race condition unique constraint error gracefully as idempotent success
      if (
        err.name === 'SequelizeUniqueConstraintError' ||
        err.name?.includes('UniqueConstraint') ||
        err.original?.code === 'SQLITE_CONSTRAINT' ||
        err.original?.code === '23505'
      ) {
        return {
          userId: targetUserId,
          isBlocked: true,
        };
      }

      throw err;
    }
  }

  /**
   * Reports a user for abuse or policy violations.
   * Prevents self-reporting, validates target and reason, prevents duplicate spam reports,
   * and persists with pending review status.
   */
  public async reportUser(
    reporterId: string,
    targetUserId: string,
    reason: ReportReason,
    description?: string | null
  ): Promise<ReportUserResult> {
    // 1. Prevent self-reporting
    if (reporterId === targetUserId) {
      throw new ModerationServiceError(
        'You cannot report yourself',
        400,
        'SELF_REPORT_NOT_ALLOWED'
      );
    }

    // 2. Validate target user existence and active status
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new ModerationServiceError(
        'User not found or unavailable',
        404,
        'TARGET_USER_NOT_FOUND'
      );
    }

    // 3. Persist report safely inside a transaction, deduplicating open reports
    const t = await sequelize.transaction();
    try {
      const existingReport = await UserReport.findOne({
        where: {
          reporterId,
          targetUserId,
          status: 'pending',
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (existingReport) {
        // Return existing pending report idempotently to prevent duplicate flood
        await t.commit();
        return {
          reportId: existingReport.id,
          status: existingReport.status,
        };
      }

      const newReport = await UserReport.create(
        {
          reporterId,
          targetUserId,
          reason,
          description: description ? description.trim() : null,
          status: 'pending',
        },
        { transaction: t }
      );

      await t.commit();

      return {
        reportId: newReport.id,
        status: newReport.status,
      };
    } catch (err: any) {
      try {
        await t.rollback();
      } catch {
        // ignore rollback errors
      }
      throw err;
    }
  }

  /**
   * Helper utility to verify if communication or interaction between two users is permitted.
   * Enforces bidirectional block constraints.
   */
  public async canUsersInteract(userAId: string, userBId: string): Promise<boolean> {
    if (userAId === userBId) return false;

    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: userAId, blockedUserId: userBId },
          { userId: userBId, blockedUserId: userAId },
        ],
      },
    });

    return !blockRecord;
  }
}

export const moderationService = new ModerationService();
