import { Op, QueryTypes } from 'sequelize';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
  MomentGift,
  MOMENT_GIFTS_CATALOG,
  ensureMomentGiftTables,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
  UserReport,
  UserInterest,
  Interest,
  MomentCommentLike,
} from '../models';
import {
  s3Service,
  formatMediaUrl,
  formatThumbnailUrl,
  extractS3Key,
} from './s3.service';
import { calculateInterestMatchPercentage } from '../utils/compatibility';
import { MomentAudience } from '../models/moment.model';
import { MomentReactionType } from '../models/momentReaction.model';
import { notificationService } from './notification.service';
import {
  publishMomentRealtime,
  MomentLiveUpdateInput,
} from '../realtime/socket.moment';
import { resolveMomentLocationLabel } from '../utils/momentLocation';

export class MomentServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;
  public data?: any;

  constructor(message: string, statusCode = 400, errorCode?: string, data?: any) {
    super(message);
    this.name = 'MomentServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.data = data;
    Object.setPrototypeOf(this, MomentServiceError.prototype);
  }
}

/**
 * Validates actual binary signature (magic bytes) of an image buffer
 */
export const validateImageSignature = (buffer: Buffer): boolean => {
  if (!buffer || buffer.length < 4) return false;

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }

  // WebP: RIFF (bytes 0-3) ... WEBP (bytes 8-11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  return false;
};

/**
 * Formats a relative age string from publication timestamp (e.g. '10m ago', '2h ago')
 */
