import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  User,
  Interest,
  UserInterest,
  SwipeAction,
  UserBlock,
  UserReport,
  UserDiscoveryPreference,
  UserDevice,
  UserPhoto,
} from '../models';
import { formatThumbnailUrl } from './s3.service';
import { calculateAge, calculateDistanceKm, calculateVibeScore, resolveDisplayName } from './discovery.service';

export const SUPPORTED_GENDERS = [
  { id: 'women', label: 'Women' },
  { id: 'men', label: 'Men' },
  { id: 'non_binary', label: 'Non-binary' },
  { id: 'everyone', label: 'Everyone' },
];

export const AGE_LIMITS = {
  min: 18,
  max: 70,
  absoluteMin: 18,
  absoluteMax: 100,
  defaultMin: 18,
  defaultMax: 70,
};

export const DISTANCE_LIMITS = {
  minKm: 1,
  maxKm: 150,
  unit: 'km',
  anywhereValue: null,
  anywhereDescription: 'No distance restriction (Anywhere)',
  defaultMaxKm: null,
};

export const SUPPORTED_LOOKING_FOR = [
  { id: 'long_term', label: 'Long-term' },
  { id: 'casual', label: 'Something casual' },
  { id: 'not_sure', label: 'Not sure yet' },
];

export const VERIFICATION_OPTIONS = {
  field: 'verifiedOnly',
  label: 'Verified only',
  description: 'Show only photo-verified profiles with face verification badge',
  default: false,
};

export const ONLINE_FRESHNESS_MINUTES = 15;

export const ONLINE_OPTIONS = {
  field: 'onlineOnly',
  label: 'Online now',
  description: `Show only active users active within the last ${ONLINE_FRESHNESS_MINUTES} minutes`,
  freshnessMinutes: ONLINE_FRESHNESS_MINUTES,
  default: false,
};

export const DEFAULT_DISCOVERY_FILTERS = {
  genders: ['everyone'],
  ageMin: 18,
  ageMax: 70,
  maxDistanceKm: null,
  lookingFor: [] as string[],
  interestIds: [] as string[],
  verifiedOnly: false,
  onlineOnly: false,
};

export class DiscoveryFilterServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'DiscoveryFilterServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, DiscoveryFilterServiceError.prototype);
  }
}

export interface DiscoveryFilterPreferenceDTO {
  id: string | null;
  userId: string;
  genders: string[];
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number | null;
  lookingFor: string[];
  interestIds: string[];
  verifiedOnly: boolean;
  onlineOnly: boolean;
  isDefault?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UpdateDiscoveryFiltersInput {
  genders?: string[];
  ageMin?: number;
  ageMax?: number;
  maxDistanceKm?: number | null;
  lookingFor?: string[];
  interestIds?: string[];
  verifiedOnly?: boolean;
  onlineOnly?: boolean;
}

export interface DiscoverySearchInput extends UpdateDiscoveryFiltersInput {
  page?: number;
  limit?: number;
  cursor?: string;
  countOnly?: boolean;
}

export interface PublicProfileCardDTO {
  id: string;
  name: string;
  username: string;
  age: number | null;
  gender: string | null;
  city: string;
  distanceKm: number | null;
  isVerified: boolean;
  isSubscribed: boolean;
  isOnline: boolean;
  profilePhotoUrl: string | null;
  about: string | null;
  lookingFor: string | null;
  interests: Array<{
    id: string;
    name: string;
    icon: string | null;
  }>;
  sharedInterests: string[];
  vibeScore: number | null;
}

export interface DiscoverySearchResultDTO {
  profiles: PublicProfileCardDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
  totalCount: number;
  appliedFilters: {
    genders: string[];
    ageMin: number;
    ageMax: number;
    maxDistanceKm: number | null;
    lookingFor: string[];
    interestIds: string[];
    verifiedOnly: boolean;
    onlineOnly: boolean;
  };
}

export class DiscoveryFilterService {
  /**
   * Retrieves authoritative filter options and limits sourced from backend configuration
   * GET /api/v1/discovery/filters/options
   */
  public async getFilterOptions() {
    const interests = await Interest.findAll({
      where: { isActive: true },
      attributes: ['id', 'name', 'icon', 'category'],
      order: [['name', 'ASC']],
    });

    return {
      genders: SUPPORTED_GENDERS,
      age: AGE_LIMITS,
      distance: DISTANCE_LIMITS,
      lookingFor: SUPPORTED_LOOKING_FOR,
      interests: interests.map((i) => ({
        id: i.id,
        name: i.name,
        icon: i.icon,
        category: i.category,
      })),
      verification: VERIFICATION_OPTIONS,
      online: ONLINE_OPTIONS,
      defaults: DEFAULT_DISCOVERY_FILTERS,
    };
  }

