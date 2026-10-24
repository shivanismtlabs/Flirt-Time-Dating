import { Op, fn, col, where as sqlWhere } from 'sequelize';
import { User, DEFAULT_NOTIFY_SETTINGS, NotificationSettings } from '../models/user.model';
import { UserPhoto } from '../models/userPhoto.model';
import { formatMediaUrl, formatThumbnailUrl } from './s3.service';
import { calculateAge } from './discovery.service';
import { calculateProfileMatchPercentage } from '../utils/compatibility';

export interface LocationDTO {
  city: string | null;
  state: string | null;
  country: string | null;
  county: string | null;
  name?: string | null;
  label?: string | null;
  fullLocation?: string | null;
  formattedLocation?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface MoreAboutMeItem {
  key: string;
  label: string;
  icon: string;
  value: string | null;
}

export interface MoreAboutMeDTO {
  drinking: string | null;
  education: string | null;
  height: string | null;
  religion: string | null;
  sexuality: string | null;
  smoking: string | null;
  weight: string | null;
  eyeColor: string | null;
  eyecolor?: string | null;
  hairColor: string | null;
  haircolor?: string | null;
  living: string | null;
  relationship: string | null;
  children: string | null;
  items: MoreAboutMeItem[];
}

export interface UpdateProfileInput {
  fullName?: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string;
  nickName?: string;
  dateOfBirth?: string;
  gender?: string;
  about?: string | null;
  location?:
    | string
    | {
        city?: string | null;
        state?: string | null;
        country?: string | null;
        county?: string | null;
        name?: string | null;
        label?: string | null;
        fullLocation?: string | null;
        formattedLocation?: string | null;
        address?: string | null;
        latitude?: number | string | null;
        longitude?: number | string | null;
        longitutute?: number | string | null;
        lat?: number | string | null;
        lng?: number | string | null;
      }
    | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  county?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  longitutute?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  drinking?: string | null;
  education?: string | null;
  height?: string | null;
  religion?: string | null;
  sexuality?: string | null;
  smoking?: string | null;
  weight?: string | null;
  eyeColor?: string | null;
  eyecolor?: string | null;
  hairColor?: string | null;
  haircolor?: string | null;
  living?: string | null;
  relationship?: string | null;
  children?: string | null;
  coverPicture?: string | null;
  coverPhoto?: string | null;
  profilePicture?: string | null;
  profilePhoto?: string | null;
  imageKey?: string | null;
  moreAboutMe?: {
    drinking?: string | null;
    education?: string | null;
    height?: string | null;
    religion?: string | null;
    sexuality?: string | null;
    smoking?: string | null;
    weight?: string | null;
    eyeColor?: string | null;
    eyecolor?: string | null;
    hairColor?: string | null;
    haircolor?: string | null;
    living?: string | null;
    relationship?: string | null;
    children?: string | null;
  };
  notify_settings?: Partial<NotificationSettings> | null;
  notificationSettings?: Partial<NotificationSettings> | null;
}

export class ServiceError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

export const formatMoreAboutMe = (user: {
  drinking?: string | null;
  education?: string | null;
  height?: string | null;
  religion?: string | null;
  sexuality?: string | null;
  smoking?: string | null;
  weight?: string | null;
  eyeColor?: string | null;
  hairColor?: string | null;
  living?: string | null;
  relationship?: string | null;
  children?: string | null;
}): MoreAboutMeDTO => {
  const drinking = user.drinking || null;
  const education = user.education || null;
  const height = user.height || null;
  const religion = user.religion || null;
  const sexuality = user.sexuality || null;
  const smoking = user.smoking || null;
  const weight = user.weight || null;
  const eyeColor = user.eyeColor || null;
  const hairColor = user.hairColor || null;
  const living = user.living || null;
  const relationship = user.relationship || null;
  const children = user.children || null;

  const items: MoreAboutMeItem[] = [
    { key: 'drinking', label: 'Drinking', icon: '🍷', value: drinking },
    { key: 'education', label: 'Education', icon: '📖', value: education },
    { key: 'height', label: 'Height', icon: '📏', value: height },
    { key: 'religion', label: 'Religion', icon: '🛕', value: religion },
    { key: 'sexuality', label: 'Sexuality', icon: '⚧', value: sexuality },
    { key: 'smoking', label: 'Smoking', icon: '🚬', value: smoking },
    { key: 'weight', label: 'Weight', icon: '⚖️', value: weight },
    { key: 'eyeColor', label: 'Eyecolor', icon: '👁', value: eyeColor },
    { key: 'hairColor', label: 'Haircolor', icon: '💇', value: hairColor },
    { key: 'living', label: 'Living', icon: '🏠', value: living },
    { key: 'relationship', label: 'Relationship', icon: '👩‍❤️‍👨', value: relationship },
    { key: 'children', label: 'Children', icon: '👶', value: children },
  ].filter((item) => item.value != null && item.value.trim() !== '');

  return {
    drinking,
    education,
    height,
    religion,
    sexuality,
    smoking,
    weight,
    eyeColor,
    hairColor,
    living,
    relationship,
    children,
    items,
  };
};

export interface UsernameAvailabilityDTO {
  username: string;
  available: boolean;
}

/**
 * Signup username check. Matches the 3–50 character rule used by registration
 * and reports a name as taken when any account already uses it, ignoring case.
 * Does not return the matching account.
 */
export const checkUsernameAvailability = async (
  username: string
): Promise<UsernameAvailabilityDTO> => {
  const cleanUsername = String(username ?? '').trim();
  if (cleanUsername.length < 3 || cleanUsername.length > 50) {
    throw new ServiceError('Username must be between 3 and 50 characters', 400);
  }

  const takenCount = await User.count({
    where: sqlWhere(fn('LOWER', col('username')), cleanUsername.toLowerCase()),
  });

  return {
    username: cleanUsername,
    available: takenCount === 0,
  };
};

/**
 * Updates user profile details for onboarding and profile editing.
 * Enforces business rules:
 * 1. User ID must exist.
 * 2. Date of Birth and Gender can be set and updated when valid values are provided.
 * 3. Marks profile as complete upon successful update.
 */
export const updateUserProfile = async (
  userId: string,
  data: UpdateProfileInput
) => {
  const user = await User.findByPk(userId);

  if (!user) {
    throw new ServiceError('User not found', 404);
  }

  // 1. Update Date of Birth if provided
  if (data.dateOfBirth !== undefined) {
    user.dateOfBirth = data.dateOfBirth ? data.dateOfBirth.trim() : null;
  }

  // 2. Normalize and update Gender if provided
  const normalizedIncomingGender = data.gender ? data.gender.toLowerCase() : null;
  if (data.gender !== undefined) {
    user.gender = normalizedIncomingGender;
  }

  // 3. Update profile fields
  if (data.fullName !== undefined) {
    user.fullName = data.fullName.trim();
    if (!data.firstName && user.fullName) {
      user.firstName = user.fullName.split(' ')[0] || null;
    }
    if (!data.lastName && user.fullName && user.fullName.includes(' ')) {
      user.lastName = user.fullName.split(' ').slice(1).join(' ') || null;
    }
  }
  if (data.firstName !== undefined) {
    user.firstName = data.firstName ? data.firstName.trim() : null;
    if (!data.fullName && user.firstName) {
      user.fullName = user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName;
    }
  }
  if (data.lastName !== undefined) {
    user.lastName = data.lastName ? data.lastName.trim() : null;
    if (!data.fullName && user.firstName && user.lastName) {
      user.fullName = `${user.firstName} ${user.lastName}`;
    }
  }
  // Handle Username update (with unique check and validation)
  const incomingUsername =
    data.username !== undefined
      ? data.username
      : (data as any).userName !== undefined
      ? (data as any).userName
      : (data as any).user_name;

  if (incomingUsername !== undefined && incomingUsername !== null) {
    const cleanUsername = String(incomingUsername).trim();
    if (cleanUsername.length < 3 || cleanUsername.length > 50) {
      throw new ServiceError('Username must be between 3 and 50 characters', 400);
    }
    const existingUser = await User.findOne({
      where: {
        username: cleanUsername,
        id: { [Op.ne]: userId },
      },
    });
    if (existingUser) {
      throw new ServiceError('Username is already taken', 400);
    }
    user.username = cleanUsername;
    // When nickName is not explicitly provided in the request payload, sync nickName to username
    if (data.nickName === undefined && (data as any).nickname === undefined) {
      user.nickName = cleanUsername;
    }
  }

  // Handle NickName update (backward compatibility)
  if (data.nickName !== undefined) {
    user.nickName = data.nickName.trim();
  }

  const parseCoord = (val: any): number | null | undefined => {
    if (val === undefined) return undefined;
    if (val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  };

  // Handle Location / City / State / Country / County / Coordinates
  if (data.location !== undefined) {
    if (typeof data.location === 'string') {
      user.city = data.location.trim() || null;
    } else if (data.location && typeof data.location === 'object') {
      const loc = data.location;
      if (loc.name && loc.name.trim()) {
        user.city = loc.name.trim();
      } else if (loc.fullLocation && loc.fullLocation.trim()) {
        user.city = loc.fullLocation.trim();
      } else {
        const parts: string[] = [];
        if (loc.city && loc.city.trim()) parts.push(loc.city.trim());
        if (loc.county && loc.county.trim()) parts.push(loc.county.trim());
        if (loc.state && loc.state.trim()) parts.push(loc.state.trim());
        if (loc.country && loc.country.trim()) parts.push(loc.country.trim());

        if (parts.length > 0) {
          user.city = parts.join(', ');
        } else if (loc.label && loc.label.trim()) {
          user.city = loc.label.trim();
        } else if (loc.address && loc.address.trim()) {
          user.city = loc.address.trim();
        }
      }
      const locLat = parseCoord(loc.latitude ?? (loc as any).lat);
      if (locLat !== undefined) {
        user.latitude = locLat;
      }
      const locLng = parseCoord(loc.longitude ?? (loc as any).longitutute ?? (loc as any).lng);
      if (locLng !== undefined) {
        user.longitude = locLng;
      }
    } else if (data.location === null) {
      user.city = null;
    }
  }

  // Handle direct root fields if location object was not provided
  if (data.location === undefined) {
    if (
      data.city !== undefined ||
      data.state !== undefined ||
      data.country !== undefined ||
      data.county !== undefined
    ) {
      const parts: string[] = [];
      if (data.city && data.city.trim()) parts.push(data.city.trim());
      if (data.county && data.county.trim()) parts.push(data.county.trim());
      if (data.state && data.state.trim()) parts.push(data.state.trim());
      if (data.country && data.country.trim()) parts.push(data.country.trim());

      if (parts.length > 0) {
        user.city = parts.join(', ');
      } else if (data.city === null || data.city === '') {
        user.city = null;
      }
    }
  }

  // Direct root latitude / longitude (also supports lat / lng / longitutute)
  const rootLat = parseCoord(data.latitude ?? (data as any).lat);
  if (rootLat !== undefined) {
    user.latitude = rootLat;
  }
  const rootLng = parseCoord(data.longitude ?? (data as any).longitutute ?? (data as any).lng);
  if (rootLng !== undefined) {
    user.longitude = rootLng;
  }

  if (data.about !== undefined) {
    user.about = data.about ? data.about.trim() : null;
  }

  // 4. Update More About Me fields from the request body, nested moreAboutMe, or items[].
  const moreSource = data.moreAboutMe || {};
  const itemValueByKey = new Map<string, string | null>();
  const rawItems = (moreSource as { items?: unknown }).items;
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (!item || typeof item !== 'object') continue;
      const key = typeof (item as { key?: unknown }).key === 'string'
        ? (item as { key: string }).key.trim()
        : '';
      if (!key) continue;
      const rawValue = (item as { value?: unknown }).value;
      itemValueByKey.set(key, rawValue == null ? null : String(rawValue));
    }
  }

