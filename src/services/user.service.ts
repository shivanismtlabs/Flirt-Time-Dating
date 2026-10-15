import { User } from '../models/user.model';
import { formatMediaUrl, formatThumbnailUrl } from './s3.service';
import { calculateAge } from './discovery.service';

export interface LocationDTO {
  city: string | null;
  state: string | null;
  name?: string | null;
  label?: string | null;
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
  nickName?: string;
  dateOfBirth?: string;
  gender?: string;
  about?: string | null;
  location?:
    | string
    | {
        city?: string | null;
        state?: string | null;
        name?: string | null;
        label?: string | null;
        address?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      }
    | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  ];

  return {
    drinking,
    education,
    height,
    religion,
    sexuality,
    smoking,
    weight,
    eyeColor,
    eyecolor: eyeColor,
    hairColor,
    haircolor: hairColor,
    living,
    relationship,
    children,
    items,
  };
};

/**
 * Updates user profile details for the onboarding process.
 * Enforces business rules:
 * 1. User ID must exist.
 * 2. Date of Birth once set cannot be changed.
 * 3. Gender once set cannot be changed.
 * 4. Marks profile as complete upon successful update.
 */
export const updateUserProfile = async (
  userId: string,
  data: UpdateProfileInput
) => {
  const user = await User.findByPk(userId);

  if (!user) {
    throw new ServiceError('User not found', 404);
  }

  // 1. Enforce Date of Birth Immutability
  if (data.dateOfBirth && user.dateOfBirth && user.dateOfBirth !== data.dateOfBirth) {
    throw new ServiceError('Date of birth cannot be changed once set', 400);
  }

  // 2. Enforce Gender Immutability
  const normalizedIncomingGender = data.gender ? data.gender.toLowerCase() : null;
  if (normalizedIncomingGender && user.gender && user.gender.toLowerCase() !== normalizedIncomingGender) {
    throw new ServiceError('Gender cannot be changed once set', 400);
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
  if (data.nickName !== undefined) {
    user.nickName = data.nickName.trim();
  }

  if (data.dateOfBirth && !user.dateOfBirth) {
    user.dateOfBirth = data.dateOfBirth;
  }

  // Handle Location / City / Coordinates
  if (data.location !== undefined) {
    if (typeof data.location === 'string') {
      user.city = data.location.trim() || null;
    } else if (data.location && typeof data.location === 'object') {
      const loc = data.location;
      if (loc.name && loc.name.trim()) {
        user.city = loc.name.trim();
      } else if (loc.city && loc.city.trim()) {
        user.city = loc.state && loc.state.trim()
          ? `${loc.city.trim()}, ${loc.state.trim()}`
          : loc.city.trim();
      } else if (loc.label && loc.label.trim()) {
        user.city = loc.label.trim();
      } else if (loc.address && loc.address.trim()) {
        user.city = loc.address.trim();
      }
      if (loc.latitude !== undefined) {
        user.latitude = loc.latitude;
      }
      if (loc.longitude !== undefined) {
        user.longitude = loc.longitude;
      }
    } else if (data.location === null) {
      user.city = null;
    }
  }

  if (data.city !== undefined) {
    user.city = data.city ? data.city.trim() : null;
  }
  if (data.latitude !== undefined) {
    user.latitude = data.latitude;
  }
  if (data.longitude !== undefined) {
    user.longitude = data.longitude;
  }

  if (normalizedIncomingGender && !user.gender) {
    user.gender = normalizedIncomingGender;
  }

  if (data.about !== undefined) {
    user.about = data.about ? data.about.trim() : null;
  }

  // 4. Update More About Me fields (direct or from data.moreAboutMe)
  const moreSource = data.moreAboutMe || {};
  if (data.drinking !== undefined || moreSource.drinking !== undefined) {
    user.drinking = data.drinking !== undefined ? data.drinking : moreSource.drinking || null;
  }
  if (data.education !== undefined || moreSource.education !== undefined) {
    user.education = data.education !== undefined ? data.education : moreSource.education || null;
  }
  if (data.height !== undefined || moreSource.height !== undefined) {
    user.height = data.height !== undefined ? data.height : moreSource.height || null;
  }
  if (data.religion !== undefined || moreSource.religion !== undefined) {
    user.religion = data.religion !== undefined ? data.religion : moreSource.religion || null;
  }
  if (data.sexuality !== undefined || moreSource.sexuality !== undefined) {
    user.sexuality = data.sexuality !== undefined ? data.sexuality : moreSource.sexuality || null;
  }
  if (data.smoking !== undefined || moreSource.smoking !== undefined) {
    user.smoking = data.smoking !== undefined ? data.smoking : moreSource.smoking || null;
  }
  if (data.weight !== undefined || moreSource.weight !== undefined) {
    user.weight = data.weight !== undefined ? data.weight : moreSource.weight || null;
  }
  if (
    data.eyeColor !== undefined ||
    data.eyecolor !== undefined ||
    moreSource.eyeColor !== undefined ||
    moreSource.eyecolor !== undefined
  ) {
    user.eyeColor =
      data.eyeColor ?? data.eyecolor ?? moreSource.eyeColor ?? moreSource.eyecolor ?? null;
  }
  if (
    data.hairColor !== undefined ||
    data.haircolor !== undefined ||
    moreSource.hairColor !== undefined ||
    moreSource.haircolor !== undefined
  ) {
    user.hairColor =
      data.hairColor ?? data.haircolor ?? moreSource.hairColor ?? moreSource.haircolor ?? null;
  }
  if (data.living !== undefined || moreSource.living !== undefined) {
    user.living = data.living !== undefined ? data.living : moreSource.living || null;
  }
  if (data.relationship !== undefined || moreSource.relationship !== undefined) {
    user.relationship = data.relationship !== undefined ? data.relationship : moreSource.relationship || null;
  }
  if (data.children !== undefined || moreSource.children !== undefined) {
    user.children = data.children !== undefined ? data.children : moreSource.children || null;
  }
  if (data.coverPicture !== undefined || data.coverPhoto !== undefined) {
    user.coverPicture = data.coverPicture !== undefined ? (data.coverPicture ?? null) : (data.coverPhoto ?? null);
  }

  user.isProfileComplete = true;

  await user.save();

  const moreAboutMe = formatMoreAboutMe(user);

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
    location: parseLocation(user.city, user.latitude, user.longitude),
    city: user.city || null,
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
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export interface OtherUserProfileResponse {
  userId: string;
  username: string;
  name: string;
  age: number | null;
  isVerified: boolean;
  profilePhoto: string | null;
  profileThumbnail?: string | null;
  coverPhoto?: {
    url: string;
    thumbnailUrl: string;
  } | null;
  coverPicture?: string | null;
  coverPhotoUrl?: string | null;
  city: string;
  distanceKm: number | null;
  bio: string | null;
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
  myAction: 'like' | 'nope' | 'super_like' | null;
  isMatched: boolean;
  canConnect: boolean;
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
        where: { status: 'approved' },
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

  // 4. Derive shared interests & vibe score
  const targetInterests = (targetUser.interests || []) as any[];
  const viewerInterests = (viewerUser.interests || []) as any[];
  const viewerInterestNames = new Set(
    viewerInterests.map((i: any) => i.name.toLowerCase())
  );

  const sharedInterests = targetInterests
    .filter((i: any) => viewerInterestNames.has(i.name.toLowerCase()))
    .map((i: any) => i.name);

  const vibeScore = calculateVibeScore(
    sharedInterests.length,
    targetUser.isFaceVerified,
    targetUser.isProfileComplete
  );

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

  // 7. Moments gallery (active Quick Moments with fallback to approved gallery photos)
  const rawPhotos = (targetUser.photos || []) as any[];
  const primaryPhoto =
    targetUser.profilePicture ||
    rawPhotos.find((p) => p.isPrimary)?.imageUrl ||
    null;

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
      .filter((p) => !p.isPrimary && p.imageUrl !== targetUser.profilePicture)
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

  // 8. Existing actions & match state
  const [existingSwipe, existingMatch] = await Promise.all([
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
  ]);

  const myAction = existingSwipe ? (existingSwipe.action as 'like' | 'nope' | 'super_like') : null;
  const isMatched = !!existingMatch;
  const canConnect = !myAction && !isMatched && viewerUserId !== targetUserId;

  const displayName =
    targetUser.firstName ||
    (targetUser.fullName ? targetUser.fullName.split(' ')[0] : null) ||
    targetUser.nickName ||
    targetUser.username;

  return {
    userId: targetUser.id,
    username: targetUser.username,
    name: displayName,
    age: calculateAge(targetUser.dateOfBirth),
    isVerified: !!targetUser.isFaceVerified,
    profilePhoto: primaryPhoto ? formatMediaUrl(primaryPhoto) : null,
    profileThumbnail: primaryPhoto ? formatThumbnailUrl(primaryPhoto) : null,
    coverPhoto: targetUser.coverPicture
      ? {
          url: formatMediaUrl(targetUser.coverPicture),
          thumbnailUrl: formatThumbnailUrl(targetUser.coverPicture),
        }
      : null,
    coverPicture: targetUser.coverPicture ? formatMediaUrl(targetUser.coverPicture) : null,
    coverPhotoUrl: targetUser.coverPicture ? formatMediaUrl(targetUser.coverPicture) : null,
    city: targetUser.city || 'Mumbai',
    distanceKm,
    bio: targetUser.about || null,
    drinking: targetUser.drinking || null,
    education: targetUser.education || null,
    height: targetUser.height || null,
    religion: targetUser.religion || null,
    sexuality: targetUser.sexuality || null,
    smoking: targetUser.smoking || null,
    weight: targetUser.weight || null,
    eyeColor: targetUser.eyeColor || null,
    eyecolor: targetUser.eyeColor || null,
    hairColor: targetUser.hairColor || null,
    haircolor: targetUser.hairColor || null,
    living: targetUser.living || null,
    relationship: targetUser.relationship || null,
    children: targetUser.children || null,
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
    myAction,
    isMatched,
    canConnect,
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
 * Parses city string (e.g. "Indore, Madhya Pradesh" or "Indore") into structured city & state
 */
export const parseLocation = (
  cityString?: string | null,
  latitude?: number | null,
  longitude?: number | null
): LocationDTO => {
  if (!cityString || !cityString.trim()) {
    return {
      city: null,
      state: null,
      name: null,
      label: null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    };
  }
  const trimmed = cityString.trim();
  const parts = trimmed.split(',').map((p) => p.trim());
  const city = parts[0] || null;
  const state = parts.length >= 2 ? parts.slice(1).join(', ') : null;
  return {
    city,
    state,
    name: trimmed,
    label: trimmed,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
  };
};