  /**
   * Retrieves authenticated user's saved filter preferences.
   * If none saved, returns documented defaults without writing duplicate DB records.
   * GET /api/v1/discovery/filters
   */
  public async getFilters(userId: string): Promise<DiscoveryFilterPreferenceDTO> {
    const preference = await UserDiscoveryPreference.findOne({
      where: { userId },
    });

    if (!preference) {
      return {
        id: null,
        userId,
        ...DEFAULT_DISCOVERY_FILTERS,
        isDefault: true,
        createdAt: null,
        updatedAt: null,
      };
    }

    return this.mapPreferenceToDTO(preference, false);
  }

  /**
   * Validates and saves authenticated user's filter preferences atomically.
   * PUT /api/v1/discovery/filters
   */
  public async updateFilters(
    userId: string,
    input: UpdateDiscoveryFiltersInput
  ): Promise<DiscoveryFilterPreferenceDTO> {
    // 1. Verify user exists
    const user = await User.findByPk(userId);
    if (!user || !user.isActive) {
      throw new DiscoveryFilterServiceError('User not found or inactive', 404, 'USER_NOT_FOUND');
    }

    // 2. Validate interest IDs exist in the database if provided
    if (input.interestIds && input.interestIds.length > 0) {
      const validInterests = await Interest.findAll({
        where: {
          id: { [Op.in]: input.interestIds },
          isActive: true,
        },
        attributes: ['id'],
      });

      if (validInterests.length !== input.interestIds.length) {
        const validSet = new Set(validInterests.map((i) => i.id));
        const invalidIds = input.interestIds.filter((id) => !validSet.has(id));
        throw new DiscoveryFilterServiceError(
          `Invalid or inactive interest IDs: ${invalidIds.join(', ')}`,
          400,
          'INVALID_INTEREST_IDS'
        );
      }
    }

    // 3. Normalize gender selections
    let cleanGenders: string[] | undefined = input.genders;
    if (cleanGenders !== undefined) {
      if (cleanGenders.length === 0 || cleanGenders.includes('everyone')) {
        cleanGenders = ['everyone'];
      }
    }

    // 4. Atomic upsert using dialect-aware transaction
    const updated = await this.executeTransaction(async (t) => {
      let preference = await UserDiscoveryPreference.findOne({
        where: { userId },
        ...(t ? { transaction: t, lock: t.LOCK.UPDATE } : {}),
      });

      if (preference) {
        // Merge updates carefully, preserving omitted fields while respecting explicit null
        if (cleanGenders !== undefined) preference.genders = cleanGenders;
        if (input.ageMin !== undefined) preference.ageMin = input.ageMin;
        if (input.ageMax !== undefined) preference.ageMax = input.ageMax;
        if (input.maxDistanceKm !== undefined) preference.maxDistanceKm = input.maxDistanceKm;
        if (input.lookingFor !== undefined) preference.lookingFor = input.lookingFor;
        if (input.interestIds !== undefined) preference.interestIds = input.interestIds;
        if (input.verifiedOnly !== undefined) preference.verifiedOnly = input.verifiedOnly;
        if (input.onlineOnly !== undefined) preference.onlineOnly = input.onlineOnly;

        // Verify ageMin <= ageMax after merge
        if (preference.ageMin > preference.ageMax) {
          throw new DiscoveryFilterServiceError(
            'ageMin cannot be greater than ageMax',
            400,
            'INVALID_AGE_RANGE'
          );
        }

        await preference.save(t ? { transaction: t } : undefined);
      } else {
        const ageMin = input.ageMin !== undefined ? input.ageMin : DEFAULT_DISCOVERY_FILTERS.ageMin;
        const ageMax = input.ageMax !== undefined ? input.ageMax : DEFAULT_DISCOVERY_FILTERS.ageMax;

        if (ageMin > ageMax) {
          throw new DiscoveryFilterServiceError(
            'ageMin cannot be greater than ageMax',
            400,
            'INVALID_AGE_RANGE'
          );
        }

        preference = await UserDiscoveryPreference.create(
          {
            userId,
            genders: cleanGenders !== undefined ? cleanGenders : DEFAULT_DISCOVERY_FILTERS.genders,
            ageMin,
            ageMax,
            maxDistanceKm:
              input.maxDistanceKm !== undefined
                ? input.maxDistanceKm
                : DEFAULT_DISCOVERY_FILTERS.maxDistanceKm,
            lookingFor:
              input.lookingFor !== undefined
                ? input.lookingFor
                : DEFAULT_DISCOVERY_FILTERS.lookingFor,
            interestIds:
              input.interestIds !== undefined
                ? input.interestIds
                : DEFAULT_DISCOVERY_FILTERS.interestIds,
            verifiedOnly:
              input.verifiedOnly !== undefined
                ? input.verifiedOnly
                : DEFAULT_DISCOVERY_FILTERS.verifiedOnly,
            onlineOnly:
              input.onlineOnly !== undefined
                ? input.onlineOnly
                : DEFAULT_DISCOVERY_FILTERS.onlineOnly,
          },
          t ? { transaction: t } : undefined
        );
      }

      return preference;
    });

    return this.mapPreferenceToDTO(updated, false);
  }

