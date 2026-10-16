import { Op } from 'sequelize';
import { sequelize, User, UserBlock, UserReport, Moment, MomentMedia } from '../models';
import { ReportReason, ReportStatus } from '../models/userReport.model';
import { formatMediaUrl } from './s3.service';

export interface BlockUserResult {
  userId: string;
  isBlocked: boolean;
}

export interface ReportUserResult {
  reportId: string;
  status: string;
}

export interface ReportMomentResult {
  reportId: string;
  momentId: string;
  status: string;
}

export interface BlockedUserItem {
  userId: string;
  name: string;
  username: string;
  profilePhoto: string | null;
  reason: string | null;
  blockedAt: Date;
}

export interface BlockedUsersResponse {
  blockedUsers: BlockedUserItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ReportItem {
  id: string;
  targetType: string;
  targetUserId: string;
  targetName: string | null;
  username?: string | null;
  targetPhoto: string | null;
  momentId?: string | null;
  momentThumbnail?: string | null;
  reason: string;
  description: string | null;
  status: string;
  createdAt: Date;
  reporterName?: string | null;
}

export interface ReportsListResponse {
  reports: ReportItem[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  counts?: {
    pending: number;
    reviewed: number;
    dismissed: number;
    resolved: number;
    total: number;
  };
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
   * Reports a specific Moment for policy or community guideline violations.
   * - Validates moment existence, active status, and non-expiration.
   * - Prevents users from reporting their own Moment.
   * - Enforces bidirectional block constraints if applicable.
   * - Deduplicates pending reports from the same reporter on this Moment idempotently.
   * - Safely associates the report with both the moment (momentId) and its creator (targetUserId).
   * - Sets initial status to 'pending' without auto-banning or deleting.
   */
  public async reportMoment(
    reporterId: string,
    momentId: string,
    reason: ReportReason,
    description?: string | null
  ): Promise<ReportMomentResult> {
    // 1. Fetch moment and validate existence
    const moment = await Moment.findByPk(momentId);
    if (!moment) {
      throw new ModerationServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    // 2. Reject deleted moments
    if (moment.status === 'deleted') {
      throw new ModerationServiceError(
        'Moment has been deleted or is unavailable',
        400,
        'MOMENT_UNAVAILABLE'
      );
    }

    // 3. Reject expired moments
    const isExpired =
      moment.status === 'expired' ||
      (!!moment.expiresAt && new Date(moment.expiresAt).getTime() <= Date.now());
    if (isExpired) {
      throw new ModerationServiceError(
        'Moment has expired and cannot be reported',
        400,
        'MOMENT_EXPIRED'
      );
    }

    // 4. Prevent self-reporting
    if (moment.userId === reporterId) {
      throw new ModerationServiceError(
        'You cannot report your own Moment',
        400,
        'SELF_REPORT_NOT_ALLOWED'
      );
    }

    // 5. Verify creator account status
    const creator = await User.findByPk(moment.userId);
    if (!creator || !creator.isActive) {
      throw new ModerationServiceError(
        'Moment creator account is no longer active',
        404,
        'CREATOR_UNAVAILABLE'
      );
    }

    // 6. Check block status
    const canInteract = await this.canUsersInteract(reporterId, moment.userId);
    if (!canInteract) {
      throw new ModerationServiceError(
        'Unable to report this Moment due to block or privacy settings',
        403,
        'USER_BLOCKED'
      );
    }

    // 7. Fast-path idempotency check before opening transaction
    const fastExisting = await UserReport.findOne({
      where: {
        reporterId,
        momentId,
        status: 'pending',
      },
    });
    if (fastExisting) {
      return {
        reportId: fastExisting.id,
        momentId: fastExisting.momentId || moment.id,
        status: fastExisting.status,
      };
    }

    // 8. Deduplicate and persist safely in transaction
    const isSqlite = sequelize.getDialect() === 'sqlite';
    const t = await sequelize.transaction();
    try {
      const existingReport = await UserReport.findOne({
        where: {
          reporterId,
          momentId,
          status: 'pending',
        },
        transaction: t,
        lock: !isSqlite && t.LOCK ? t.LOCK.UPDATE : undefined,
      });

      if (existingReport) {
        await t.commit();
        return {
          reportId: existingReport.id,
          momentId: existingReport.momentId || moment.id,
          status: existingReport.status,
        };
      }

      const newReport = await UserReport.create(
        {
          reporterId,
          targetUserId: moment.userId,
          targetType: 'moment',
          momentId: moment.id,
          reason,
          description: description ? description.trim() : null,
          status: 'pending',
        },
        { transaction: t }
      );

      await t.commit();

      return {
        reportId: newReport.id,
        momentId: newReport.momentId || moment.id,
        status: newReport.status,
      };
    } catch (err: any) {
      try {
        await t.rollback();
      } catch {
        // ignore rollback errors
      }

      // Handle concurrency race conditions and busy locks gracefully
      if (
        err.name === 'SequelizeTimeoutError' ||
        err.original?.code === 'SQLITE_BUSY' ||
        err.message?.includes('SQLITE_BUSY') ||
        err.name === 'SequelizeUniqueConstraintError' ||
        err.name?.includes('UniqueConstraint') ||
        err.original?.code === 'SQLITE_CONSTRAINT' ||
        err.original?.code === '23505'
      ) {
        // Give concurrent transaction a brief moment to commit
        await new Promise((resolve) => setTimeout(resolve, 50));
        const raceExisting = await UserReport.findOne({
          where: {
            reporterId,
            momentId,
            status: 'pending',
          },
        });
        if (raceExisting) {
          return {
            reportId: raceExisting.id,
            momentId: raceExisting.momentId || moment.id,
            status: raceExisting.status,
          };
        }
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

  /**
   * Retrieves paginated list of users blocked by the authenticated user
   */
  public async getBlockedUsers(
    userId: string,
    options?: { page?: number; limit?: number }
  ): Promise<BlockedUsersResponse> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await UserBlock.findAndCountAll({
      where: { userId },
      include: [
        {
          model: User,
          as: 'blockedUser',
          attributes: [
            'id',
            'username',
            'fullName',
            'firstName',
            'nickName',
            'profilePicture',
            'city',
            'gender',
            'isFaceVerified',
          ],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const blockedUsers: BlockedUserItem[] = rows.map((block) => {
      const target = (block as any).blockedUser;
      const username = target?.username || 'Unknown';
      const displayName =
        target?.username ||
        target?.firstName ||
        (target?.fullName ? target.fullName.split(' ')[0] : null) ||
        target?.nickName ||
        'User';

      return {
        userId: block.blockedUserId,
        name: displayName,
        username,
        profilePhoto: target?.profilePicture ? formatMediaUrl(target.profilePicture) : null,
        reason: block.reason || null,
        blockedAt: block.createdAt,
      };
    });

    return {
      blockedUsers,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  /**
   * Unblocks a previously blocked user
   */
  public async unblockUser(
    blockerId: string,
    targetUserId: string
  ): Promise<{ userId: string; isBlocked: boolean }> {
    if (blockerId === targetUserId) {
      throw new ModerationServiceError(
        'You cannot unblock yourself',
        400,
        'SELF_UNBLOCK_NOT_ALLOWED'
      );
    }

    const existingBlock = await UserBlock.findOne({
      where: {
        userId: blockerId,
        blockedUserId: targetUserId,
      },
    });

    if (!existingBlock) {
      throw new ModerationServiceError(
        'User is not blocked or block record not found',
        404,
        'BLOCK_NOT_FOUND'
      );
    }

    await existingBlock.destroy();

    return {
      userId: targetUserId,
      isBlocked: false,
    };
  }

  /**
   * Retrieves reports filed by a specific user with pagination and optional filters
   */
  public async getUserReports(
    reporterId: string,
    options?: {
      page?: number;
      limit?: number;
      status?: string;
      targetType?: string;
    }
  ): Promise<ReportsListResponse> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const whereClause: any = { reporterId };
    if (options?.status) {
      whereClause.status = options.status;
    }
    if (options?.targetType) {
      whereClause.targetType = options.targetType;
    }

    const { count, rows } = await UserReport.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'targetUser',
          attributes: ['id', 'username', 'fullName', 'firstName', 'profilePicture'],
          required: false,
        },
        {
          model: Moment,
          as: 'moment',
          attributes: ['id', 'caption'],
          include: [
            {
              model: MomentMedia,
              as: 'media',
              attributes: ['mediaUrl'],
              required: false,
            },
          ],
          required: false,
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const reports: ReportItem[] = rows.map((r: any) => {
      const firstMediaUrl = r.moment?.media?.[0]?.mediaUrl;
      const targetUsername = r.targetUser?.username || null;
      const targetName =
        targetUsername ||
        r.targetUser?.firstName ||
        (r.targetUser?.fullName ? r.targetUser.fullName.split(' ')[0] : null) ||
        null;

      return {
        id: r.id,
        targetType: r.targetType,
        targetUserId: r.targetUserId,
        targetName,
        username: targetUsername,
        targetPhoto: r.targetUser?.profilePicture
          ? formatMediaUrl(r.targetUser.profilePicture)
          : null,
        momentId: r.momentId || null,
        momentThumbnail: firstMediaUrl ? formatMediaUrl(firstMediaUrl) : null,
        reason: r.reason,
        description: r.description || null,
        status: r.status,
        createdAt: r.createdAt,
      };
    });

    return {
      reports,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit) || 1,
      },
    };
  }

  /**
   * Retrieves all reports for moderation/admin dashboard with pagination, counts and filters
   */
  public async getAllReports(options?: {
    page?: number;
    limit?: number;
    status?: string;
    targetType?: string;
    search?: string;
  }): Promise<ReportsListResponse> {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const whereClause: any = {};
    if (options?.status) {
      whereClause.status = options.status;
    }
    if (options?.targetType) {
      whereClause.targetType = options.targetType;
    }

    const [pendingCount, reviewedCount, dismissedCount, resolvedCount, totalCountResult] =
      await Promise.all([
        UserReport.count({ where: { status: 'pending' } }),
        UserReport.count({ where: { status: 'reviewed' } }),
        UserReport.count({ where: { status: 'dismissed' } }),
        UserReport.count({ where: { status: 'resolved' } }),
        UserReport.findAndCountAll({
          where: whereClause,
          include: [
            {
              model: User,
              as: 'reporter',
              attributes: ['id', 'username', 'email', 'fullName', 'firstName'],
              required: false,
            },
            {
              model: User,
              as: 'targetUser',
              attributes: ['id', 'username', 'email', 'fullName', 'firstName', 'profilePicture'],
              required: false,
            },
            {
              model: Moment,
              as: 'moment',
              attributes: ['id', 'caption'],
              include: [
                {
                  model: MomentMedia,
                  as: 'media',
                  attributes: ['mediaUrl'],
                  required: false,
                },
              ],
              required: false,
            },
          ],
          order: [['createdAt', 'DESC']],
          limit,
          offset,
        }),
      ]);

    const reports: ReportItem[] = totalCountResult.rows.map((r: any) => {
      const firstMediaUrl = r.moment?.media?.[0]?.mediaUrl;
      const targetUsername = r.targetUser?.username || null;
      const targetName =
        targetUsername ||
        r.targetUser?.firstName ||
        (r.targetUser?.fullName ? r.targetUser.fullName.split(' ')[0] : null) ||
        null;
      const reporterUsername = r.reporter?.username || null;
      const reporterName =
        reporterUsername ||
        r.reporter?.firstName ||
        (r.reporter?.fullName ? r.reporter.fullName.split(' ')[0] : null) ||
        null;

      return {
        id: r.id,
        targetType: r.targetType,
        targetUserId: r.targetUserId,
        targetName,
        username: targetUsername,
        targetPhoto: r.targetUser?.profilePicture
          ? formatMediaUrl(r.targetUser.profilePicture)
          : null,
        momentId: r.momentId || null,
        momentThumbnail: firstMediaUrl ? formatMediaUrl(firstMediaUrl) : null,
        reason: r.reason,
        description: r.description || null,
        status: r.status,
        createdAt: r.createdAt,
        reporterName,
      };
    });

    return {
      reports,
      pagination: {
        total: totalCountResult.count,
        page,
        limit,
        totalPages: Math.ceil(totalCountResult.count / limit) || 1,
      },
      counts: {
        pending: pendingCount,
        reviewed: reviewedCount,
        dismissed: dismissedCount,
        resolved: resolvedCount,
        total: pendingCount + reviewedCount + dismissedCount + resolvedCount,
      },
    };
  }

  /**
   * Updates the status of an existing report (e.g. pending -> reviewed / dismissed / resolved)
   */
  public async updateReportStatus(
    reportId: string,
    status: ReportStatus,
    reviewNotes?: string | null
  ): Promise<UserReport> {
    const report = await UserReport.findByPk(reportId);
    if (!report) {
      throw new ModerationServiceError('Report not found', 404, 'REPORT_NOT_FOUND');
    }

    report.status = status;
    if (reviewNotes && 'description' in report) {
      // Optional description note
    }
    await report.save();

    return report;
  }

  /**
   * Returns list of configured report reasons and categories for mobile UI modals
   */
  public getReportReasons() {
    return {
      userReasons: [
        { key: 'fake_profile', label: 'Fake profile / Impersonation' },
        { key: 'harassment', label: 'Harassment / Cyberbullying' },
        { key: 'inappropriate_content', label: 'Inappropriate Content' },
        { key: 'spam', label: 'Spam or Commercial Promotion' },
        { key: 'scam', label: 'Scam or Fraud' },
        { key: 'underage', label: 'Underage User' },
        { key: 'other', label: 'Other' },
      ],
      momentReasons: [
        { key: 'nudity', label: 'Nudity or Sexual Content' },
        { key: 'violence', label: 'Violence or Graphic Content' },
        { key: 'harassment', label: 'Harassment or Bullying' },
        { key: 'spam', label: 'Spam or Advertising' },
        { key: 'fake_content', label: 'Fake or Misleading Content' },
        { key: 'underage', label: 'Involves Minors' },
        { key: 'other', label: 'Other' },
      ],
    };
  }
}

export const moderationService = new ModerationService();
