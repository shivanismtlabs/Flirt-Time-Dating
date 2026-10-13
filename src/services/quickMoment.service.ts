import { Op } from 'sequelize';
import {
  QuickMoment,
  QuickMomentReaction,
  QuickMomentView,
  User,
  Notification,
} from '../models';
import { s3Service, formatMediaUrl, formatThumbnailUrl, extractS3Key } from './s3.service';

export class QuickMomentServiceError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode = 400, errorCode = 'QUICK_MOMENT_ERROR') {
    super(message);
    this.name = 'QuickMomentServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, QuickMomentServiceError.prototype);
  }
}

export const ALLOWED_EMOJIS = ['😍', '🔥', '😂', '😮', '👏', '❤️'];

/**
 * Format relative time string (e.g., "48 min ago", "2 hr ago", "1h", "2h")
 */
function formatTimeAgo(date: Date, short = false): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  const hours = Math.floor(mins / 60);

  if (short) {
    if (hours < 1) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  if (mins < 60) {
    return `${mins} min ago`;
  }
  if (hours < 24) {
    return `${hours} hr ago`;
  }
  return `${Math.floor(hours / 24)} days ago`;
}

/**
 * Helper to build reaction badge text (e.g. "😍 5" or "😍🔥 3")
 */
function buildReactionBadge(reactions: { emoji: string }[]): {
  badgeText: string | null;
  topEmojis: string[];
  total: number;
  breakdown: { emoji: string; count: number }[];
} {
  if (!reactions || reactions.length === 0) {
    return { badgeText: null, topEmojis: [], total: 0, breakdown: [] };
  }

  const counts: Record<string, number> = {};
  for (const r of reactions) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  }

  const breakdown = Object.entries(counts)
    .map(([emoji, count]) => ({ emoji, count }))
    .sort((a, b) => b.count - a.count);

  const topEmojis = breakdown.slice(0, 2).map((b) => b.emoji);
  const total = reactions.length;

  // e.g. "😍 5" or "😍🔥 3"
  const emojiPrefix = topEmojis.join('');
  const badgeText = `${emojiPrefix} ${total}`;

  return { badgeText, topEmojis, total, breakdown };
}