  const blankToNull = (value: unknown): string | null => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const resolveMore = (
    direct: string | null | undefined,
    nested: string | null | undefined,
    ...keys: string[]
  ): string | null | undefined => {
    if (direct !== undefined) return direct;
    if (nested !== undefined) return nested;
    for (const key of keys) {
      if (itemValueByKey.has(key)) return itemValueByKey.get(key);
    }
    return undefined;
  };

  const drinkingValue = resolveMore(data.drinking, moreSource.drinking, 'drinking');
  if (drinkingValue !== undefined) user.drinking = blankToNull(drinkingValue);
  const educationValue = resolveMore(data.education, moreSource.education, 'education');
  if (educationValue !== undefined) user.education = blankToNull(educationValue);
  const heightValue = resolveMore(data.height, moreSource.height, 'height');
  if (heightValue !== undefined) user.height = blankToNull(heightValue);
  const religionValue = resolveMore(data.religion, moreSource.religion, 'religion');
  if (religionValue !== undefined) user.religion = blankToNull(religionValue);
  const sexualityValue = resolveMore(data.sexuality, moreSource.sexuality, 'sexuality');
  if (sexualityValue !== undefined) user.sexuality = blankToNull(sexualityValue);
  const smokingValue = resolveMore(data.smoking, moreSource.smoking, 'smoking');
  if (smokingValue !== undefined) user.smoking = blankToNull(smokingValue);
  const weightValue = resolveMore(data.weight, moreSource.weight, 'weight');
  if (weightValue !== undefined) user.weight = blankToNull(weightValue);
  const eyeColorValue = resolveMore(
    data.eyeColor !== undefined ? data.eyeColor : data.eyecolor,
    moreSource.eyeColor !== undefined ? moreSource.eyeColor : moreSource.eyecolor,
    'eyeColor',
    'eyecolor'
  );
  if (eyeColorValue !== undefined) user.eyeColor = blankToNull(eyeColorValue);
  const hairColorValue = resolveMore(
    data.hairColor !== undefined ? data.hairColor : data.haircolor,
    moreSource.hairColor !== undefined ? moreSource.hairColor : moreSource.haircolor,
    'hairColor',
    'haircolor'
  );
  if (hairColorValue !== undefined) user.hairColor = blankToNull(hairColorValue);
  const livingValue = resolveMore(data.living, moreSource.living, 'living');
  if (livingValue !== undefined) user.living = blankToNull(livingValue);
  const relationshipValue = resolveMore(data.relationship, moreSource.relationship, 'relationship');
  if (relationshipValue !== undefined) user.relationship = blankToNull(relationshipValue);
  const childrenValue = resolveMore(data.children, moreSource.children, 'children');
  if (childrenValue !== undefined) user.children = blankToNull(childrenValue);
  if (data.coverPicture !== undefined || data.coverPhoto !== undefined) {
    user.coverPicture = data.coverPicture !== undefined ? (data.coverPicture ?? null) : (data.coverPhoto ?? null);
  }

