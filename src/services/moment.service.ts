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
import { s3Service } from './s3.service';
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
    files: Express.Multer.File[];
  }) {
    const { creatorId, caption, audience = 'everyone', locationLabel, files } = input;

    // 1. Validate images presence (1 to 5 required)
    if (!files || files.length === 0) {
      throw new MomentServiceError(
        'At least 1 image is required to create a Moment',
        400,
        'NO_IMAGES_PROVIDED'
      );
    }

    if (files.length > 5) {
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

    // 3. Validate image magic bytes and individual sizes
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

    // 4. Upload all media to secure storage preserving order
    const uploadedMediaKeys: Array<{ key: string; order: number }> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const s3Key = await s3Service.uploadMedia(
          file.buffer,
          creatorId,
          file.mimetype,
          'moments'
        );
        uploadedMediaKeys.push({ key: s3Key, order: i });
      }
    } catch (uploadErr: any) {
      // Clean up any successfully uploaded keys before error
      for (const item of uploadedMediaKeys) {
        await s3Service.deleteObject(item.key);
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
        media: mediaRecords.map((m) => ({
          mediaId: m.id,
          mediaUrl: m.mediaUrl,
          mediaType: m.mediaType,
          displayOrder: m.displayOrder,
        })),
      };
    } catch (dbErr: any) {
      await t.rollback();
      // Clean up orphaned S3 uploads on database failure
      for (const item of uploadedMediaKeys) {
        await s3Service.deleteObject(item.key);
      }
      throw dbErr;
    }
  }

  /**
   * Retrieves visible active Moment thumbnails for a user's profile detail screen.
   * Enforces block restrictions and audience permissions.
   */
  public async getUserMoments(viewerId: string, targetUserId: string) {
    // 1. Check target existence
    const targetUser = await User.findByPk(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      throw new MomentServiceError(
        'User not found or unavailable',
        404,
        'USER_NOT_FOUND'
      );
    }

    // 2. Block check in both directions
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: viewerId, blockedUserId: targetUserId },
          { userId: targetUserId, blockedUserId: viewerId },
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

    // 3. Check mutual match status if viewer is not the creator
    const isSelf = viewerId === targetUserId;
    let isMatched = false;

    if (!isSelf) {
      const [u1, u2] = [viewerId, targetUserId].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
      });
      isMatched = !!match;
    }

    // 4. Query active Moments (permanent posts)
    const moments = await Moment.findAll({
      where: {
        userId: targetUserId,
        status: 'active',
      },
      include: [
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

    // 5. Filter out matches_only moments if not matched and not self
    const visibleMoments = moments.filter((m) => {
      if (isSelf) return true;
      if (m.audience === 'matches_only' && !isMatched) return false;
      return true;
    });

    return {
      userId: targetUserId,
      moments: visibleMoments.map((m) => {
        const sortedMedia = (m.media || []).sort(
          (a: any, b: any) => a.displayOrder - b.displayOrder
        );
        const firstMedia = sortedMedia[0];
        return {
          momentId: m.id,
          thumbnailUrl: firstMedia ? firstMedia.mediaUrl : null,
          mediaCount: sortedMedia.length,
          caption: m.caption,
          publishedAt: m.publishedAt,
          expiresAt: m.expiresAt || null,
          timeRemainingMinutes: null,
        };
      }),
    };
  }

  /**
   * Retrieves active Moments for the discovery / feed screen.
   * Supports both flat feed mode and stories tray grouped by user.
   * Enforces mutual block exclusion and audience privacy.
   */
  public async getAllMoments(
    viewerId: string,
    options: { page?: number; limit?: number; type?: 'feed' | 'stories' } = {}
  ) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;
    const feedType = options.type || 'feed';

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

    // 3. Construct where clause (no 24-hour expiry check)
    const whereConditions: any[] = [
      { status: 'active' },
      {
        [Op.or]: [
          { userId: viewerId },
          { audience: 'everyone' },
          ...(matchIdsArray.length > 0
            ? [{ audience: 'matches_only', userId: { [Op.in]: matchIdsArray } }]
            : []),
        ],
      },
    ];

    if (blockedUserIds.size > 0) {
      whereConditions.push({
        userId: { [Op.notIn]: Array.from(blockedUserIds) },
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
            profilePhoto: creator.profilePicture || null,
            isFaceVerified: !!creator.isFaceVerified,
            city: creator.city || null,
            isSelf: creator.id === viewerId,
            momentsCount: 0,
            latestMoment: {
              momentId: m.id,
              thumbnailUrl: firstMedia ? firstMedia.mediaUrl : null,
              caption: m.caption,
              publishedAt: m.publishedAt,
              relativeAge: formatRelativeAge(m.publishedAt),
            },
            moments: [],
          });
        }

        const entry = storiesMap.get(creator.id);
        entry.momentsCount += 1;
        entry.moments.push({
          momentId: m.id,
          thumbnailUrl: firstMedia ? firstMedia.mediaUrl : null,
          mediaCount: sortedMedia.length,
          caption: m.caption,
          publishedAt: m.publishedAt,
          relativeAge: formatRelativeAge(m.publishedAt),
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

      return {
        momentId: m.id,
        caption: m.caption,
        audience: m.audience,
        publishedAt: m.publishedAt,
        expiresAt: m.expiresAt || null,
        relativeAge: formatRelativeAge(m.publishedAt),
        locationLabel: m.locationLabel,
        creator: creator
          ? {
              creatorId: creator.id,
              name:
                creator.nickName ||
                creator.firstName ||
                creator.fullName ||
                creator.username ||
                'User',
              profilePhoto: creator.profilePicture || null,
              isFaceVerified: !!creator.isFaceVerified,
              city: creator.city || null,
            }
          : null,
        media: sortedMedia.map((media: any) => ({
          mediaId: media.id,
          mediaUrl: media.mediaUrl,
          mediaType: media.mediaType,
          displayOrder: media.displayOrder,
        })),
        thumbnailUrl: sortedMedia[0] ? sortedMedia[0].mediaUrl : null,
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
        mediaUrl: m.mediaUrl,
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

    return {
      momentId: moment.id,
      creator: {
        userId: creator.id,
        name: creatorDisplayName,
        profilePhoto: creator.profilePicture || null,
        isVerified: !!creator.isFaceVerified,
        city: creator.city || null,
      },
      media,
      caption: moment.caption,
      audience: moment.audience,
      publishedAt: moment.publishedAt,
      relativeAge: formatRelativeAge(moment.publishedAt),
      expiresAt: moment.expiresAt || null,
      timeRemainingMinutes: null,
      locationLabel: moment.locationLabel || creator.city || null,
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
      conversationId: conversation.id,
      momentId: moment.id,
      recipientId: moment.userId,
      message: trimmedMessage,
      createdAt: chatMessage.createdAt,
    };
  }
}

export const momentService = new MomentService();