export class QuickMomentService {
  /**
   * 1. GET TRAY: Horizontal Stories Bar (Screen / Image 1)
   * Returns authenticated user's own status bubble ("Add new" or their active stories badge)
   * plus other users' active stories with unread state, preview, time, and reaction badges.
   */
  public async getTray(viewerUserId: string) {
    const now = new Date();

    // Fetch all active, non-expired quick moments
    const activeMoments = await QuickMoment.findAll({
      where: {
        status: 'active',
        expiresAt: { [Op.gt]: now },
      },
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
        {
          model: QuickMomentReaction,
          as: 'reactions',
          attributes: ['id', 'emoji', 'userId'],
        },
        {
          model: QuickMomentView,
          as: 'views',
          attributes: ['userId'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    // 1. Group own stories
    const myMoments = activeMoments.filter((m) => m.userId === viewerUserId);
    const viewer = await User.findByPk(viewerUserId, {
      attributes: ['id', 'fullName', 'nickName', 'profilePicture'],
    });

    let myStatus: any = {
      hasActive: false,
      totalActive: 0,
      avatar: viewer?.profilePicture || null,
      addLabel: 'Add new',
      latestTimeAgo: null,
      badge: null,
      stories: [],
    };

    if (myMoments.length > 0) {
      const allMyReactions = myMoments.flatMap((m) => m.reactions || []);
      const reactionSummary = buildReactionBadge(allMyReactions);
      const latestStory = myMoments[0];

      myStatus = {
        hasActive: true,
        totalActive: myMoments.length,
        avatar: viewer?.profilePicture ? formatThumbnailUrl(viewer.profilePicture) : null,
        addLabel: formatTimeAgo(latestStory.createdAt, true),
        latestTimeAgo: formatTimeAgo(latestStory.createdAt, true),
        badge: reactionSummary.badgeText
          ? {
              text: reactionSummary.badgeText,
              topEmojis: reactionSummary.topEmojis,
              count: reactionSummary.total,
            }
          : null,
        stories: myMoments.map((m) => {
          const cleanKey = m.mediaUrl ? extractS3Key(m.mediaUrl) : null;
          return {
            id: m.id,
            type: m.type,
            imageKey: cleanKey,
            imageUrl: cleanKey ? formatMediaUrl(cleanKey) : (m.mediaUrl ? formatMediaUrl(m.mediaUrl) : null),
            thumbnailUrl: formatThumbnailUrl(m.thumbnailUrl || m.mediaUrl),
            mediaUrl: m.mediaUrl ? formatMediaUrl(m.mediaUrl) : null,
            text: m.text,
            createdAt: m.createdAt,
          };
        }),
      };
    }

    // 2. Group other users' stories
    const otherMoments = activeMoments.filter((m) => m.userId !== viewerUserId);
    const userGroups = new Map<string, typeof otherMoments>();

    for (const moment of otherMoments) {
      const uId = moment.userId;
      if (!userGroups.has(uId)) {
        userGroups.set(uId, []);
      }
      userGroups.get(uId)!.push(moment);
    }

    const otherUsers: any[] = [];

    for (const [, moments] of userGroups) {
      if (moments.length === 0) continue;
      const author = moments[0].author;
      if (!author) continue;

      const latest = moments[0];
      const hasUnread = moments.some(
        (m) => !(m.views || []).some((v: any) => v.userId === viewerUserId)
      );

      const allReactions = moments.flatMap((m) => m.reactions || []);
      const reactionSummary = buildReactionBadge(allReactions);

      const latestCleanKey = latest.mediaUrl ? extractS3Key(latest.mediaUrl) : null;
      let preview: any = {
        type: latest.type,
        imageKey: latestCleanKey,
        imageUrl: latestCleanKey ? formatMediaUrl(latestCleanKey) : (latest.mediaUrl ? formatMediaUrl(latest.mediaUrl) : null),
        thumbnailUrl: formatThumbnailUrl(latest.thumbnailUrl || latest.mediaUrl),
        mediaUrl: latest.mediaUrl ? formatMediaUrl(latest.mediaUrl) : null,
        text: latest.text ? (latest.text.length > 30 ? `${latest.text.slice(0, 30)}...` : latest.text) : null,
        backgroundColor: latest.backgroundColor,
      };

      otherUsers.push({
        userId: author.id,
        name: author.fullName || author.nickName || 'User',
        avatar: author.profilePicture ? formatThumbnailUrl(author.profilePicture) : null,
        isVerified: !!author.isFaceVerified,
        hasUnread,
        totalStories: moments.length,
        latestTimeAgo: formatTimeAgo(latest.createdAt, true),
        preview,
        badge: reactionSummary.badgeText
          ? {
              text: reactionSummary.badgeText,
              topEmojis: reactionSummary.topEmojis,
              count: reactionSummary.total,
            }
          : null,
        firstMomentId: latest.id,
      });
    }

    // Sort: unread stories first, then most recently posted
    otherUsers.sort((a, b) => {
      if (a.hasUnread && !b.hasUnread) return -1;
      if (!a.hasUnread && b.hasUnread) return 1;
      return 0;
    });

    return {
      myStatus,
      otherUsers,
    };
  }

  /**
   * 2. VIEW OWN QUICK MOMENTS (Screen / Image 2)
   * Returns all active slides of authenticated user with progress bar count,
   * reactions summary badge (e.g. "😍🔥 3 · 💬 2 replies"), viewers list, and expansion sheet.
   */
  public async getMyQuickMoments(viewerUserId: string) {
    const now = new Date();

    const moments = await QuickMoment.findAll({
      where: {
        userId: viewerUserId,
        status: 'active',
        expiresAt: { [Op.gt]: now },
      },
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified'],
        },
        {
          model: QuickMomentReaction,
          as: 'reactions',
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
            },
          ],
        },
        {
          model: QuickMomentView,
          as: 'views',
          include: [
            {
              model: User,
              as: 'viewer',
              attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified'],
            },
          ],
        },
      ],
      order: [['createdAt', 'ASC']],
    });

    const viewer = await User.findByPk(viewerUserId, {
      attributes: ['id', 'fullName', 'nickName', 'profilePicture'],
    });

    const authorName = viewer?.fullName || viewer?.nickName || 'You';

    const slides = moments.map((m, index) => {
      const reactions = m.reactions || [];
      const reactionSummary = buildReactionBadge(reactions);

      // Badge format: "😍🔥 3 · 💬 2 replies" matching Image 2
      let badgeParts: string[] = [];
      if (reactionSummary.badgeText) {
        badgeParts.push(reactionSummary.badgeText);
      }
      if (m.repliesCount > 0) {
        badgeParts.push(`💬 ${m.repliesCount} ${m.repliesCount === 1 ? 'reply' : 'replies'}`);
      }
      const badgeText = badgeParts.length > 0 ? badgeParts.join(' · ') : null;

      return {
        id: m.id,
        slideIndex: index,
        totalSlides: moments.length,
        type: m.type,
        text: m.text,
        backgroundColor: m.backgroundColor || '#2d0b1e',
        textColor: m.textColor || '#ffffff',
        imageKey: m.mediaUrl ? extractS3Key(m.mediaUrl) : null,
        imageUrl: m.mediaUrl ? (m.mediaUrl.startsWith('http') ? m.mediaUrl : formatMediaUrl(m.mediaUrl)) : null,
        mediaUrl: m.mediaUrl ? formatMediaUrl(m.mediaUrl) : null,
        thumbnailUrl: formatThumbnailUrl(m.thumbnailUrl || m.mediaUrl),
        caption: m.caption,
        locationLabel: m.locationLabel,
        createdAt: m.createdAt,
        timeAgo: formatTimeAgo(m.createdAt, false),
        expiresAt: m.expiresAt,
        badgeText,
        reactionsCount: reactionSummary.total,
        topEmojis: reactionSummary.topEmojis,
        reactionsBreakdown: reactionSummary.breakdown,
        repliesCount: m.repliesCount,
        viewsCount: m.viewsCount || (m.views ? m.views.length : 0),
        isMine: true,
        reactors: reactions.map((r: any) => ({
          id: r.id,
          emoji: r.emoji,
          createdAt: r.createdAt,
          timeAgo: formatTimeAgo(r.createdAt, false),
          user: {
            id: r.user?.id,
            name: r.user?.fullName || r.user?.nickName || 'User',
            avatar: r.user?.profilePicture ? formatThumbnailUrl(r.user.profilePicture) : null,
            city: r.user?.city,
            isVerified: !!r.user?.isFaceVerified,
          },
        })),
        viewers: (m.views || []).map((v: any) => ({
          userId: v.viewer?.id,
          name: v.viewer?.fullName || v.viewer?.nickName || 'Viewer',
          avatar: v.viewer?.profilePicture ? formatThumbnailUrl(v.viewer.profilePicture) : null,
          isVerified: !!v.viewer?.isFaceVerified,
          viewedAt: v.createdAt,
        })),
      };
    });

    return {
      author: {
        id: viewerUserId,
        name: authorName,
        avatar: viewer?.profilePicture ? formatThumbnailUrl(viewer.profilePicture) : null,
      },
      totalStories: slides.length,
      stories: slides,
    };
  }