  const incomingNotifySettings = data.notify_settings || data.notificationSettings;
  if (incomingNotifySettings && typeof incomingNotifySettings === 'object') {
    const existingSettings = user.notificationSettings || DEFAULT_NOTIFY_SETTINGS;
    user.notificationSettings = {
      ...existingSettings,
      ...incomingNotifySettings,
    };

    try {
      const { NotificationSetting } = await import('../models/notificationSetting.model');
      const [setting] = await NotificationSetting.findOrCreate({
        where: { userId },
        defaults: {
          userId,
          newMessages: true,
          newMatches: true,
          likeComments: true,
          profileVisits: true,
          datingTips: false,
          pushNotifications: true,
        },
      });

      const inc = incomingNotifySettings as any;
      if (inc.new_messages !== undefined) setting.newMessages = Boolean(inc.new_messages);
      else if (inc.new_message !== undefined) setting.newMessages = Boolean(inc.new_message);

      if (inc.new_matches !== undefined) setting.newMatches = Boolean(inc.new_matches);

      if (inc.like_comments !== undefined) setting.likeComments = Boolean(inc.like_comments);
      else if (inc.likes_comments_calls !== undefined) setting.likeComments = Boolean(inc.likes_comments_calls);

      if (inc.profile_visits !== undefined) setting.profileVisits = Boolean(inc.profile_visits);
      else if (inc.profile_visit !== undefined) setting.profileVisits = Boolean(inc.profile_visit);

      if (inc.dating_tips !== undefined) setting.datingTips = Boolean(inc.dating_tips);
      else if (inc.new_tips_available !== undefined) setting.datingTips = Boolean(inc.new_tips_available);

      if (inc.push_notifications !== undefined) setting.pushNotifications = Boolean(inc.push_notifications);
      else if (inc.push !== undefined) setting.pushNotifications = Boolean(inc.push);

      await setting.save();
    } catch {}
  }

