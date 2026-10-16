import crypto from 'crypto';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  QuickMoment,
  UserBlock,
  Match,
  DeepLink,
} from '../models';
import { s3Service } from './s3.service';
import { env } from '../config/env';
import { DeepLinkContentType } from '../models/deepLink.model';

export class DeepLinkServiceError extends Error {
  public statusCode: number;
  public errorCode: string;
  public data?: any;

  constructor(message: string, statusCode = 400, errorCode = 'DEEP_LINK_ERROR', data?: any) {
    super(message);
    this.name = 'DeepLinkServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.data = data;
    Object.setPrototypeOf(this, DeepLinkServiceError.prototype);
  }
}

let deepLinkTablesReady = false;
export async function ensureDeepLinkTables(): Promise<void> {
  if (deepLinkTablesReady) return;
  try {
    await DeepLink.sync();
    deepLinkTablesReady = true;
  } catch (err: any) {
    console.warn('[DeepLink Schema Warning]:', err.message);
  }
}

/**
 * Generates an unpredictable, cryptographically random, base62 opaque code.
 * Default 10 characters = 62^10 (~8.39 * 10^17 possibilities), impossible to guess or brute-force.
 */
export const generateSecureLinkCode = (length = 10): string => {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const randomBytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[randomBytes[i] % alphabet.length];
  }
  return code;
};

export class DeepLinkService {
  /**
   * 1. CREATE A SHAREABLE DEEP LINK (POST /api/v1/deep-links)
   * Validates target content existence, ownership/audience rules, moderation, and sets appropriate lifetime.
   */
  public async createDeepLink(input: {
    creatorId: string;
    contentType: DeepLinkContentType;
    contentId: string;
    metadata?: Record<string, any>;
  }) {
    await ensureDeepLinkTables();
    const { creatorId, contentType, contentId, metadata } = input;

    // 1. Validate creator account eligibility
    const creator = await User.findByPk(creatorId, {
      attributes: ['id', 'isActive', 'fullName', 'nickName'],
    });
    if (!creator || !creator.isActive) {
      throw new DeepLinkServiceError('User account not found or inactive', 404, 'USER_NOT_FOUND');
    }

    let linkExpiresAt: Date | null = null;

    // 2. Validate target content based on contentType
    switch (contentType) {
      case 'moment': {
        const moment = await Moment.findByPk(contentId, {
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'isActive'],
            },
          ],
        });