export const formatRelativeAge = (publishedAt: Date): string => {
  const diffMs = Math.max(0, Date.now() - new Date(publishedAt).getTime());
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

/**
 * Formats a short time-ago string matching mobile card header (e.g. 'now', '10m', '1h', '2d')
 */
export const formatTimeAgoShort = (publishedAt: Date): string => {
  const diffMs = Math.max(0, Date.now() - new Date(publishedAt).getTime());
  const diffMinutes = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'now';
  if (diffMinutes < 60) return `${diffMinutes}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w`;
};

export class MomentService {
  /**
   * Sends one in-app + push notification. Skips self and never blocks the API response.
   */
  private dispatchMomentNotification(
    recipientId: string,
    senderId: string,
    send: (senderName: string) => Promise<unknown>
  ): void {
    if (!recipientId || recipientId === senderId) return;
    void (async () => {
      try {
        const senderUser = await User.findByPk(senderId, {
          attributes: ['id', 'username', 'fullName', 'firstName', 'nickName'],
        });
        const senderName =
          senderUser?.fullName ||
          senderUser?.firstName ||
          senderUser?.nickName ||
          senderUser?.username ||
          'Someone';
        await send(senderName);
      } catch (err: any) {
        console.warn('[Moment notification]', err?.message || err);
      }
    })();
  }

  /**
   * Pushes like, comment, and gift activity to sockets watching this moment.
   * Never blocks or fails the HTTP response.
   */
  private emitMomentActivity(update: MomentLiveUpdateInput): void {
    void publishMomentRealtime(update);
  }

  /**
   * Publishes a new Moment with 1 to 5 images.
   * Ensures atomic persistence and cleans up orphaned S3 uploads on failure.
   */
  public async createMoment(input: {
    creatorId: string;
    caption?: string | null;
    audience?: MomentAudience;
    locationLabel?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    files?: Express.Multer.File[];
    mediaUrls?: string[];
  }) {
    const {
      creatorId,
      caption,
      audience = 'everyone',
      locationLabel,
      latitude = null,
      longitude = null,
      files = [],
      mediaUrls = [],
    } = input;

    // Filter valid non-empty mediaUrls
    const validMediaUrls = (mediaUrls || [])
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean);

    // 1. Validate images presence (1 to 5 required across files and mediaUrls)
    const totalImagesCount = files.length + validMediaUrls.length;
    if (totalImagesCount === 0) {
      throw new MomentServiceError(
        'At least 1 image is required to create a Moment',
        400,
        'NO_IMAGES_PROVIDED'
      );
    }

    if (totalImagesCount > 5) {
      throw new MomentServiceError(
        'Maximum 5 images allowed per Moment',
        400,
        'TOO_MANY_IMAGES'
      );
    }

    // 2. Validate creator account eligibility
    const creator = await User.findByPk(creatorId);
    if (!creator || !creator.isActive) {
      throw new MomentServiceError(
        'User account not found or unavailable',
        404,
        'USER_NOT_FOUND'
      );
    }

    // 3. Validate image magic bytes and individual sizes for files
    for (const [index, file] of files.entries()) {
      if (!file.buffer || file.buffer.length === 0) {
        throw new MomentServiceError(
          `Image ${index + 1} is empty or missing data`,
          400,
          'EMPTY_FILE'
        );
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new MomentServiceError(
          `Image ${index + 1} exceeds 5MB limit`,
          400,
          'FILE_TOO_LARGE'
        );
      }

      if (!validateImageSignature(file.buffer)) {
        throw new MomentServiceError(
          `Image ${index + 1} content is corrupted or in an unsupported format`,
          400,
          'CORRUPTED_IMAGE'
        );
      }
    }

    // 4. Validate and verify pre-uploaded S3 keys preserving order
    const uploadedMediaKeys: Array<{
      key: string;
      order: number;
      isDirectUpload?: boolean;
    }> = [];

    // Pre-uploaded URLs first with strict authorization and storage validation
    for (const preUrl of validMediaUrls) {
      const key = extractS3Key(preUrl);

      // a. Path traversal protection
      if (!key || key.includes('..') || key.startsWith('/')) {
        throw new MomentServiceError('Invalid S3 object key', 400, 'INVALID_KEY');
      }

      // b. Folder authorization check (must be inside allowed media directories)
      const isAllowedFolder = ['moments/', 'uploads/', 'photos/'].some((prefix) =>
        key.startsWith(prefix)
      );
      if (!isAllowedFolder && key.includes('/')) {
        throw new MomentServiceError(
          'Image key must be within an authorized storage folder',
          400,
          'INVALID_FOLDER'
        );
      }

      // c. User authorization check: The key must belong to creatorId
      const isAuthorizedUser =
        key.startsWith(`${creatorId}/`) || key.includes(`/${creatorId}/`);

      if (!isAuthorizedUser) {
        throw new MomentServiceError(
          'You are not authorized to attach uploads belonging to another user',
          403,
          'UNAUTHORIZED_IMAGE_KEY'
        );
      }

      // d. Duplicate submission check: ensure key hasn't already been used in another Moment
      const alreadyUsed = await MomentMedia.findOne({
        where: { mediaUrl: key },
      });
      if (alreadyUsed) {
        throw new MomentServiceError(
          'This image has already been submitted for another Moment',
          409,
          'DUPLICATE_IMAGE_SUBMISSION'
        );
      }

      // e. S3 Object existence & metadata validation
      const objectMeta = await s3Service.checkObjectExists(key);
      if (!objectMeta.exists) {
        throw new MomentServiceError(
          'Uploaded image not found in storage. Please upload the image to S3 before creating the Moment.',
          400,
          'S3_OBJECT_NOT_FOUND'
        );
      }

      if (objectMeta.contentLength && objectMeta.contentLength > 5 * 1024 * 1024) {
        throw new MomentServiceError(
          'Uploaded image exceeds the 5MB size limit',
          400,
          'FILE_TOO_LARGE'
        );
      }

      if (objectMeta.contentType && !objectMeta.contentType.startsWith('image/')) {
        throw new MomentServiceError(
          'Uploaded file is not a supported image format',
          400,
          'INVALID_IMAGE_TYPE'
        );
      }

      // Ensure thumbnail exists for pre-uploaded media key
      s3Service.ensureThumbnail(key);

      uploadedMediaKeys.push({
        key,
        order: uploadedMediaKeys.length,
        isDirectUpload: false,
      });
    }

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const s3Key = await s3Service.uploadMedia(
          file.buffer,
          creatorId,
          file.mimetype,
          'moments'
        );
        uploadedMediaKeys.push({
          key: s3Key,
          order: uploadedMediaKeys.length,
          isDirectUpload: true,
        });
      }
    } catch (uploadErr: any) {
      // Clean up any successfully uploaded keys before error
      for (const item of uploadedMediaKeys) {
        if (item.isDirectUpload) {
          await s3Service.deleteObject(item.key);
        }
      }
      throw uploadErr;
    }

    // 5. Permanent Moment - no 24-hour expiry
    const publishedAt = new Date();
    const expiresAt = null;
    const resolvedLocationLabel = await resolveMomentLocationLabel({
      uploadedLabel: locationLabel,
      latitude,
      longitude,
      profileCity: creator.city,
      profileLatitude: creator.latitude,
      profileLongitude: creator.longitude,
    });

    // 6. Atomic database persistence
    const t = await sequelize.transaction();
    try {
      let moment: Moment;
      try {
        moment = await Moment.create(
          {
            userId: creatorId,
            caption: caption ? caption.trim() : null,
            audience,
            status: 'active',
            publishedAt,
            expiresAt: null,
            locationLabel: resolvedLocationLabel,
          },
          { transaction: t }
        );
      } catch (createErr: any) {
        // Fallback for database instances where expiresAt NOT NULL constraint hasn't been dropped yet
        const isNotNullConstraintError =
          createErr.original?.code === '23502' ||
          (typeof createErr.message === 'string' &&
            createErr.message.toLowerCase().includes('expiresat') &&
            createErr.message.toLowerCase().includes('not-null'));

        if (isNotNullConstraintError) {
          try {
            await sequelize.query(
              'ALTER TABLE "moments" ALTER COLUMN "expiresAt" DROP NOT NULL;'
            );
          } catch (_ignore) {}

          // Fallback creation with far-future date (100 years from now) so insert succeeds
          moment = await Moment.create(
            {
              userId: creatorId,
              caption: caption ? caption.trim() : null,
              audience,
              status: 'active',
              publishedAt,
              expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
              locationLabel: resolvedLocationLabel,
            },
            { transaction: t }
          );
        } else {
          throw createErr;
        }
      }

      const mediaRecords = [];
      for (const item of uploadedMediaKeys) {
        const media = await MomentMedia.create(
          {
            momentId: moment.id,
            mediaUrl: item.key,
            mediaType: 'image',
            displayOrder: item.order,
          },
          { transaction: t }
        );
        mediaRecords.push(media);
      }

      await t.commit();

      const media = mediaRecords.map((m) => ({
        mediaId: m.id,
        imageKey: m.mediaUrl,
        imageUrl: formatMediaUrl(m.mediaUrl),
        mediaUrl: formatMediaUrl(m.mediaUrl),
        thumbnailUrl: formatThumbnailUrl(m.mediaUrl),
        mediaType: m.mediaType,
        displayOrder: m.displayOrder,
      }));

      const creatorName =
        creator.firstName ||
        (creator.fullName ? creator.fullName.split(' ')[0] : null) ||
        creator.nickName ||
        creator.username ||
        'User';

      const createdMoment = {
        momentId: moment.id,
        creatorId: moment.userId,
        caption: moment.caption,
        audience: moment.audience,
        status: moment.status,
        publishedAt: moment.publishedAt,
        expiresAt: moment.expiresAt,
        locationLabel: moment.locationLabel,
        location: moment.locationLabel ? { name: moment.locationLabel } : null,
        media,
      };

      this.emitMomentActivity({
        type: 'created',
        momentId: moment.id,
        ownerId: moment.userId,
        actorId: creatorId,
        likesCount: 0,
        commentsCount: 0,
        giftsCount: 0,
        actor: {
          id: creator.id,
          name: creator.fullName || creator.nickName || creatorName,
          username: creator.username || null,
          profilePhoto: creator.profilePicture
            ? formatThumbnailUrl(creator.profilePicture)
            : null,
        },
        moment: {
          id: moment.id,
          momentId: moment.id,
          caption: moment.caption,
          audience: moment.audience,
          status: moment.status,
          publishedAt: moment.publishedAt,
          createdAt: moment.createdAt,
          expiresAt: moment.expiresAt,
          locationLabel: moment.locationLabel,
          location: createdMoment.location,
          media,
          imageUrl: media[0] ? media[0].imageUrl : null,
          mediaUrl: media[0] ? media[0].mediaUrl : null,
          thumbnailUrl: media[0] ? media[0].thumbnailUrl : null,
          mediaCount: media.length,
          likesCount: 0,
          commentsCount: 0,
          giftsCount: 0,
          creator: {
            id: creator.id,
            creatorId: creator.id,
            name: creatorName,
            fullName: creator.fullName || null,
            username: creator.username,
            profilePhoto: creator.profilePicture
              ? formatThumbnailUrl(creator.profilePicture)
              : null,
          },
        },
      });

      return createdMoment;
    } catch (dbErr: any) {
      await t.rollback();
      // Clean up orphaned S3 uploads on database failure
      for (const item of uploadedMediaKeys) {
        if (item.isDirectUpload) {
          await s3Service.deleteObject(item.key);
        }
      }
      throw dbErr;
    }
  }

  /**
   * Retrieves active Moments created by a specific individual or the authenticated user.
   * Supports targetUserId = 'me' or target user UUID.
   * Returns rich moment objects (media list, creator, likesCount, commentsCount)
   * while maintaining backwards compatibility (momentId, thumbnailUrl, mediaCount).
   */
  public async getUserMoments(
    viewerId: string,
    targetUserId: string,
    options: { page?: number; limit?: number } = {}
  ) {
    const resolvedUserId =
      !targetUserId || targetUserId === 'me' || targetUserId === viewerId
        ? viewerId
        : targetUserId;

    // 1. Check target existence
    const targetUser = await User.findByPk(resolvedUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new MomentServiceError(
        'User not found or unavailable',
        404,
        'USER_NOT_FOUND'
      );
    }

    const isSelf = viewerId === resolvedUserId;

    // 2. Block check in both directions if not querying oneself
    if (!isSelf) {
      const blockRecord = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: viewerId, blockedUserId: resolvedUserId },
            { userId: resolvedUserId, blockedUserId: viewerId },
          ],
        },
      });

      if (blockRecord) {
        throw new MomentServiceError(
          'Moments unavailable due to privacy restrictions',
          403,
          'MOMENTS_BLOCKED'
        );
      }
    }

    // 3. Check mutual match status if viewer is not the creator
    let isMatched = false;
    if (!isSelf) {
      const [u1, u2] = [viewerId, resolvedUserId].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
      });
      isMatched = !!match;
    }

    // 4. Pagination
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const now = new Date();

    // 5. Query active Moments
    const whereConditions: any[] = [
      { userId: resolvedUserId },
      { status: 'active' },
      {
        [Op.or]: [
          { expiresAt: null },
          { expiresAt: { [Op.gt]: now } },
        ],
      },
    ];

    if (!isSelf && !isMatched) {
      whereConditions.push({ audience: { [Op.ne]: 'matches_only' } });
    }

    if (!isSelf) {
      const reports = await UserReport.findAll({
        where: {
          reporterId: viewerId,
          targetUserId: resolvedUserId,
          status: { [Op.ne]: 'dismissed' },
        },
        attributes: ['targetType', 'momentId'],
      });

      const hasUserReport = reports.some(
        (r) => !r.momentId && (r.targetType === 'user' || !r.targetType)
      );
      if (hasUserReport) {
        return {
          type: 'feed',
          page,
          limit,
          totalCount: 0,
          totalPages: 0,
          moments: [],
        };
      }

      const reportedMomentIds = reports
        .map((r) => r.momentId)
        .filter((id): id is string => Boolean(id));

      if (reportedMomentIds.length > 0) {
        whereConditions.push({
          id: { [Op.notIn]: reportedMomentIds },
        });
      }
    }

    const momentWhere = { [Op.and]: whereConditions };
    const [count, moments] = await Promise.all([
      Moment.count({ where: momentWhere }),
      Moment.findAll({
        where: momentWhere,
        include: [
          {
            model: MomentMedia,
            as: 'media',
          },
        ],
        order: [
          ['publishedAt', 'DESC'],
          ['id', 'DESC'],
          [{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC'],
        ],
        limit,
        offset,
      }),
    ]);

    // 6. Replies / comments counts & gifts counts
    const momentIds = moments.map((m: any) => m.id);
    const repliesCountMap = new Map<string, number>();
    const giftsCountMap = new Map<string, number>();
    for (const id of momentIds) {
      repliesCountMap.set(id, 0);
      giftsCountMap.set(id, 0);
    }

    if (momentIds.length > 0) {
      const [counted, giftRecords, reactionRows] = await Promise.all([
        this.countMomentReplies(momentIds).catch(() => new Map<string, number>()),
        MomentGift.findAll({
          where: { momentId: { [Op.in]: momentIds } },
          attributes: ['momentId', 'quantity'],
        }).catch(() => [] as MomentGift[]),
        MomentReaction.findAll({
          where: { momentId: { [Op.in]: momentIds } },
          attributes: ['momentId', 'userId', 'reaction'],
        }).catch(() => [] as MomentReaction[]),
      ]);

      for (const [id, total] of counted) repliesCountMap.set(id, total);

      for (const g of giftRecords) {
        const mId = g.momentId;
        const qty = Number(g.quantity) || 1;
        if (giftsCountMap.has(mId)) {
          giftsCountMap.set(mId, (giftsCountMap.get(mId) || 0) + qty);
        }
      }

      const reactionsByMoment = new Map<string, MomentReaction[]>();
      for (const row of reactionRows) {
        const list = reactionsByMoment.get(row.momentId) || [];
        list.push(row);
        reactionsByMoment.set(row.momentId, list);
      }
      for (const moment of moments) {
        moment.setDataValue('reactions', reactionsByMoment.get(moment.id) || []);
      }
    }

    const { momentCounts, compatibilityMap } = await this.getCompatibilityAndMomentCounts(
      viewerId,
      [resolvedUserId]
    );
    const targetMomentCount = momentCounts.get(resolvedUserId) || count;
    const targetCompatibility = compatibilityMap.get(resolvedUserId) || {
      interestMatchPercentage: 0,
    };

    const creatorName =
      targetUser.firstName ||
      (targetUser.fullName ? targetUser.fullName.split(' ')[0] : null) ||
      targetUser.nickName ||
      targetUser.username ||
      'User';

    const creatorInfo = {
      id: targetUser.id,
      creatorId: targetUser.id,
      userId: targetUser.id,
      name: creatorName,
      fullName: targetUser.fullName || null,
      username: targetUser.username,
      profilePhoto: targetUser.profilePicture ? formatThumbnailUrl(targetUser.profilePicture) : null,
      profilePicture: targetUser.profilePicture ? formatMediaUrl(targetUser.profilePicture) : null,
      isVerified: !!targetUser.isFaceVerified,
      isFaceVerified: !!targetUser.isFaceVerified,
      isSubscribed: !!targetUser.isSubscribed,
      city: targetUser.city || null,
      location: targetUser.city || null,
      momentCount: targetMomentCount,
      compatibility: targetCompatibility,
    };

    const mappedMoments = moments.map((m: any) => {
      const sortedMedia = (m.media || []).sort(
        (a: any, b: any) => a.displayOrder - b.displayOrder
      );
      const firstMedia = sortedMedia[0];

      const reactions = m.reactions || [];
      const myReactionRecord = reactions.find((r: any) => r.userId === viewerId);
      const myReaction = myReactionRecord ? myReactionRecord.reaction : null;

      const reactionCounts: Record<string, number> = {
        like: 0,
        heart: 0,
        love_eyes: 0,
        fire: 0,
        laugh: 0,
        surprised: 0,
        clap: 0,
        total: 0,
      };

      for (const r of reactions) {
        if (reactionCounts[r.reaction] !== undefined) {
          reactionCounts[r.reaction] += 1;
          reactionCounts.total += 1;
        }
      }

      const commentsCount = repliesCountMap.get(m.id) || 0;
      const likesCount = reactionCounts.total || reactions.length;

      return {
        id: m.id,
        momentId: m.id,
        momentCount: targetMomentCount,
        compatibility: targetCompatibility,
        imageUrl: firstMedia ? formatMediaUrl(firstMedia.mediaUrl) : null,
        firstImageUrl: firstMedia ? formatMediaUrl(firstMedia.mediaUrl) : null,
        mediaUrl: firstMedia ? formatMediaUrl(firstMedia.mediaUrl) : null,
        thumbnailUrl: firstMedia ? formatThumbnailUrl(firstMedia.mediaUrl) : null,
        mediaCount: sortedMedia.length,
        imageCount: sortedMedia.length,
        hasMultipleMedia: sortedMedia.length > 1,
        hasMultipleImages: sortedMedia.length > 1,
        caption: m.caption,
        audience: m.audience,
        publishedAt: m.publishedAt,
        createdAt: m.createdAt,
        expiresAt: m.expiresAt || null,
        timeRemainingMinutes: null,
        relativeAge: formatRelativeAge(m.publishedAt),
        timeAgo: formatTimeAgoShort(m.publishedAt),
        locationLabel: m.locationLabel || null,
        location: m.locationLabel ? { name: m.locationLabel } : null,
        creator: creatorInfo,
        media: sortedMedia.map((media: any) => ({
          mediaId: media.id,
          imageKey: media.mediaUrl,
          imageUrl: formatMediaUrl(media.mediaUrl),
          mediaUrl: formatMediaUrl(media.mediaUrl),
          thumbnailUrl: formatThumbnailUrl(media.mediaUrl),
          mediaType: media.mediaType,
          displayOrder: media.displayOrder,
        })),
        likesCount,
        likeCount: likesCount,
        commentsCount,
        commentCount: commentsCount,
        giftsCount: giftsCountMap.get(m.id) || 0,
        sharesCount: 0,
        isLiked: !!myReaction,
        viewerReaction: myReaction,
        reactionCounts,
        canReply: true,
      };
    });

    return {
      userId: resolvedUserId,
      momentCount: targetMomentCount,
      compatibility: targetCompatibility,
      page,
      limit,
      totalCount: count,
      totalPages: Math.ceil(count / limit),
      moments: mappedMoments,
    };
  }

  /**
   * Retrieves active Moments for the discovery / feed screen.
   * Supports both flat feed mode and stories tray grouped by user.
   * Supports scoping: 'all', 'others' (to see other moments), 'self', 'matches'.
   * Enforces mutual block exclusion and audience privacy.
   */
  public async getAllMoments(
    viewerId: string,
    options: {
      page?: number;
      limit?: number;
      type?: 'feed' | 'stories';
      scope?: 'all' | 'others' | 'self' | 'matches' | 'friends';
      momentId?: string;
    } = {}
  ) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;
    const feedType = options.type || 'feed';
    const scope = options.scope || 'all';

    // 1. Identify all blocked relationships
    const blocks = await UserBlock.findAll({
      where: {
        [Op.or]: [{ userId: viewerId }, { blockedUserId: viewerId }],
      },
    });

    const blockedUserIds = new Set<string>();
    for (const b of blocks) {
      if (b.userId === viewerId) blockedUserIds.add(b.blockedUserId);
      if (b.blockedUserId === viewerId) blockedUserIds.add(b.userId);
    }

    // 1b. Identify reported users and moments to filter out for viewer
    const reports = await UserReport.findAll({
      where: {
        reporterId: viewerId,
        status: { [Op.ne]: 'dismissed' },
      },
      attributes: ['targetUserId', 'momentId', 'targetType'],
    });

    const reportedUserIds = new Set<string>();
    const reportedMomentIds = new Set<string>();
    for (const r of reports) {
      if (!r.momentId && (r.targetType === 'user' || !r.targetType) && r.targetUserId) {
        reportedUserIds.add(r.targetUserId);
      }
      if (r.momentId) {
        reportedMomentIds.add(r.momentId);
      }
    }

    // 2. Identify matches for matches_only audience filter
    const matches = await Match.findAll({
      where: {
        [Op.or]: [{ user1Id: viewerId }, { user2Id: viewerId }],
        isActive: true,
      },
    });
    const matchedUserIds = new Set<string>();
    for (const m of matches) {
      matchedUserIds.add(m.user1Id === viewerId ? m.user2Id : m.user1Id);
    }
    const matchIdsArray = Array.from(matchedUserIds);

    // 3. Construct where conditions based on scope & privacy
    const whereConditions: any[] = [{ status: 'active' }];

    const excludedUserIds = new Set<string>([...blockedUserIds, ...reportedUserIds]);
    if (excludedUserIds.size > 0) {
      whereConditions.push({
        userId: { [Op.notIn]: Array.from(excludedUserIds) },
      });
    }

    if (reportedMomentIds.size > 0) {
      whereConditions.push({
        id: { [Op.notIn]: Array.from(reportedMomentIds) },
      });
    }

    if (scope === 'others') {
      // Exclude self moments to see other users' moments
      whereConditions.push({ userId: { [Op.ne]: viewerId } });
      whereConditions.push({
        [Op.or]: [
          { audience: 'everyone' },
          ...(matchIdsArray.length > 0
            ? [{ audience: 'matches_only', userId: { [Op.in]: matchIdsArray } }]
            : []),
        ],
      });
    } else if (scope === 'self') {
      whereConditions.push({ userId: viewerId });
    } else if (scope === 'matches' || scope === 'friends') {
      if (matchIdsArray.length === 0) {
        return {
          type: feedType,
          page,
          limit,
          totalCount: 0,
          totalPages: 0,
          moments: [],
        };
      }
      whereConditions.push({ userId: { [Op.in]: matchIdsArray } });
    } else {
      // Default: 'all'
      whereConditions.push({
        [Op.or]: [
          { userId: viewerId },
          { audience: 'everyone' },
          ...(matchIdsArray.length > 0
            ? [{ audience: 'matches_only', userId: { [Op.in]: matchIdsArray } }]
            : []),
        ],
      });
    }

    const whereClause = {
      [Op.and]: whereConditions,
    };

    // 4. Handle 'stories' tray grouping
    if (feedType === 'stories') {
      const activeMoments = await Moment.findAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'user',
            where: { isActive: true },
            attributes: [
              'id',
              'username',
              'fullName',
              'firstName',
              'nickName',
              'profilePicture',
              'isFaceVerified',
              'city',
            ],
          },
          {
            model: MomentMedia,
            as: 'media',
          },
        ],
        order: [
          ['publishedAt', 'DESC'],
          [{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC'],
        ],
      });

      const storyMomentIds = activeMoments.map((m) => m.id);
      const reactionsByMoment = new Map<string, any[]>();
      if (storyMomentIds.length > 0) {
        const storyReactionRows = await MomentReaction.findAll({
          where: { momentId: { [Op.in]: storyMomentIds } },
        });
        for (const reaction of storyReactionRows) {
          const bucket = reactionsByMoment.get(reaction.momentId) || [];
          bucket.push(reaction);
          reactionsByMoment.set(reaction.momentId, bucket);
        }
      }

      // Group moments by creator
      const storiesMap = new Map<string, any>();
      for (const m of activeMoments) {
        const creator = m.user;
        if (!creator) continue;

        const sortedMedia = (m.media || []).sort(
          (a: any, b: any) => a.displayOrder - b.displayOrder
        );
        const firstMedia = sortedMedia[0];

        const storyReactions = reactionsByMoment.get(m.id) || [];
        const myStoryReaction = storyReactions.find((r: any) => r.userId === viewerId);
        const storyReactionCounts: Record<string, number> = {
          like: 0,
          heart: 0,
          love_eyes: 0,
          fire: 0,
          laugh: 0,
          surprised: 0,
          clap: 0,
          total: 0,
        };
        for (const r of storyReactions) {
          if (storyReactionCounts[r.reaction] !== undefined) {
            storyReactionCounts[r.reaction] += 1;
            storyReactionCounts.total += 1;
          }
        }

        const storyReactionFields = {
          likesCount: storyReactionCounts.total,
          isLiked: !!myStoryReaction,
          viewerReaction: myStoryReaction ? myStoryReaction.reaction : null,
          myReaction: myStoryReaction ? myStoryReaction.reaction : null,
          reactionCounts: storyReactionCounts,
        };

        if (!storiesMap.has(creator.id)) {
          storiesMap.set(creator.id, {
            creatorId: creator.id,
            name:
              creator.nickName ||
              creator.firstName ||
              creator.fullName ||
              creator.username ||
              'User',
            profilePhoto: creator.profilePicture ? formatThumbnailUrl(creator.profilePicture) : null,
            isFaceVerified: !!creator.isFaceVerified,
            city: creator.city || null,
            isSelf: creator.id === viewerId,
            momentsCount: 0,
            latestMoment: {
              momentId: m.id,
              thumbnailUrl: firstMedia ? formatThumbnailUrl(firstMedia.mediaUrl) : null,
              caption: m.caption,
              publishedAt: m.publishedAt,
              relativeAge: formatRelativeAge(m.publishedAt),
              timeAgo: formatTimeAgoShort(m.publishedAt),
              ...storyReactionFields,
            },
            moments: [],
          });
        }

        const entry = storiesMap.get(creator.id);
        entry.momentsCount += 1;
        entry.moments.push({
          momentId: m.id,
          thumbnailUrl: firstMedia ? formatThumbnailUrl(firstMedia.mediaUrl) : null,
          mediaCount: sortedMedia.length,
          caption: m.caption,
          publishedAt: m.publishedAt,
          relativeAge: formatRelativeAge(m.publishedAt),
          timeAgo: formatTimeAgoShort(m.publishedAt),
          ...storyReactionFields,
        });
      }

      // Batch fetch moment counts & compatibility for story creators
      const storyCreatorIds = Array.from(storiesMap.keys());
      const { momentCounts: storyMomentCounts, compatibilityMap: storyCompatibilityMap } =
        await this.getCompatibilityAndMomentCounts(viewerId, storyCreatorIds);

      for (const [cId, entry] of storiesMap.entries()) {
        const cMomentCount = storyMomentCounts.get(cId) || entry.momentsCount;
        const cCompat = storyCompatibilityMap.get(cId) || { interestMatchPercentage: 0 };
        entry.momentCount = cMomentCount;
        entry.compatibility = cCompat;
        for (const sm of entry.moments) {
          sm.momentCount = cMomentCount;
          sm.compatibility = cCompat;
        }
      }

      // Viewer's own story first if present, followed by others sorted by latest moment
      const stories = Array.from(storiesMap.values()).sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        return (
          new Date(b.latestMoment.publishedAt).getTime() -
          new Date(a.latestMoment.publishedAt).getTime()
        );
      });

      return {
        type: 'stories',
        totalUsers: stories.length,
        stories,
      };
    }

    // 5. Handle 'feed' mode (flat chronological stream)
    // The page still returns the same creator, media, and reaction fields.
    // The total count does not join those tables, so one feed call does not scan every like.
    const feedUserInclude = {
      model: User,
      as: 'user',
      where: { isActive: true },
      required: true,
      attributes: [
        'id',
        'username',
        'fullName',
        'firstName',
        'nickName',
        'profilePicture',
        'isFaceVerified',
        'city',
      ],
    };
    const feedPageInclude = [
      feedUserInclude,
      { model: MomentMedia, as: 'media' },
      { model: MomentReaction, as: 'reactions' },
    ];

    // Pin a requested moment to the front only when it already belongs in this feed.
    let priorityMoment: any = null;
    if (options.momentId) {
      priorityMoment = await Moment.findOne({
        where: {
          [Op.and]: [...whereConditions, { id: options.momentId }],
        },
        include: feedPageInclude,
      });
    }

    const listWhere = priorityMoment
      ? { [Op.and]: [...whereConditions, { id: { [Op.ne]: priorityMoment.id } }] }
      : whereClause;
    const listLimit = priorityMoment && page === 1 ? limit - 1 : limit;
    const listOffset = priorityMoment ? (page === 1 ? 0 : offset - 1) : offset;

    let otherCount = 0;
    let otherMoments: any[] = [];

    const countMoments = () =>
      Moment.count({
        where: listWhere,
        include: [{ ...feedUserInclude, attributes: [] }],
        distinct: true,
      });

    if (listLimit <= 0) {
      otherCount = await countMoments();
    } else {
      const [counted, listed] = await Promise.all([
        countMoments(),
        Moment.findAll({
          where: listWhere,
          include: feedPageInclude,
          order: [
            ['publishedAt', 'DESC'],
            ['id', 'DESC'],
            [{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC'],
          ],
          subQuery: true,
          limit: listLimit,
          offset: Math.max(0, listOffset),
        }),
      ]);
      otherCount = counted;
      otherMoments = listed;
    }

    const count = priorityMoment ? Number(otherCount) + 1 : otherCount;
    const moments =
      priorityMoment && page === 1 ? [priorityMoment, ...otherMoments] : otherMoments;

    // Batch query comment/reply counts and gifts counts for all moments in page
    const momentIds = moments.map((m: any) => m.id);
    const repliesCountMap = new Map<string, number>();
    const giftsCountMap = new Map<string, number>();
    for (const id of momentIds) {
      repliesCountMap.set(id, 0);
      giftsCountMap.set(id, 0);
    }

    if (momentIds.length > 0) {
      try {
        const counted = await this.countMomentReplies(momentIds);
        for (const [id, total] of counted) repliesCountMap.set(id, total);
      } catch {}

      try {
        const giftRecords = await MomentGift.findAll({
          where: { momentId: { [Op.in]: momentIds } },
          attributes: ['momentId', 'quantity'],
        });

        for (const g of giftRecords) {
          const mId = g.momentId;
          const qty = Number(g.quantity) || 1;
          if (giftsCountMap.has(mId)) {
            giftsCountMap.set(mId, (giftsCountMap.get(mId) || 0) + qty);
          }
        }
      } catch {}
    }

    // Batch query moment counts and interest compatibility for creators in feed
    const creatorUserIds = Array.from(
      new Set(moments.map((m: any) => m.userId || (m.user && m.user.id)).filter(Boolean))
    );
    const { momentCounts, compatibilityMap } = await this.getCompatibilityAndMomentCounts(
      viewerId,
      creatorUserIds
    );

    const feedItems = moments.map((m: any) => {
      const creator = m.user;
      const sortedMedia = (m.media || []).sort(
        (a: any, b: any) => a.displayOrder - b.displayOrder
      );

      const reactions = m.reactions || [];
      const myReactionRecord = reactions.find((r: any) => r.userId === viewerId);
      const myReaction = myReactionRecord ? myReactionRecord.reaction : null;

      const reactionCounts: Record<string, number> = {
        like: 0,
        heart: 0,
        love_eyes: 0,
        fire: 0,
        laugh: 0,
        surprised: 0,
        clap: 0,
        total: 0,
      };

      for (const r of reactions) {
        if (reactionCounts[r.reaction] !== undefined) {
          reactionCounts[r.reaction] += 1;
          reactionCounts.total += 1;
        }
      }

      const isSelf = creator ? creator.id === viewerId : false;
      const commentsCount = repliesCountMap.get(m.id) || 0;
      const likesCount = reactionCounts.total || reactions.length;

      const creatorDisplayName = creator
        ? creator.firstName ||
          (creator.fullName ? creator.fullName.split(' ')[0] : null) ||
          creator.nickName ||
          creator.username ||
          'User'
        : 'User';

      const creatorId = creator ? creator.id : m.userId;
      const creatorMomentCount = momentCounts.get(creatorId) || 0;
      const creatorCompatibility = compatibilityMap.get(creatorId) || { interestMatchPercentage: 0 };

      return {
        id: m.id,
        momentId: m.id,
        momentCount: creatorMomentCount,
        compatibility: creatorCompatibility,
        caption: m.caption,
        audience: m.audience,
        publishedAt: m.publishedAt,
        expiresAt: m.expiresAt || null,
        relativeAge: formatRelativeAge(m.publishedAt),
        timeAgo: formatTimeAgoShort(m.publishedAt),
        locationLabel: m.locationLabel || null,
        location: m.locationLabel ? { name: m.locationLabel } : null,
        creator: creator
          ? {
              id: creator.id,
              creatorId: creator.id,
              userId: creator.id,
              name: creatorDisplayName,
              fullName: creator.fullName || null,
              username: creator.username,
              profilePhoto: creator.profilePicture ? formatThumbnailUrl(creator.profilePicture) : null,
              profilePicture: creator.profilePicture ? formatMediaUrl(creator.profilePicture) : null,
              isVerified: !!creator.isFaceVerified,
              isFaceVerified: !!creator.isFaceVerified,
              isSubscribed: !!creator.isSubscribed,
              city: creator.city || null,
              location: creator.city || null,
              momentCount: creatorMomentCount,
              compatibility: creatorCompatibility,
            }
          : null,
        media: sortedMedia.map((media: any) => ({
          mediaId: media.id,
          imageKey: media.mediaUrl,
          imageUrl: formatMediaUrl(media.mediaUrl),
          mediaUrl: formatMediaUrl(media.mediaUrl),
          thumbnailUrl: formatThumbnailUrl(media.mediaUrl),
          mediaType: media.mediaType,
          displayOrder: media.displayOrder,
        })),
        imageUrl: sortedMedia[0] ? formatMediaUrl(sortedMedia[0].mediaUrl) : null,
        mediaUrl: sortedMedia[0] ? formatMediaUrl(sortedMedia[0].mediaUrl) : null,
        thumbnailUrl: sortedMedia[0] ? formatThumbnailUrl(sortedMedia[0].mediaUrl) : null,
        mediaCount: sortedMedia.length,
        hasMultipleMedia: sortedMedia.length > 1,
        createdAt: m.createdAt,
        likesCount,
        commentsCount,
        giftsCount: giftsCountMap.get(m.id) || 0,
        sharesCount: 0,
        isLiked: !!myReaction,
        viewerReaction: myReaction,
        reactionCounts,
        canReply: true,
      };
    });

    return {
      type: 'feed',
      page,
      limit,
      totalCount: count,
      totalPages: Math.ceil(count / limit),
      moments: feedItems,
    };
  }

  /**
   * Retrieves full details for a single Quick Moment in full-screen viewer mode.
   * Includes ordered media, creator metadata, relative age, viewer reaction, and reaction counts.
   */
  public async getMomentDetail(viewerId: string, momentId: string) {
    const moment = await Moment.findByPk(momentId, {
      include: [
        {
          model: MomentMedia,
          as: 'media',
        },
        {
          model: User,
          as: 'user',
          attributes: [
            'id',
            'username',
            'fullName',
            'firstName',
            'nickName',
            'profilePicture',
            'isFaceVerified',
            'city',
            'isActive',
          ],
        },
        {
          model: MomentReaction,
          as: 'reactions',
        },
      ],
      order: [[{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC']],
    });

    if (!moment || moment.status !== 'active') {
      throw new MomentServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    const creator = moment.user;
    if (!creator || !creator.isActive) {
      throw new MomentServiceError(
        'Creator account unavailable',
        404,
        'CREATOR_UNAVAILABLE'
      );
    }

    // Check block restrictions
    const isSelf = viewerId === creator.id;
    if (!isSelf) {
      const blockRecord = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: viewerId, blockedUserId: creator.id },
            { userId: creator.id, blockedUserId: viewerId },
          ],
        },
      });

      if (blockRecord) {
        throw new MomentServiceError(
          'Moment unavailable due to privacy restrictions',
          403,
          'MOMENT_BLOCKED'
        );
      }

      // Check report restrictions
      const reportRecord = await UserReport.findOne({
        where: {
          reporterId: viewerId,
          [Op.or]: [
            { momentId: moment.id },
            { targetUserId: creator.id, targetType: 'user' },
          ],
          status: { [Op.ne]: 'dismissed' },
        },
      });

      if (reportRecord) {
        throw new MomentServiceError(
          'Moment unavailable or has been reported',
          404,
          'MOMENT_NOT_FOUND'
        );
      }

      // Check audience permissions
      if (moment.audience === 'matches_only') {
        const [u1, u2] = [viewerId, creator.id].sort();
        const match = await Match.findOne({
          where: { user1Id: u1, user2Id: u2, isActive: true },
        });

        if (!match) {
          throw new MomentServiceError(
            'This moment is only visible to matches',
            403,
            'AUDIENCE_RESTRICTED'
          );
        }
      }
    }

    // Ordered media items
    const media = (moment.media || [])
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder)
      .map((m: any) => ({
        mediaId: m.id,
        imageKey: m.mediaUrl,
        imageUrl: formatMediaUrl(m.mediaUrl),
        mediaUrl: formatMediaUrl(m.mediaUrl),
        thumbnailUrl: formatThumbnailUrl(m.mediaUrl),
        mediaType: m.mediaType,
        displayOrder: m.displayOrder,
      }));

    // Viewer reaction & aggregate reaction counts
    const reactions = moment.reactions || [];
    const myReactionRecord = reactions.find((r: any) => r.userId === viewerId);
    const myReaction = myReactionRecord ? myReactionRecord.reaction : null;

    const reactionCounts: Record<string, number> = {
      like: 0,
      heart: 0,
      love_eyes: 0,
      fire: 0,
      laugh: 0,
      surprised: 0,
      clap: 0,
    };

    for (const r of reactions) {
      if (reactionCounts[r.reaction] !== undefined) {
        reactionCounts[r.reaction]++;
      }
    }

    const creatorDisplayName =
      creator.firstName ||
      (creator.fullName ? creator.fullName.split(' ')[0] : null) ||
      creator.nickName ||
      creator.username;

    // Count comments/replies for this moment (excluding gift transactions)
    let commentsCount = 0;
    try {
      commentsCount = (await this.countMomentReplies([moment.id], { excludeGiftContent: true })).get(moment.id) || 0;
    } catch {}

    let giftsCount = 0;
    try {
      const summed = await MomentGift.sum('quantity', { where: { momentId: moment.id } });
      const parsed = Number(summed);
      giftsCount = Number.isFinite(parsed) ? parsed : 0;
    } catch {}

    const likesCount = reactions.length;

    const { momentCounts, compatibilityMap } = await this.getCompatibilityAndMomentCounts(
      viewerId,
      [creator.id]
    );
    const creatorMomentCount = momentCounts.get(creator.id) || 1;
    const creatorCompatibility = compatibilityMap.get(creator.id) || {
      interestMatchPercentage: 0,
    };

    return {
      id: moment.id,
      momentId: moment.id,
      momentCount: creatorMomentCount,
      compatibility: creatorCompatibility,
      creator: {
        id: creator.id,
        creatorId: creator.id,
        userId: creator.id,
        name: creatorDisplayName,
        fullName: creator.fullName || null,
        username: creator.username,
        profilePhoto: creator.profilePicture ? formatThumbnailUrl(creator.profilePicture) : null,
        profilePicture: creator.profilePicture ? formatMediaUrl(creator.profilePicture) : null,
        isVerified: !!creator.isFaceVerified,
        isFaceVerified: !!creator.isFaceVerified,
        isSubscribed: !!creator.isSubscribed,
        city: creator.city || null,
        location: creator.city || null,
        momentCount: creatorMomentCount,
        compatibility: creatorCompatibility,
      },
      media,
      imageUrl: media[0] ? formatMediaUrl(media[0].mediaUrl) : null,
      mediaUrl: media[0] ? formatMediaUrl(media[0].mediaUrl) : null,
      thumbnailUrl: media[0] ? formatThumbnailUrl(media[0].mediaUrl) : null,
      mediaCount: media.length,
      hasMultipleMedia: media.length > 1,
      caption: moment.caption,
      audience: moment.audience,
      publishedAt: moment.publishedAt,
      createdAt: moment.createdAt,
      relativeAge: formatRelativeAge(moment.publishedAt),
      timeAgo: formatTimeAgoShort(moment.publishedAt),
      expiresAt: moment.expiresAt || null,
      timeRemainingMinutes: null,
      locationLabel: moment.locationLabel || null,
      location: moment.locationLabel ? { name: moment.locationLabel } : null,
      likesCount,
      commentsCount,
      giftsCount,
      sharesCount: 0,
      isLiked: !!myReaction,
      viewerReaction: myReaction,
      myReaction,
      totalReactions: reactions.length,
      reactionCounts,
      canReply: true,
    };
  }

  /**
   * Adds or updates a viewer's emoji reaction on a Moment.
   * Enforces 1 reaction per viewer (updates if changing emoji) and blocks check.
   */
  public async reactToMoment(
    viewerId: string,
    momentId: string,
    reaction: MomentReactionType = 'like'
  ) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status !== 'active') {
      throw new MomentServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    // Block check
    if (viewerId !== moment.userId) {
      const blockRecord = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: viewerId, blockedUserId: moment.userId },
            { userId: moment.userId, blockedUserId: viewerId },
          ],
        },
      });

      if (blockRecord) {
        throw new MomentServiceError(
          'Cannot react to this moment due to privacy restrictions',
          403,
          'REACTION_FORBIDDEN'
        );
      }

      // Audience check
      if (moment.audience === 'matches_only') {
        const [u1, u2] = [viewerId, moment.userId].sort();
        const match = await Match.findOne({
          where: { user1Id: u1, user2Id: u2, isActive: true },
        });

        if (!match) {
          throw new MomentServiceError(
            'This moment is only visible to matches',
            403,
            'AUDIENCE_RESTRICTED'
          );
        }
      }
    }

    // Upsert reaction: 1 reaction per viewer per moment
    const [reactionRecord, created] = await MomentReaction.findOrCreate({
      where: {
        momentId,
        userId: viewerId,
      },
      defaults: {
        momentId,
        userId: viewerId,
        reaction,
      },
    });

    if (!created && reactionRecord.reaction !== reaction) {
      reactionRecord.reaction = reaction;
      await reactionRecord.save();
    }

    if (created) {
      this.dispatchMomentNotification(moment.userId, viewerId, (senderName) =>
        notificationService.sendLikeNotification(moment.userId, {
          senderId: viewerId,
          senderName,
          momentId,
          reaction,
        })
      );
    }

    // Calculate updated reaction counts
    const allReactions = await MomentReaction.findAll({ where: { momentId } });
    const reactionCounts: Record<string, number> = {
      like: 0,
      heart: 0,
      love_eyes: 0,
      fire: 0,
      laugh: 0,
      surprised: 0,
      clap: 0,
    };

    for (const r of allReactions) {
      if (reactionCounts[r.reaction] !== undefined) {
        reactionCounts[r.reaction]++;
      }
    }

    this.emitMomentActivity({
      type: 'reaction',
      momentId,
      ownerId: moment.userId,
      actorId: viewerId,
      likesCount: allReactions.length,
      reaction,
      reactionCounts,
    });

    return {
      momentId,
      liked: true,
      isLiked: true,
      action: 'liked',
      likesCount: allReactions.length,
      reaction,
      totalReactions: allReactions.length,
      reactionCounts,
    };
  }

  /**
   * Single unified API to toggle Like / Unlike on a Moment.
   * If already liked by user -> unlikes it (isLiked: false).
   * If not liked yet -> likes it (isLiked: true).
   */
  public async toggleLikeMoment(
    viewerId: string,
    momentId: string,
    forcedAction?: 'like' | 'unlike' | 'toggle'
  ) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status !== 'active') {
      throw new MomentServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    // Block check
    if (viewerId !== moment.userId) {
      const blockRecord = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: viewerId, blockedUserId: moment.userId },
            { userId: moment.userId, blockedUserId: viewerId },
          ],
        },
      });

      if (blockRecord) {
        throw new MomentServiceError(
          'Cannot react to this moment due to privacy restrictions',
          403,
          'REACTION_FORBIDDEN'
        );
      }

      // Audience check
      if (moment.audience === 'matches_only') {
        const [u1, u2] = [viewerId, moment.userId].sort();
        const match = await Match.findOne({
          where: { user1Id: u1, user2Id: u2, isActive: true },
        });

        if (!match) {
          throw new MomentServiceError(
            'This moment is only visible to matches',
            403,
            'AUDIENCE_RESTRICTED'
          );
        }
      }
    }

    const existingReaction = await MomentReaction.findOne({
      where: {
        momentId,
        userId: viewerId,
      },
    });

    let action: 'liked' | 'unliked';
    let isLiked: boolean;
    let shouldNotify = false;

    if (forcedAction === 'like') {
      if (!existingReaction) {
        await MomentReaction.create({
          momentId,
          userId: viewerId,
          reaction: 'like',
        });
        shouldNotify = true;
      } else if (existingReaction.reaction !== 'like') {
        existingReaction.reaction = 'like';
        await existingReaction.save();
      }
      action = 'liked';
      isLiked = true;
    } else if (forcedAction === 'unlike') {
      if (existingReaction) {
        await existingReaction.destroy();
      }
      action = 'unliked';
      isLiked = false;
    } else {
      // Automatic Toggle (default behavior)
      if (existingReaction) {
        await existingReaction.destroy();
        action = 'unliked';
        isLiked = false;
      } else {
        await MomentReaction.create({
          momentId,
          userId: viewerId,
          reaction: 'like',
        });
        action = 'liked';
        isLiked = true;
        shouldNotify = true;
      }
    }

    if (shouldNotify) {
      this.dispatchMomentNotification(moment.userId, viewerId, (senderName) =>
        notificationService.sendLikeNotification(moment.userId, {
          senderId: viewerId,
          senderName,
          momentId,
        })
      );
    }

    const allReactions = await MomentReaction.findAll({ where: { momentId } });
    const reactionCounts: Record<string, number> = {
      like: 0,
      heart: 0,
      love_eyes: 0,
      fire: 0,
      laugh: 0,
      surprised: 0,
      clap: 0,
    };

    for (const r of allReactions) {
      if (reactionCounts[r.reaction] !== undefined) {
        reactionCounts[r.reaction]++;
      }
    }

    this.emitMomentActivity({
      type: isLiked ? 'like' : 'unlike',
      momentId,
      ownerId: moment.userId,
      actorId: viewerId,
      likesCount: allReactions.length,
      reaction: isLiked ? 'like' : null,
      reactionCounts,
    });

    return {
      momentId,
      liked: isLiked,
      unliked: !isLiked,
      isLiked,
      action,
      likesCount: allReactions.length,
      totalReactions: allReactions.length,
      reactionCounts,
    };
  }

  /**
   * Sends a direct reply to a Quick Moment delivered through the chat conversation system.
   * Enforces expiry check, self-reply prevention, block restrictions, and conversation persistence.
   */
  public async replyToMoment(
    senderId: string,
    momentId: string,
    message: string,
    options?: {
      parentCommentId?: string | null;
      parent_comment_id?: string | null;
      parentId?: string | null;
      parent_id?: string | null;
      replyToCommentId?: string | null;
      reply_to_comment_id?: string | null;
      commentId?: string | null;
      comment_id?: string | null;
      parentReplyId?: string | null;
      parent_reply_id?: string | null;
    }
  ) {
    const parentId =
      options?.parentCommentId ||
      options?.parent_comment_id ||
      options?.parentId ||
      options?.parent_id ||
      options?.replyToCommentId ||
      options?.reply_to_comment_id ||
      options?.commentId ||
      options?.comment_id;

    if (parentId) {
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(parentId)) {
        throw new MomentServiceError(
          'Invalid parent comment ID format',
          400,
          'INVALID_COMMENT_ID'
        );
      }
      return this.replyToMomentComment(
        senderId,
        momentId,
        parentId,
        message,
        { parentReplyId: options?.parentReplyId || options?.parent_reply_id || null }
      );
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      throw new MomentServiceError(
        'Reply message cannot be empty',
        400,
        'EMPTY_MESSAGE'
      );
    }

    if (trimmedMessage.length > 1000) {
      throw new MomentServiceError(
        'Reply message exceeds 1000 characters limit',
        400,
        'MESSAGE_TOO_LONG'
      );
    }

    const moment = await Moment.findByPk(momentId, {
      include: [{ model: MomentMedia, as: 'media' }],
      order: [[{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC']],
    });

    if (!moment || moment.status !== 'active') {
      throw new MomentServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    // Allow personal commenting on own moment; block & audience checks only apply when replying to others
    if (senderId !== moment.userId) {
      // Block check
      const blockRecord = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: senderId, blockedUserId: moment.userId },
            { userId: moment.userId, blockedUserId: senderId },
          ],
        },
      });

      if (blockRecord) {
        throw new MomentServiceError(
          'Cannot reply due to privacy restrictions',
          403,
          'REPLY_FORBIDDEN'
        );
      }

      // Audience check
      if (moment.audience === 'matches_only') {
        const [u1, u2] = [senderId, moment.userId].sort();
        const match = await Match.findOne({
          where: { user1Id: u1, user2Id: u2, isActive: true },
        });

        if (!match) {
          throw new MomentServiceError(
            'This moment is only visible to matches',
            403,
            'AUDIENCE_RESTRICTED'
          );
        }
      }
    }

    // Find or create direct message thread conversation
    const [u1, u2] = [senderId, moment.userId].sort();
    const now = new Date();

    const [conversation] = await Conversation.findOrCreate({
      where: {
        user1Id: u1,
        user2Id: u2,
      },
      defaults: {
        user1Id: u1,
        user2Id: u2,
        lastMessage: trimmedMessage,
        lastMessageAt: now,
      },
    });

    // Create chat message record linking to moment
    const firstMedia = (moment.media || [])[0];
    const metadata = JSON.stringify({
      momentId: moment.id,
      mediaUrl: firstMedia ? firstMedia.mediaUrl : null,
      caption: moment.caption || null,
    });

    const chatMessage = await ChatMessage.create({
      conversationId: conversation.id,
      senderId,
      recipientId: moment.userId,
      content: trimmedMessage,
      messageType: 'moment_reply',
      metadata,
      isRead: senderId === moment.userId,
    });

    conversation.lastMessage = trimmedMessage;
    conversation.lastMessageAt = now;
    await conversation.save();

    this.dispatchMomentNotification(moment.userId, senderId, (senderName) =>
      notificationService.sendCommentNotification(moment.userId, {
        senderId,
        senderName,
        comment: trimmedMessage,
        momentId: moment.id,
        commentId: chatMessage.id,
        isReply: false,
      })
    );

    this.emitMomentActivity({
      type: 'comment',
      momentId: moment.id,
      ownerId: moment.userId,
      actorId: senderId,
      commentId: chatMessage.id,
      comment: {
        id: chatMessage.id,
        commentId: chatMessage.id,
        momentId: moment.id,
        comment: trimmedMessage,
        text: trimmedMessage,
        parentCommentId: null,
        createdAt: chatMessage.createdAt,
        repliesCount: 0,
        likesCount: 0,
      },
    });

    return {
      id: chatMessage.id,
      commentId: chatMessage.id,
      momentId: moment.id,
      comment: trimmedMessage,
      text: trimmedMessage,
      parentCommentId: null,
      createdAt: chatMessage.createdAt,
      repliesCount: 0,
      replies: [],
    };
  }

  /**
   * Retrieves comments / replies for a Moment
   * GET /api/v1/moments/:momentId/comments (or /replies)
   */
  public async getMomentComments(
    viewerId: string,
    momentId: string,
    options?: { page?: number; limit?: number }
  ) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const parseMeta = (item: any) => {
      if (!item?.metadata) return null;
      try {
        return typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata;
      } catch {
        return null;
      }
    };

    const isReply = (meta: any) => {
      return Boolean(
        meta?.parentCommentId ||
        meta?.parent_comment_id ||
        meta?.parentId ||
        meta?.parent_id ||
        meta?.parentReplyId ||
        meta?.parent_reply_id ||
        meta?.replyToCommentId ||
        meta?.reply_to_comment_id ||
        meta?.replyId ||
        meta?.reply_id
      );
    };

    const { count, rows } = await ChatMessage.findAndCountAll({
      where: {
        messageType: 'moment_reply',
        [Op.or]: [
          { metadata: { [Op.like]: `%"momentId":"${momentId}"%` } },
          { metadata: { [Op.like]: `%"momentId": "${momentId}"%` } },
        ],
        [Op.and]: [
          { metadata: { [Op.notLike]: '%"type":"gift"%' } },
          { metadata: { [Op.notLike]: '%"type": "gift"%' } },
          { metadata: { [Op.notLike]: '%"parentCommentId"%' } },
          { metadata: { [Op.notLike]: '%"parent_comment_id"%' } },
          { metadata: { [Op.notLike]: '%"parentId"%' } },
          { metadata: { [Op.notLike]: '%"parent_id"%' } },
          { metadata: { [Op.notLike]: '%"parentReplyId"%' } },
          { metadata: { [Op.notLike]: '%"parent_reply_id"%' } },
          { metadata: { [Op.notLike]: '%"replyToCommentId"%' } },
          { metadata: { [Op.notLike]: '%"reply_to_comment_id"%' } },
          { content: { [Op.notLike]: '🎁%' } },
        ],
      },
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const topLevelRows = rows.filter((r: any) => !isReply(parseMeta(r)));
    const commentIds = topLevelRows.map((c: any) => c.id);
    const likesCountMap = new Map<string, number>();
    const userLikedSet = new Set<string>();

    // Fetch all replies belonging to this moment
    let allMomentReplies: any[] = [];
    try {
      allMomentReplies = await ChatMessage.findAll({
        where: {
          messageType: 'moment_reply',
          [Op.or]: [
            { metadata: { [Op.like]: `%"momentId":"${momentId}"%` } },
            { metadata: { [Op.like]: `%"momentId": "${momentId}"%` } },
          ],
          [Op.and]: [
            {
              [Op.or]: [
                { metadata: { [Op.like]: '%"parentCommentId"%' } },
                { metadata: { [Op.like]: '%"parent_comment_id"%' } },
                { metadata: { [Op.like]: '%"parentReplyId"%' } },
                { metadata: { [Op.like]: '%"parent_reply_id"%' } },
                { metadata: { [Op.like]: '%"replyToCommentId"%' } },
                { metadata: { [Op.like]: '%"reply_to_comment_id"%' } },
                { metadata: { [Op.like]: '%"parentId"%' } },
                { metadata: { [Op.like]: '%"parent_id"%' } },
              ],
            },
          ],
        },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
          },
        ],
        order: [['createdAt', 'ASC']],
      });
      allMomentReplies = allMomentReplies.filter((r: any) => isReply(parseMeta(r)));
    } catch {}

    const replyMap = new Map<string, any>();
    for (const r of allMomentReplies) {
      replyMap.set(r.id, r);
    }

    const allReplyIds = allMomentReplies.map((r: any) => r.id);
    const allTargetIds = [...commentIds, ...allReplyIds];

    if (allTargetIds.length > 0) {
      try {
        const commentLikes = await MomentCommentLike.findAll({
          where: { commentId: { [Op.in]: allTargetIds } },
          attributes: ['commentId', 'userId'],
        });
        for (const cl of commentLikes) {
          likesCountMap.set(cl.commentId, (likesCountMap.get(cl.commentId) || 0) + 1);
          if (cl.userId === viewerId) {
            userLikedSet.add(cl.commentId);
          }
        }
      } catch {}
    }

    // Function to trace root comment ID for any reply
    const findRootCommentId = (reply: any): string | null => {
      let curr = reply;
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        const meta = parseMeta(curr);
        const pCommentId =
          meta?.parentCommentId ||
          meta?.parent_comment_id ||
          meta?.parentId ||
          meta?.parent_id ||
          meta?.parentReplyId ||
          meta?.parent_reply_id ||
          meta?.replyToCommentId ||
          meta?.reply_to_comment_id;
        if (!pCommentId) {
          return curr.id;
        }
        if (replyMap.has(pCommentId)) {
          curr = replyMap.get(pCommentId);
        } else {
          return pCommentId;
        }
      }
      return null;
    };

    // Group replies by root comment ID
    const commentRepliesMap = new Map<string, any[]>();
    for (const r of allMomentReplies) {
      const rootId = findRootCommentId(r);
      if (rootId && commentIds.includes(rootId)) {
        if (!commentRepliesMap.has(rootId)) {
          commentRepliesMap.set(rootId, []);
        }
        commentRepliesMap.get(rootId)!.push(r);
      }
    }

    const comments = topLevelRows.map((c: any) => {
      const rawReplies = commentRepliesMap.get(c.id) || [];
      const formattedList: any[] = [];

      for (const r of rawReplies) {
        const meta = parseMeta(r) || {};

        let parentRepId: string | null = null;
        const explicitParentReply =
          meta?.parentReplyId ||
          meta?.parent_reply_id;

        if (explicitParentReply && explicitParentReply !== c.id) {
          parentRepId = explicitParentReply;
        } else {
          const candidateId =
            meta?.parentCommentId ||
            meta?.parent_comment_id ||
            meta?.parentId ||
            meta?.parent_id ||
            meta?.replyToCommentId ||
            meta?.reply_to_comment_id;

          if (candidateId && candidateId !== c.id && replyMap.has(candidateId)) {
            parentRepId = candidateId;
          }
        }

        let replyToUName = meta?.replyToUsername || null;
        let replyToUId = meta?.replyToUserId || null;
        if (!replyToUName && parentRepId && replyMap.has(parentRepId)) {
          const pr = replyMap.get(parentRepId);
          replyToUName = pr.sender?.username || pr.sender?.fullName || null;
          replyToUId = pr.senderId || null;
        }

        const formatted = {
          id: r.id,
          replyId: r.id,
          reply: r.content,
          parentCommentId: c.id,
          parentReplyId: parentRepId,
          replyToCommentId: parentRepId || c.id,
          replyTo: {
            userId: replyToUId,
            username: replyToUName,
          },
          repliesCount: 0,
          replies: [] as any[],
          user: {
            id: r.sender?.id,
            username: r.sender?.username || null,
            name: r.sender?.fullName || r.sender?.nickName || 'User',
            profilePhoto: r.sender?.profilePicture ? formatThumbnailUrl(r.sender.profilePicture) : null,
            isVerified: !!r.sender?.isFaceVerified,
            isSubscribed: !!r.sender?.isSubscribed,
            city: r.sender?.city || null,
          },
          likesCount: likesCountMap.get(r.id) || 0,
          isLiked: userLikedSet.has(r.id),
          isMyComment: r.senderId === viewerId,
          canDelete: r.senderId === viewerId || c.senderId === viewerId || moment.userId === viewerId,
          createdAt: r.createdAt,
          timeAgo: formatTimeAgoShort(r.createdAt),
        };
        formattedList.push(formatted);
      }

      // Nested hierarchical tree of replies (child replies placed inside parent reply's replies array)
      const treeItemMap = new Map<string, any>();
      const treeList: any[] = [];
      for (const item of formattedList) {
        const treeItem = {
          ...item,
          user: { ...item.user },
          replyTo: { ...item.replyTo },
          replies: [] as any[],
        };
        treeItemMap.set(treeItem.replyId, treeItem);
        treeList.push(treeItem);
      }

      for (const item of treeList) {
        if (item.parentReplyId && treeItemMap.has(item.parentReplyId)) {
          treeItemMap.get(item.parentReplyId).replies.push(item);
        }
      }

      // Update repliesCount on each tree item
      for (const item of treeList) {
        item.repliesCount = item.replies.length;
      }

      // Direct replies are top-level replies only (child sub-replies reside exclusively within parent.replies)
      const directReplies = treeList.filter(
        (item) => !item.parentReplyId || item.parentReplyId === c.id || !treeItemMap.has(item.parentReplyId)
      );

      return {
        id: c.id,
        commentId: c.id,
        comment: c.content,
        repliesCount: directReplies.length,
        replies: directReplies,
        user: {
          id: c.sender?.id,
          username: c.sender?.username || null,
          name: c.sender?.fullName || c.sender?.nickName || 'User',
          profilePhoto: c.sender?.profilePicture ? formatThumbnailUrl(c.sender.profilePicture) : null,
          isVerified: !!c.sender?.isFaceVerified,
          isSubscribed: !!c.sender?.isSubscribed,
          city: c.sender?.city || null,
        },
        likesCount: likesCountMap.get(c.id) || 0,
        isLiked: userLikedSet.has(c.id),
        isMyComment: c.senderId === viewerId,
        canDelete: c.senderId === viewerId || moment.userId === viewerId,
        createdAt: c.createdAt,
        timeAgo: formatTimeAgoShort(c.createdAt),
      };
    });

    return {
      momentId,
      totalComments: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      comments,
    };
  }

  /**
   * Toggles or sets like on a Moment Comment
   * POST /api/v1/moments/:momentId/comments/:commentId/like (or /toggle-like)
   */
  public async toggleLikeMomentComment(
    userId: string,
    commentId: string,
    options?: { action?: 'like' | 'unlike' | 'toggle'; reaction?: string; momentId?: string }
  ) {
    const comment = await ChatMessage.findByPk(commentId);
    if (!comment) {
      throw new MomentServiceError('Comment not found or already deleted', 404, 'COMMENT_NOT_FOUND');
    }

    // Resolve momentId
    let resolvedMomentId = options?.momentId;
    if (!resolvedMomentId && comment.metadata) {
      try {
        const parsed = typeof comment.metadata === 'string' ? JSON.parse(comment.metadata) : comment.metadata;
        resolvedMomentId = parsed.momentId || parsed.moment_id || null;
      } catch {}
    }

    let moment: Moment | null = null;
    if (resolvedMomentId) {
      moment = await Moment.findByPk(resolvedMomentId);
      if (moment && moment.status === 'deleted') {
        throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
      }
    }

    // Privacy / block check
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId, blockedUserId: comment.senderId },
          { userId: comment.senderId, blockedUserId: userId },
          ...(moment
            ? [
                { userId, blockedUserId: moment.userId },
                { userId: moment.userId, blockedUserId: userId },
              ]
            : []),
        ],
      },
    });

    if (blockRecord) {
      throw new MomentServiceError('Cannot perform this action due to privacy restrictions', 403, 'PRIVACY_RESTRICTED');
    }

    const existingLike = await MomentCommentLike.findOne({
      where: { commentId, userId },
    });

    const reaction = options?.reaction || 'like';
    let action = options?.action || 'toggle';
    if (action === 'toggle') {
      action = existingLike ? 'unlike' : 'like';
    }

    let isLiked = false;
    if (action === 'unlike') {
      if (existingLike) {
        await existingLike.destroy();
      }
      isLiked = false;
    } else {
      if (existingLike) {
        if (existingLike.reaction !== reaction) {
          existingLike.reaction = reaction;
          await existingLike.save();
        }
      } else {
        await MomentCommentLike.create({
          commentId,
          userId,
          reaction,
        });

        this.dispatchMomentNotification(comment.senderId, userId, (senderName) =>
          notificationService.sendCommentLikeNotification(comment.senderId, {
            senderId: userId,
            senderName,
            commentId: comment.id,
            momentId: resolvedMomentId || null,
            commentSnippet: comment.content,
          })
        );
      }
      isLiked = true;
    }

    const likesCount = await MomentCommentLike.count({ where: { commentId } });

    if (resolvedMomentId) {
      this.emitMomentActivity({
        type: 'comment_like',
        momentId: resolvedMomentId,
        ownerId: moment?.userId || comment.senderId,
        actorId: userId,
        notifyUserIds: [comment.senderId],
        commentId,
        commentLikesCount: likesCount,
      });
    }

    return {
      commentId,
      momentId: resolvedMomentId || null,
      isLiked,
      likesCount,
      action: isLiked ? 'like' : 'unlike',
    };
  }

  /**
   * Retrieves users who liked a Moment Comment
   * GET /api/v1/moments/:momentId/comments/:commentId/likes
   */
  public async getMomentCommentLikes(
    _viewerId: string,
    commentId: string,
    options?: { page?: number; limit?: number; momentId?: string }
  ) {
    const comment = await ChatMessage.findByPk(commentId);
    if (!comment) {
      throw new MomentServiceError('Comment not found or already deleted', 404, 'COMMENT_NOT_FOUND');
    }

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await MomentCommentLike.findAndCountAll({
      where: { commentId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const users = rows.map((likeRecord: any) => ({
      id: likeRecord.user?.id,
      username: likeRecord.user?.username || null,
      name: likeRecord.user?.fullName || likeRecord.user?.nickName || 'User',
      profilePhoto: likeRecord.user?.profilePicture ? formatThumbnailUrl(likeRecord.user.profilePicture) : null,
      avatar: likeRecord.user?.profilePicture ? formatThumbnailUrl(likeRecord.user.profilePicture) : null,
      isVerified: !!likeRecord.user?.isFaceVerified,
      isSubscribed: !!likeRecord.user?.isSubscribed,
      city: likeRecord.user?.city || null,
      reaction: likeRecord.reaction,
      likedAt: likeRecord.createdAt,
    }));

    return {
      commentId,
      momentId: options?.momentId || null,
      totalLikes: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      users,
    };
  }

  /**
   * Sends a reply to an existing comment on a Moment
   * POST /api/v1/moments/:momentId/comments/:commentId/replies
   */
  /**
   * Sends a reply or sub-reply to an existing comment on a Moment
   * POST /api/v1/moments/:momentId/comments/:commentId/replies
   */
  public async replyToMomentComment(
    senderId: string,
    momentId: string,
    commentId: string,
    message: string,
    options?: { parentReplyId?: string | null }
  ) {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      throw new MomentServiceError('Reply message cannot be empty', 400, 'EMPTY_MESSAGE');
    }
    if (trimmedMessage.length > 1000) {
      throw new MomentServiceError('Reply message exceeds 1000 characters limit', 400, 'MESSAGE_TOO_LONG');
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!commentId || !uuidRegex.test(commentId)) {
      throw new MomentServiceError('Invalid parent comment ID format', 400, 'INVALID_COMMENT_ID');
    }
    if (options?.parentReplyId && !uuidRegex.test(options.parentReplyId)) {
      throw new MomentServiceError('Invalid parent reply ID format', 400, 'INVALID_REPLY_ID');
    }

    // 1. Validate moment existence and active status
    const moment = await Moment.findByPk(momentId, {
      include: [{ model: MomentMedia, as: 'media' }],
      order: [[{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC']],
    });
    if (!moment || moment.status !== 'active') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    // 2. Validate parent comment existence
    const parentComment = await ChatMessage.findByPk(commentId, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'username', 'fullName', 'nickName'],
        },
      ],
    });
    if (!parentComment || parentComment.messageType !== 'moment_reply') {
      throw new MomentServiceError('Comment not found or unavailable', 404, 'COMMENT_NOT_FOUND');
    }

    // 3. Verify parent comment belongs to this moment
    let commentMomentId: string | null = null;
    let parentCommentMeta: any = null;
    if (parentComment.metadata) {
      try {
        parentCommentMeta =
          typeof parentComment.metadata === 'string'
            ? JSON.parse(parentComment.metadata)
            : parentComment.metadata;
        commentMomentId = parentCommentMeta.momentId || null;
      } catch {}
    }
    if (commentMomentId && commentMomentId !== momentId) {
      throw new MomentServiceError(
        'Comment does not belong to the specified moment',
        404,
        'COMMENT_MOMENT_MISMATCH'
      );
    }

    // Resolve thread root comment & effective parent reply
    let rootComment = parentComment;
    let rootCommentId = commentId;
    let effectiveParentReplyId = options?.parentReplyId || null;

    const parentCommentMetaId =
      parentCommentMeta?.parentCommentId ||
      parentCommentMeta?.parent_comment_id ||
      parentCommentMeta?.parentId ||
      parentCommentMeta?.parent_id;

    if (parentCommentMetaId) {
      // parentComment passed in URL is itself a reply to a comment
      let curr: any = parentComment;
      const visited = new Set<string>();
      while (curr && !visited.has(curr.id)) {
        visited.add(curr.id);
        let m: any = null;
        if (curr.metadata) {
          try {
            m = typeof curr.metadata === 'string' ? JSON.parse(curr.metadata) : curr.metadata;
          } catch {}
        }
        const mParentId =
          m?.parentCommentId ||
          m?.parent_comment_id ||
          m?.parentId ||
          m?.parent_id;
        if (mParentId) {
          rootCommentId = mParentId;
          const ancestor = await ChatMessage.findByPk(rootCommentId, {
            include: [{ model: User, as: 'sender', attributes: ['id', 'username', 'fullName', 'nickName'] }],
          });
          if (ancestor) {
            rootComment = ancestor;
            curr = ancestor;
          } else {
            break;
          }
        } else {
          rootComment = curr;
          rootCommentId = curr.id;
          break;
        }
      }
      if (!effectiveParentReplyId) {
        effectiveParentReplyId = commentId;
      }
    }

    // 4. Handle sub-reply validation if effectiveParentReplyId is set
    let targetRecipientId = parentComment.senderId;
    let targetRecipientUsername =
      parentComment.sender?.username || parentComment.sender?.fullName || null;

    if (effectiveParentReplyId) {
      const parentReply = await ChatMessage.findByPk(effectiveParentReplyId, {
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'username', 'fullName', 'nickName'],
          },
        ],
      });
      if (!parentReply || parentReply.messageType !== 'moment_reply') {
        throw new MomentServiceError(
          'Parent reply not found or unavailable',
          404,
          'PARENT_REPLY_NOT_FOUND'
        );
      }

      let replyMomentId: string | null = null;
      let replyParentCommentId: string | null = null;
      if (parentReply.metadata) {
        try {
          const parsed =
            typeof parentReply.metadata === 'string'
              ? JSON.parse(parentReply.metadata)
              : parentReply.metadata;
          replyMomentId = parsed.momentId || null;
          replyParentCommentId = parsed.parentCommentId || null;
        } catch {}
      }

      if (replyMomentId && replyMomentId !== momentId) {
        throw new MomentServiceError(
          'Parent reply does not belong to the specified comment or moment',
          404,
          'PARENT_REPLY_MISMATCH'
        );
      }

      // Check if parentReply belongs to rootCommentId thread
      const prParentId =
        replyParentCommentId ||
        (() => {
          if (!parentReply.metadata) return null;
          try {
            const parsed = typeof parentReply.metadata === 'string' ? JSON.parse(parentReply.metadata) : parentReply.metadata;
            return parsed?.parent_comment_id || parsed?.parentId || parsed?.parent_id;
          } catch { return null; }
        })();

      if (prParentId && prParentId !== rootCommentId && prParentId !== commentId) {
        let traceCurr: any = parentReply;
        let belongsToThread = false;
        const prVisited = new Set<string>();
        while (traceCurr && !prVisited.has(traceCurr.id)) {
          prVisited.add(traceCurr.id);
          let m: any = null;
          if (traceCurr.metadata) {
            try {
              m = typeof traceCurr.metadata === 'string' ? JSON.parse(traceCurr.metadata) : traceCurr.metadata;
            } catch {}
          }
          const mParent = m?.parentCommentId || m?.parent_comment_id || m?.parentId || m?.parent_id;
          if (mParent === rootCommentId || mParent === commentId) {
            belongsToThread = true;
            break;
          }
          if (mParent) {
            const nextPr = await ChatMessage.findByPk(mParent);
            traceCurr = nextPr;
          } else {
            break;
          }
        }
        if (!belongsToThread) {
          throw new MomentServiceError(
            'Parent reply does not belong to the specified comment or moment',
            404,
            'PARENT_REPLY_MISMATCH'
          );
        }
      }

      targetRecipientId = parentReply.senderId;
      targetRecipientUsername =
        parentReply.sender?.username || parentReply.sender?.fullName || null;
    }

    // 5. Privacy & Block checks: ensure sender is not blocked with moment creator, root comment author, or reply recipient
    const blockedUserIdsToCheck = Array.from(
      new Set([moment.userId, rootComment.senderId, targetRecipientId])
    );
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: blockedUserIdsToCheck.flatMap((targetUid) => [
          { userId: senderId, blockedUserId: targetUid },
          { userId: targetUid, blockedUserId: senderId },
        ]),
      },
    });

    if (blockRecord) {
      throw new MomentServiceError(
        'Cannot reply due to privacy restrictions',
        403,
        'REPLY_FORBIDDEN'
      );
    }

    // 6. Audience check
    if (moment.audience === 'matches_only' && senderId !== moment.userId) {
      const [u1, u2] = [senderId, moment.userId].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
      });
      if (!match) {
        throw new MomentServiceError(
          'This moment is only visible to matches',
          403,
          'AUDIENCE_RESTRICTED'
        );
      }
    }

    // 7. Atomic persistence using database transaction
    const firstMedia = (moment.media || [])[0];
    const metadata = JSON.stringify({
      momentId: moment.id,
      parentCommentId: rootCommentId,
      parent_comment_id: rootCommentId,
      parentId: rootCommentId,
      parent_id: rootCommentId,
      parentReplyId: effectiveParentReplyId,
      parent_reply_id: effectiveParentReplyId,
      replyToCommentId: effectiveParentReplyId || rootCommentId,
      reply_to_comment_id: effectiveParentReplyId || rootCommentId,
      replyToUserId: targetRecipientId,
      replyToUsername: targetRecipientUsername,
      mediaUrl: firstMedia ? firstMedia.mediaUrl : null,
      caption: moment.caption || null,
    });

    const [u1, u2] = [senderId, targetRecipientId].sort();
    const now = new Date();

    const chatMessage = await sequelize.transaction(async (t) => {
      const [conversation] = await Conversation.findOrCreate({
        where: { user1Id: u1, user2Id: u2 },
        defaults: {
          user1Id: u1,
          user2Id: u2,
          lastMessage: trimmedMessage,
          lastMessageAt: now,
        },
        transaction: t,
      });

      const msg = await ChatMessage.create(
        {
          conversationId: conversation.id,
          senderId,
          recipientId: targetRecipientId,
          content: trimmedMessage,
          messageType: 'moment_reply',
          metadata,
          isRead: senderId === targetRecipientId,
        },
        { transaction: t }
      );

      conversation.lastMessage = trimmedMessage;
      conversation.lastMessageAt = now;
      await conversation.save({ transaction: t });

      return msg;
    });

    // 8. Fetch replier profile details
    const replierUser = await User.findByPk(senderId, {
      attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
    });

    this.dispatchMomentNotification(targetRecipientId, senderId, (senderName) =>
      notificationService.sendCommentNotification(targetRecipientId, {
        senderId,
        senderName,
        comment: trimmedMessage,
        momentId: moment.id,
        commentId: chatMessage.id,
        isReply: true,
      })
    );

    this.emitMomentActivity({
      type: 'reply',
      momentId: moment.id,
      ownerId: moment.userId,
      actorId: senderId,
      notifyUserIds: [targetRecipientId, rootComment.senderId],
      commentId: rootCommentId,
      replyId: chatMessage.id,
      parentCommentId: rootCommentId,
      actor: {
        id: replierUser?.id || senderId,
        name: replierUser?.fullName || replierUser?.nickName || 'User',
        username: replierUser?.username || null,
        profilePhoto: replierUser?.profilePicture
          ? formatThumbnailUrl(replierUser.profilePicture)
          : null,
      },
      comment: {
        id: chatMessage.id,
        replyId: chatMessage.id,
        commentId: rootCommentId,
        reply: trimmedMessage,
        text: trimmedMessage,
        parentCommentId: rootCommentId,
        parentReplyId: effectiveParentReplyId,
        replyToCommentId: effectiveParentReplyId || rootCommentId,
        replyToUserId: targetRecipientId,
        replyToUsername: targetRecipientUsername,
        momentId: moment.id,
        createdAt:
          chatMessage.createdAt instanceof Date
            ? chatMessage.createdAt.toISOString()
            : chatMessage.createdAt,
        likesCount: 0,
        repliesCount: 0,
        user: {
          id: replierUser?.id,
          username: replierUser?.username || null,
          name: replierUser?.fullName || replierUser?.nickName || 'User',
          profilePhoto: replierUser?.profilePicture
            ? formatThumbnailUrl(replierUser.profilePicture)
            : null,
        },
      },
    });

    return {
      id: chatMessage.id,
      replyId: chatMessage.id,
      commentId: rootCommentId,
      reply: trimmedMessage,
      text: trimmedMessage,
      parentCommentId: rootCommentId,
      parentReplyId: effectiveParentReplyId,
      replyToCommentId: effectiveParentReplyId || rootCommentId,
      replyTo: {
        userId: targetRecipientId,
        username: targetRecipientUsername,
      },
      replyToUserId: targetRecipientId,
      replyToUsername: targetRecipientUsername,
      momentId: moment.id,
      createdAt: chatMessage.createdAt instanceof Date ? chatMessage.createdAt.toISOString() : chatMessage.createdAt,
      timeAgo: formatTimeAgoShort(chatMessage.createdAt),
      likesCount: 0,
      isLiked: false,
      isMyComment: true,
      canDelete: true,
      repliesCount: 0,
      user: {
        id: replierUser?.id,
        username: replierUser?.username || null,
        name: replierUser?.fullName || replierUser?.nickName || 'User',
        profilePhoto: replierUser?.profilePicture
          ? formatThumbnailUrl(replierUser.profilePicture)
          : null,
        isVerified: !!replierUser?.isFaceVerified,
        isSubscribed: !!replierUser?.isSubscribed,
        city: replierUser?.city || null,
      },
      replies: [],
    };
  }

  /**
   * Retrieves replies for a specific Comment
   * GET /api/v1/moments/:momentId/comments/:commentId/replies
   */
  public async getMomentCommentReplies(
    viewerId: string,
    momentId: string,
    commentId: string,
    options?: { page?: number; limit?: number; format?: string; flat?: boolean }
  ) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    const parentComment = await ChatMessage.findByPk(commentId, {
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
    });

    if (!parentComment) {
      throw new MomentServiceError('Comment not found or unavailable', 404, 'COMMENT_NOT_FOUND');
    }

    let commentMomentId: string | null = null;
    if (parentComment.metadata) {
      try {
        const parsed =
          typeof parentComment.metadata === 'string'
            ? JSON.parse(parentComment.metadata)
            : parentComment.metadata;
        commentMomentId = parsed.momentId || null;
      } catch {}
    }
    if (commentMomentId && commentMomentId !== momentId) {
      throw new MomentServiceError(
        'Comment does not belong to the specified moment',
        404,
        'COMMENT_MOMENT_MISMATCH'
      );
    }

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    // Fetch all replies on this moment to accurately resolve full hierarchy / descendants
    let allMomentReplies: any[] = [];
    try {
      allMomentReplies = await ChatMessage.findAll({
        where: {
          messageType: 'moment_reply',
          [Op.or]: [
            { metadata: { [Op.like]: `%"momentId":"${momentId}"%` } },
            { metadata: { [Op.like]: `%"momentId": "${momentId}"%` } },
          ],
          [Op.and]: [
            {
              [Op.or]: [
                { metadata: { [Op.like]: '%"parentCommentId"%' } },
                { metadata: { [Op.like]: '%"parentReplyId"%' } },
              ],
            },
          ],
        },
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
          },
        ],
        order: [['createdAt', 'ASC']],
      });
    } catch {}

    const replyMap = new Map<string, any>();
    for (const r of allMomentReplies) {
      replyMap.set(r.id, r);
    }

    // Find all descendants of commentId (direct replies, sub-replies, and replies to sub-replies)
    const descendantIds = new Set<string>([commentId]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const r of allMomentReplies) {
        if (!descendantIds.has(r.id)) {
          let meta: any = null;
          if (r.metadata) {
            try {
              meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
            } catch {}
          }
          if (
            (meta?.parentCommentId && descendantIds.has(meta.parentCommentId)) ||
            (meta?.parentReplyId && descendantIds.has(meta.parentReplyId))
          ) {
            descendantIds.add(r.id);
            expanded = true;
          }
        }
      }
    }

    // Filter matching replies (excluding the parent comment itself)
    const matchingReplies = allMomentReplies.filter(
      (r: any) => r.id !== commentId && descendantIds.has(r.id)
    );

    const replyIds = matchingReplies.map((r: any) => r.id);
    const likesCountMap = new Map<string, number>();
    const userLikedSet = new Set<string>();

    if (replyIds.length > 0) {
      try {
        const replyLikes = await MomentCommentLike.findAll({
          where: { commentId: { [Op.in]: replyIds } },
          attributes: ['commentId', 'userId'],
        });
        for (const rl of replyLikes) {
          likesCountMap.set(rl.commentId, (likesCountMap.get(rl.commentId) || 0) + 1);
          if (rl.userId === viewerId) {
            userLikedSet.add(rl.commentId);
          }
        }
      } catch {}
    }
    const userMap = new Map<string, { id: string; username: string | null; name: string }>();
    if (parentComment.sender) {
      userMap.set(parentComment.sender.id, {
        id: parentComment.sender.id,
        username: parentComment.sender.username || null,
        name: parentComment.sender.fullName || parentComment.sender.nickName || 'User',
      });
    }
    for (const r of allMomentReplies) {
      if (r.sender) {
        userMap.set(r.sender.id, {
          id: r.sender.id,
          username: r.sender.username || null,
          name: r.sender.fullName || r.sender.nickName || 'User',
        });
      }
    }

    const rawFormattedList: any[] = [];

    for (const c of matchingReplies) {
      let meta: any = {};
      if (c.metadata) {
        try {
          meta = typeof c.metadata === 'string' ? JSON.parse(c.metadata) : c.metadata;
        } catch {}
      }

      // Canonical parentReplyId:
      // Direct reply to the comment: parentReplyId is null
      // Reply to another reply: parentReplyId is the target reply's ID
      let parentReplyId: string | null = null;
      const explicitParentReply =
        meta?.parentReplyId ||
        meta?.parent_reply_id;

      if (explicitParentReply && explicitParentReply !== commentId) {
        parentReplyId = explicitParentReply;
      } else {
        const candidateId =
          meta?.parentCommentId ||
          meta?.parent_comment_id ||
          meta?.parentId ||
          meta?.parent_id ||
          meta?.replyToCommentId ||
          meta?.reply_to_comment_id;

        if (candidateId && candidateId !== commentId && replyMap.has(candidateId)) {
          parentReplyId = candidateId;
        }
      }

      let targetUserId: string | null = meta?.replyToUserId || null;
      let targetUsername: string | null = meta?.replyToUsername || null;

      if (!targetUserId) {
        if (parentReplyId && replyMap.has(parentReplyId)) {
          const pr = replyMap.get(parentReplyId);
          targetUserId = pr.senderId || null;
          targetUsername = pr.sender?.username || pr.sender?.fullName || null;
        } else {
          targetUserId = parentComment.senderId || null;
          targetUsername = parentComment.sender?.username || parentComment.sender?.fullName || null;
        }
      } else if (userMap.has(targetUserId)) {
        const u = userMap.get(targetUserId);
        targetUsername = u?.username || u?.name || targetUsername;
      }

      const formatted = {
        id: c.id,
        replyId: c.id,
        text: c.content,
        reply: c.content,
        parentCommentId: commentId,
        parentReplyId,
        replyToCommentId: parentReplyId || commentId,
        replyTo: {
          userId: targetUserId || null,
          username: targetUsername || null,
        },
        createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
        timeAgo: formatTimeAgoShort(c.createdAt),
        likesCount: likesCountMap.get(c.id) || 0,
        isLiked: userLikedSet.has(c.id),
        isMyComment: c.senderId === viewerId,
        canDelete:
          c.senderId === viewerId ||
          parentComment.senderId === viewerId ||
          moment.userId === viewerId,
        repliesCount: 0,
        user: {
          id: c.sender?.id,
          username: c.sender?.username || null,
          name: c.sender?.fullName || c.sender?.nickName || 'User',
          avatar: c.sender?.profilePicture
            ? formatThumbnailUrl(c.sender.profilePicture)
            : null,
          isVerified: !!c.sender?.isFaceVerified,
        },
        replies: [] as any[],
      };
      rawFormattedList.push(formatted);
    }

    // Nested hierarchical tree of replies (child replies placed recursively inside parent reply's replies array)
    const treeItemMap = new Map<string, any>();
    const treeList: any[] = [];
    for (const item of rawFormattedList) {
      const treeItem = {
        ...item,
        user: { ...item.user },
        replyTo: { ...item.replyTo },
        replies: [] as any[],
      };
      treeItemMap.set(treeItem.id, treeItem);
      treeList.push(treeItem);
    }

    // Link nested sub-replies into parent reply's replies array
    const directReplies: any[] = [];
    for (const item of treeList) {
      if (item.parentReplyId && treeItemMap.has(item.parentReplyId)) {
        treeItemMap.get(item.parentReplyId).replies.push(item);
      } else {
        item.parentReplyId = null;
        directReplies.push(item);
      }
    }

    // Update repliesCount on each tree item
    for (const item of treeList) {
      item.repliesCount = item.replies.length;
    }

    const isFlat = options?.format === 'flat' || options?.flat === true;
    const targetList = isFlat
      ? rawFormattedList.map((item) => ({ ...item, replies: [] }))
      : directReplies;

    const totalReplies = matchingReplies.length;
    const paginatedReplies = targetList.slice(offset, offset + limit);
    const totalPages = Math.ceil(targetList.length / limit) || 1;

    return {
      momentId,
      parentComment: {
        id: parentComment.id,
        text: parentComment.content,
        createdAt:
          parentComment.createdAt instanceof Date
            ? parentComment.createdAt.toISOString()
            : parentComment.createdAt,
        user: {
          id: parentComment.sender?.id,
          username: parentComment.sender?.username || null,
          name: parentComment.sender?.fullName || parentComment.sender?.nickName || 'User',
          avatar: parentComment.sender?.profilePicture
            ? formatThumbnailUrl(parentComment.sender.profilePicture)
            : null,
          isVerified: !!parentComment.sender?.isFaceVerified,
        },
      },
      replies: paginatedReplies,
      pagination: {
        page,
        limit,
        totalReplies,
        totalPages,
      },
    };
  }

  /**
   * Deletes a specific reply from a comment.
   * Authorized for reply author, parent comment author, or moment creator.
   * DELETE /api/v1/moments/:momentId/comments/:commentId/replies/:replyId
   */
  public async deleteMomentCommentReply(
    userId: string,
    momentId: string,
    commentId: string,
    replyId: string
  ) {
    // 1. Verify moment
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    // 2. Verify parent comment
    const parentComment = await ChatMessage.findByPk(commentId);
    if (!parentComment) {
      throw new MomentServiceError('Comment not found or unavailable', 404, 'COMMENT_NOT_FOUND');
    }

    let commentMomentId: string | null = null;
    if (parentComment.metadata) {
      try {
        const parsed =
          typeof parentComment.metadata === 'string'
            ? JSON.parse(parentComment.metadata)
            : parentComment.metadata;
        commentMomentId = parsed.momentId || null;
      } catch {}
    }
    if (commentMomentId && commentMomentId !== momentId) {
      throw new MomentServiceError(
        'Comment does not belong to the specified moment',
        404,
        'COMMENT_MOMENT_MISMATCH'
      );
    }

    // 3. Verify reply
    const reply = await ChatMessage.findByPk(replyId);
    if (!reply) {
      throw new MomentServiceError('Reply not found or already deleted', 404, 'REPLY_NOT_FOUND');
    }

    let replyMomentId: string | null = null;
    let replyParentCommentId: string | null = null;
    let replyParentReplyId: string | null = null;
    if (reply.metadata) {
      try {
        const parsed =
          typeof reply.metadata === 'string'
            ? JSON.parse(reply.metadata)
            : reply.metadata;
        replyMomentId = parsed.momentId || null;
        replyParentCommentId = parsed.parentCommentId || null;
        replyParentReplyId = parsed.parentReplyId || null;
      } catch {}
    }

    if (
      (replyMomentId && replyMomentId !== momentId) ||
      (replyParentCommentId &&
        replyParentCommentId !== commentId &&
        replyParentReplyId !== commentId)
    ) {
      throw new MomentServiceError(
        'Reply does not belong to the specified comment or moment',
        404,
        'REPLY_MISMATCH'
      );
    }

    // 4. Authorization check: reply author, parent comment author, or moment creator
    const isReplyAuthor = reply.senderId === userId;
    const isCommentAuthor = parentComment.senderId === userId;
    const isMomentCreator = moment.userId === userId;

    if (!isReplyAuthor && !isCommentAuthor && !isMomentCreator) {
      throw new MomentServiceError(
        'You are not authorized to delete this reply',
        403,
        'FORBIDDEN'
      );
    }

    const conversationId = reply.conversationId;

    // 5. Database transaction for clean cascade deletion
    await sequelize.transaction(async (t) => {
      // Delete any likes on this reply
      await MomentCommentLike.destroy({ where: { commentId: replyId }, transaction: t });

      // Find all descendant sub-replies pointing to this reply
      const allMomentReplies = await ChatMessage.findAll({
        where: {
          messageType: 'moment_reply',
          [Op.or]: [
            { metadata: { [Op.like]: '%"parentCommentId"%' } },
            { metadata: { [Op.like]: '%"parentReplyId"%' } },
            { metadata: { [Op.like]: '%"replyToCommentId"%' } },
            { metadata: { [Op.like]: '%"parentId"%' } },
          ],
        },
        transaction: t,
      });

      const toDelete = new Set<string>([replyId]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const r of allMomentReplies) {
          if (!toDelete.has(r.id)) {
            let m: any = null;
            if (r.metadata) {
              try {
                m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
              } catch {}
            }
            if (
              (m?.parentCommentId && toDelete.has(m.parentCommentId)) ||
              (m?.parentReplyId && toDelete.has(m.parentReplyId)) ||
              (m?.replyToCommentId && toDelete.has(m.replyToCommentId)) ||
              (m?.parentId && toDelete.has(m.parentId))
            ) {
              toDelete.add(r.id);
              expanded = true;
            }
          }
        }
      }
      toDelete.delete(replyId);

      for (const childId of toDelete) {
        await MomentCommentLike.destroy({ where: { commentId: childId }, transaction: t });
        await ChatMessage.destroy({ where: { id: childId }, transaction: t });
      }

      await reply.destroy({ transaction: t });
    });

    // If conversation lastMessage was this deleted reply, update conversation
    try {
      const remainingLatestMessage = await ChatMessage.findOne({
        where: { conversationId },
        order: [['createdAt', 'DESC']],
      });

      const conversation = await Conversation.findByPk(conversationId);
      if (conversation) {
        if (remainingLatestMessage) {
          conversation.lastMessage = remainingLatestMessage.content;
          conversation.lastMessageAt = remainingLatestMessage.createdAt;
        } else {
          conversation.lastMessage = '';
        }
        await conversation.save();
      }
    } catch {}

    this.emitMomentActivity({
      type: 'comment_deleted',
      momentId,
      ownerId: moment.userId,
      actorId: userId,
      notifyUserIds: [reply.senderId, parentComment.senderId],
      commentId,
      replyId,
      parentCommentId: commentId,
    });

    return {
      replyId,
      commentId,
      momentId,
    };
  }

  /**
   * Deletes a comment/reply from a Moment.
   * Authorized for comment author, parent comment author, OR moment creator.
   * DELETE /api/v1/moments/:momentId/comments/:commentId
   */
  public async deleteMomentComment(
    userId: string,
    commentId: string,
    momentId?: string
  ) {
    const comment = await ChatMessage.findByPk(commentId);
    if (!comment) {
      throw new MomentServiceError(
        'Comment not found or already deleted',
        404,
        'COMMENT_NOT_FOUND'
      );
    }

    let parsedMomentId: string | null = null;
    let parentCommentId: string | null = null;
    if (comment.metadata) {
      try {
        const parsed =
          typeof comment.metadata === 'string'
            ? JSON.parse(comment.metadata)
            : comment.metadata;
        parsedMomentId = parsed.momentId || null;
        parentCommentId = parsed.parentCommentId || null;
      } catch {}
    }

    const resolvedMomentId = momentId || parsedMomentId;
    let moment: Moment | null = null;
    if (resolvedMomentId) {
      moment = await Moment.findByPk(resolvedMomentId);
    }

    // Check if user is parent comment author (if this was a reply)
    let isParentCommentAuthor = false;
    if (parentCommentId) {
      const parentComment = await ChatMessage.findByPk(parentCommentId);
      if (parentComment && parentComment.senderId === userId) {
        isParentCommentAuthor = true;
      }
    }

    // Authorization: User must be comment author OR moment creator OR parent comment author
    const isCommentAuthor = comment.senderId === userId;
    const isMomentCreator = moment ? moment.userId === userId : false;

    if (!isCommentAuthor && !isMomentCreator && !isParentCommentAuthor) {
      throw new MomentServiceError(
        'You are not authorized to delete this comment',
        403,
        'FORBIDDEN'
      );
    }

    // Cascade delete any child replies and comment likes
    try {
      await MomentCommentLike.destroy({ where: { commentId } });

      const allMomentReplies = await ChatMessage.findAll({
        where: {
          messageType: 'moment_reply',
          [Op.or]: [
            { metadata: { [Op.like]: '%"parentCommentId"%' } },
            { metadata: { [Op.like]: '%"parentReplyId"%' } },
            { metadata: { [Op.like]: '%"replyToCommentId"%' } },
            { metadata: { [Op.like]: '%"parentId"%' } },
          ],
        },
      });

      const toDelete = new Set<string>([commentId]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const r of allMomentReplies) {
          if (!toDelete.has(r.id)) {
            let m: any = null;
            if (r.metadata) {
              try {
                m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
              } catch {}
            }
            if (
              (m?.parentCommentId && toDelete.has(m.parentCommentId)) ||
              (m?.parentReplyId && toDelete.has(m.parentReplyId)) ||
              (m?.replyToCommentId && toDelete.has(m.replyToCommentId)) ||
              (m?.parentId && toDelete.has(m.parentId))
            ) {
              toDelete.add(r.id);
              expanded = true;
            }
          }
        }
      }
      toDelete.delete(commentId);

      for (const childId of toDelete) {
        await MomentCommentLike.destroy({ where: { commentId: childId } });
        await ChatMessage.destroy({ where: { id: childId } });
      }
    } catch {}

    const conversationId = comment.conversationId;
    await comment.destroy();

    // If conversation lastMessage was this deleted comment, update conversation
    try {
      const remainingLatestMessage = await ChatMessage.findOne({
        where: { conversationId },
        order: [['createdAt', 'DESC']],
      });

      const conversation = await Conversation.findByPk(conversationId);
      if (conversation) {
        if (remainingLatestMessage) {
          conversation.lastMessage = remainingLatestMessage.content;
          conversation.lastMessageAt = remainingLatestMessage.createdAt;
        } else {
          conversation.lastMessage = '';
        }
        await conversation.save();
      }
    } catch {}

    if (resolvedMomentId) {
      this.emitMomentActivity({
        type: 'comment_deleted',
        momentId: resolvedMomentId,
        ownerId: moment?.userId || userId,
        actorId: userId,
        notifyUserIds: [comment.senderId],
        commentId,
        parentCommentId,
      });
    }

    return {
      success: true,
      message: 'Comment deleted successfully',
      commentId,
      momentId: resolvedMomentId,
    };
  }

  /**
   * Retrieves likes / reactions list for a Moment
   * GET /api/v1/moments/:momentId/likes (or /reactions)
   */
  public async getMomentLikes(
    viewerId: string,
    momentId: string,
    options?: { page?: number; limit?: number; reaction?: string }
  ) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const whereClause: any = { momentId };
    if (options?.reaction) {
      whereClause.reaction = options.reaction;
    }

    // Check if current viewer has liked / reacted
    const viewerReaction = await MomentReaction.findOne({
      where: { momentId, userId: viewerId },
    });

    // 1. Total reactions breakdown across all reactions
    const allReactions = await MomentReaction.findAll({
      where: { momentId },
      attributes: ['reaction'],
    });

    const reactionCounts: Record<string, number> = {
      like: 0,
      heart: 0,
      love_eyes: 0,
      fire: 0,
      laugh: 0,
      surprised: 0,
      clap: 0,
    };

    for (const r of allReactions) {
      if (reactionCounts[r.reaction] !== undefined) {
        reactionCounts[r.reaction]++;
      }
    }

    // 2. Query paginated likes/reactions with User details
    const { count, rows } = await MomentReaction.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const likes = rows.map((r: any) => ({
      id: r.id,
      reactionId: r.id,
      reaction: r.reaction,
      isLike: r.reaction === 'like',
      createdAt: r.createdAt,
      timeAgo: formatTimeAgoShort(r.createdAt),
      user: {
        id: r.user?.id,
        name: r.user?.fullName || r.user?.nickName || 'User',
        profilePhoto: r.user?.profilePicture ? formatThumbnailUrl(r.user.profilePicture) : null,
        avatar: r.user?.profilePicture ? formatThumbnailUrl(r.user.profilePicture) : null,
        isVerified: !!r.user?.isFaceVerified,
        isSubscribed: !!r.user?.isSubscribed,
        city: r.user?.city || null,
      },
    }));

    return {
      momentId,
      totalLikes: allReactions.filter((r) => r.reaction === 'like').length,
      totalReactions: allReactions.length,
      reactionCounts,
      hasLiked: !!viewerReaction,
      myReaction: viewerReaction ? viewerReaction.reaction : null,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      likes,
      reactions: likes,
    };
  }

  /**
   * Unlike or remove reaction from a Moment
   * DELETE /api/v1/moments/:momentId/reactions or POST /api/v1/moments/:momentId/unlike
   */
  public async unlikeMoment(viewerId: string, momentId: string) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError(
        'Moment not found or unavailable',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    const existingReaction = await MomentReaction.findOne({
      where: {
        momentId,
        userId: viewerId,
      },
    });

    if (existingReaction) {
      await existingReaction.destroy();
    }

    // Recalculate reaction counts
    const allReactions = await MomentReaction.findAll({ where: { momentId } });
    const reactionCounts: Record<string, number> = {
      like: 0,
      heart: 0,
      love_eyes: 0,
      fire: 0,
      laugh: 0,
      surprised: 0,
      clap: 0,
    };

    for (const r of allReactions) {
      if (reactionCounts[r.reaction] !== undefined) {
        reactionCounts[r.reaction]++;
      }
    }

    this.emitMomentActivity({
      type: 'unlike',
      momentId,
      ownerId: moment.userId,
      actorId: viewerId,
      likesCount: allReactions.length,
      reaction: null,
      reactionCounts,
    });

    return {
      momentId,
      liked: false,
      unliked: true,
      isLiked: false,
      action: 'unliked',
      viewerReaction: null,
      likesCount: allReactions.length,
      totalReactions: allReactions.length,
      reactionCounts,
    };
  }

  /**
   * Permanently delete a Moment (Author only)
   * DELETE /api/v1/moments/:momentId
   */
  public async deleteMoment(userId: string, momentId: string) {
    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError(
        'Moment not found or already deleted',
        404,
        'MOMENT_NOT_FOUND'
      );
    }

    if (moment.userId !== userId) {
      throw new MomentServiceError(
        'You can only delete your own moments',
        403,
        'FORBIDDEN'
      );
    }

    moment.status = 'deleted';
    await moment.save();

    this.emitMomentActivity({
      type: 'deleted',
      momentId,
      ownerId: moment.userId,
      actorId: userId,
    });

    return {
      success: true,
      message: 'Moment deleted successfully',
      momentId,
    };
  }

  /**
   * 1. Get Moment Gifts Catalog & User Coins Balance
   * GET /api/v1/moments/gifts or GET /api/v1/moments/:momentId/gifts
   */
  public async getMomentGiftsCatalog(viewerId: string, momentId?: string) {
    await ensureMomentGiftTables();

    const viewer = await User.findByPk(viewerId, {
      attributes: ['id', 'fullName', 'nickName', 'coins', 'profilePicture'],
    });

    const userBalance = typeof viewer?.coins === 'number' ? viewer.coins : 0;

    let momentInfo: any = null;
    let totalGiftsReceived = 0;

    if (momentId) {
      const moment = await Moment.findByPk(momentId, {
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'city', 'isFaceVerified'],
          },
        ],
      });

      if (moment && moment.status !== 'deleted') {
        try {
          const summed = await MomentGift.sum('quantity', { where: { momentId } });
          const parsed = Number(summed);
          totalGiftsReceived = Number.isFinite(parsed) ? parsed : 0;
        } catch (_err) {
          totalGiftsReceived = 0;
        }

        momentInfo = {
          id: moment.id,
          caption: moment.caption,
          creator: {
            id: moment.user?.id,
            name: moment.user?.fullName || moment.user?.nickName || 'Creator',
            profilePhoto: moment.user?.profilePicture ? formatThumbnailUrl(moment.user.profilePicture) : null,
            city: moment.user?.city || null,
            isVerified: !!moment.user?.isFaceVerified,
            isSubscribed: !!moment.user?.isSubscribed,
          },
          totalGiftsReceived,
        };
      }
    }

    return {
      userBalance,
      moment: momentInfo,
      gifts: MOMENT_GIFTS_CATALOG,
    };
  }

  /**
   * 2. Send Gift to Moment with ALL Valid Checks
   * POST /api/v1/moments/:momentId/gifts
   */
  public async sendMomentGift(
    senderId: string,
    momentId: string,
    payload: {
      giftCode?: string;
      giftId?: string;
      gift?: string;
      quantity?: number;
      message?: string;
    }
  ) {
    await ensureMomentGiftTables();

    // 1. Gift Identification Validation
    const requestedIdentifier = (
      payload.giftCode ||
      payload.giftId ||
      payload.gift ||
      ''
    ).trim().toLowerCase();

    if (!requestedIdentifier) {
      throw new MomentServiceError(
        'Gift identifier is required (e.g. rose, heart, chocolate, teddy, bouquet, ring, crown, sports_car)',
        400,
        'MISSING_GIFT'
      );
    }

    const gift = MOMENT_GIFTS_CATALOG.find(
      (g) =>
        g.code.toLowerCase() === requestedIdentifier ||
        g.id.toLowerCase() === requestedIdentifier ||
        g.name.toLowerCase() === requestedIdentifier
    );

    if (!gift) {
      throw new MomentServiceError(
        `Invalid gift '${requestedIdentifier}'. Valid options: ${MOMENT_GIFTS_CATALOG.map((g) => g.code).join(', ')}`,
        400,
        'INVALID_GIFT'
      );
    }

    // 2. Quantity Validation
    const qty = Math.max(1, Math.min(100, Math.floor(Number(payload.quantity) || 1)));
    const totalCost = gift.coins * qty;
    const totalCoins = totalCost;

    // 3. Moment Existence & Status Check
    const moment = await Moment.findByPk(momentId, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isActive'],
        },
      ],
    });

    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or has been deleted', 404, 'MOMENT_NOT_FOUND');
    }

    if (moment.status !== 'active') {
      throw new MomentServiceError('This moment is no longer active', 400, 'MOMENT_NOT_ACTIVE');
    }

    // 4. Moment Creator Check
    const recipient = moment.user;
    if (!recipient || !recipient.isActive) {
      throw new MomentServiceError('Moment creator account is no longer available', 404, 'CREATOR_NOT_AVAILABLE');
    }

    // 5. Self-Gift Validation Check
    if (senderId === moment.userId) {
      throw new MomentServiceError(
        'You cannot send a gift to your own moment',
        400,
        'CANNOT_GIFT_SELF'
      );
    }

    // 6. User Block & Privacy Checks
    const isBlocked = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: senderId, blockedUserId: moment.userId },
          { userId: moment.userId, blockedUserId: senderId },
        ],
      },
    });

    if (isBlocked) {
      throw new MomentServiceError('Cannot send gift due to privacy restrictions', 403, 'USER_BLOCKED');
    }

    // 7. Audience / Matches-Only Visibility Check
    if (moment.audience === 'matches_only') {
      const [u1, u2] = [senderId, moment.userId].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
      });

      if (!match) {
        throw new MomentServiceError('This moment is only visible to matches', 403, 'AUDIENCE_RESTRICTED');
      }
    }

    // 8. Sender Account & Coin Balance Check
    const sender = await User.findByPk(senderId);
    if (!sender || !sender.isActive) {
      throw new MomentServiceError('Your account is inactive or not found', 401, 'UNAUTHORIZED');
    }

    const senderCurrentCoins = typeof sender.coins === 'number' ? sender.coins : 0;
    if (senderCurrentCoins < totalCost) {
      throw new MomentServiceError(
        `Insufficient coin balance. You need ${totalCost} coins to send ${qty > 1 ? qty + 'x ' : ''}${gift.name}, but your balance is ${senderCurrentCoins} coins.`,
        400,
        'INSUFFICIENT_COINS',
        {
          requiredCoins: totalCost,
          currentBalance: senderCurrentCoins,
          shortage: totalCost - senderCurrentCoins,
          giftName: gift.name,
          quantity: qty,
        }
      );
    }

    // 9. Atomic Database Transaction
    const transaction = await sequelize.transaction();
    let giftRecord: any;

    try {
      // Deduct coins from sender
      sender.coins = senderCurrentCoins - totalCost;
      await sender.save({ transaction });

      // Credit coins to recipient creator
      const recipientUser = await User.findByPk(moment.userId, { transaction });
      if (recipientUser) {
        recipientUser.coins = (typeof recipientUser.coins === 'number' ? recipientUser.coins : 0) + totalCost;
        await recipientUser.save({ transaction });
      }

      // Record Moment Gift transaction
      giftRecord = await MomentGift.create(
        {
          momentId: moment.id,
          senderId,
          recipientId: moment.userId,
          giftCode: gift.code,
          giftName: gift.name,
          icon: gift.icon,
          coins: gift.coins,
          quantity: qty,
          totalCoins,
          message: payload.message ? payload.message.trim() : null,
        },
        { transaction }
      );

      await transaction.commit();
    } catch (txErr: any) {
      await transaction.rollback();
      throw new MomentServiceError(
        txErr.message || 'Error processing gift transaction',
        500,
        'TRANSACTION_FAILED'
      );
    }

    this.dispatchMomentNotification(moment.userId, senderId, (senderName) =>
      notificationService.sendMomentGiftNotification(moment.userId, {
        senderId,
        senderName,
        momentId: moment.id,
        giftName: gift.name,
        giftIcon: gift.icon,
        giftCode: gift.code,
        quantity: qty,
        totalCoins,
        giftId: giftRecord.id,
      })
    );

    // 11. Direct Message Conversation Entry (so creator sees gift celebration in chat)
    try {
      const [u1, u2] = [senderId, moment.userId].sort();
      const [conversation] = await Conversation.findOrCreate({
        where: { user1Id: u1, user2Id: u2 },
        defaults: {
          user1Id: u1,
          user2Id: u2,
          lastMessage: `🎁 Sent gift: ${qty > 1 ? qty + 'x ' : ''}${gift.name} ${gift.icon}`,
          lastMessageAt: new Date(),
        },
      });

      const giftMsgContent = payload.message
        ? `🎁 Sent you ${qty > 1 ? qty + 'x ' : ''}${gift.name} ${gift.icon} on your Moment: "${payload.message}"`
        : `🎁 Sent you ${qty > 1 ? qty + 'x ' : ''}${gift.name} ${gift.icon} on your Moment!`;

      await ChatMessage.create({
        conversationId: conversation.id,
        senderId,
        recipientId: moment.userId,
        content: giftMsgContent,
        messageType: 'moment_gift',
        metadata: JSON.stringify({
          type: 'gift',
          momentId: moment.id,
          giftCode: gift.code,
          giftName: gift.name,
          icon: gift.icon,
          quantity: qty,
          totalCoins,
        }),
        isRead: false,
      });

      conversation.lastMessage = giftMsgContent;
      conversation.lastMessageAt = new Date();
      await conversation.save();
    } catch (_chatErr) {
      // Safe to ignore chat record failure
    }

    // 12. Total gifts count on this moment (sum of quantities, same as the feed)
    let totalMomentGifts = qty;
    try {
      const summed = await MomentGift.sum('quantity', { where: { momentId } });
      const parsed = Number(summed);
      if (Number.isFinite(parsed)) totalMomentGifts = parsed;
    } catch (_sumErr) {
      totalMomentGifts = qty;
    }

    this.emitMomentActivity({
      type: 'gift',
      momentId: moment.id,
      ownerId: moment.userId,
      actorId: senderId,
      giftsCount: totalMomentGifts,
      actor: {
        id: sender.id,
        name: sender.fullName || sender.nickName || 'User',
        username: sender.username || null,
        profilePhoto: sender.profilePicture
          ? formatThumbnailUrl(sender.profilePicture)
          : null,
      },
      gift: {
        giftTransactionId: giftRecord.id,
        id: gift.id,
        code: gift.code,
        name: gift.name,
        icon: gift.icon,
        quantity: qty,
        totalCoins,
        message: giftRecord.message,
        createdAt: giftRecord.createdAt,
        sender: {
          id: sender.id,
          name: sender.fullName || sender.nickName || 'User',
          profilePhoto: sender.profilePicture
            ? formatThumbnailUrl(sender.profilePicture)
            : null,
        },
        recipient: {
          id: recipient.id,
          name: recipient.fullName || recipient.nickName || 'Creator',
          profilePhoto: recipient.profilePicture
            ? formatThumbnailUrl(recipient.profilePicture)
            : null,
        },
      },
    });

    return {
      giftTransactionId: giftRecord.id,
      momentId: moment.id,
      gift: {
        id: gift.id,
        code: gift.code,
        name: gift.name,
        icon: gift.icon,
        pricePerUnit: gift.coins,
        quantity: qty,
        totalCoins,
      },
      message: giftRecord.message,
      sender: {
        id: sender.id,
        name: sender.fullName || sender.nickName || 'You',
        previousBalance: senderCurrentCoins,
        newBalance: sender.coins,
        coinsDeducted: totalCoins,
      },
      recipient: {
        id: recipient.id,
        name: recipient.fullName || recipient.nickName || 'Creator',
        profilePhoto: recipient.profilePicture ? formatThumbnailUrl(recipient.profilePicture) : null,
      },
      totalMomentGifts,
      createdAt: giftRecord.createdAt,
    };
  }

  /**
   * 3. Get Gifts Received on a Moment
   * GET /api/v1/moments/:momentId/gifts/received
   */
  public async getMomentGiftsReceived(
    viewerId: string,
    momentId: string,
    options?: { page?: number; limit?: number }
  ) {
    await ensureMomentGiftTables();

    const moment = await Moment.findByPk(momentId);
    if (!moment || moment.status === 'deleted') {
      throw new MomentServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
    }

    const page = Math.max(1, options?.page || 1);
    const limit = Math.max(1, Math.min(100, options?.limit || 20));
    const offset = (page - 1) * limit;

    const { count, rows } = await MomentGift.findAndCountAll({
      where: { momentId },
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const totalCoins = (await MomentGift.sum('totalCoins', { where: { momentId } })) || 0;

    const gifts = rows.map((g: any) => ({
      id: g.id,
      giftCode: g.giftCode,
      giftName: g.giftName,
      icon: g.icon,
      coins: g.coins,
      quantity: g.quantity,
      totalCoins: g.totalCoins,
      message: g.message,
      createdAt: g.createdAt,
      timeAgo: formatTimeAgoShort(g.createdAt),
      sender: {
        id: g.sender?.id,
        name: g.sender?.fullName || g.sender?.nickName || 'User',
        profilePhoto: g.sender?.profilePicture ? formatThumbnailUrl(g.sender.profilePicture) : null,
        avatar: g.sender?.profilePicture ? formatThumbnailUrl(g.sender.profilePicture) : null,
        isVerified: !!g.sender?.isFaceVerified,
        isSubscribed: !!g.sender?.isSubscribed,
        city: g.sender?.city || null,
      },
    }));

    return {
      momentId,
      totalGiftsCount: count,
      totalCoins,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      gifts,
    };
  }

  /**
   * Batch aggregates active, non-expired, eligible moment counts for candidate user IDs
   * viewed by a given viewer in Discover People and Moments Feed.
   *
   * Requirements:
   * - Count moments belonging to candidate users or viewer.
   * - Count only moments that are active, not expired, not deleted, and eligible under privacy and moderation rules.
   * - Reuses existing moment-expiry logic (expiresAt IS NULL OR expiresAt > now).
   * - Excludes 'matches_only' audience unless viewer and candidate are matched.
   * - Excludes 'close_friends' audience.
   * - Excludes moments reported by viewer.
   * - Avoids duplicate counts caused by joins (queries Moment directly with group by).
   * - Zero N+1 queries.
   */
  public async getEligibleMomentCountsByUserIds(
    viewerId: string,
    targetUserIds: string[]
  ): Promise<Map<string, number>> {
    const countsMap = new Map<string, number>();
    if (!targetUserIds || targetUserIds.length === 0) {
      return countsMap;
    }

    // Default 0 for every requested candidate
    for (const id of targetUserIds) {
      countsMap.set(id, 0);
    }

    const now = new Date();

    // 1. Viewer's own moments count if requested
    if (targetUserIds.includes(viewerId)) {
      const selfCount = await Moment.count({
        where: {
          userId: viewerId,
          status: 'active',
          [Op.or]: [
            { expiresAt: null },
            { expiresAt: { [Op.gt]: now } },
          ],
        },
      });
      countsMap.set(viewerId, selfCount);
    }

    // 2. Candidate counts
    const candidateIds = targetUserIds.filter((id) => id && id !== viewerId);
    if (candidateIds.length === 0) {
      return countsMap;
    }

    // Query moments reported by viewer to exclude them from candidate's visible count
    const reportedRecords = await UserReport.findAll({
      where: {
        reporterId: viewerId,
        momentId: { [Op.ne]: null },
        status: { [Op.ne]: 'dismissed' },
      },
      attributes: ['momentId'],
    });

    const reportedMomentIds = reportedRecords
      .map((r) => r.momentId)
      .filter((id): id is string => Boolean(id));

    // Check matches between viewer and candidate IDs
    const matches = await Match.findAll({
      where: {
        [Op.or]: [
          { user1Id: viewerId, user2Id: { [Op.in]: candidateIds } },
          { user2Id: viewerId, user1Id: { [Op.in]: candidateIds } },
        ],
        isActive: true,
      },
      attributes: ['user1Id', 'user2Id'],
    });

    const matchedCandidateIds = new Set<string>();
    for (const m of matches) {
      matchedCandidateIds.add(m.user1Id === viewerId ? m.user2Id : m.user1Id);
    }

    const candidateOrConditions: any[] = [];
    const nonMatchedIds = candidateIds.filter((id) => !matchedCandidateIds.has(id));
    if (nonMatchedIds.length > 0) {
      candidateOrConditions.push({
        userId: { [Op.in]: nonMatchedIds },
        audience: { [Op.notIn]: ['matches_only', 'close_friends'] },
      });
    }
    const matchedIdsArray = Array.from(matchedCandidateIds);
    if (matchedIdsArray.length > 0) {
      candidateOrConditions.push({
        userId: { [Op.in]: matchedIdsArray },
        audience: { [Op.ne]: 'close_friends' },
      });
    }

    const momentWhere: any = {
      status: 'active',
      [Op.or]: [
        { expiresAt: null },
        { expiresAt: { [Op.gt]: now } },
      ],
      [Op.and]: [
        { [Op.or]: candidateOrConditions },
      ],
    };

    if (reportedMomentIds.length > 0) {
      momentWhere.id = { [Op.notIn]: reportedMomentIds };
    }

    const rows = await Moment.findAll({
      where: momentWhere,
      attributes: [
        'userId',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['userId'],
      raw: true,
    });

    for (const row of rows as any[]) {
      const parsed = parseInt(String(row.count), 10);
      if (!isNaN(parsed) && parsed > 0) {
        countsMap.set(row.userId, parsed);
      }
    }

    return countsMap;
  }

  /**
   * Comment totals for the moments on this page.
   * Postgres uses the moment id stored in metadata so it does not scan every chat row.
   */
  private async countMomentReplies(
    momentIds: string[],
    options?: { excludeGiftContent?: boolean }
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const ids = [...new Set(momentIds.filter(Boolean))];
    for (const id of ids) counts.set(id, 0);
    if (ids.length === 0) return counts;

    if (sequelize.getDialect() === 'postgres') {
      const giftContentSql = options?.excludeGiftContent
        ? `AND COALESCE(content, '') NOT LIKE '🎁%'`
        : '';
      const rows = await sequelize.query<{ momentId: string; count: number }>(
        `SELECT substring(metadata from '"momentId":"([0-9a-fA-F-]{36})"') AS "momentId",
                COUNT(*)::int AS "count"
         FROM chat_messages
         WHERE "messageType" = 'moment_reply'
           AND substring(metadata from '"momentId":"([0-9a-fA-F-]{36})"') IN (:momentIds)
           AND COALESCE(metadata, '') NOT LIKE '%"type":"gift"%'
           ${giftContentSql}
         GROUP BY 1`,
        { replacements: { momentIds: ids }, type: QueryTypes.SELECT }
      );
      for (const row of rows) {
        if (row.momentId && counts.has(row.momentId)) counts.set(row.momentId, Number(row.count) || 0);
      }
      return counts;
    }

    const replyMessages = await ChatMessage.findAll({
      where: {
        messageType: 'moment_reply',
        [Op.or]: ids.map((id) => ({
          metadata: { [Op.like]: `%"momentId":"${id}"%` },
        })),
      },
      attributes: ['metadata', 'content'],
    });
    for (const msg of replyMessages) {
      if (!msg.metadata) continue;
      if (options?.excludeGiftContent && String(msg.content || '').startsWith('🎁')) continue;
      try {
        const parsed = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
        if (parsed.type === 'gift') continue;
        if (parsed.momentId && counts.has(parsed.momentId)) {
          counts.set(parsed.momentId, (counts.get(parsed.momentId) || 0) + 1);
        }
      } catch {
        // Ignore a reply whose metadata is not JSON.
      }
    }
    return counts;
  }

  /**
   * Batch resolves moment counts and interest compatibility percentages for target creators
   * against the authenticated viewer.
   */
  public async getCompatibilityAndMomentCounts(
    viewerId: string,
    targetUserIds: string[]
  ): Promise<{
    momentCounts: Map<string, number>;
    compatibilityMap: Map<string, { interestMatchPercentage: number }>;
  }> {
    const compatibilityMap = new Map<string, { interestMatchPercentage: number }>();
    const uniqueTargetIds = Array.from(new Set(targetUserIds.filter(Boolean)));

    for (const id of uniqueTargetIds) {
      compatibilityMap.set(id, { interestMatchPercentage: 0 });
    }

    if (uniqueTargetIds.length === 0) {
      return {
        momentCounts: new Map<string, number>(),
        compatibilityMap,
      };
    }

    // Parallel fetch: eligible moment counts AND all active user interests (viewer + targets)
    const userIdsToFetch = Array.from(new Set([viewerId, ...uniqueTargetIds]));
    const [momentCounts, userInterests] = await Promise.all([
      this.getEligibleMomentCountsByUserIds(viewerId, uniqueTargetIds),
      UserInterest.findAll({
        where: {
          userId: { [Op.in]: userIdsToFetch },
        },
        include: [
          {
            model: Interest,
            as: 'interest',
            where: { isActive: true },
            attributes: ['id'],
            required: true,
          },
        ],
        attributes: ['userId', 'interestId'],
      }),
    ]);

    // Group active interest IDs per user
    const userInterestMap = new Map<string, Set<string>>();
    for (const ui of userInterests) {
      if (!userInterestMap.has(ui.userId)) {
        userInterestMap.set(ui.userId, new Set());
      }
      userInterestMap.get(ui.userId)!.add(ui.interestId);
    }

    const viewerInterestIds = userInterestMap.get(viewerId) || new Set<string>();

    for (const targetId of uniqueTargetIds) {
      const targetInterestIds = userInterestMap.get(targetId) || new Set<string>();
      const interestMatchPercentage = calculateInterestMatchPercentage(
        viewerInterestIds,
        targetInterestIds
      );
      compatibilityMap.set(targetId, {
        interestMatchPercentage,
      });
    }

    return {
      momentCounts,
      compatibilityMap,
    };
  }
}

export const momentService = new MomentService();