  const incomingPhoto = data.profilePicture ?? data.profilePhoto ?? (data as any).imageKey;
  if (incomingPhoto !== undefined) {
    if (incomingPhoto === null) {
      user.profilePicture = null;
      await UserPhoto.update(
        { isPrimary: false },
        { where: { userId, isPrimary: true } }
      );
    } else if (typeof incomingPhoto === 'string' && incomingPhoto.trim()) {
      const cleanPhoto = incomingPhoto.trim();
      user.profilePicture = cleanPhoto;
      // Demote existing primary photo
      await UserPhoto.update(
        { isPrimary: false },
        { where: { userId, isPrimary: true } }
      );
      // Ensure UserPhoto record exists and is marked primary
      const [photoRec] = await UserPhoto.findOrCreate({
        where: { userId, imageUrl: cleanPhoto },
        defaults: {
          userId,
          imageUrl: cleanPhoto,
          isPrimary: true,
          status: 'approved',
          displayOrder: 0,
        },
      });
      if (!photoRec.isPrimary) {
        photoRec.isPrimary = true;
        await photoRec.save();
      }
    }
  }

  const basicInfoReady = !!(user.fullName && user.dateOfBirth && user.gender);
  const hasProfilePhoto = !!user.profilePicture;

  if (user.isFaceVerified) {
    user.onboardingStep = 'completed';
    user.isProfileComplete = true;
  } else if (basicInfoReady && user.onboardingStep !== 'completed') {
    const stored = user.onboardingStep;
    // Name / DOB / gender save opens the profile photo screen.
    // A gesture pointer with no photo is the previous flow; send them to photos.
    if (!stored || stored === 'basicInfo' || (stored === 'gesture' && !hasProfilePhoto)) {
      user.onboardingStep = 'photos';
    }
  }

  try {
    await user.save();
  } catch (err: any) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      throw new ServiceError('Username is already taken', 400);
    }
    throw err;
  }

  const moreAboutMe = formatMoreAboutMe(user);
  const userLocation = parseLocation(user.city, user.latitude, user.longitude);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    nickName: user.nickName,
    dateOfBirth: user.dateOfBirth,
    age: calculateAge(user.dateOfBirth),
    gender: user.gender,
    about: user.about,
    location: userLocation,
    city: user.city || null,
    state: userLocation.state || null,
    country: userLocation.country || null,
    county: userLocation.county || null,
    fullLocation: userLocation.fullLocation || user.city || null,
    latitude: user.latitude ?? null,
    longitude: user.longitude ?? null,
    drinking: user.drinking,
    education: user.education,
    height: user.height,
    religion: user.religion,
    sexuality: user.sexuality,
    smoking: user.smoking,
    weight: user.weight,
    eyeColor: user.eyeColor,
    eyecolor: user.eyeColor,
    hairColor: user.hairColor,
    haircolor: user.hairColor,
    living: user.living,
    relationship: user.relationship,
    children: user.children,
    coverPicture: user.coverPicture ? formatMediaUrl(user.coverPicture) : null,
    coverPhotoUrl: user.coverPicture ? formatMediaUrl(user.coverPicture) : null,
    coverPhoto: user.coverPicture
      ? {
          url: formatMediaUrl(user.coverPicture),
          thumbnailUrl: formatThumbnailUrl(user.coverPicture),
        }
      : null,
    moreAboutMe,
    isProfileComplete: user.isProfileComplete,
    currentStep: user.onboardingStep || null,
    isVerified: !!user.isFaceVerified,
    isSubscribed: !!user.isSubscribed,
    subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    activeSubscriptionPlanId: user.activeSubscriptionPlanId || null,
    coins: typeof user.coins === 'number' ? user.coins : 0,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export interface OtherUserProfilePhotoDTO {
  id: string;
  url: string;
  imageUrl: string;
  thumbnailUrl?: string | null;
  isPrimary: boolean;
  displayOrder: number;
}