  /**
   * Resets saved preferences to documented defaults atomically.
   * POST /api/v1/discovery/filters/reset
   */
  public async resetFilters(userId: string): Promise<DiscoveryFilterPreferenceDTO> {
    const user = await User.findByPk(userId);
    if (!user || !user.isActive) {
      throw new DiscoveryFilterServiceError('User not found or inactive', 404, 'USER_NOT_FOUND');
    }

    const resetPreference = await this.executeTransaction(async (t) => {
      let preference = await UserDiscoveryPreference.findOne({
        where: { userId },
        ...(t ? { transaction: t, lock: t.LOCK.UPDATE } : {}),
      });

      if (preference) {
        preference.genders = DEFAULT_DISCOVERY_FILTERS.genders;
        preference.ageMin = DEFAULT_DISCOVERY_FILTERS.ageMin;
        preference.ageMax = DEFAULT_DISCOVERY_FILTERS.ageMax;
        preference.maxDistanceKm = DEFAULT_DISCOVERY_FILTERS.maxDistanceKm;
        preference.lookingFor = DEFAULT_DISCOVERY_FILTERS.lookingFor;
        preference.interestIds = DEFAULT_DISCOVERY_FILTERS.interestIds;
        preference.verifiedOnly = DEFAULT_DISCOVERY_FILTERS.verifiedOnly;
        preference.onlineOnly = DEFAULT_DISCOVERY_FILTERS.onlineOnly;
        await preference.save(t ? { transaction: t } : undefined);
      } else {
        preference = await UserDiscoveryPreference.create(
          {
            userId,
            ...DEFAULT_DISCOVERY_FILTERS,
          },
          t ? { transaction: t } : undefined
        );
      }

      return preference;
    });

    return this.mapPreferenceToDTO(resetPreference, true);
  }

