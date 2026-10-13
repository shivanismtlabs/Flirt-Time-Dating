import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
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

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'MomentServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
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
      const moment = await Moment.create(
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
        expiresAt: moment.expiresAt,
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

    // 6. Replies / comments counts
    const momentIds = moments.map((m: any) => m.id);
    const repliesCountMap = new Map<string, number>();
    for (const id of momentIds) {
      repliesCountMap.set(id, 0);
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
      const likesCount = reactionCounts.heart || reactionCounts.total || 0;

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
        giftsCount: 0,
        sharesCount: 0,
        isLiked: !!myReaction,
        viewerReaction: myReaction,
        reactionCounts,
        canReply: !isSelf,
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

    // Batch query comment/reply counts for all moments in page
    const momentIds = moments.map((m: any) => m.id);
    const repliesCountMap = new Map<string, number>();
    for (const id of momentIds) {
      repliesCountMap.set(id, 0);
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
      const likesCount = reactionCounts.heart || reactionCounts.total || 0;

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
        giftsCount: 0,
        sharesCount: 0,
        isLiked: !!myReaction,
        viewerReaction: myReaction,
        reactionCounts,
        canReply: !isSelf,
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

    // Count comments/replies for this moment
    let commentsCount = 0;
    try {
      commentsCount = await ChatMessage.count({
        where: {
          messageType: 'moment_reply',
          metadata: { [Op.like]: `%"momentId":"${moment.id}"%` },
        },
      });
    } catch {}

    const likesCount = reactionCounts.heart || reactions.length;

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
      giftsCount: 0,
      sharesCount: 0,
      isLiked: !!myReaction,
      viewerReaction: myReaction,
      myReaction,
      totalReactions: reactions.length,
      reactionCounts,
      canReply: !isSelf,
    };
  }

  /**
   * Adds or updates a viewer's emoji reaction on a Moment.
   * Enforces 1 reaction per viewer (updates if changing emoji) and blocks check.
   */
  public async reactToMoment(
    viewerId: string,
    momentId: string,
    reaction: MomentReactionType
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
      reaction,
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

    // Prevent self-reply
    if (senderId === moment.userId) {
      throw new MomentServiceError(
        'You cannot reply to your own Moment',
        400,
        'SELF_REPLY_NOT_ALLOWED'
      );
    }

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
      isRead: false,
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
        metadata: { [Op.like]: `%"momentId":"${momentId}"%` },
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
      momentId,
      comment: c.content,
      message: c.content,
      createdAt: c.createdAt,
      timeAgo: formatTimeAgoShort(c.createdAt),
      user: {
        id: c.sender?.id,
        name: c.sender?.fullName || c.sender?.nickName || 'User',
        profilePhoto: c.sender?.profilePicture ? formatThumbnailUrl(c.sender.profilePicture) : null,
        isVerified: !!c.sender?.isFaceVerified,
        city: c.sender?.city || null,
      },
    }));

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
      unliked: true,
      action: 'removed',
      isLiked: false,
      viewerReaction: null,
      totalReactions: allReactions.length,
      likesCount: reactionCounts.heart || allReactions.length,
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
}

export const momentService = new MomentService();