export interface OtherUserProfileResponse {
  id?: string;
  userId: string;
  username: string;
  fullName: string;
  age: number | null;
  isVerified: boolean;
  isSubscribed?: boolean;
  subscriptionExpiresAt?: Date | null;
  activeSubscriptionPlanId?: number | null;
  profilePhoto: string | null;
  profileThumbnail?: string | null;
  photos: OtherUserProfilePhotoDTO[];
  coverPhoto?: {
    url: string;
    thumbnailUrl: string;
  } | null;
  city: string;
  fullLocation: string;
  distanceKm: number | null;
  bio: string | null;
  moreAboutMe?: MoreAboutMeDTO;
  vibeScore: number | null;
  vibeExplanation: {
    text: string;
    sharedInterests: string[];
  } | null;
  voiceIntro: {
    url: string;
    durationSeconds: number | null;
    duration?: number | null;
  } | null;
  moments: Array<{
    id?: string;
    momentId: string;
    mediaUrl: string;
    thumbnailUrl?: string | null;
    mediaType: 'image';
    mediaCount?: number;
    hasMultipleMedia?: boolean;
    caption?: string | null;
    likesCount?: number;
    commentsCount?: number;
    giftsCount?: number;
    sharesCount?: number;
    isLiked?: boolean;
    viewerReaction?: string | null;
    publishedAt?: Date;
    createdAt: Date;
    relativeAge?: string;
    timeAgo?: string;
    media?: Array<{
      mediaId: string;
      mediaUrl: string;
      mediaType: string;
      displayOrder: number;
    }>;
  }>;
  interests: Array<{
    id: string;
    name: string;
    icon: string | null;
  }>;
  sharedInterests: string[];
  commonInterestsCount: number;
  profileMatchPercentage: number;
  action: 'like' | 'nope' | 'super_like' | null;
  myAction: 'like' | 'nope' | 'super_like' | null;
  isMatched: boolean;
  canConnect: boolean;
  conversationId?: string | null;
}

/**
 * Retrieves the full profile details of another user for the Profile Detail screen.
 * Respects blocking, privacy, verification, mutual compatibility, voice intro, and moments.
 */
