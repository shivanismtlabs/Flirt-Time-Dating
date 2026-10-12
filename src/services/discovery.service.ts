import { Op } from 'sequelize';
import { User, Interest, UserInterest } from '../models';

export interface DiscoveryQueryInput {
  currentUserId: string;
  interestId?: string;
  page?: number;
  limit?: number;
}

export interface DiscoveryUserProfile {
  userId: string;
  name: string;
  age: number | null;
  profilePhoto: string | null;
  isVerified: boolean;
  city: string;
  distanceKm: number | null;
  vibeScore: number | null;
  sharedInterests: string[];
  interestTags: string[];
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

export class DiscoveryService {
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
    const whereClause: any = {
      id: { [Op.ne]: currentUserId },
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

    // 5. For each target user, fetch their complete saved interests for tag display & shared vibe
    const targetUserIds = targetUsers.map((u) => u.id);
    let allTargetUserInterests: Map<string, Interest[]> = new Map();

    if (targetUserIds.length > 0) {
      const fullUsersWithInterests = await User.findAll({
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
      });

      for (const u of fullUsersWithInterests) {
        allTargetUserInterests.set(u.id, (u.interests || []) as Interest[]);
      }
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

      const displayName =
        user.firstName ||
        (user.fullName ? user.fullName.split(' ')[0] : null) ||
        user.nickName ||
        user.username;

      return {
        userId: user.id,
        name: displayName,
        age: calculateAge(user.dateOfBirth),
        profilePhoto: user.profilePicture || null,
        isVerified: !!user.isFaceVerified,
        city: user.city || 'Mumbai',
        distanceKm,
        vibeScore,
        sharedInterests,
        interestTags,
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
}

export const discoveryService = new DiscoveryService();