  /**
   * 3. VIEW OTHER USER'S QUICK MOMENTS (Screen / Image 3)
   * Returns active slides for Cindy / target user with author header ("Cindy", "48 min ago"),
   * media photo or text, caption ("Coffee date with myself ☕"), location ("📍 Indore, Madhya Pradesh"),
   * quick reaction emojis list (😍, 🔥, 😂, 😮, 👏, ❤️), viewer's own reaction state, and reply input.
   */
  public async getUserQuickMoments(viewerUserId: string, targetUserId: string) {
    const now = new Date();

    const targetUser = await User.findByPk(targetUserId, {
      attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
    });

    if (!targetUser) {
      throw new QuickMomentServiceError('User not found', 404, 'USER_NOT_FOUND');
    }

    const moments = await QuickMoment.findAll({
      where: {
        userId: targetUserId,
        status: 'active',
        expiresAt: { [Op.gt]: now },
      },
      include: [
        {
          model: QuickMomentReaction,
          as: 'reactions',
          attributes: ['id', 'emoji', 'userId'],
        },
        {
          model: QuickMomentView,
          as: 'views',
          attributes: ['userId'],
        },
      ],
      order: [['createdAt', 'ASC']],
    });

    const authorDisplayName =
      targetUser.fullName?.split(' ')[0] || targetUser.nickName || targetUser.fullName || 'User';

    const slides = moments.map((m, index) => {
      const viewerReactionRecord = (m.reactions || []).find(
        (r: any) => r.userId === viewerUserId
      );
      const isViewed = (m.views || []).some((v: any) => v.userId === viewerUserId);
      const reactionSummary = buildReactionBadge(m.reactions || []);

      return {
        id: m.id,
        slideIndex: index,
        totalSlides: moments.length,
        type: m.type,
        imageKey: m.mediaUrl ? extractS3Key(m.mediaUrl) : null,
        imageUrl: m.mediaUrl ? (m.mediaUrl.startsWith('http') ? m.mediaUrl : formatMediaUrl(m.mediaUrl)) : null,
        mediaUrl: m.mediaUrl ? formatMediaUrl(m.mediaUrl) : null,
        thumbnailUrl: formatThumbnailUrl(m.thumbnailUrl || m.mediaUrl),
        text: m.text,
        backgroundColor: m.backgroundColor,
        textColor: m.textColor,
        caption: m.caption,
        locationLabel: m.locationLabel,
        createdAt: m.createdAt,
        timeAgo: formatTimeAgo(m.createdAt, false),
        expiresAt: m.expiresAt,
        isViewed,
        myReaction: viewerReactionRecord ? viewerReactionRecord.emoji : null,
        availableEmojis: ALLOWED_EMOJIS,
        replyPlaceholder: `Reply to ${authorDisplayName}...`,
        reactionsCount: reactionSummary.total,
        badgeText: reactionSummary.badgeText,
      };
    });

    return {
      author: {
        id: targetUser.id,
        name: authorDisplayName,
        fullName: targetUser.fullName,
        avatar: targetUser.profilePicture ? formatThumbnailUrl(targetUser.profilePicture) : null,
        city: targetUser.city,
        isVerified: !!targetUser.isFaceVerified,
      },
      totalStories: slides.length,
      stories: slides,
    };
  }

