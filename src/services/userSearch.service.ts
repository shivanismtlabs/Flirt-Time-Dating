import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  User,
  Interest,
  UserInterest,
  SwipeAction,
  UserBlock,
  UserReport,
  UserPhoto,
} from '../models';
import { formatThumbnailUrl } from './s3.service';
import {
  calculateAge,
  calculateDistanceKm,
  calculateVibeScore,
  resolveDisplayName,
  calculateInterestMatchPercentage,
} from './discovery.service';
import { momentService } from './moment.service';
import { quickMomentService } from './quickMoment.service';
import { parseLocation, LocationDTO } from './user.service';

export const ONLINE_FRESHNESS_MINUTES = 15;

export interface UserSearchServiceInput {
  query?: string;
  search?: string;
  q?: string;
  name?: string;
  city?: string;
  page?: number;
  limit?: number;
  gender?: string;
  minAge?: number;
  maxAge?: number;
  onlineOnly?: boolean;
  verifiedOnly?: boolean;
  includeSwiped?: boolean;
}

export interface UserSearchCardDTO {
  id: string;
  userId: string;
  name: string;
  username: string;
  age: number | null;
  gender: string | null;
  profilePhoto: string | null;
  profilePhotoUrl: string | null;
  isVerified: boolean;
  isOnline: boolean;
  city: string;
  state?: string | null;
  country?: string | null;
  county?: string | null;
  location?: LocationDTO;
  fullLocation?: string | null;
  distanceKm: number | null;
  distanceText: string | null;
  about: string | null;
  lookingFor: string | null;
  interests: Array<{
    id: string;
    name: string;
    icon: string | null;
  }>;
  sharedInterests: string[];
  vibeScore: number | null;
  momentCount: number;
  compatibility: {
    interestMatchPercentage: number;
  };
  hasViewedQuickMoment: boolean;
}

export interface UserSearchPaginationDTO {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface UserSearchResultDTO {
  users: UserSearchCardDTO[];
  pagination: UserSearchPaginationDTO;
  total: number;
}

export class UserSearchServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'UserSearchServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, UserSearchServiceError.prototype);
  }
}

export const formatDistanceText = (distanceKm: number | null): string | null => {
  if (distanceKm == null) return null;
  if (distanceKm < 1) return 'Less than 1 km away';
  return `${distanceKm} km away`;
};