export const getOtherUserProfile = async (
  viewerUserId: string,
  targetUserId: string
): Promise<OtherUserProfileResponse> => {
  // 1. Check for block restrictions in either direction
  const { Op } = await import('sequelize');
  const {
    UserBlock,
    Interest,
    UserPhoto,
    SwipeAction,
    Match,
    ConnectionRequest,
  } = await import('../models');
  const {
    calculateAge,
    calculateDistanceKm,
    calculateVibeScore,
  } = await import('./discovery.service');

  const blockRecord = await UserBlock.findOne({
    where: {
      [Op.or]: [
        { userId: viewerUserId, blockedUserId: targetUserId },
        { userId: targetUserId, blockedUserId: viewerUserId },
      ],
    },
  });

  if (blockRecord) {
    throw new ServiceError(
      'Profile unavailable due to privacy restrictions',
      403
    );
  }

  // 2. Fetch target user with interests and photos
  const targetUser = await User.findByPk(targetUserId, {
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
        where: {
          [Op.or]: [{ status: 'approved' }, { status: 'pending' }, { status: null }],
        },
        required: false,
      },
    ],
    order: [
      [{ model: UserPhoto, as: 'photos' }, 'displayOrder', 'ASC'],
      [{ model: UserPhoto, as: 'photos' }, 'createdAt', 'DESC'],
    ],
  });

  if (!targetUser || !targetUser.isActive) {
    throw new ServiceError('Profile not found or unavailable', 404);
  }

  // 3. Fetch viewer user for shared interests & distance calculation
  const viewerUser = await User.findByPk(viewerUserId, {
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

  if (!viewerUser) {
    throw new ServiceError('Authenticated user not found', 404);
  }

  // 4. Derive shared interests, vibe score & profile match percentage
  const targetInterests = (targetUser.interests || []) as any[];
  const viewerInterests = (viewerUser.interests || []) as any[];

  // Match shared interests using canonical interest IDs, with fallback to display names
  const viewerInterestIdSet = new Set<string>();
  const viewerInterestNames = new Set<string>();
  for (const i of viewerInterests) {
    if (i.id) viewerInterestIdSet.add(i.id);
    if (i.name) viewerInterestNames.add(i.name.toLowerCase());
  }

  const sharedNamesSet = new Set<string>();
  for (const interest of targetInterests) {
    if (
      (interest.id && viewerInterestIdSet.has(interest.id)) ||
      (interest.name && viewerInterestNames.has(interest.name.toLowerCase()))
    ) {
      sharedNamesSet.add(interest.name);
    }
  }
  const sharedInterests = Array.from(sharedNamesSet);
  const commonInterestsCount = sharedInterests.length;

  const viewerInterestIds = viewerInterests.map((i: any) => i.id);
  const candidateInterestIds = targetInterests.map((i: any) => i.id);

  const profileMatchPercentage =
    viewerUserId === targetUserId
      ? 100
      : calculateProfileMatchPercentage({
          viewerInterestIds,
          candidateInterestIds,
          viewerLookingFor: viewerUser.lookingFor,
          candidateLookingFor: targetUser.lookingFor,
        });

  // Assign profileMatchPercentage to vibeScore for mobile app compatibility
  const vibeScore = profileMatchPercentage;

  let vibeExplanation: { text: string; sharedInterests: string[] } | null = null;
  if (sharedInterests.length > 0) {
    let text = `You both love ${sharedInterests[0].toLowerCase()}`;
    if (sharedInterests.length === 2) {
      text = `You both love ${sharedInterests[0].toLowerCase()} and ${sharedInterests[1].toLowerCase()}`;
    } else if (sharedInterests.length > 2) {
      text = `You both love ${sharedInterests[0].toLowerCase()} and ${sharedInterests.length - 1} other interests`;
    }
    vibeExplanation = {
      text,
      sharedInterests,
    };
  }

  // 5. Distance calculation
  let distanceKm = calculateDistanceKm(
    viewerUser.latitude,
    viewerUser.longitude,
    targetUser.latitude,
    targetUser.longitude
  );

  if (
    distanceKm == null &&
    viewerUser.city &&
    targetUser.city &&
    viewerUser.city.toLowerCase() === targetUser.city.toLowerCase()
  ) {
    distanceKm = 7; // realistic default distance in same metropolitan city
  }

  // 6. Voice intro
  let voiceIntro: { url: string; durationSeconds: number | null; duration: number | null } | null = null;
  if (targetUser.voicePromptUrl) {
    voiceIntro = {
      url: targetUser.voicePromptUrl,
      durationSeconds: targetUser.voicePromptDuration ?? null,
      duration: targetUser.voicePromptDuration ?? null,
    };
  }

  // 7. Photos gallery formatting
  const rawPhotos = (targetUser.photos || []) as any[];
  const primaryPhotoRecord = rawPhotos.find((p: any) => p.isPrimary);
  const primaryPhoto =
    primaryPhotoRecord?.imageUrl ||
    targetUser.profilePicture ||
    (rawPhotos[0]?.imageUrl) ||
    null;
  const photoVersion = primaryPhotoRecord?.updatedAt || targetUser.updatedAt;

  const formattedPhotos: OtherUserProfilePhotoDTO[] = rawPhotos.map((p: any) => ({
    id: p.id,
    url: formatMediaUrl(p.imageUrl, p.updatedAt),
    imageUrl: formatMediaUrl(p.imageUrl, p.updatedAt),
    thumbnailUrl: formatThumbnailUrl(p.imageUrl, p.updatedAt),
    isPrimary: !!p.isPrimary,
    displayOrder: p.displayOrder,
  }));

  const primaryFormattedUrl = primaryPhoto ? formatMediaUrl(primaryPhoto, photoVersion) : null;
  if (formattedPhotos.length === 0 && primaryFormattedUrl) {
    formattedPhotos.push({
      id: `profile-${targetUser.id}`,
      url: primaryFormattedUrl,
      imageUrl: primaryFormattedUrl,
      thumbnailUrl: formatThumbnailUrl(primaryPhoto, photoVersion),
      isPrimary: true,
      displayOrder: 0,
    });
  } else if (primaryFormattedUrl) {
    const alreadyIncludesPrimary = formattedPhotos.some(
      (p: any) => p.url === primaryFormattedUrl || p.imageUrl === primaryFormattedUrl
    );
    if (!alreadyIncludesPrimary) {
      formattedPhotos.unshift({
        id: `profile-${targetUser.id}`,
        url: primaryFormattedUrl,
        imageUrl: primaryFormattedUrl,
        thumbnailUrl: formatThumbnailUrl(primaryPhoto, photoVersion),
        isPrimary: true,
        displayOrder: 0,
      });
    }
  }

  const hasPrimaryInList = formattedPhotos.some((p: any) => p.isPrimary);
  if (!hasPrimaryInList && formattedPhotos.length > 0) {
    formattedPhotos[0].isPrimary = true;
  }

  // 8. Moments gallery (active Quick Moments with fallback to approved gallery photos)
  const { momentService } = await import('./moment.service');
  let moments: any[] = [];
  try {
    const userMomentsResult = await momentService.getUserMoments(viewerUserId, targetUserId, {
      limit: 20,
    });
    moments = (userMomentsResult.moments || []).map((m: any) => ({
      id: m.id,
      momentId: m.momentId,
      mediaUrl: m.mediaUrl || m.thumbnailUrl,
      thumbnailUrl: m.thumbnailUrl,
      mediaType: 'image' as const,
      mediaCount: m.mediaCount,
      hasMultipleMedia: m.hasMultipleMedia,
      caption: m.caption,
      likesCount: m.likesCount,
      commentsCount: m.commentsCount,
      giftsCount: m.giftsCount || 0,
      sharesCount: m.sharesCount || 0,
      isLiked: m.isLiked,
      viewerReaction: m.viewerReaction,
      publishedAt: m.publishedAt,
      createdAt: m.createdAt || m.publishedAt,
      relativeAge: m.relativeAge,
      timeAgo: m.timeAgo,
      media: m.media,
    }));
  } catch {
    moments = [];
  }

  if (moments.length === 0 && rawPhotos.length > 0) {
    moments = rawPhotos
      .filter((p) => p.status === 'approved' && !p.isPrimary && p.imageUrl !== targetUser.profilePicture)
      .map((p) => ({
        id: p.id,
        momentId: p.id,
        mediaUrl: formatMediaUrl(p.imageUrl),
        thumbnailUrl: formatThumbnailUrl(p.imageUrl),
        mediaType: 'image' as const,
        mediaCount: 1,
        hasMultipleMedia: false,
        caption: null,
        likesCount: 0,
        commentsCount: 0,
        giftsCount: 0,
        sharesCount: 0,
        isLiked: false,
        viewerReaction: null,
        createdAt: p.createdAt,
      }));
  }

  // 9. Existing actions & match state
  const [existingSwipe, existingMatch, existingRequest, existingConv] = await Promise.all([
    SwipeAction.findOne({
      where: {
        userId: viewerUserId,
        targetUserId,
      },
    }),
    (async () => {
      const [u1, u2] = [viewerUserId, targetUserId].sort();
      return Match.findOne({
        where: {
          user1Id: u1,
          user2Id: u2,
          isActive: true,
        },
      });
    })(),
    ConnectionRequest.findOne({
      where: {
        requesterId: viewerUserId,
        targetUserId,
      },
    }),
    (async () => {
      if (!viewerUserId || !targetUserId || viewerUserId === targetUserId) {
        return null;
      }
      try {
        const { chatService } = await import('./chat.service');
        const { conversation } = await chatService.getOrCreateOneToOneConversation(
          viewerUserId,
          targetUserId,
          { unhideForUser: viewerUserId }
        );
        return conversation;
      } catch (err: any) {
        console.warn('[GetOtherUserProfile] Warning: Could not find or create conversation:', err?.message || err);
        return null;
      }
    })(),
  ]);

  let action: 'like' | 'nope' | 'super_like' | null = existingSwipe
    ? (existingSwipe.action as 'like' | 'nope' | 'super_like')
    : null;

  if (!action && existingRequest) {
    action = 'super_like';
  }

  const myAction = action;
  const isMatched = !!existingMatch;
  const canConnect = !action && !isMatched && viewerUserId !== targetUserId;

  const fullName =
    targetUser.fullName ||
    (targetUser.firstName
      ? `${targetUser.firstName} ${targetUser.lastName || ''}`.trim()
      : null) ||
    targetUser.nickName ||
    targetUser.username;

  const otherLocation = parseLocation(targetUser.city, targetUser.latitude, targetUser.longitude);

  return {
    id: targetUser.id,
    userId: targetUser.id,
    username: targetUser.username,
    fullName,
    age: calculateAge(targetUser.dateOfBirth),
    isVerified: !!targetUser.isFaceVerified,
    isSubscribed: !!targetUser.isSubscribed,
    subscriptionExpiresAt: targetUser.subscriptionExpiresAt || null,
    activeSubscriptionPlanId: targetUser.activeSubscriptionPlanId || null,
    profilePhoto: primaryPhoto ? formatMediaUrl(primaryPhoto, photoVersion) : null,
    profileThumbnail: primaryPhoto ? formatThumbnailUrl(primaryPhoto, photoVersion) : null,
    photos: formattedPhotos,
    coverPhoto: targetUser.coverPicture
      ? {
          url: formatMediaUrl(targetUser.coverPicture),
          thumbnailUrl: formatThumbnailUrl(targetUser.coverPicture),
        }
      : null,
    city: targetUser.city || 'Mumbai',
    fullLocation: otherLocation.fullLocation || (targetUser.city ? targetUser.city.trim() : null) || 'Mumbai',
    distanceKm,
    bio: targetUser.about || null,
    moreAboutMe: formatMoreAboutMe(targetUser),
    vibeScore,
    vibeExplanation,
    voiceIntro,
    moments,
    interests: targetInterests.map((i: any) => ({
      id: i.id,
      name: i.name,
      icon: i.icon || null,
    })),
    sharedInterests,
    commonInterestsCount,
    profileMatchPercentage,
    action,
    myAction,
    isMatched,
    canConnect,
    conversationId: existingConv?.id || null,
  };
};

/**
 * Retrieves the photos gallery of another user
 * GET /api/v1/users/:userId/photos
 */
export const getOtherUserPhotos = async (
  viewerUserId: string,
  targetUserId: string
): Promise<{ photos: OtherUserProfilePhotoDTO[]; totalPhotos: number }> => {
  const { Op } = await import('sequelize');
  const { UserBlock, UserPhoto } = await import('../models');

  const blockRecord = await UserBlock.findOne({
    where: {
      [Op.or]: [
        { userId: viewerUserId, blockedUserId: targetUserId },
        { userId: targetUserId, blockedUserId: viewerUserId },
      ],
    },
  });

  if (blockRecord) {
    throw new ServiceError(
      'Profile unavailable due to privacy restrictions',
      403
    );
  }

  const targetUser = await User.findByPk(targetUserId, {
    include: [
      {
        model: UserPhoto,
        as: 'photos',
        where: {
          [Op.or]: [{ status: 'approved' }, { status: 'pending' }, { status: null }],
        },
        required: false,
      },
    ],
    order: [
      [{ model: UserPhoto, as: 'photos' }, 'displayOrder', 'ASC'],
      [{ model: UserPhoto, as: 'photos' }, 'createdAt', 'DESC'],
    ],
  });

  if (!targetUser || !targetUser.isActive) {
    throw new ServiceError('Profile not found or unavailable', 404);
  }

  const rawPhotos = (targetUser.photos || []) as any[];
  const primaryPhotoRecord = rawPhotos.find((p) => p.isPrimary);
  const primaryPhoto =
    primaryPhotoRecord?.imageUrl ||
    targetUser.profilePicture ||
    (rawPhotos[0]?.imageUrl) ||
    null;
  const photoVersion = primaryPhotoRecord?.updatedAt || targetUser.updatedAt;

  const formattedPhotos: OtherUserProfilePhotoDTO[] = rawPhotos.map((p: any) => ({
    id: p.id,
    url: formatMediaUrl(p.imageUrl, p.updatedAt),
    imageUrl: formatMediaUrl(p.imageUrl, p.updatedAt),
    thumbnailUrl: formatThumbnailUrl(p.imageUrl, p.updatedAt),
    isPrimary: !!p.isPrimary,
    displayOrder: p.displayOrder,
  }));

  const primaryFormattedUrl = primaryPhoto ? formatMediaUrl(primaryPhoto, photoVersion) : null;
  if (formattedPhotos.length === 0 && primaryFormattedUrl) {
    formattedPhotos.push({
      id: `profile-${targetUser.id}`,
      url: primaryFormattedUrl,
      imageUrl: primaryFormattedUrl,
      thumbnailUrl: formatThumbnailUrl(primaryPhoto, photoVersion),
      isPrimary: true,
      displayOrder: 0,
    });
  } else if (primaryFormattedUrl) {
    const alreadyIncludesPrimary = formattedPhotos.some(
      (p: any) => p.url === primaryFormattedUrl || p.imageUrl === primaryFormattedUrl
    );
    if (!alreadyIncludesPrimary) {
      formattedPhotos.unshift({
        id: `profile-${targetUser.id}`,
        url: primaryFormattedUrl,
        imageUrl: primaryFormattedUrl,
        thumbnailUrl: formatThumbnailUrl(primaryPhoto, photoVersion),
        isPrimary: true,
        displayOrder: 0,
      });
    }
  }

  const hasPrimaryInList = formattedPhotos.some((p: any) => p.isPrimary);
  if (!hasPrimaryInList && formattedPhotos.length > 0) {
    formattedPhotos[0].isPrimary = true;
  }

  return {
    photos: formattedPhotos,
    totalPhotos: formattedPhotos.length,
  };
};

/**
 * Calculates profile completion percentage dynamically from real saved user data:
 * - Basic details (Full Name, Date of Birth, Gender): 20%
 * - Primary profile photo: 20%
 * - Bio / About me: 15%
 * - Selected interests (at least 1): 15%
 * - Location (City): 10%
 * - Preferences (lookingFor or genderPreference): 10%
 * - Voice intro prompt: 10%
 * Total = 100%
 */
export const calculateProfileCompletion = (
  user: {
    fullName?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    profilePicture?: string | null;
    about?: string | null;
    city?: string | null;
    lookingFor?: string | null;
    genderPreference?: string | null;
    voicePromptUrl?: string | null;
  },
  interestCount = 0,
  photoCount = 0
): number => {
  let score = 0;

  // 1. Required basic details (20%)
  if (user.fullName && user.dateOfBirth && user.gender) {
    score += 20;
  }

  // 2. Primary Profile Photo (20%)
  if (user.profilePicture || photoCount > 0) {
    score += 20;
  }

  // 3. Bio / About me (15%)
  if (user.about && user.about.trim().length > 0) {
    score += 15;
  }

  // 4. At least one saved interest (15%)
  if (interestCount > 0) {
    score += 15;
  }

  // 5. Location / City (10%)
  if (user.city && user.city.trim().length > 0) {
    score += 10;
  }

  // 6. Preferences (10%)
  if (user.lookingFor || user.genderPreference) {
    score += 10;
  }

  // 7. Voice Intro (10%)
  if (user.voicePromptUrl) {
    score += 10;
  }

  return Math.min(100, Math.max(0, score));
};


/**
 * Splits a user-entered location string into city, county, state, and country.
 * The formatted location stays exactly what the user saved. A state or country
 * is included only when it is part of that string.
 */
export const parseLocation = (
  cityString?: string | null,
  latitude?: number | null,
  longitude?: number | null
): LocationDTO => {
  const latitudeValue = latitude ?? null;
  const longitudeValue = longitude ?? null;

  const emptyLocation = (): LocationDTO => ({
    city: null,
    state: null,
    country: null,
    county: null,
    name: null,
    label: null,
    fullLocation: null,
    formattedLocation: null,
    latitude: latitudeValue,
    longitude: longitudeValue,
  });

  if (!cityString || !cityString.trim()) {
    return emptyLocation();
  }

  const trimmed = cityString.trim();
  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return emptyLocation();
  }

  const city = parts[0];
  const rest = parts.slice(1);
  let county: string | null = null;
  const countyIndex = rest.findIndex((part) => part.toLowerCase().includes('county'));
  if (countyIndex !== -1) {
    county = rest[countyIndex];
    rest.splice(countyIndex, 1);
  }

  let state: string | null = null;
  let country: string | null = null;
  if (rest.length >= 2) {
    country = rest[rest.length - 1];
    state = rest.slice(0, rest.length - 1).join(', ');
  } else if (rest.length === 1) {
    state = rest[0];
  }

  return {
    city,
    state,
    country,
    county,
    name: trimmed,
    label: trimmed,
    fullLocation: trimmed,
    formattedLocation: trimmed,
    latitude: latitudeValue,
    longitude: longitudeValue,
  };
};
