import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { User, Interest, UserInterest, SwipeAction, UserBlock, UserPhoto, UserReport } from '../models';
import { formatThumbnailUrl } from './s3.service';
import { momentService } from './moment.service';
import { quickMomentService } from './quickMoment.service';
import { calculateInterestMatchPercentage } from '../utils/compatibility';

export { calculateInterestMatchPercentage };

export interface DiscoveryQueryInput {
  currentUserId: string;
  interestId?: string;
  page?: number;
  limit?: number;
}

export interface DiscoveryUserProfile {
  id: string;
  userId: string;
  name: string;
  username: string;
  age: number | null;
  profilePhoto: string | null;
  isVerified: boolean;
  city: string;
  distanceKm: number | null;
  vibeScore: number | null;
  sharedInterests: string[];
  interestTags: string[];
  momentCount: number;
  compatibility: {
    interestMatchPercentage: number;
  };
  hasViewedQuickMoment: boolean;
}

export interface DiscoveryResponseData {
  filter?: {
    interestId: string;
    name: string;
    icon: string | null;
  } | null;
  users: DiscoveryUserProfile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

export interface DiscoveryInterestItem {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  peopleCount: number;
  isSelected: boolean;
}

export interface GetDiscoveryInterestsInput {
  currentUserId: string;
  selectedInterestId?: string;
  search?: string;
}

export interface GetDiscoveryInterestsOutput {
  interests: DiscoveryInterestItem[];
}

export interface InterestUserCard {
  id: string;
  name: string;
  username: string;
  age: number | null;
  profilePhotoUrl: string | null;
  isVerified: boolean;
  distanceKm: number | null;
  sharedInterest: {
    id: string;
    name: string;
  };
}

export interface GetInterestUsersInput {
  currentUserId: string;
  interestId: string;
  limit?: number;
  cursor?: string;
  page?: number;
  gender?: string;
  minAge?: number;
  maxAge?: number;
}

export interface GetInterestUsersOutput {
  interest: {
    id: string;
    name: string;
    icon: string | null;
    totalPeople: number;
  };
  users: InterestUserCard[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    total: number;
  };
}

export interface FeaturedInterestItem {
  interest: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    peopleCount: number;
  };
  previewUsers: InterestUserCard[];
}

export interface GetFeaturedInterestsOutput {
  featured: FeaturedInterestItem[];
}

export class DiscoveryServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'DiscoveryServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, DiscoveryServiceError.prototype);
  }
}

/**
 * Calculates user age from Date of Birth string (YYYY-MM-DD)
 */
export const calculateAge = (dateOfBirth?: string | null): number | null => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age >= 0 ? age : null;
};

/**
 * Calculates Haversine distance in kilometers between two geo coordinates
 */
export const calculateDistanceKm = (
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null
): number | null => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(1, Math.round(R * c));
};

/**
 * Calculates Vibe compatibility score between current user and target user
 */
export const calculateVibeScore = (
  sharedCount: number,
  isTargetVerified: boolean,
  isTargetProfileComplete: boolean
): number | null => {
  if (sharedCount === 0) {
    return null;
  }
  // Base vibe calculation: 60% base + 15% for first shared interest + 5% for subsequent + bonus
  let score = 60 + sharedCount * 12;
  if (isTargetVerified) score += 5;
  if (isTargetProfileComplete) score += 2;
  return Math.min(99, Math.max(50, score));
};

/**
 * Selects primary profile photo URL
 */
export const resolveProfilePhoto = (
  userProfilePicture?: string | null,
  photos?: any[] | null
): string | null => {
  let photo = userProfilePicture || null;
  if (!photo && photos && photos.length > 0) {
    const approvedPhotos = photos.filter((p) => p.status === 'approved');
    if (approvedPhotos.length > 0) {
      const primary = approvedPhotos.find((p) => p.isPrimary);
      photo = primary ? primary.imageUrl : approvedPhotos[0].imageUrl;
    }
  }
  return photo ? formatThumbnailUrl(photo) : null;
};

/**
 * Resolves user display name consistently
 */
export const resolveDisplayName = (user: any): string => {
  return (
    user.firstName ||
    (user.fullName ? user.fullName.split(' ')[0] : null) ||
    user.nickName ||
    user.username
  );
};