  /**
   * 4. GET REACTIONS LIST FOR A QUICK MOMENT
   * "1 image me jo reaction wo kisne hme reaction diye wo he if more than willopen list please craete api for this with proper logic"
   * Returns list of reactors with user details, emoji, time ago, and breakdown by emoji.
   */
  public async getQuickMomentReactions(
    viewerUserId: string,
    momentId: string,
    options: { page?: number; limit?: number; emoji?: string } = {}
  ) {
    const moment = await QuickMoment.findByPk(momentId, {
      attributes: ['id', 'userId', 'caption', 'text', 'type', 'mediaUrl'],
    });

    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 20));
    const offset = (page - 1) * limit;

    const whereClause: any = { quickMomentId: momentId };
    if (options.emoji) {
      whereClause.emoji = options.emoji;
    }

    // 1. Total reactions breakdown across all emojis
    const allReactions = await QuickMomentReaction.findAll({
      where: { quickMomentId: momentId },
      attributes: ['emoji'],
    });

    const reactionSummary = buildReactionBadge(allReactions);

    // 2. Paginated reactors list with user details
    const { count, rows } = await QuickMomentReaction.findAndCountAll({
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

    const reactors = rows.map((r: any) => ({
      id: r.id,
      emoji: r.emoji,
      createdAt: r.createdAt,
      timeAgo: formatTimeAgo(r.createdAt, false),
      user: {
        id: r.user?.id,
        name: r.user?.fullName || r.user?.nickName || 'User',
        avatar: r.user?.profilePicture,
        city: r.user?.city,
        isVerified: !!r.user?.isFaceVerified,
      },
    }));

    return {
      momentId,
      totalReactions: reactionSummary.total,
      topEmojis: reactionSummary.topEmojis,
      badgeText: reactionSummary.badgeText,
      breakdown: reactionSummary.breakdown,
      filteredEmoji: options.emoji || null,
      reactors,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    };
  }

  /**
   * 5. REACT TO QUICK MOMENT
   * React with emoji (😍, 🔥, 😂, 😮, 👏, ❤️). If same emoji already reacted, toggles off.
   */
  public async reactToQuickMoment(
    viewerUserId: string,
    momentId: string,
    emoji: string
  ) {
    const moment = await QuickMoment.findByPk(momentId, {
      include: [{ model: User, as: 'author', attributes: ['id', 'fullName'] }],
    });

    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    if (new Date() > new Date(moment.expiresAt)) {
      throw new QuickMomentServiceError('This quick moment has expired', 410, 'MOMENT_EXPIRED');
    }

    const existingReaction = await QuickMomentReaction.findOne({
      where: { quickMomentId: momentId, userId: viewerUserId },
    });

    let action: 'added' | 'removed' | 'updated';
    let currentEmoji: string | null = emoji;

    if (existingReaction) {
      if (existingReaction.emoji === emoji) {
        // Toggle off
        await existingReaction.destroy();
        action = 'removed';
        currentEmoji = null;
      } else {
        // Update to new emoji
        existingReaction.emoji = emoji;
        await existingReaction.save();
        action = 'updated';
      }
    } else {
      // Add new reaction
      await QuickMomentReaction.create({
        quickMomentId: momentId,
        userId: viewerUserId,
        emoji,
      });
      action = 'added';

      // Send in-app notification to story author if not self
      if (moment.userId !== viewerUserId) {
        try {
          const reactor = await User.findByPk(viewerUserId, {
            attributes: ['id', 'fullName', 'nickName'],
          });
          const reactorName = reactor?.fullName || reactor?.nickName || 'Someone';

          await Notification.create({
            recipientId: moment.userId,
            senderId: viewerUserId,
            type: 'moment_reaction',
            title: 'New Quick Moment Reaction',
            body: `${reactorName} reacted ${emoji} to your quick moment`,
            data: {
              quickMomentId: momentId,
              emoji,
            },
          });
        } catch (notifErr: any) {
          console.warn('[Quick Moment Notif Warning]:', notifErr.message);
        }
      }
    }

    // Return updated reaction metrics
    const allReactions = await QuickMomentReaction.findAll({
      where: { quickMomentId: momentId },
      attributes: ['emoji'],
    });

    const reactionSummary = buildReactionBadge(allReactions);

    return {
      action,
      myReaction: currentEmoji,
      totalReactions: reactionSummary.total,
      topEmojis: reactionSummary.topEmojis,
      badgeText: reactionSummary.badgeText,
      breakdown: reactionSummary.breakdown,
    };
  }

  /**
   * 6. REPLY TO QUICK MOMENT
   * Sends a reply to Cindy / Alex referencing their quick moment.
   */
  public async replyToQuickMoment(
    viewerUserId: string,
    momentId: string,
    message: string
  ) {
    const moment = await QuickMoment.findByPk(momentId, {
      include: [{ model: User, as: 'author', attributes: ['id', 'fullName', 'nickName'] }],
    });

    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    if (new Date() > new Date(moment.expiresAt)) {
      throw new QuickMomentServiceError('This quick moment has expired', 410, 'MOMENT_EXPIRED');
    }

    // Increment repliesCount
    await moment.increment('repliesCount', { by: 1 });

    const sender = await User.findByPk(viewerUserId, {
      attributes: ['id', 'fullName', 'nickName'],
    });
    const senderName = sender?.fullName || sender?.nickName || 'Someone';

    // Notify author
    if (moment.userId !== viewerUserId) {
      try {
        await Notification.create({
          recipientId: moment.userId,
          senderId: viewerUserId,
          type: 'moment_reply',
          title: 'Reply to your Quick Moment',
          body: `${senderName}: "${message.slice(0, 80)}"`,
          data: {
            quickMomentId: momentId,
            replyText: message,
          },
        });
      } catch (err: any) {
        console.warn('[Quick Moment Reply Notif Warning]:', err.message);
      }
    }

    return {
      momentId,
      repliedToUserId: moment.userId,
      message,
      sentAt: new Date(),
    };
  }

  /**
   * 7. MARK VIEWED
   */
  public async markViewed(viewerUserId: string, momentId: string) {
    const moment = await QuickMoment.findByPk(momentId);
    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    const [viewRecord, created] = await QuickMomentView.findOrCreate({
      where: { quickMomentId: momentId, userId: viewerUserId },
      defaults: { quickMomentId: momentId, userId: viewerUserId },
    });

    if (created) {
      await moment.increment('viewsCount', { by: 1 });
    }

    return {
      momentId,
      isViewed: true,
      viewsCount: moment.viewsCount + (created ? 1 : 0),
    };
  }

  /**
   * 8. GET VIEWERS LIST (Author only)
   */
  public async getViewers(viewerUserId: string, momentId: string) {
    const moment = await QuickMoment.findByPk(momentId);
    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    if (moment.userId !== viewerUserId) {
      throw new QuickMomentServiceError('Only the author can see viewers', 403, 'FORBIDDEN');
    }

    const views = await QuickMomentView.findAll({
      where: { quickMomentId: momentId },
      include: [
        {
          model: User,
          as: 'viewer',
          attributes: ['id', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'city'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    const viewers = views.map((v: any) => ({
      userId: v.viewer?.id,
      name: v.viewer?.fullName || v.viewer?.nickName || 'Viewer',
      avatar: v.viewer?.profilePicture ? formatThumbnailUrl(v.viewer.profilePicture) : null,
      isVerified: !!v.viewer?.isFaceVerified,
      city: v.viewer?.city,
      viewedAt: v.createdAt,
      timeAgo: formatTimeAgo(v.createdAt, false),
    }));

    return {
      momentId,
      totalViews: viewers.length,
      viewers,
    };
  }

  /**
   * 9. CREATE QUICK MOMENT (Text or Image, 24-hour expiration)
   */
  public async createQuickMoment(
    userId: string,
    data: {
      type?: 'image' | 'text';
      text?: string;
      backgroundColor?: string;
      textColor?: string;
      caption?: string;
      locationLabel?: string;
      mediaUrl?: string;
      imageKey?: string;
      key?: string;
      imageUrl?: string;
    },
    file?: Express.Multer.File
  ) {
    const rawImageKey = data.imageKey || data.key || data.imageUrl || data.mediaUrl;
    let type = data.type || (file || rawImageKey ? 'image' : 'text');
    let cleanKey: string | null = null;

    if (file) {
      type = 'image';
      const s3Key = await s3Service.uploadMedia(
        file.buffer,
        userId,
        file.mimetype,
        'quick_moments'
      );
      cleanKey = extractS3Key(s3Key);
    } else if (rawImageKey) {
      type = 'image';
      cleanKey = extractS3Key(rawImageKey);

      // Verify user ownership
      const isAuthorized =
        cleanKey.startsWith(`${userId}/`) ||
        cleanKey.includes(`/${userId}/`) ||
        cleanKey.startsWith('http://') ||
        cleanKey.startsWith('https://');

      if (!isAuthorized) {
        throw new QuickMomentServiceError('Unauthorized image key', 403, 'UNAUTHORIZED_IMAGE_KEY');
      }

      // Verify object exists in storage and size limit
      if (!cleanKey.startsWith('http://') && !cleanKey.startsWith('https://')) {
        const objectCheck = await s3Service.checkObjectExists(cleanKey);
        if (!objectCheck.exists) {
          throw new QuickMomentServiceError(
            'Uploaded image does not exist in storage',
            400,
            'IMAGE_NOT_FOUND'
          );
        }
        if (objectCheck.contentLength && objectCheck.contentLength > 5 * 1024 * 1024) {
          throw new QuickMomentServiceError(
            'Image file size exceeds 5MB limit',
            400,
            'IMAGE_SIZE_EXCEEDED'
          );
        }
        s3Service.ensureThumbnail(cleanKey);
      }
    }

    if (type === 'text' && !data.text) {
      throw new QuickMomentServiceError(
        'Text content is required for text quick moments',
        400,
        'TEXT_REQUIRED'
      );
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const moment = await QuickMoment.create({
      userId,
      type,
      mediaUrl: cleanKey,
      thumbnailUrl: cleanKey ? formatThumbnailUrl(cleanKey) : null,
      text: data.text || null,
      backgroundColor: data.backgroundColor || (type === 'text' ? '#2d0b1e' : null),
      textColor: data.textColor || '#ffffff',
      caption: data.caption || null,
      locationLabel: data.locationLabel || null,
      viewsCount: 0,
      repliesCount: 0,
      status: 'active',
      publishedAt: new Date(),
      expiresAt,
    });

    const finalImageUrl = cleanKey ? formatMediaUrl(cleanKey) : null;
    const finalThumbnailUrl = cleanKey ? formatThumbnailUrl(cleanKey) : null;

    return {
      id: moment.id,
      userId: moment.userId,
      type: moment.type,
      imageKey: cleanKey || null,
      imageUrl: finalImageUrl,
      thumbnailUrl: finalThumbnailUrl,
      mediaUrl: finalImageUrl,
      text: moment.text,
      backgroundColor: moment.backgroundColor,
      textColor: moment.textColor,
      caption: moment.caption,
      locationLabel: moment.locationLabel,
      publishedAt: moment.publishedAt,
      expiresAt: moment.expiresAt,
      timeAgo: 'Just now',
    };
  }

  /**
   * 10. DELETE QUICK MOMENT
   */
  public async deleteQuickMoment(userId: string, momentId: string) {
    const moment = await QuickMoment.findByPk(momentId);
    if (!moment) {
      throw new QuickMomentServiceError('Quick moment not found', 404, 'MOMENT_NOT_FOUND');
    }

    if (moment.userId !== userId) {
      throw new QuickMomentServiceError('You can only delete your own quick moments', 403, 'FORBIDDEN');
    }

    moment.status = 'deleted';
    await moment.save();

    return { success: true, message: 'Quick moment deleted successfully' };
  }
}

export const quickMomentService = new QuickMomentService();
