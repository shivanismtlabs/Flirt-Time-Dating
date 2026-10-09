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