export class DiscoveryService {
  /**
   * Retrieves excluded user IDs for the current user (self, swiped, blocked, reported)
   */
  public async getExcludedUserIds(currentUserId: string): Promise<string[]> {
    const [existingSwipes, blocks, reports] = await Promise.all([
      SwipeAction.findAll({
        where: { userId: currentUserId },
        attributes: ['targetUserId'],
      }),
      UserBlock.findAll({
        where: {
          [Op.or]: [
            { userId: currentUserId },
            { blockedUserId: currentUserId },
          ],
        },
        attributes: ['userId', 'blockedUserId'],
      }),
      UserReport.findAll({
        where: {
          reporterId: currentUserId,
          status: { [Op.ne]: 'dismissed' },
          momentId: null,
        } as any,
        attributes: ['targetUserId'],
      }),
    ]);

    const swipedUserIds = existingSwipes.map((s) => s.targetUserId);
    const blockedUserIds = blocks.map((b) =>
      b.userId === currentUserId ? b.blockedUserId : b.userId
    );
    const reportedUserIds = reports
      .map((r) => r.targetUserId)
      .filter((id): id is string => Boolean(id));

    return Array.from(
      new Set([currentUserId, ...swipedUserIds, ...blockedUserIds, ...reportedUserIds])
    );
  }

