import { Op, WhereOptions } from 'sequelize';
import {
  User,
  SwipeAction,
  Match,
  ConnectionRequest,
  UserBlock,
  UserPhoto,
  Notification,
} from '../models';
import { formatThumbnailUrl } from './s3.service';
import { calculateAge, calculateDistanceKm, resolveDisplayName } from './discovery.service';
import { InteractionType } from '../schemas/interaction.schema';

export interface InteractionUserCard {
  id: string;
  name: string;
  username: string;
  age: number | null;
  profilePhotoUrl: string | null;
  isVerified: boolean;
  isSubscribed: boolean;
  distanceKm: number | null;
  locationLabel: string;
  isBlurred?: boolean;
}

export interface InteractionItemDTO {
  interactionId: string;
  username: string;
  user: InteractionUserCard;
  interaction: {
    type: InteractionType;
    createdAt: string;
    action?: 'like' | 'super_like';
    isMatched?: boolean;
    matchedBy?: 'like' | 'super_like';
    reason?: string | null;
    message?: string | null;
    momentId?: string | null;
    status?: string;
    isRead?: boolean;
  };
}

export interface InteractionsListResponse {
  type: InteractionType;
  isLocked?: boolean;
  totalCount?: number;
  items: InteractionItemDTO[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface InteractionCountsResponse {
  likes: number;
  you_liked: number;
  matches: number;
  compliments: number;
}

export class InteractionServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'InteractionServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, InteractionServiceError.prototype);
  }
}

interface DecodedCursor {
  createdAt: string;
  id: string;
}

export class InteractionService {
  /**
   * Helper to resolve the primary approved profile photo URL
   */
  public resolvePrimaryPhoto(userProfilePicture?: string | null, photos?: any[] | null): string | null {
    let photo = userProfilePicture || null;
    if (!photo && photos && photos.length > 0) {
      const approvedPhotos = photos.filter((p) => p.status === 'approved');
      if (approvedPhotos.length > 0) {
        const primary = approvedPhotos.find((p) => p.isPrimary);
        photo = primary ? primary.imageUrl : approvedPhotos[0].imageUrl;
      }
    }
    return photo ? formatThumbnailUrl(photo) : null;
  }

  /**
   * Helper to retrieve all user IDs blocked by or blocking the current user
   */
  public async getBlockedUserIds(currentUserId: string): Promise<string[]> {
    const blocks = await UserBlock.findAll({
      where: {
        [Op.or]: [
          { userId: currentUserId },
          { blockedUserId: currentUserId },
        ],
      },
      attributes: ['userId', 'blockedUserId'],
    });

    const blockedIds = new Set<string>();
    for (const b of blocks) {
      if (b.userId === currentUserId) {
        blockedIds.add(b.blockedUserId);
      } else {
        blockedIds.add(b.userId);
      }
    }
    return Array.from(blockedIds);
  }