  private async executeTransaction<T>(callback: (t?: any) => Promise<T>): Promise<T> {
    if (sequelize.getDialect() === 'postgres') {
      return sequelize.transaction(callback);
    }
    return callback();
  }

  /**
   * Discovers profiles matching validated search filters or saved preferences.
   * POST /api/v1/discovery/search
   */
  public async search(
    userId: string,
    input: DiscoverySearchInput
  ): Promise<DiscoverySearchResultDTO> {
    // 1. Fetch authenticated user with coordinates, dateOfBirth, city, and saved interests
    const currentUser = await User.findByPk(userId, {
      include: [
        {
          model: Interest,
          as: 'interests',
          through: { attributes: [] },
        },
      ],
    });

    if (!currentUser || !currentUser.isActive) {
      throw new DiscoveryFilterServiceError('User not found or inactive', 404, 'USER_NOT_FOUND');
    }

    // 2. Fetch saved preferences to use as base, then merge request overrides
    const saved = await this.getFilters(userId);

    const effectiveFilters = {
      genders: input.genders !== undefined ? input.genders : saved.genders,
      ageMin: input.ageMin !== undefined ? input.ageMin : saved.ageMin,
      ageMax: input.ageMax !== undefined ? input.ageMax : saved.ageMax,
      maxDistanceKm:
        input.maxDistanceKm !== undefined ? input.maxDistanceKm : saved.maxDistanceKm,
      lookingFor: input.lookingFor !== undefined ? input.lookingFor : saved.lookingFor,
      interestIds: input.interestIds !== undefined ? input.interestIds : saved.interestIds,
      verifiedOnly: input.verifiedOnly !== undefined ? input.verifiedOnly : saved.verifiedOnly,
      onlineOnly: input.onlineOnly !== undefined ? input.onlineOnly : saved.onlineOnly,
    };

    if (effectiveFilters.ageMin > effectiveFilters.ageMax) {
      throw new DiscoveryFilterServiceError(
        'ageMin cannot be greater than ageMax',
        400,
        'INVALID_AGE_RANGE'
      );
    }

    // 3. Exclude self, already swiped, blocked, and reported users
    const excludedUserIds = await this.getExcludedUserIds(userId);

    // 4. Build SQL where clauses
    const where: any = {
      id: { [Op.notIn]: excludedUserIds },
      isActive: true,
    };

    // --- Gender Filtering ---
    const genders = effectiveFilters.genders || [];
    if (genders.length > 0 && !genders.includes('everyone')) {
      const allowedDbGenders: string[] = [];
      if (genders.includes('women')) allowedDbGenders.push('female', 'woman', 'women');
      if (genders.includes('men')) allowedDbGenders.push('male', 'man', 'men');
      if (genders.includes('non_binary')) {
        allowedDbGenders.push('non-binary', 'non_binary', 'nonbinary', 'other');
      }

      if (allowedDbGenders.length > 0) {
        where.gender = { [Op.in]: allowedDbGenders };
      }
    }

    // --- Age Range Filtering (Derived from dateOfBirth) ---
    const now = new Date();
    // ageMin: user must have been born on or before (today - ageMin years)
    const maxDob = new Date(now.getFullYear() - effectiveFilters.ageMin, now.getMonth(), now.getDate());
    // ageMax: user must have been born on or after (today - (ageMax + 1) years + 1 day)
    const minDob = new Date(
      now.getFullYear() - effectiveFilters.ageMax - 1,
      now.getMonth(),
      now.getDate() + 1
    );

    const maxDobStr = maxDob.toISOString().slice(0, 10);
    const minDobStr = minDob.toISOString().slice(0, 10);

    where.dateOfBirth = {
      [Op.between]: [minDobStr, maxDobStr],
    };

    // --- Looking For Compatibility Filtering ---
    const lookingFor = effectiveFilters.lookingFor || [];
    if (lookingFor.length > 0) {
      const allowedLookingForValues: string[] = [];
      if (lookingFor.includes('long_term')) {
        allowedLookingForValues.push('relationship', 'long_term', 'long-term');
      }
      if (lookingFor.includes('casual')) {
        allowedLookingForValues.push('something_casual', 'casual');
      }
      if (lookingFor.includes('not_sure')) {
        allowedLookingForValues.push('figuring_out', 'we_ll_see', 'not_sure', 'not_sure_yet');
      }

      if (allowedLookingForValues.length > 0) {
        where.lookingFor = { [Op.in]: allowedLookingForValues };
      }
    }

    // --- Verified Only Filtering ---
    if (effectiveFilters.verifiedOnly) {
      where.isFaceVerified = true;
    }

    // --- Online Presence Filtering ---
    const onlineCutoff = new Date(Date.now() - ONLINE_FRESHNESS_MINUTES * 60 * 1000);
    if (effectiveFilters.onlineOnly) {
      where.lastActiveAt = { [Op.gte]: onlineCutoff };
    }

    // --- Distance & Geolocation Filtering ---
    const hasDistanceLimit =
      effectiveFilters.maxDistanceKm != null && effectiveFilters.maxDistanceKm > 0;

    if (hasDistanceLimit && currentUser.latitude != null && currentUser.longitude != null) {
      const maxDist = effectiveFilters.maxDistanceKm!;
      // 1 degree latitude ~= 111 km
      const latDelta = maxDist / 111.0;
      // 1 degree longitude ~= 111 * cos(lat) km
      const cosLat = Math.cos((currentUser.latitude * Math.PI) / 180);
      const lonDelta = maxDist / (111.0 * Math.max(0.1, Math.abs(cosLat)));

      where.latitude = {
        [Op.between]: [
          currentUser.latitude - latDelta,
          currentUser.latitude + latDelta,
        ],
      };
      where.longitude = {
        [Op.between]: [
          currentUser.longitude - lonDelta,
          currentUser.longitude + lonDelta,
        ],
      };
    }

    // --- Interest OR Filtering (At least one selected interest) ---
    const interestIds = effectiveFilters.interestIds || [];
    const includeClause: any[] = [];

    if (interestIds.length > 0) {
      includeClause.push({
        model: Interest,
        as: 'interests',
        through: { attributes: [] },
        where: {
          id: { [Op.in]: interestIds },
          isActive: true,
        },
        required: true, // Inner join ensures only users having at least one selected interest are returned
      });
    }

    // 5. Pagination setup
    const page = Math.max(1, input.page || 1);
    const limit = Math.min(50, Math.max(1, input.limit || 20));
    const offset = (page - 1) * limit;

    // Fast-path: count only
    if (input.countOnly) {
      const count = await User.count({
        where,
        include: includeClause,
        distinct: true,
      });

      return {
        profiles: [],
        pagination: {
          page,
          limit,
          total: count,
          hasMore: false,
          nextCursor: null,
        },
        totalCount: count,
        appliedFilters: effectiveFilters,
      };
    }

    // 6. Execute query
    const { count: total, rows: targetUsers } = await User.findAndCountAll({
      where,
      include: includeClause,
      distinct: true,
      limit,
      offset,
      order: [
        ['isFaceVerified', 'DESC'],
        ['createdAt', 'DESC'],
        ['id', 'ASC'], // deterministic tie-breaker
      ],
    });

    // 7. For the returned users, fetch complete active interests & primary photos
    const targetUserIds = targetUsers.map((u) => u.id);
    const allUserInterestsMap = new Map<string, Array<{ id: string; name: string; icon: string | null }>>();
    const primaryPhotosMap = new Map<string, string>();

    if (targetUserIds.length > 0) {
      const [fullUsersWithInterests, photos] = await Promise.all([
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
        UserPhoto.findAll({
          where: {
            userId: { [Op.in]: targetUserIds },
            status: 'approved',
          },
          order: [['isPrimary', 'DESC'], ['displayOrder', 'ASC']],
        }),
      ]);

      for (const u of fullUsersWithInterests) {
        const mapped = ((u.interests || []) as Interest[]).map((i) => ({
          id: i.id,
          name: i.name,
          icon: i.icon,
        }));
        allUserInterestsMap.set(u.id, mapped);
      }

      for (const p of photos) {
        if (!primaryPhotosMap.has(p.userId)) {
          primaryPhotosMap.set(p.userId, p.imageUrl);
        }
      }
    }

    // Current user's interest names for shared vibe calculation
    const currentUserInterests = (currentUser.interests || []) as Interest[];
    const currentUserInterestNames = new Set(currentUserInterests.map((i) => i.name.toLowerCase()));

    // 8. Map to clean public profile card DTOs
    const profiles: PublicProfileCardDTO[] = [];

    for (const targetUser of targetUsers) {
      const userInterests = allUserInterestsMap.get(targetUser.id) || [];
      const sharedInterests = userInterests
        .filter((i) => currentUserInterestNames.has(i.name.toLowerCase()))
        .map((i) => i.name);

      // Distance calculation
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
        distanceKm = 7; // realistic default distance in same city
      }

      // If maxDistanceKm is enforced and exact distance exceeds it, skip
      if (hasDistanceLimit && distanceKm != null && distanceKm > effectiveFilters.maxDistanceKm!) {
        continue;
      }

      // Check online status freshness
      const isOnline =
        targetUser.lastActiveAt != null && targetUser.lastActiveAt >= onlineCutoff;

      // Profile photo resolution
      const rawPhoto = targetUser.profilePicture || primaryPhotosMap.get(targetUser.id) || null;
      const profilePhotoUrl = rawPhoto ? formatThumbnailUrl(rawPhoto) : null;

      const vibeScore = calculateVibeScore(
        sharedInterests.length,
        targetUser.isFaceVerified,
        targetUser.isProfileComplete
      );

      profiles.push({
        id: targetUser.id,
        name: resolveDisplayName(targetUser),
        username: targetUser.username,
        age: calculateAge(targetUser.dateOfBirth),
        gender: targetUser.gender || null,
        city: targetUser.city || 'Mumbai',
        distanceKm,
        isVerified: !!targetUser.isFaceVerified,
        isSubscribed: !!targetUser.isSubscribed,
        isOnline,
        profilePhotoUrl,
        about: targetUser.about || null,
        lookingFor: targetUser.lookingFor || null,
        interests: userInterests,
        sharedInterests,
        vibeScore,
      });
    }

