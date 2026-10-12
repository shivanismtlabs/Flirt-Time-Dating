import { User } from '../models/user.model';

export interface UpdateProfileInput {
  fullName: string;
  nickName: string;
  dateOfBirth: string;
  gender: string;
  about?: string | null;
}

export class ServiceError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ServiceError.prototype);
  }
}

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
  if (user.dateOfBirth && user.dateOfBirth !== data.dateOfBirth) {
    throw new ServiceError('Date of birth cannot be changed once set', 400);
  }

  // 2. Enforce Gender Immutability
  const normalizedIncomingGender = data.gender.toLowerCase();
  if (user.gender && user.gender.toLowerCase() !== normalizedIncomingGender) {
    throw new ServiceError('Gender cannot be changed once set', 400);
  }

  // 3. Update profile fields
  user.fullName = data.fullName.trim();
  user.nickName = data.nickName.trim();

  if (!user.dateOfBirth) {
    user.dateOfBirth = data.dateOfBirth;
  }

  if (!user.gender) {
    user.gender = normalizedIncomingGender;
  }

  user.about = data.about ? data.about.trim() : null;
  user.isProfileComplete = true;

  await user.save();

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    fullName: user.fullName,
    nickName: user.nickName,
    dateOfBirth: user.dateOfBirth,
    gender: user.gender,
    about: user.about,
    isProfileComplete: user.isProfileComplete,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

export interface OtherUserProfileResponse {
  userId: string;
  name: string;
  age: number | null;
  isVerified: boolean;
  profilePhoto: string | null;
  city: string;
  distanceKm: number | null;
  bio: string | null;
  vibeScore: number | null;
  vibeExplanation: {
    text: string;
    sharedInterests: string[];
  } | null;
  voiceIntro: {
    url: string;
    durationSeconds: number | null;
  } | null;
  moments: Array<{
    momentId: string;
    mediaUrl: string;
    mediaType: 'image';
    createdAt: Date;
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
  let voiceIntro: { url: string; durationSeconds: number | null } | null = null;
  if (targetUser.voicePromptUrl) {
    voiceIntro = {
      url: targetUser.voicePromptUrl,
      durationSeconds: targetUser.voicePromptDuration ?? null,
    };
  }

  // 7. Moments gallery (active Quick Moments with fallback to approved gallery photos)
  const rawPhotos = (targetUser.photos || []) as any[];
  const primaryPhoto =
    targetUser.profilePicture ||
    rawPhotos.find((p) => p.isPrimary)?.imageUrl ||
    null;

  const { Moment: MomentModel, MomentMedia: MomentMediaModel } = await import('../models');
  const activeMoments = await MomentModel.findAll({
    where: {
      userId: targetUserId,
      status: 'active',
    },
    include: [{ model: MomentMediaModel, as: 'media' }],
    order: [
      ['publishedAt', 'DESC'],
      [{ model: MomentMediaModel, as: 'media' }, 'displayOrder', 'ASC'],
    ],
  });

  let moments: any[] = [];
  if (activeMoments.length > 0) {
    for (const m of activeMoments) {
      const firstMedia = (m.media || [])[0];
      if (firstMedia) {
        moments.push({
          momentId: m.id,
          mediaUrl: firstMedia.mediaUrl,
          mediaType: 'image' as const,
          createdAt: m.createdAt,
        });
      }
    }
  } else {
    moments = rawPhotos
      .filter((p) => !p.isPrimary && p.imageUrl !== targetUser.profilePicture)
      .map((p) => ({
        momentId: p.id,
        mediaUrl: p.imageUrl,
        mediaType: 'image' as const,
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
    name: displayName,
    age: calculateAge(targetUser.dateOfBirth),
    isVerified: !!targetUser.isFaceVerified,
    profilePhoto: primaryPhoto,
    city: targetUser.city || 'Mumbai',
    distanceKm,
    bio: targetUser.about || null,
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