  /**
   * Safe cursor decoding
   */
  private decodeCursor(cursor?: string): DecodedCursor | null {
    if (!cursor) return null;
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (!decoded.createdAt || !decoded.id || typeof decoded.id !== 'string') {
        throw new Error();
      }
      return decoded;
    } catch {
      throw new InteractionServiceError('Invalid pagination cursor', 400, 'INVALID_CURSOR');
    }
  }

  /**
   * Encode keyset cursor
   */
  private encodeCursor(item: { createdAt: Date | string; id: string }): string {
    const payload = {
      createdAt: new Date(item.createdAt).toISOString(),
      id: item.id,
    };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  /**
   * Format a user record into standard UserCard DTO
   */
  private formatUserCard(targetUser: any, currentUser: User): InteractionUserCard {
    let distanceKm = calculateDistanceKm(
      currentUser.latitude,
      currentUser.longitude,
      targetUser.latitude,
      targetUser.longitude
    );

    if (
      distanceKm == null &&
      targetUser.city &&
      currentUser.city &&
      targetUser.city.toLowerCase() === currentUser.city.toLowerCase()
    ) {
      distanceKm = 7;
    }

    return {
      id: targetUser.id,
      name: resolveDisplayName(targetUser),
      username: targetUser.username || targetUser.nickName || '',
      age: calculateAge(targetUser.dateOfBirth),
      profilePhotoUrl: this.resolvePrimaryPhoto(targetUser.profilePicture, targetUser.photos),
      isVerified: Boolean(targetUser.isFaceVerified),
      isSubscribed: Boolean(targetUser.isSubscribed),
      distanceKm,
      locationLabel: targetUser.city || 'Mumbai',
    };
  }

  /**
   * Fetch interactions for any of the 4 tabs
   */
  public async getInteractions(
    currentUserId: string,
    options: {
      type: InteractionType;
      limit?: number;
      cursor?: string;
      sort?: string;
    }
  ): Promise<InteractionsListResponse> {
    const { type, limit = 20, cursor } = options;
    const validatedLimit = Math.min(50, Math.max(1, limit));
    const decodedCursor = this.decodeCursor(cursor);

    const currentUser = await User.findByPk(currentUserId);
    if (!currentUser || !currentUser.isActive) {
      throw new InteractionServiceError('Authenticated user not found or unavailable', 401, 'UNAUTHORIZED');
    }

    const blockedUserIds = await this.getBlockedUserIds(currentUserId);
    const excludedUserIds = new Set<string>([currentUserId, ...blockedUserIds]);

    switch (type) {
      case 'likes':
        return this.getLikesInteractions(currentUser, validatedLimit, decodedCursor, excludedUserIds);
      case 'you_liked':
        return this.getYouLikedInteractions(currentUser, validatedLimit, decodedCursor, excludedUserIds);
      case 'matches':
        return this.getMatchesInteractions(currentUser, validatedLimit, decodedCursor, excludedUserIds);
      case 'compliments':
        return this.getComplimentsInteractions(currentUser, validatedLimit, decodedCursor, excludedUserIds);
      default:
        throw new InteractionServiceError(`Unsupported interaction type: ${type}`, 400, 'INVALID_TYPE');
    }
  }

  /**
   * Tab 1: Likes (Incoming likes where targetUserId = currentUserId)
   * Excludes mutual matches and users already swiped on by current user
   */
  private async getLikesInteractions(
    currentUser: User,
    limit: number,
    cursor: DecodedCursor | null,
    excludedUserIds: Set<string>
  ): Promise<InteractionsListResponse> {
    // 1. Identify users current user has already swiped on or already matched with
    const [outgoingSwipes, matches] = await Promise.all([
      SwipeAction.findAll({
        where: { userId: currentUser.id },
        attributes: ['targetUserId'],
      }),
      Match.findAll({
        where: {
          [Op.or]: [{ user1Id: currentUser.id }, { user2Id: currentUser.id }],
          isActive: true,
        },
        attributes: ['user1Id', 'user2Id'],
      }),
    ]);

    const alreadyResolvedUserIds = new Set<string>(excludedUserIds);
    outgoingSwipes.forEach((s) => alreadyResolvedUserIds.add(s.targetUserId));
    matches.forEach((m) => {
      alreadyResolvedUserIds.add(m.user1Id === currentUser.id ? m.user2Id : m.user1Id);
    });

    const whereClause: any = {
      targetUserId: currentUser.id,
      action: { [Op.in]: ['like', 'super_like'] },
      userId: { [Op.notIn]: Array.from(alreadyResolvedUserIds) },
    };

    if (cursor) {
      whereClause[Op.and] = [
        {
          [Op.or]: [
            { createdAt: { [Op.lt]: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { [Op.lt]: cursor.id },
            },
          ],
        },
      ];
    }

    const rows = await SwipeAction.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          where: { isActive: true },
          required: true,
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

    const isLocked = !Boolean(currentUser.isSubscribed);
    const totalCount = await SwipeAction.count({
      where: {
        targetUserId: currentUser.id,
        action: { [Op.in]: ['like', 'super_like'] },
        userId: { [Op.notIn]: Array.from(alreadyResolvedUserIds) },
      },
    });

    const items: InteractionItemDTO[] = itemsToReturn.map((swipe) => {
      const userCard = this.formatUserCard((swipe as any).user, currentUser);
      const maskedCard: InteractionUserCard = isLocked
        ? {
            ...userCard,
            name: userCard.name ? `${userCard.name.charAt(0)}***` : 'Someone',
            username: userCard.username ? `${userCard.username.charAt(0)}***` : '',
            isBlurred: true,
          }
        : {
            ...userCard,
            isBlurred: false,
          };

      return {
        interactionId: swipe.id,
        username: maskedCard.username,
        user: maskedCard,
        interaction: {
          type: 'likes',
          createdAt: swipe.createdAt.toISOString(),
          action: swipe.action as 'like' | 'super_like',
        },
      };
    });

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? this.encodeCursor(itemsToReturn[itemsToReturn.length - 1])
        : null;

    return {
      type: 'likes',
      isLocked,
      totalCount,
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Tab 2: You Liked (Outgoing likes where userId = currentUserId)
   */
  private async getYouLikedInteractions(
    currentUser: User,
    limit: number,
    cursor: DecodedCursor | null,
    excludedUserIds: Set<string>
  ): Promise<InteractionsListResponse> {
    const whereClause: any = {
      userId: currentUser.id,
      action: { [Op.in]: ['like', 'super_like'] },
      targetUserId: { [Op.notIn]: Array.from(excludedUserIds) },
    };

    if (cursor) {
      whereClause[Op.and] = [
        {
          [Op.or]: [
            { createdAt: { [Op.lt]: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { [Op.lt]: cursor.id },
            },
          ],
        },
      ];
    }

    const rows = await SwipeAction.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'targetUser',
          where: { isActive: true },
          required: true,
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

    // Check match status for returned users in batch
    const targetIds = itemsToReturn.map((s) => s.targetUserId);
    const matchMap = new Set<string>();

    if (targetIds.length > 0) {
      const activeMatches = await Match.findAll({
        where: {
          [Op.or]: [
            { user1Id: currentUser.id, user2Id: { [Op.in]: targetIds } },
            { user2Id: currentUser.id, user1Id: { [Op.in]: targetIds } },
          ],
          isActive: true,
        },
        attributes: ['user1Id', 'user2Id'],
      });

      activeMatches.forEach((m) => {
        matchMap.add(m.user1Id === currentUser.id ? m.user2Id : m.user1Id);
      });
    }

    const items: InteractionItemDTO[] = itemsToReturn.map((swipe) => {
      const userCard = this.formatUserCard((swipe as any).targetUser, currentUser);
      return {
        interactionId: swipe.id,
        username: userCard.username,
        user: userCard,
        interaction: {
          type: 'you_liked',
          createdAt: swipe.createdAt.toISOString(),
          action: swipe.action as 'like' | 'super_like',
          isMatched: matchMap.has(swipe.targetUserId),
        },
      };
    });

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? this.encodeCursor(itemsToReturn[itemsToReturn.length - 1])
        : null;

    return {
      type: 'you_liked',
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Tab 3: Matches (Mutual active matches)
   */
  private async getMatchesInteractions(
    currentUser: User,
    limit: number,
    cursor: DecodedCursor | null,
    excludedUserIds: Set<string>
  ): Promise<InteractionsListResponse> {
    const whereClause: any = {
      [Op.or]: [{ user1Id: currentUser.id }, { user2Id: currentUser.id }],
      isActive: true,
    };

    if (cursor) {
      whereClause[Op.and] = [
        {
          [Op.or]: [
            { createdAt: { [Op.lt]: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { [Op.lt]: cursor.id },
            },
          ],
        },
      ];
    }

    const rows = await Match.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user1',
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        },
        {
          model: User,
          as: 'user2',
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1,
    });

    // Filter out blocked or inactive counterpart users
    const validMatches = rows.filter((m) => {
      const partner = m.user1Id === currentUser.id ? (m as any).user2 : (m as any).user1;
      return partner && partner.isActive && !excludedUserIds.has(partner.id);
    });

    const hasMore = validMatches.length > limit;
    const itemsToReturn = hasMore ? validMatches.slice(0, limit) : validMatches;

    const items: InteractionItemDTO[] = itemsToReturn.map((match) => {
      const partner = match.user1Id === currentUser.id ? (match as any).user2 : (match as any).user1;
      const userCard = this.formatUserCard(partner, currentUser);
      return {
        interactionId: match.id,
        username: userCard.username,
        user: userCard,
        interaction: {
          type: 'matches',
          createdAt: match.createdAt.toISOString(),
          matchedBy: match.matchedBy as 'like' | 'super_like',
        },
      };
    });

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? this.encodeCursor(itemsToReturn[itemsToReturn.length - 1])
        : null;

    return {
      type: 'matches',
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Tab 4: Compliments (Received ConnectionRequests)
   */
  private async getComplimentsInteractions(
    currentUser: User,
    limit: number,
    cursor: DecodedCursor | null,
    excludedUserIds: Set<string>
  ): Promise<InteractionsListResponse> {
    const whereClause: any = {
      targetUserId: currentUser.id,
      requesterId: { [Op.notIn]: Array.from(excludedUserIds) },
    };

    if (cursor) {
      whereClause[Op.and] = [
        {
          [Op.or]: [
            { createdAt: { [Op.lt]: new Date(cursor.createdAt) } },
            {
              createdAt: new Date(cursor.createdAt),
              id: { [Op.lt]: cursor.id },
            },
          ],
        },
      ];
    }

    const rows = await ConnectionRequest.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'requester',
          where: { isActive: true },
          required: true,
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

    // Check read status from notifications
    const requestIds = itemsToReturn.map((r) => r.id);
    const readNotifications = new Set<string>();

    if (requestIds.length > 0) {
      const notifs = await Notification.findAll({
        where: {
          recipientId: currentUser.id,
          entityId: { [Op.in]: requestIds },
          isRead: true,
        },
        attributes: ['entityId'],
      });
      notifs.forEach((n) => {
        if (n.entityId) readNotifications.add(n.entityId);
      });
    }

    const isLocked = !Boolean(currentUser.isSubscribed);
    const totalCount = await ConnectionRequest.count({
      where: {
        targetUserId: currentUser.id,
        requesterId: { [Op.notIn]: Array.from(excludedUserIds) },
      },
    });

    const items: InteractionItemDTO[] = itemsToReturn.map((req) => {
      const userCard = this.formatUserCard((req as any).requester, currentUser);
      const maskedCard: InteractionUserCard = isLocked
        ? {
            ...userCard,
            name: userCard.name ? `${userCard.name.charAt(0)}***` : 'Someone',
            username: userCard.username ? `${userCard.username.charAt(0)}***` : '',
            isBlurred: true,
          }
        : {
            ...userCard,
            isBlurred: false,
          };

      return {
        interactionId: req.id,
        username: maskedCard.username,
        user: maskedCard,
        interaction: {
          type: 'compliments',
          createdAt: req.createdAt.toISOString(),
          reason: isLocked && req.reason ? 'Hidden - Upgrade to view compliment' : req.reason || null,
          message: isLocked && req.message ? 'Hidden - Upgrade to view compliment' : req.message || null,
          momentId: req.momentId || null,
          status: req.status,
          isRead: readNotifications.has(req.id),
        },
      };
    });

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? this.encodeCursor(itemsToReturn[itemsToReturn.length - 1])
        : null;

    return {
      type: 'compliments',
      isLocked,
      totalCount,
      items,
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Badge counts for all 4 tabs via optimized aggregate queries
   */
  public async getInteractionCounts(currentUserId: string): Promise<InteractionCountsResponse> {
    const currentUser = await User.findByPk(currentUserId);
    if (!currentUser || !currentUser.isActive) {
      throw new InteractionServiceError('User not found or unavailable', 401, 'UNAUTHORIZED');
    }

    const blockedUserIds = await this.getBlockedUserIds(currentUserId);
    const excludedUserIds = new Set<string>([currentUserId, ...blockedUserIds]);

    // 1. Swipes & matches already resolved by current user (for Likes tab exclusion)
    const [outgoingSwipes, allMatches] = await Promise.all([
      SwipeAction.findAll({
        where: { userId: currentUserId },
        attributes: ['targetUserId'],
      }),
      Match.findAll({
        where: {
          [Op.or]: [{ user1Id: currentUserId }, { user2Id: currentUserId }],
          isActive: true,
        },
        attributes: ['user1Id', 'user2Id'],
      }),
    ]);

    const alreadyResolvedUserIds = new Set<string>(excludedUserIds);
    outgoingSwipes.forEach((s) => alreadyResolvedUserIds.add(s.targetUserId));
    allMatches.forEach((m) => {
      alreadyResolvedUserIds.add(m.user1Id === currentUserId ? m.user2Id : m.user1Id);
    });

    // 2. Run aggregate counts concurrently
    const [likesCount, youLikedCount, complimentsCount] = await Promise.all([
      SwipeAction.count({
        where: {
          targetUserId: currentUserId,
          action: { [Op.in]: ['like', 'super_like'] },
          userId: { [Op.notIn]: Array.from(alreadyResolvedUserIds) },
        },
        include: [
          {
            model: User,
            as: 'user',
            where: { isActive: true },
            required: true,
          },
        ],
      }),
      SwipeAction.count({
        where: {
          userId: currentUserId,
          action: { [Op.in]: ['like', 'super_like'] },
          targetUserId: { [Op.notIn]: Array.from(excludedUserIds) },
        },
        include: [
          {
            model: User,
            as: 'targetUser',
            where: { isActive: true },
            required: true,
          },
        ],
      }),
      ConnectionRequest.count({
        where: {
          targetUserId: currentUserId,
          requesterId: { [Op.notIn]: Array.from(excludedUserIds) },
        },
        include: [
          {
            model: User,
            as: 'requester',
            where: { isActive: true },
            required: true,
          },
        ],
      }),
    ]);

    // Filter active matches whose counterpart is active and not blocked
    const matchesCount = allMatches.filter((m) => {
      const partnerId = m.user1Id === currentUserId ? m.user2Id : m.user1Id;
      return !excludedUserIds.has(partnerId);
    }).length;

    return {
      likes: likesCount,
      you_liked: youLikedCount,
      matches: matchesCount,
      compliments: complimentsCount,
    };
  }

  /**
   * Mark an interaction read / seen idempotently
   */
  public async markInteractionRead(
    currentUserId: string,
    interactionId: string
  ): Promise<{ interactionId: string; isRead: boolean }> {
    // 1. Check if it's a ConnectionRequest / Compliment
    const connReq = await ConnectionRequest.findByPk(interactionId);
    if (connReq) {
      if (connReq.targetUserId !== currentUserId) {
        throw new InteractionServiceError(
          'You are not authorized to mark this interaction as read',
          403,
          'FORBIDDEN'
        );
      }
      // Update any associated notification to read
      await Notification.update(
        { isRead: true },
        { where: { entityId: interactionId, recipientId: currentUserId } }
      );
      return { interactionId, isRead: true };
    }

    // 2. Check if it's a SwipeAction (incoming like)
    const swipe = await SwipeAction.findByPk(interactionId);
    if (swipe) {
      if (swipe.targetUserId !== currentUserId && swipe.userId !== currentUserId) {
        throw new InteractionServiceError(
          'You are not authorized to mark this interaction as read',
          403,
          'FORBIDDEN'
        );
      }
      await Notification.update(
        { isRead: true },
        { where: { entityId: interactionId, recipientId: currentUserId } }
      );
      return { interactionId, isRead: true };
    }

    // 3. Check if it's a Match
    const match = await Match.findByPk(interactionId);
    if (match) {
      if (match.user1Id !== currentUserId && match.user2Id !== currentUserId) {
        throw new InteractionServiceError(
          'You are not authorized to mark this interaction as read',
          403,
          'FORBIDDEN'
        );
      }
      await Notification.update(
        { isRead: true },
        { where: { entityId: interactionId, recipientId: currentUserId } }
      );
      return { interactionId, isRead: true };
    }

    throw new InteractionServiceError('Interaction not found', 404, 'INTERACTION_NOT_FOUND');
  }
}

export const interactionService = new InteractionService();