    const hasMore = offset + profiles.length < total;
    const nextCursor = hasMore && profiles.length > 0 ? profiles[profiles.length - 1].id : null;

    return {
      profiles,
      pagination: {
        page,
        limit,
        total,
        hasMore,
        nextCursor,
      },
      totalCount: total,
      appliedFilters: effectiveFilters,
    };
  }

  /**
   * Retrieves excluded user IDs for discovery: self, already swiped, blocked, and non-dismissed reported
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
        },
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
   * Maps UserDiscoveryPreference model to clean DTO
   */
  private mapPreferenceToDTO(
    pref: UserDiscoveryPreference,
    isDefault = false
  ): DiscoveryFilterPreferenceDTO {
    return {
      id: pref.id,
      userId: pref.userId,
      genders: Array.isArray(pref.genders) ? pref.genders : ['everyone'],
      ageMin: pref.ageMin,
      ageMax: pref.ageMax,
      maxDistanceKm: pref.maxDistanceKm,
      lookingFor: Array.isArray(pref.lookingFor) ? pref.lookingFor : [],
      interestIds: Array.isArray(pref.interestIds) ? pref.interestIds : [],
      verifiedOnly: !!pref.verifiedOnly,
      onlineOnly: !!pref.onlineOnly,
      isDefault,
      createdAt: pref.createdAt ? pref.createdAt.toISOString() : null,
      updatedAt: pref.updatedAt ? pref.updatedAt.toISOString() : null,
    };
  }
}

export const discoveryFilterService = new DiscoveryFilterService();
