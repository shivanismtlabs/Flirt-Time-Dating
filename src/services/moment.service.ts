import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
  MomentGift,
  MOMENT_GIFTS_CATALOG,
  ensureMomentGiftTables,
  Notification,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
} from '../models';
import {
  s3Service,
  formatMediaUrl,
  formatThumbnailUrl,
  extractS3Key,
} from './s3.service';
import { MomentAudience } from '../models/moment.model';
import { MomentReactionType } from '../models/momentReaction.model';

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
   * Publishes a new Moment with 1 to 5 images.
   * Ensures atomic persistence and cleans up orphaned S3 uploads on failure.
   */
  public async createMoment(input: {
    creatorId: string;
    caption?: string | null;
    audience?: MomentAudience;
    locationLabel?: string | null;
    files?: Express.Multer.File[];
    mediaUrls?: string[];
  }) {
    const {
      creatorId,
      caption,
      audience = 'everyone',
      locationLabel,
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
            locationLabel: locationLabel?.trim() || creator.city || null,
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
              locationLabel: locationLabel?.trim() || creator.city || null,
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

      return {
        momentId: moment.id,
        creatorId: moment.userId,
        caption: moment.caption,
        audience: moment.audience,
        status: moment.status,
        publishedAt: moment.publishedAt,
        expiresAt: null,
        locationLabel: moment.locationLabel,
        location: moment.locationLabel ? { name: moment.locationLabel } : null,
        media: mediaRecords.map((m) => ({
          mediaId: m.id,
          imageKey: m.mediaUrl,
          imageUrl: formatMediaUrl(m.mediaUrl),
          mediaUrl: formatMediaUrl(m.mediaUrl),
          thumbnailUrl: formatThumbnailUrl(m.mediaUrl),
          mediaType: m.mediaType,
          displayOrder: m.displayOrder,
        })),
      };
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

    // 5. Query active Moments
    const whereConditions: any[] = [
      { userId: resolvedUserId },
      { status: 'active' },
    ];

    if (!isSelf && !isMatched) {
      whereConditions.push({ audience: { [Op.ne]: 'matches_only' } });
    }

    const { count, rows: moments } = await Moment.findAndCountAll({
      where: { [Op.and]: whereConditions },
      include: [
        {
          model: MomentMedia,
          as: 'media',
        },
        {
          model: MomentReaction,
          as: 'reactions',
        },
      ],
      distinct: true,
      order: [
        ['publishedAt', 'DESC'],
        [{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC'],
      ],
      limit,
      offset,
    });

    // 6. Replies / comments counts & gifts counts
    const momentIds = moments.map((m: any) => m.id);
    const repliesCountMap = new Map<string, number>();
    const giftsCountMap = new Map<string, number>();
    for (const id of momentIds) {
      repliesCountMap.set(id, 0);
      giftsCountMap.set(id, 0);
    }

    if (momentIds.length > 0) {
      try {
        const replyMessages = await ChatMessage.findAll({
          where: {
            messageType: 'moment_reply',
            [Op.or]: momentIds.map((id) => ({
              metadata: { [Op.like]: `%"momentId":"${id}"%` },
            })),
          },
          attributes: ['metadata'],
        });

        for (const msg of replyMessages) {
          if (msg.metadata) {
            try {
              const parsed =
                typeof msg.metadata === 'string'
                  ? JSON.parse(msg.metadata)
                  : msg.metadata;
              if (parsed.type === 'gift') continue;
              if (parsed.momentId && repliesCountMap.has(parsed.momentId)) {
                repliesCountMap.set(
                  parsed.momentId,
                  (repliesCountMap.get(parsed.momentId) || 0) + 1
                );
              }
            } catch {}
          }
        }
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
      city: targetUser.city || null,
      location: targetUser.city || null,
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
        imageUrl: firstMedia ? formatMediaUrl(firstMedia.mediaUrl) : null,
        mediaUrl: firstMedia ? formatMediaUrl(firstMedia.mediaUrl) : null,
        thumbnailUrl: firstMedia ? formatThumbnailUrl(firstMedia.mediaUrl) : null,
        mediaCount: sortedMedia.length,
        hasMultipleMedia: sortedMedia.length > 1,
        caption: m.caption,
        audience: m.audience,
        publishedAt: m.publishedAt,
        createdAt: m.createdAt,
        expiresAt: m.expiresAt || null,
        timeRemainingMinutes: null,
        relativeAge: formatRelativeAge(m.publishedAt),
        timeAgo: formatTimeAgoShort(m.publishedAt),
        locationLabel: m.locationLabel || targetUser.city || null,
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
      userId: resolvedUserId,
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

    if (blockedUserIds.size > 0) {
      whereConditions.push({
        userId: { [Op.notIn]: Array.from(blockedUserIds) },
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

      // Group moments by creator
      const storiesMap = new Map<string, any>();
      for (const m of activeMoments) {
        const creator = m.user;
        if (!creator) continue;

        const sortedMedia = (m.media || []).sort(
          (a: any, b: any) => a.displayOrder - b.displayOrder
        );
        const firstMedia = sortedMedia[0];

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
        });
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
    const { count, rows: moments } = await Moment.findAndCountAll({
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
        {
          model: MomentReaction,
          as: 'reactions',
        },
      ],
      distinct: true,
      order: [
        ['publishedAt', 'DESC'],
        [{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC'],
      ],
      limit,
      offset,
    });

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
        const replyMessages = await ChatMessage.findAll({
          where: {
            messageType: 'moment_reply',
            [Op.or]: momentIds.map((id) => ({
              metadata: { [Op.like]: `%"momentId":"${id}"%` },
            })),
          },
          attributes: ['metadata'],
        });

        for (const msg of replyMessages) {
          if (msg.metadata) {
            try {
              const parsed =
                typeof msg.metadata === 'string'
                  ? JSON.parse(msg.metadata)
                  : msg.metadata;
              if (parsed.type === 'gift') continue;
              if (parsed.momentId && repliesCountMap.has(parsed.momentId)) {
                repliesCountMap.set(
                  parsed.momentId,
                  (repliesCountMap.get(parsed.momentId) || 0) + 1
                );
              }
            } catch {}
          }
        }
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

      return {
        id: m.id,
        momentId: m.id,
        caption: m.caption,
        audience: m.audience,
        publishedAt: m.publishedAt,
        expiresAt: m.expiresAt || null,
        relativeAge: formatRelativeAge(m.publishedAt),
        timeAgo: formatTimeAgoShort(m.publishedAt),
        locationLabel: m.locationLabel || (creator ? creator.city : null) || null,
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
              city: creator.city || null,
              location: creator.city || null,
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
      commentsCount = await ChatMessage.count({
        where: {
          messageType: 'moment_reply',
          metadata: {
            [Op.like]: `%"momentId":"${moment.id}"%`,
            [Op.notLike]: '%"type":"gift"%',
          },
          content: {
            [Op.notLike]: '🎁%',
          },
        },
      });
    } catch {}

    let giftsCount = 0;
    try {
      giftsCount = (await MomentGift.sum('quantity', { where: { momentId: moment.id } })) || 0;
    } catch {}

    const likesCount = reactions.length;

    return {
      id: moment.id,
      momentId: moment.id,
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
        city: creator.city || null,
        location: creator.city || null,
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
      locationLabel: moment.locationLabel || creator.city || null,
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

    if (forcedAction === 'like') {
      if (!existingReaction) {
        await MomentReaction.create({
          momentId,
          userId: viewerId,
          reaction: 'like',
        });
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
      }
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
    message: string
  ) {
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

    return {
      replyId: chatMessage.id,
      commentId: chatMessage.id,
      conversationId: conversation.id,
      momentId: moment.id,
      recipientId: moment.userId,
      message: trimmedMessage,
      comment: trimmedMessage,
      createdAt: chatMessage.createdAt,
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
          { content: { [Op.notLike]: '🎁%' } },
        ],
      },
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

    const comments = rows.map((c: any) => ({
      id: c.id,
      commentId: c.id,
      replyId: c.id,
      momentId,
      comment: c.content,
      message: c.content,
      createdAt: c.createdAt,
      timeAgo: formatTimeAgoShort(c.createdAt),
      isMyComment: c.senderId === viewerId,
      canDelete: c.senderId === viewerId || moment.userId === viewerId,
      user: {
        id: c.sender?.id,
        name: c.sender?.fullName || c.sender?.nickName || 'User',
        profilePhoto: c.sender?.profilePicture ? formatThumbnailUrl(c.sender.profilePicture) : null,
        avatar: c.sender?.profilePicture ? formatThumbnailUrl(c.sender.profilePicture) : null,
        isVerified: !!c.sender?.isFaceVerified,
        city: c.sender?.city || null,
      },
    }));

    return {
      momentId,
      totalComments: count,
      totalReplies: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      comments,
      replies: comments,
    };
  }

  /**
   * Deletes a comment/reply from a Moment.
   * Authorized for either the comment author OR the moment creator.
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
    if (comment.metadata) {
      try {
        const parsed =
          typeof comment.metadata === 'string'
            ? JSON.parse(comment.metadata)
            : comment.metadata;
        parsedMomentId = parsed.momentId || null;
      } catch {}
    }

    const resolvedMomentId = momentId || parsedMomentId;
    let moment: Moment | null = null;
    if (resolvedMomentId) {
      moment = await Moment.findByPk(resolvedMomentId);
    }

    // Authorization: User must be comment author OR moment creator
    const isCommentAuthor = comment.senderId === userId;
    const isMomentCreator = moment ? moment.userId === userId : false;

    if (!isCommentAuthor && !isMomentCreator) {
      throw new MomentServiceError(
        'You are not authorized to delete this comment',
        403,
        'FORBIDDEN'
      );
    }

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

    const userBalance = typeof viewer?.coins === 'number' ? viewer.coins : 500;

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
          totalGiftsReceived = (await MomentGift.sum('quantity', { where: { momentId } })) || 0;
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

    const senderCurrentCoins = typeof sender.coins === 'number' ? sender.coins : 500;
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
        recipientUser.coins = (typeof recipientUser.coins === 'number' ? recipientUser.coins : 500) + totalCost;
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

    // 10. Background In-App Notification to Recipient
    try {
      const senderDisplayName = sender.fullName || sender.nickName || 'Someone';
      await Notification.create({
        recipientId: moment.userId,
        senderId,
        type: 'moment_gift',
        title: `New Gift Received! ${gift.icon}`,
        body: `${senderDisplayName} sent you ${qty > 1 ? qty + 'x ' : ''}${gift.name} ${gift.icon} on your moment!`,
        entityId: moment.id,
        data: {
          momentId: moment.id,
          giftId: giftRecord.id,
          giftCode: gift.code,
          giftName: gift.name,
          icon: gift.icon,
          quantity: qty,
          totalCoins,
          senderName: senderDisplayName,
        },
        isRead: false,
      });
    } catch (_notifErr) {
      // Safe to ignore notification failure
    }

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

    // 12. Total gifts count on this moment
    let totalMomentGifts = 0;
    try {
      totalMomentGifts = (await MomentGift.sum('quantity', { where: { momentId } })) || qty;
    } catch (_sumErr) {
      totalMomentGifts = qty;
    }

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
}

export const momentService = new MomentService();