        if (!moment || moment.status !== 'active') {
          throw new DeepLinkServiceError('Moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
        }

        const author = moment.user;
        if (!author || !author.isActive) {
          throw new DeepLinkServiceError('Content creator account is unavailable', 404, 'CREATOR_UNAVAILABLE');
        }

        // Privacy & moderation checks if sharing another user's moment
        if (moment.userId !== creatorId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: creatorId, blockedUserId: moment.userId },
                { userId: moment.userId, blockedUserId: creatorId },
              ],
            },
          });

          if (isBlocked) {
            throw new DeepLinkServiceError('Content unavailable due to privacy restrictions', 403, 'CONTENT_BLOCKED');
          }

          // Check audience permissions
          if (moment.audience === 'matches_only') {
            const [u1, u2] = [creatorId, moment.userId].sort();
            const match = await Match.findOne({
              where: { user1Id: u1, user2Id: u2, isActive: true },
            });
            if (!match) {
              throw new DeepLinkServiceError('This moment can only be shared with mutual matches', 403, 'AUDIENCE_RESTRICTED');
            }
          } else if (moment.audience === 'close_friends') {
            throw new DeepLinkServiceError('This private moment cannot be shared publicly', 403, 'AUDIENCE_RESTRICTED');
          }
        }

        // Permanent Moments retain their explicit expiry (usually null)
        linkExpiresAt = moment.expiresAt || null;
        break;
      }

      case 'quick_moment': {
        const quickMoment = await QuickMoment.findByPk(contentId, {
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'isActive'],
            },
          ],
        });

        if (!quickMoment || quickMoment.status !== 'active') {
          throw new DeepLinkServiceError('Quick moment not found or unavailable', 404, 'MOMENT_NOT_FOUND');
        }

        // Quick Moments must respect their 24-hour lifetime. Do not create links for expired stories.
        const now = new Date();
        if (quickMoment.expiresAt <= now) {
          throw new DeepLinkServiceError('This quick moment has expired and cannot be shared', 410, 'MOMENT_EXPIRED');
        }

        const author = quickMoment.author;
        if (!author || !author.isActive) {
          throw new DeepLinkServiceError('Content creator account is unavailable', 404, 'CREATOR_UNAVAILABLE');
        }

        if (quickMoment.userId !== creatorId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: creatorId, blockedUserId: quickMoment.userId },
                { userId: quickMoment.userId, blockedUserId: creatorId },
              ],
            },
          });
          if (isBlocked) {
            throw new DeepLinkServiceError('Content unavailable due to privacy restrictions', 403, 'CONTENT_BLOCKED');
          }
        }

        // The deep link must strictly inherit the Quick Moment's 24-hour expiration
        linkExpiresAt = quickMoment.expiresAt;
        break;
      }

      case 'profile': {
        const targetUser = await User.findByPk(contentId, {
          attributes: ['id', 'isActive', 'isProfileComplete'],
        });

        if (!targetUser || !targetUser.isActive) {
          throw new DeepLinkServiceError('User profile not found or unavailable', 404, 'PROFILE_NOT_FOUND');
        }

        if (targetUser.id !== creatorId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: creatorId, blockedUserId: targetUser.id },
                { userId: targetUser.id, blockedUserId: creatorId },
              ],
            },
          });
          if (isBlocked) {
            throw new DeepLinkServiceError('User profile unavailable due to privacy restrictions', 403, 'CONTENT_BLOCKED');
          }
        }

        linkExpiresAt = null;
        break;
      }

      default:
        throw new DeepLinkServiceError(`Unsupported content type: ${contentType}`, 400, 'INVALID_CONTENT_TYPE');
    }

    // 3. Avoid creating duplicate links unnecessarily (check for existing active reusable link)
    const existingLink = await DeepLink.findOne({
      where: {
        creatorId,
        contentType,
        contentId,
        status: 'active',
        [Op.or]: [
          { expiresAt: null },
          { expiresAt: { [Op.gt]: new Date() } },
        ],
      },
    });

    if (existingLink) {
      const appBaseUrl = env.DEEP_LINK_BASE_URL.replace(/\/+$/, '');
      return {
        code: existingLink.code,
        url: `${appBaseUrl}/l/${existingLink.code}`,
        contentType: existingLink.contentType,
        expiresAt: existingLink.expiresAt,
      };
    }

    // 4. Generate unique unguessable code
    let code = '';
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      code = generateSecureLinkCode(10);
      const collision = await DeepLink.findOne({ where: { code } });
      if (!collision) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new DeepLinkServiceError('Failed to generate unique link code. Please try again.', 500, 'CODE_GENERATION_FAILED');
    }

    // 5. Persist the deep link
    const newLink = await DeepLink.create({
      code,
      contentType,
      contentId,
      creatorId,
      status: 'active',
      expiresAt: linkExpiresAt,
      clicksCount: 0,
      metadata: metadata || null,
    });

    const appBaseUrl = env.DEEP_LINK_BASE_URL.replace(/\/+$/, '');
    return {
      code: newLink.code,
      url: `${appBaseUrl}/l/${newLink.code}`,
      contentType: newLink.contentType,
      expiresAt: newLink.expiresAt,
    };
  }

  /**
   * 2. RESOLVE A DEEP LINK (GET /api/v1/deep-links/:code)
   * Evaluates link validity, target content availability, audience rules, and privacy restrictions.
   */
  public async resolveDeepLink(code: string, viewerUserId?: string) {
    await ensureDeepLinkTables();

    const link = await DeepLink.findOne({
      where: { code },
    });

    if (!link) {
      throw new DeepLinkServiceError('Deep link not found or invalid', 404, 'LINK_NOT_FOUND');
    }

    // Check link status
    if (link.status === 'revoked') {
      return {
        contentType: link.contentType,
        contentId: link.contentId,
        status: 'revoked',
        requiresAuthentication: false,
        isRevoked: true,
        isExpired: false,
        title: 'Link Revoked',
        thumbnailUrl: null,
      };
    }

    // Check link expiration
    const now = new Date();
    if (link.expiresAt && new Date(link.expiresAt) <= now) {
      return {
        contentType: link.contentType,
        contentId: link.contentId,
        status: 'expired',
        requiresAuthentication: false,
        isRevoked: false,
        isExpired: true,
        title: 'Content Expired',
        thumbnailUrl: null,
      };
    }

    // Asynchronously record link click / access count (atomic increment)
    DeepLink.increment('clicksCount', { by: 1, where: { id: link.id } }).catch(() => {});
    DeepLink.update({ lastAccessedAt: now }, { where: { id: link.id } }).catch(() => {});

    // Re-check target content live availability and authorization
    switch (link.contentType) {
      case 'moment': {
        const moment = await Moment.findByPk(link.contentId, {
          include: [
            {
              model: MomentMedia,
              as: 'media',
            },
            {
              model: User,
              as: 'user',
              attributes: ['id', 'firstName', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'isSubscribed', 'city', 'isActive'],
            },
          ],
          order: [[{ model: MomentMedia, as: 'media' }, 'displayOrder', 'ASC']],
        });

        if (!moment || moment.status !== 'active') {
          return {
            contentType: 'moment',
            contentId: link.contentId,
            status: 'deleted',
            requiresAuthentication: false,
            title: 'Moment Unavailable',
            thumbnailUrl: null,
          };
        }

        const author = moment.user;
        if (!author || !author.isActive) {
          return {
            contentType: 'moment',
            contentId: link.contentId,
            status: 'unavailable',
            requiresAuthentication: false,
            title: 'User Unavailable',
            thumbnailUrl: null,
          };
        }

        // Privacy & block checks if viewer is logged in
        if (viewerUserId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: viewerUserId, blockedUserId: author.id },
                { userId: author.id, blockedUserId: viewerUserId },
              ],
            },
          });

          if (isBlocked) {
            return {
              contentType: 'moment',
              contentId: link.contentId,
              status: 'unavailable',
              requiresAuthentication: false,
              title: 'Content Unavailable',
              thumbnailUrl: null,
            };
          }

          if (moment.audience === 'matches_only' && viewerUserId !== author.id) {
            const [u1, u2] = [viewerUserId, author.id].sort();
            const match = await Match.findOne({
              where: { user1Id: u1, user2Id: u2, isActive: true },
            });
            if (!match) {
              return {
                contentType: 'moment',
                contentId: link.contentId,
                status: 'restricted',
                requiresAuthentication: true,
                title: 'Mutual Match Required',
                thumbnailUrl: null,
              };
            }
          }
        } else {
          // Unauthenticated recipient opening a private/matches-only moment
          if (moment.audience !== 'everyone') {
            return {
              contentType: 'moment',
              contentId: link.contentId,
              status: 'restricted',
              requiresAuthentication: true,
              title: 'Login Required to View Moment',
              thumbnailUrl: null,
            };
          }
        }

        // Extract approved safe thumbnail
        const firstMedia = (moment.media || [])[0];
        const safeThumbnail = firstMedia ? s3Service.getThumbnailUrl(firstMedia.mediaUrl) : null;
        const authorDisplayName = author.firstName || author.fullName || author.nickName || 'User';
        const safeTitle = moment.caption
          ? (moment.caption.length > 80 ? `${moment.caption.slice(0, 80)}...` : moment.caption)
          : `${authorDisplayName}'s Moment`;

        return {
          contentType: 'moment',
          contentId: moment.id,
          status: 'available',
          requiresAuthentication: moment.audience !== 'everyone',
          title: safeTitle,
          caption: moment.caption || null,
          thumbnailUrl: safeThumbnail,
          author: {
            id: author.id,
            name: authorDisplayName,
            avatar: author.profilePicture ? s3Service.getThumbnailUrl(author.profilePicture) : null,
            isVerified: !!author.isFaceVerified,
            isSubscribed: !!author.isSubscribed,
          },
        };
      }

      case 'quick_moment': {
        const quickMoment = await QuickMoment.findByPk(link.contentId, {
          include: [
            {
              model: User,
              as: 'author',
              attributes: ['id', 'firstName', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'isSubscribed', 'city', 'isActive'],
            },
          ],
        });

        if (!quickMoment || quickMoment.status !== 'active') {
          return {
            contentType: 'quick_moment',
            contentId: link.contentId,
            status: 'deleted',
            requiresAuthentication: false,
            title: 'Quick Moment Unavailable',
            thumbnailUrl: null,
          };
        }

        if (quickMoment.expiresAt <= now) {
          return {
            contentType: 'quick_moment',
            contentId: link.contentId,
            status: 'expired',
            requiresAuthentication: false,
            title: 'This Story Has Expired',
            thumbnailUrl: null,
          };
        }

        const author = quickMoment.author;
        if (!author || !author.isActive) {
          return {
            contentType: 'quick_moment',
            contentId: link.contentId,
            status: 'unavailable',
            requiresAuthentication: false,
            title: 'User Unavailable',
            thumbnailUrl: null,
          };
        }

        if (viewerUserId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: viewerUserId, blockedUserId: author.id },
                { userId: author.id, blockedUserId: viewerUserId },
              ],
            },
          });
          if (isBlocked) {
            return {
              contentType: 'quick_moment',
              contentId: link.contentId,
              status: 'unavailable',
              requiresAuthentication: false,
              title: 'Content Unavailable',
              thumbnailUrl: null,
            };
          }
        }

        const authorDisplayName = author.firstName || author.fullName || author.nickName || 'User';
        const rawMedia = quickMoment.thumbnailUrl || quickMoment.mediaUrl;
        const safeThumbnail = rawMedia ? s3Service.getThumbnailUrl(rawMedia) : null;
        const safeTitle = quickMoment.caption || quickMoment.text || `${authorDisplayName}'s Quick Moment`;

        return {
          contentType: 'quick_moment',
          contentId: quickMoment.id,
          status: 'available',
          requiresAuthentication: false,
          title: safeTitle,
          thumbnailUrl: safeThumbnail,
          expiresAt: quickMoment.expiresAt,
          author: {
            id: author.id,
            name: authorDisplayName,
            avatar: author.profilePicture ? s3Service.getThumbnailUrl(author.profilePicture) : null,
            isVerified: !!author.isFaceVerified,
            isSubscribed: !!author.isSubscribed,
          },
        };
      }

      case 'profile': {
        const user = await User.findByPk(link.contentId, {
          attributes: ['id', 'firstName', 'fullName', 'nickName', 'profilePicture', 'isFaceVerified', 'isSubscribed', 'city', 'isActive'],
        });

        if (!user || !user.isActive) {
          return {
            contentType: 'profile',
            contentId: link.contentId,
            status: 'unavailable',
            requiresAuthentication: false,
            title: 'Profile Unavailable',
            thumbnailUrl: null,
          };
        }

        if (viewerUserId) {
          const isBlocked = await UserBlock.findOne({
            where: {
              [Op.or]: [
                { userId: viewerUserId, blockedUserId: user.id },
                { userId: user.id, blockedUserId: viewerUserId },
              ],
            },
          });
          if (isBlocked) {
            return {
              contentType: 'profile',
              contentId: link.contentId,
              status: 'unavailable',
              requiresAuthentication: false,
              title: 'Profile Unavailable',
              thumbnailUrl: null,
            };
          }
        }

        const displayName = user.firstName || user.fullName || user.nickName || 'User';
        return {
          contentType: 'profile',
          contentId: user.id,
          status: 'available',
          requiresAuthentication: false,
          title: `${displayName} on FlirtTime`,
          thumbnailUrl: user.profilePicture ? s3Service.getThumbnailUrl(user.profilePicture) : null,
          author: {
            id: user.id,
            name: displayName,
            avatar: user.profilePicture ? s3Service.getThumbnailUrl(user.profilePicture) : null,
            city: user.city || null,
            isVerified: !!user.isFaceVerified,
            isSubscribed: !!user.isSubscribed,
          },
        };
      }

      default:
        throw new DeepLinkServiceError('Unknown content type', 400, 'UNKNOWN_CONTENT_TYPE');
    }
  }

  /**
   * 3. SHARE PREVIEW METADATA (GET /api/v1/deep-links/:code/preview)
   * Returns safe Open Graph and link preview data suitable for social crawlers and share sheets.
   */
  public async getPreviewMetadata(code: string) {
    const resolved = await this.resolveDeepLink(code);
    const appBaseUrl = env.DEEP_LINK_BASE_URL.replace(/\/+$/, '');
    const canonicalUrl = `${appBaseUrl}/l/${code}`;

    if (resolved.status === 'available') {
      const authorName = resolved.author?.name || 'Someone';
      return {
        title: resolved.contentType === 'profile'
          ? resolved.title
          : `${resolved.title} · ${authorName} on FlirtTime`,
        description: resolved.caption || 'Join FlirtTime to connect, match, and share moments.',
        thumbnailUrl: resolved.thumbnailUrl || `${appBaseUrl}/assets/flirttime-preview-icon.png`,
        canonicalUrl,
        siteName: 'FlirtTime',
        contentType: resolved.contentType,
        contentId: resolved.contentId,
        status: resolved.status,
      };
    }

    if (resolved.status === 'restricted') {
      return {
        title: 'Shared Content on FlirtTime',
        description: 'Open FlirtTime to view this shared moment.',
        thumbnailUrl: `${appBaseUrl}/assets/flirttime-preview-icon.png`,
        canonicalUrl,
        siteName: 'FlirtTime',
        contentType: resolved.contentType,
        contentId: resolved.contentId,
        status: 'restricted',
      };
    }

    // Expired, revoked, or deleted
    return {
      title: resolved.status === 'expired' ? 'FlirtTime - Story Expired' : 'FlirtTime - Content Unavailable',
      description: 'This content is no longer available on FlirtTime.',
      thumbnailUrl: `${appBaseUrl}/assets/flirttime-preview-icon.png`,
      canonicalUrl,
      siteName: 'FlirtTime',
      contentType: resolved.contentType,
      contentId: resolved.contentId,
      status: resolved.status,
    };
  }

  /**
   * 4. TRACK DEEP LINK EVENT (POST /api/v1/deep-links/:code/track)
   * Permitted events: link_opened, app_opened, content_viewed, share_clicked, install_referred
   */
  public async trackEvent(code: string, event: string, platform?: string, metadata?: any) {
    await ensureDeepLinkTables();

    const link = await DeepLink.findOne({ where: { code } });
    if (!link) {
      throw new DeepLinkServiceError('Deep link not found', 404, 'LINK_NOT_FOUND');
    }

    // Atomic increment click if it's an open event
    if (event === 'link_opened' || event === 'app_opened') {
      await DeepLink.increment('clicksCount', { by: 1, where: { id: link.id } });
      await DeepLink.update({ lastAccessedAt: new Date() }, { where: { id: link.id } });
    }

    return {
      recorded: true,
      code,
      event,
      timestamp: new Date().toISOString(),
    };
  }
}

export const deepLinkService = new DeepLinkService();