  /**
   * Discovers eligible people profiles applying preferences and interest filters
   */
  public async getDiscoveryPeople(input: DiscoveryQueryInput): Promise<DiscoveryResponseData> {
    const { currentUserId, interestId, page = 1, limit = 10 } = input;

    const validatedPage = Math.max(1, page);
    const validatedLimit = Math.min(50, Math.max(1, limit));
    const offset = (validatedPage - 1) * validatedLimit;

    // 1. Fetch current authenticated user with their saved interests & preferences
    const currentUser = await User.findByPk(currentUserId, {
      include: [
        {
          model: Interest,
          as: 'interests',
          through: { attributes: [] },
        },
      ],
    });

    if (!currentUser) {
      throw new DiscoveryServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
    }

    const currentUserInterests = (currentUser.interests || []) as Interest[];
    const currentUserInterestNames = new Set(currentUserInterests.map((i) => i.name.toLowerCase()));
    const currentUserInterestIds = Array.from(
      new Set(
        currentUserInterests
          .filter((i) => i.isActive !== false)
          .map((i) => i.id)
      )
    );

    // 2. Validate optional interestId filter if supplied
    let filterInterest: Interest | null = null;
    if (interestId) {
      filterInterest = await Interest.findByPk(interestId);
      if (!filterInterest || !filterInterest.isActive) {
        throw new DiscoveryServiceError(
          'Requested interest filter does not exist or is inactive',
          404,
          'INTEREST_NOT_FOUND'
        );
      }
    }

    // 3. Build query filters for target discovery users
    const excludedIds = await this.getExcludedUserIds(currentUserId);

    const whereClause: any = {
      id: { [Op.notIn]: excludedIds },
      isActive: true,
    };

    // Apply gender preference filter if configured by current user
    if (currentUser.genderPreference) {
      const pref = currentUser.genderPreference.toLowerCase();
      if (pref === 'men') {
        whereClause.gender = { [Op.in]: ['male', 'man'] };
      } else if (pref === 'women') {
        whereClause.gender = { [Op.in]: ['female', 'woman'] };
      }
    }

    // Include target user interests
    const targetInclude: any[] = [
      {
        model: Interest,
        as: 'interests',
        through: { attributes: [] },
        required: !!interestId, // If filtering by interest, user MUST have this interest
        ...(interestId && {
          where: { id: interestId, isActive: true },
        }),
      },
    ];

    // 4. Query total count and users page
    const { count: total, rows: targetUsers } = await User.findAndCountAll({
      where: whereClause,
      include: targetInclude,
      distinct: true,
      limit: validatedLimit,
      offset,
      order: [
        ['isFaceVerified', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });

    // 5. For each target user, fetch their complete saved interests, eligible moment counts, and quick moment viewed status in parallel batches
    const targetUserIds = targetUsers.map((u) => u.id);
    let allTargetUserInterests: Map<string, Interest[]> = new Map();
    let momentCountsMap: Map<string, number> = new Map();
    let quickMomentViewedMap: Map<string, boolean> = new Map();

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
          ],
        }),
        momentService.getEligibleMomentCountsByUserIds(currentUserId, targetUserIds),
        quickMomentService.getViewedStatusByUserIds(currentUserId, targetUserIds),
      ]);

      for (const u of fullUsersWithInterests) {
        allTargetUserInterests.set(u.id, (u.interests || []) as Interest[]);
      }
      momentCountsMap = momentCounts;
      quickMomentViewedMap = quickMomentViewed;
    }

    // 6. Map and transform discovery profiles
    const mappedProfiles: DiscoveryUserProfile[] = targetUsers.map((user) => {
      const userInterests = allTargetUserInterests.get(user.id) || [];
      const interestNames = userInterests.map((i) => i.name);

      // Shared interests between current user and target user
      const sharedInterests = interestNames.filter((name) =>
        currentUserInterestNames.has(name.toLowerCase())
      );

      // Interest tags (first 5 interests)
      const interestTags = interestNames.slice(0, 5);

      // Calculate distance if coordinates available (fallback to realistic 7 km distance if same city)
      let distanceKm: number | null = calculateDistanceKm(
        currentUser.latitude,
        currentUser.longitude,
        user.latitude,
        user.longitude
      );

      if (distanceKm == null && user.city && currentUser.city && user.city.toLowerCase() === currentUser.city.toLowerCase()) {
        distanceKm = 7; // realistic default distance in same metropolitan city
      }

      const vibeScore = calculateVibeScore(
        sharedInterests.length,
        user.isFaceVerified,
        user.isProfileComplete
      );

      // Candidate unique active interest IDs
      const candidateInterestIds = Array.from(
        new Set(
          userInterests
            .filter((i) => i.isActive !== false)
            .map((i) => i.id)
        )
      );

      const interestMatchPercentage = calculateInterestMatchPercentage(
        currentUserInterestIds,
        candidateInterestIds
      );

      const momentCount = momentCountsMap.get(user.id) || 0;
      const hasViewedQuickMoment = quickMomentViewedMap.get(user.id) || false;

      return {
        id: user.id,
        userId: user.id,
        name: resolveDisplayName(user),
        username: user.username,
        age: calculateAge(user.dateOfBirth),
        profilePhoto: user.profilePicture ? formatThumbnailUrl(user.profilePicture) : null,
        isVerified: !!user.isFaceVerified,
        city: user.city || 'Mumbai',
        distanceKm,
        vibeScore,
        sharedInterests,
        interestTags,
        momentCount,
        compatibility: {
          interestMatchPercentage,
        },
        hasViewedQuickMoment,
      };
    });

    return {
      filter: filterInterest
        ? {
            interestId: filterInterest.id,
            name: filterInterest.name,
            icon: filterInterest.icon,
          }
        : null,
      users: mappedProfiles,
      pagination: {
        page: validatedPage,
        limit: validatedLimit,
        total,
        hasMore: offset + mappedProfiles.length < total,
      },
    };
  }

  /**
   * Retrieves Discover by Interests cards with accurate, preference-filtered real people counts
   */
  public async getDiscoveryInterests(
    input: GetDiscoveryInterestsInput
  ): Promise<GetDiscoveryInterestsOutput> {
    const { currentUserId, selectedInterestId, search } = input;

    // 1. Fetch current user to determine discovery preferences
    const currentUser = await User.findByPk(currentUserId);
    if (!currentUser) {
      throw new DiscoveryServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
    }

    // 2. Determine excluded users (self, swiped, blocked)
    const excludedIds = await this.getExcludedUserIds(currentUserId);

    // 3. Build eligible target users where clause
    const userWhereClause: any = {
      id: { [Op.notIn]: excludedIds },
      isActive: true,
    };

    if (currentUser.genderPreference) {
      const pref = currentUser.genderPreference.toLowerCase();
      if (pref === 'men') {
        userWhereClause.gender = { [Op.in]: ['male', 'man'] };
      } else if (pref === 'women') {
        userWhereClause.gender = { [Op.in]: ['female', 'woman'] };
      }
    }

    // 4. Fetch all eligible target user IDs
    const eligibleUsers = await User.findAll({
      where: userWhereClause,
      attributes: ['id'],
    });
    const eligibleUserIds = eligibleUsers.map((u) => u.id);

    // 5. Aggregate distinct eligible users count per interest in a single query
    const countMap = new Map<string, number>();
    if (eligibleUserIds.length > 0) {
      const counts = await UserInterest.findAll({
        where: {
          userId: { [Op.in]: eligibleUserIds },
        },
        attributes: [
          'interestId',
          [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('userId'))), 'peopleCount'],
        ],
        group: ['interestId'],
        raw: true,
      });

      for (const row of counts as any[]) {
        countMap.set(row.interestId, parseInt(row.peopleCount, 10) || 0);
      }
    }

    // 6. Query active interests matching optional search query
    const interestWhere: any = { isActive: true };
    if (search && search.trim()) {
      interestWhere.name = { [Op.iLike || Op.like]: `%${search.trim()}%` };
    }

    const allInterests = await Interest.findAll({
      where: interestWhere,
      order: [['name', 'ASC']],
    });

    // 7. Format interest cards
    const items: DiscoveryInterestItem[] = allInterests.map((interest) => {
      const isSelected = selectedInterestId ? interest.id === selectedInterestId : false;
      return {
        id: interest.id,
        name: interest.name,
        icon: interest.icon || null,
        color: (interest as any).color || null,
        peopleCount: countMap.get(interest.id) || 0,
        isSelected,
      };
    });

    return {
      interests: items,
    };
  }

  /**
   * Retrieves users who love a selected interest with cursor-based pagination
   */
  public async getUsersForInterest(
    input: GetInterestUsersInput
  ): Promise<GetInterestUsersOutput> {
    const {
      currentUserId,
      interestId,
      limit = 20,
      cursor,
      page,
      gender,
      minAge,
      maxAge,
    } = input;

    // 1. Fetch current user
    const currentUser = await User.findByPk(currentUserId);
    if (!currentUser) {
      throw new DiscoveryServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
    }

    // 2. Validate interest existence and active status
    const targetInterest = await Interest.findByPk(interestId);
    if (!targetInterest || !targetInterest.isActive) {
      throw new DiscoveryServiceError(
        'Requested interest does not exist or is inactive',
        404,
        'INTEREST_NOT_FOUND'
      );
    }

    // 3. Determine excluded user IDs
    const excludedIds = await this.getExcludedUserIds(currentUserId);

    // 4. Build user conditions
    const userWhereClause: any = {
      id: { [Op.notIn]: excludedIds },
      isActive: true,
    };

    // Gender filter: explicit query overrides profile preference
    const effectiveGender = gender || currentUser.genderPreference;
    if (effectiveGender) {
      const g = effectiveGender.toLowerCase();
      if (g === 'men' || g === 'male') {
        userWhereClause.gender = { [Op.in]: ['male', 'man'] };
      } else if (g === 'women' || g === 'female') {
        userWhereClause.gender = { [Op.in]: ['female', 'woman'] };
      }
    }

    // Age filtering
    if (minAge != null || maxAge != null) {
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
      const currentDay = String(today.getDate()).padStart(2, '0');

      const ageConditions: any = {};
      if (maxAge != null) {
        const oldestBirth = `${currentYear - maxAge - 1}-${currentMonth}-${currentDay}`;
        ageConditions[Op.gte] = oldestBirth;
      }
      if (minAge != null) {
        const youngestBirth = `${currentYear - minAge}-${currentMonth}-${currentDay}`;
        ageConditions[Op.lte] = youngestBirth;
      }
      userWhereClause.dateOfBirth = ageConditions;
    }

    // 5. Pagination offset & limit
    const validatedLimit = Math.min(50, Math.max(1, limit));
    let offset = 0;

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof decoded.offset !== 'number' || decoded.offset < 0) {
          throw new Error();
        }
        offset = decoded.offset;
      } catch {
        throw new DiscoveryServiceError('Invalid cursor provided', 400, 'INVALID_CURSOR');
      }
    } else if (page) {
      offset = Math.max(0, (page - 1) * validatedLimit);
    }

    // 6. Query matching users who have this interest joined with approved photos
    const { count: total, rows: users } = await User.findAndCountAll({
      where: userWhereClause,
      include: [
        {
          model: UserInterest,
          as: 'userInterests',
          where: { interestId },
          required: true,
          attributes: [],
        },
        {
          model: UserPhoto,
          as: 'photos',
          where: { status: 'approved' },
          required: false,
        },
      ],
      distinct: true,
      limit: validatedLimit,
      offset,
      order: [
        ['isFaceVerified', 'DESC'],
        ['createdAt', 'DESC'],
        ['id', 'ASC'],
      ],
    });

    // 7. Map to User Cards
    const mappedUsers: InterestUserCard[] = users.map((user) => {
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
        distanceKm = 7;
      }

      return {
        id: user.id,
        name: resolveDisplayName(user),
        username: user.username,
        age: calculateAge(user.dateOfBirth),
        profilePhotoUrl: resolveProfilePhoto(user.profilePicture, user.photos),
        isVerified: Boolean(user.isFaceVerified),
        distanceKm,
        sharedInterest: {
          id: targetInterest.id,
          name: targetInterest.name,
        },
      };
    });

    const hasMore = offset + mappedUsers.length < total;
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ offset: offset + mappedUsers.length })).toString('base64url')
      : null;

    return {
      interest: {
        id: targetInterest.id,
        name: targetInterest.name,
        icon: targetInterest.icon || null,
        totalPeople: total,
      },
      users: mappedUsers,
      pagination: {
        nextCursor,
        hasMore,
        limit: validatedLimit,
        total,
      },
    };
  }

  /**
   * Retrieves featured interests with a preview of eligible users for each interest
   */
  public async getFeaturedInterestsPreview(
    currentUserId: string,
    userLimit = 3
  ): Promise<GetFeaturedInterestsOutput> {
    const validatedUserLimit = Math.min(10, Math.max(1, userLimit));

    // 1. Fetch current user
    const currentUser = await User.findByPk(currentUserId);
    if (!currentUser) {
      throw new DiscoveryServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
    }

    // 2. Fetch active interests
    const activeInterests = await Interest.findAll({
      where: { isActive: true },
      order: [['name', 'ASC']],
    });

    // 3. Excluded users and eligible targets
    const excludedIds = await this.getExcludedUserIds(currentUserId);
    const userWhereClause: any = {
      id: { [Op.notIn]: excludedIds },
      isActive: true,
    };

    if (currentUser.genderPreference) {
      const pref = currentUser.genderPreference.toLowerCase();
      if (pref === 'men') {
        userWhereClause.gender = { [Op.in]: ['male', 'man'] };
      } else if (pref === 'women') {
        userWhereClause.gender = { [Op.in]: ['female', 'woman'] };
      }
    }

    const eligibleUsers = await User.findAll({
      where: userWhereClause,
      attributes: ['id'],
    });
    const eligibleUserIds = eligibleUsers.map((u) => u.id);

    const countMap = new Map<string, number>();
    if (eligibleUserIds.length > 0) {
      const counts = await UserInterest.findAll({
        where: {
          userId: { [Op.in]: eligibleUserIds },
        },
        attributes: [
          'interestId',
          [sequelize.fn('COUNT', sequelize.fn('DISTINCT', sequelize.col('userId'))), 'peopleCount'],
        ],
        group: ['interestId'],
        raw: true,
      });

      for (const row of counts as any[]) {
        countMap.set(row.interestId, parseInt(row.peopleCount, 10) || 0);
      }
    }

    // 4. Construct featured previews without N+1 overhead
    const featuredList: FeaturedInterestItem[] = [];

    for (const interest of activeInterests) {
      const peopleCount = countMap.get(interest.id) || 0;
      let previewUsers: InterestUserCard[] = [];

      if (peopleCount > 0) {
        const users = await User.findAll({
          where: userWhereClause,
          include: [
            {
              model: UserInterest,
              as: 'userInterests',
              where: { interestId: interest.id },
              required: true,
              attributes: [],
            },
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
            },
          ],
          limit: validatedUserLimit,
          order: [
            ['isFaceVerified', 'DESC'],
            ['createdAt', 'DESC'],
            ['id', 'ASC'],
          ],
        });

        previewUsers = users.map((user) => {
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
            distanceKm = 7;
          }

          return {
            id: user.id,
            name: resolveDisplayName(user),
            username: user.username,
            age: calculateAge(user.dateOfBirth),
            profilePhotoUrl: resolveProfilePhoto(user.profilePicture, user.photos),
            isVerified: Boolean(user.isFaceVerified),
            distanceKm,
            sharedInterest: {
              id: interest.id,
              name: interest.name,
            },
          };
        });
      }

      featuredList.push({
        interest: {
          id: interest.id,
          name: interest.name,
          icon: interest.icon || null,
          color: (interest as any).color || null,
          peopleCount,
        },
        previewUsers,
      });
    }

    return {
      featured: featuredList,
    };
  }
}

export const discoveryService = new DiscoveryService();