export class UserSearchService {
  /**
   * Search users by name or city with proper pagination and filters
   */
  public async searchUsers(
    currentUserId: string,
    input: UserSearchServiceInput
  ): Promise<UserSearchResultDTO> {
    // 1. Fetch current authenticated user
    const currentUser = await User.findByPk(currentUserId, {
      include: [
        {
          model: Interest,
          as: 'interests',
          through: { attributes: [] },
          where: { isActive: true },
          required: false,
        },
      ],
    });

    if (!currentUser) {
      throw new UserSearchServiceError('User not found', 404, 'USER_NOT_FOUND');
    }

    const currentUserInterests = (currentUser.interests || []) as Interest[];
    const currentUserInterestNames = new Set(
      currentUserInterests.map((i) => i.name.toLowerCase())
    );

    // 2. Normalize search keywords
    const rawSearch = (input.query || input.search || input.q || '').trim();
    const nameFilter = (input.name || '').trim();
    const cityFilter = (input.city || '').trim();

    // 3. Setup pagination
    const page = Math.max(1, input.page || 1);
    const limit = Math.min(50, Math.max(1, input.limit || 10));
    const offset = (page - 1) * limit;

    // 4. Determine whether to exclude previously swiped profiles
    // Default: exclude swiped when browsing with no query, but allow searching all non-blocked users when explicitly searching
    const hasSearchKeyword = Boolean(rawSearch || nameFilter || cityFilter);
    const shouldExcludeSwiped =
      input.includeSwiped !== undefined ? !input.includeSwiped : !hasSearchKeyword;

    // 5. Build exclusion list (self, blocked, reported, optionally swiped)
    const [blocks, reports, swipes] = await Promise.all([
      UserBlock.findAll({
        where: {
          [Op.or]: [{ userId: currentUserId }, { blockedUserId: currentUserId }],
        },
        attributes: ['userId', 'blockedUserId'],
      }),
      UserReport.findAll({
        where: {
          reporterId: currentUserId,
          status: { [Op.ne]: 'dismissed' },
        },
        attributes: ['targetUserId'],
      }),
      shouldExcludeSwiped
        ? SwipeAction.findAll({
            where: { userId: currentUserId },
            attributes: ['targetUserId'],
          })
        : Promise.resolve([]),
    ]);

    const blockedUserIds = blocks.map((b) =>
      b.userId === currentUserId ? b.blockedUserId : b.userId
    );
    const reportedUserIds = reports
      .map((r) => r.targetUserId)
      .filter((id): id is string => Boolean(id));
    const swipedUserIds = swipes.map((s) => s.targetUserId);

    const excludedIds = Array.from(
      new Set([currentUserId, ...blockedUserIds, ...reportedUserIds, ...swipedUserIds])
    );

    // 6. Build query WHERE conditions
    const dialect = sequelize.getDialect();
    const likeOp = dialect === 'postgres' ? Op.iLike : Op.like;

    const where: any = {
      id: { [Op.notIn]: excludedIds },
      isActive: true,
    };

    const andConditions: any[] = [];

    // General search keyword (matches name or city)
    if (rawSearch) {
      andConditions.push({
        [Op.or]: [
          { firstName: { [likeOp]: `%${rawSearch}%` } },
          { lastName: { [likeOp]: `%${rawSearch}%` } },
          { fullName: { [likeOp]: `%${rawSearch}%` } },
          { nickName: { [likeOp]: `%${rawSearch}%` } },
          { username: { [likeOp]: `%${rawSearch}%` } },
          { city: { [likeOp]: `%${rawSearch}%` } },
        ],
      });
    }

    // Specific name filter
    if (nameFilter) {
      andConditions.push({
        [Op.or]: [
          { firstName: { [likeOp]: `%${nameFilter}%` } },
          { lastName: { [likeOp]: `%${nameFilter}%` } },
          { fullName: { [likeOp]: `%${nameFilter}%` } },
          { nickName: { [likeOp]: `%${nameFilter}%` } },
          { username: { [likeOp]: `%${nameFilter}%` } },
        ],
      });
    }

    // Specific city filter
    if (cityFilter) {
      andConditions.push({
        city: { [likeOp]: `%${cityFilter}%` },
      });
    }

    // Gender filter
    if (input.gender) {
      const g = input.gender.toLowerCase().trim();
      if (g !== 'everyone' && g !== 'all') {
        if (g === 'women' || g === 'woman' || g === 'female') {
          where.gender = { [Op.in]: ['female', 'women', 'woman'] };
        } else if (g === 'men' || g === 'man' || g === 'male') {
          where.gender = { [Op.in]: ['male', 'men', 'man'] };
        } else if (g === 'non_binary' || g === 'non-binary') {
          where.gender = { [Op.in]: ['non_binary', 'non-binary'] };
        } else {
          where.gender = input.gender;
        }
      }
    }

    // Age range filter
    if (input.minAge !== undefined || input.maxAge !== undefined) {
      const minAge = input.minAge ?? 18;
      const maxAge = input.maxAge ?? 100;
      const now = new Date();
      const maxDob = new Date(now.getFullYear() - minAge, now.getMonth(), now.getDate());
      const minDob = new Date(now.getFullYear() - maxAge - 1, now.getMonth(), now.getDate() + 1);

      where.dateOfBirth = {
        [Op.between]: [minDob.toISOString().slice(0, 10), maxDob.toISOString().slice(0, 10)],
      };
    }

    // Verified only filter
    if (input.verifiedOnly) {
      where.isFaceVerified = true;
    }

    // Online only filter
    const onlineCutoff = new Date(Date.now() - ONLINE_FRESHNESS_MINUTES * 60 * 1000);
    if (input.onlineOnly) {
      where.lastActiveAt = { [Op.gte]: onlineCutoff };
    }

    if (andConditions.length > 0) {
      where[Op.and] = andConditions;
    }

    // 7. Execute paginated count and query
    const { count: total, rows: targetUsers } = await User.findAndCountAll({
      where,
      limit,
      offset,
      order: [
        ['isFaceVerified', 'DESC'],
        ['lastActiveAt', 'DESC'],
        ['createdAt', 'DESC'],
        ['id', 'ASC'],
      ],
    });

    const targetUserIds = targetUsers.map((u) => u.id);

    // 8. Batch fetch related details (interests, photos, moment counts, quick moment viewed status)
    const allUserInterestsMap = new Map<string, Array<{ id: string; name: string; icon: string | null }>>();
    const allUserPhotosMap = new Map<string, UserPhoto[]>();
    let momentCountsMap = new Map<string, number>();
    let quickMomentViewedMap = new Map<string, boolean>();

    if (targetUserIds.length > 0) {
      const [fullUsersWithInterests, momentCounts, quickMomentViewed] = await Promise.all([
        User.findAll({
          where: { id: { [Op.in]: targetUserIds } },
          include: [
            {
              model: Interest,
              as: 'interests',
              through: { attributes: [] },
              where: { isActive: true },
              required: false,
            },
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
        }),
        momentService.getEligibleMomentCountsByUserIds(currentUserId, targetUserIds),
        quickMomentService.getViewedStatusByUserIds(currentUserId, targetUserIds),
      ]);

      for (const u of fullUsersWithInterests) {
        const mappedInterests = ((u.interests || []) as Interest[]).map((i) => ({
          id: i.id,
          name: i.name,
          icon: i.icon || null,
        }));
        allUserInterestsMap.set(u.id, mappedInterests);
        allUserPhotosMap.set(u.id, (u.photos || []) as UserPhoto[]);
      }

      momentCountsMap = momentCounts;
      quickMomentViewedMap = quickMomentViewed;
    }

    // 9. Map target users to clean, comprehensive card DTOs
    const users: UserSearchCardDTO[] = targetUsers.map((user) => {
      const userInterests = allUserInterestsMap.get(user.id) || [];
      const userPhotos = allUserPhotosMap.get(user.id) || [];

      const sharedInterests = userInterests
        .filter((i) => currentUserInterestNames.has(i.name.toLowerCase()))
        .map((i) => i.name);

      // Distance calculation
      let distanceKm = calculateDistanceKm(
        currentUser.latitude,
        currentUser.longitude,
        user.latitude,
        user.longitude
      );

      if (
        distanceKm == null &&
        user.city &&
        currentUser.city &&
        user.city.toLowerCase() === currentUser.city.toLowerCase()
      ) {
        distanceKm = 7; // realistic default distance in same metropolitan city
      }

      // Online status check
      const isOnline = user.lastActiveAt != null && user.lastActiveAt >= onlineCutoff;

      // Primary profile photo resolution
      const primaryPhotoRecord = userPhotos.find((p) => p.isPrimary);
      const primaryPhotoKey =
        primaryPhotoRecord?.imageUrl || user.profilePicture || userPhotos[0]?.imageUrl || null;
      const photoVersion = primaryPhotoRecord?.updatedAt || user.updatedAt;
      const resolvedPhotoUrl = primaryPhotoKey ? formatThumbnailUrl(primaryPhotoKey, photoVersion) : null;

      const vibeScore = calculateVibeScore(
        sharedInterests.length,
        user.isFaceVerified,
        user.isProfileComplete
      );

      const interestMatchPercentage = calculateInterestMatchPercentage(
        currentUserInterests.map((i) => i.id),
        userInterests.map((i) => i.id)
      );

      const momentCount = momentCountsMap.get(user.id) || 0;
      const hasViewedQuickMoment = quickMomentViewedMap.get(user.id) || false;
      const userLoc = parseLocation(user.city, user.latitude, user.longitude);

      return {
        id: user.id,
        userId: user.id,
        name: resolveDisplayName(user),
        username: user.username,
        age: calculateAge(user.dateOfBirth),
        gender: user.gender || null,
        profilePhoto: resolvedPhotoUrl,
        profilePhotoUrl: resolvedPhotoUrl,
        isVerified: !!user.isFaceVerified,
        isOnline,
        city: user.city || 'Mumbai',
        state: userLoc.state || null,
        country: userLoc.country || null,
        county: userLoc.county || null,
        location: userLoc,
        fullLocation: userLoc.fullLocation || user.city || 'Mumbai',
        distanceKm,
        distanceText: formatDistanceText(distanceKm),
        about: user.about || null,
        lookingFor: user.lookingFor || null,
        interests: userInterests,
        sharedInterests,
        vibeScore,
        momentCount,
        compatibility: {
          interestMatchPercentage,
        },
        hasViewedQuickMoment,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const hasMore = offset + users.length < total;

    return {
      users,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
      total,
    };
  }
}

export const userSearchService = new UserSearchService();
