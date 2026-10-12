import { Op } from 'sequelize';
import { sequelize, User, Interest, UserInterest, UserPhoto } from '../models';
import { s3Service } from './s3.service';

export class OnboardingServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'OnboardingServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, OnboardingServiceError.prototype);
  }
}

export class OnboardingService {
  private static readonly MAX_PHOTOS_COUNT = 6;
  private static readonly MAX_AUDIO_DURATION_SECONDS = 60; // 60s max voice prompt

  /**
   * Helper to fetch authenticated user
   */
  private async getUserOrThrow(userId: string): Promise<User> {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new OnboardingServiceError('User account not found', 404, 'USER_NOT_FOUND');
    }
    return user;
  }

  // ==========================================
  // Screen 21: Dating Preferences (lookingFor)
  // ==========================================

  public async getPreferences(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      lookingFor: user.lookingFor || null,
    };
  }

  public async updatePreferences(userId: string, lookingFor: string) {
    const user = await this.getUserOrThrow(userId);
    user.lookingFor = lookingFor;
    await user.save();
    return {
      lookingFor: user.lookingFor,
    };
  }

  // ==========================================
  // Screen 22: Gender Preference
  // ==========================================

  public async getGenderPreference(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      genderPreference: user.genderPreference || null,
    };
  }

  public async updateGenderPreference(userId: string, genderPreference: string) {
    const user = await this.getUserOrThrow(userId);
    user.genderPreference = genderPreference;
    await user.save();
    return {
      genderPreference: user.genderPreference,
    };
  }

  // ==========================================
  // Screen 23: Religious Belief
  // ==========================================

  public async getReligion(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      religion: user.religion || null,
    };
  }

  public async updateReligion(userId: string, religion?: string | null) {
    const user = await this.getUserOrThrow(userId);
    user.religion = religion || null;
    await user.save();
    return {
      religion: user.religion,
    };
  }

  // ==========================================
  // Screen 24: Matching Interests
  // ==========================================

  public async getUserInterests(userId: string) {
    await this.getUserOrThrow(userId);
    const user = await User.findByPk(userId, {
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

    return {
      interests: user?.interests || [],
    };
  }

  public async updateUserInterests(userId: string, interestIds: string[]) {
    await this.getUserOrThrow(userId);

    // Remove duplicates
    const uniqueIds = Array.from(new Set(interestIds));

    // Validate that all interests exist and are active
    const existingInterests = await Interest.findAll({
      where: {
        id: { [Op.in]: uniqueIds },
        isActive: true,
      },
    });

    if (existingInterests.length !== uniqueIds.length) {
      throw new OnboardingServiceError(
        'One or more selected interests do not exist or are inactive',
        400,
        'INVALID_INTEREST_IDS'
      );
    }

    // Atomic replacement inside a transaction
    await sequelize.transaction(async (transaction) => {
      await UserInterest.destroy({
        where: { userId },
        transaction,
      });

      const recordsToCreate = uniqueIds.map((interestId) => ({
        userId,
        interestId,
      }));

      await UserInterest.bulkCreate(recordsToCreate, { transaction });
    });

    return {
      interests: existingInterests,
    };
  }

  // ==========================================
  // Screen 25: Profile Photos Gallery
  // ==========================================

  public async getUserPhotos(userId: string) {
    await this.getUserOrThrow(userId);
    const photos = await UserPhoto.findAll({
      where: { userId },
      order: [['displayOrder', 'ASC']],
    });
    return {
      photos,
    };
  }

  public async addPhoto(userId: string, buffer: Buffer, mimeType: string) {
    const user = await this.getUserOrThrow(userId);

    const existingCount = await UserPhoto.count({ where: { userId } });
    if (existingCount >= OnboardingService.MAX_PHOTOS_COUNT) {
      throw new OnboardingServiceError(
        `Maximum ${OnboardingService.MAX_PHOTOS_COUNT} profile photos allowed`,
        400,
        'MAX_PHOTOS_EXCEEDED'
      );
    }

    // Upload photo to S3
    const s3Key = await s3Service.uploadMedia(buffer, userId, mimeType, 'photos');

    const isFirstPhoto = existingCount === 0;

    const photo = await sequelize.transaction(async (transaction) => {
      const createdPhoto = await UserPhoto.create(
        {
          userId,
          imageUrl: s3Key,
          isPrimary: isFirstPhoto,
          displayOrder: existingCount,
          status: 'approved',
        },
        { transaction }
      );

      // If it's the first photo, also update user's main profilePicture
      if (isFirstPhoto && !user.profilePicture) {
        user.profilePicture = s3Key;
        await user.save({ transaction });
      }

      return createdPhoto;
    });

    return photo;
  }

  public async deletePhoto(userId: string, photoId: string) {
    const user = await this.getUserOrThrow(userId);

    const photo = await UserPhoto.findOne({
      where: { id: photoId, userId },
    });

    if (!photo) {
      throw new OnboardingServiceError('Photo not found or not owned by you', 404, 'PHOTO_NOT_FOUND');
    }

    const wasPrimary = photo.isPrimary;
    const deletedImageKey = photo.imageUrl;

    await sequelize.transaction(async (transaction) => {
      await photo.destroy({ transaction });

      // If primary was deleted, reassign primary to first remaining photo
      if (wasPrimary) {
        const nextPhoto = await UserPhoto.findOne({
          where: { userId },
          order: [['displayOrder', 'ASC']],
          transaction,
        });

        if (nextPhoto) {
          nextPhoto.isPrimary = true;
          await nextPhoto.save({ transaction });
          user.profilePicture = nextPhoto.imageUrl;
          await user.save({ transaction });
        } else {
          user.profilePicture = null;
          await user.save({ transaction });
        }
      }
    });

    // Cleanup S3 asset
    await s3Service.deleteObject(deletedImageKey);

    return { success: true, message: 'Photo deleted successfully' };
  }

  public async setPrimaryPhoto(userId: string, photoId: string) {
    const user = await this.getUserOrThrow(userId);

    const photo = await UserPhoto.findOne({
      where: { id: photoId, userId },
    });

    if (!photo) {
      throw new OnboardingServiceError('Photo not found or not owned by you', 404, 'PHOTO_NOT_FOUND');
    }

    await sequelize.transaction(async (transaction) => {
      // Unset all other photos as primary
      await UserPhoto.update(
        { isPrimary: false },
        { where: { userId, isPrimary: true }, transaction }
      );

      photo.isPrimary = true;
      await photo.save({ transaction });

      user.profilePicture = photo.imageUrl;
      await user.save({ transaction });
    });

    return photo;
  }

  // ==========================================
  // Audio Voice Prompt / Voice Bio
  // ==========================================

  public async uploadAudio(
    userId: string,
    buffer: Buffer,
    mimeType: string,
    durationSeconds?: number
  ) {
    const user = await this.getUserOrThrow(userId);

    if (durationSeconds !== undefined && durationSeconds > OnboardingService.MAX_AUDIO_DURATION_SECONDS) {
      throw new OnboardingServiceError(
        `Voice recording duration cannot exceed ${OnboardingService.MAX_AUDIO_DURATION_SECONDS} seconds`,
        400,
        'AUDIO_DURATION_LIMIT_EXCEEDED'
      );
    }

    // Clean up old audio if existing
    if (user.voicePromptUrl) {
      await s3Service.deleteObject(user.voicePromptUrl);
    }

    const s3Key = await s3Service.uploadMedia(buffer, userId, mimeType, 'voice_prompts');

    user.voicePromptUrl = s3Key;
    user.voicePromptDuration = durationSeconds || 30; // default 30s if not specified
    await user.save();

    return {
      voicePromptUrl: user.voicePromptUrl,
      durationSeconds: user.voicePromptDuration,
    };
  }

  public async getAudio(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      voicePromptUrl: user.voicePromptUrl || null,
      durationSeconds: user.voicePromptDuration || null,
    };
  }

  public async deleteAudio(userId: string) {
    const user = await this.getUserOrThrow(userId);

    if (user.voicePromptUrl) {
      await s3Service.deleteObject(user.voicePromptUrl);
      user.voicePromptUrl = null;
      user.voicePromptDuration = null;
      await user.save();
    }

    return { success: true, message: 'Voice prompt removed successfully' };
  }

  // ==========================================
  // Onboarding Progress & Completion
  // ==========================================

  public async getProgress(userId: string) {
    const user = await this.getUserOrThrow(userId);

    const [interestCount, photoCount] = await Promise.all([
      UserInterest.count({ where: { userId } }),
      UserPhoto.count({ where: { userId } }),
    ]);

    const steps = {
      basicInfo: !!(user.fullName && user.dateOfBirth && user.gender),
      preferences: !!user.lookingFor,
      genderPreference: !!user.genderPreference,
      religion: user.religion !== undefined, // Optional/can be skipped
      interests: interestCount >= 1,
      photos: photoCount >= 1 || !!user.profilePicture,
      audio: !!user.voicePromptUrl, // Optional
      faceVerification: !!user.isFaceVerified,
    };

    // Required steps for complete onboarding
    const requiredSteps = [
      steps.basicInfo,
      steps.preferences,
      steps.genderPreference,
      steps.interests,
      steps.photos,
    ];

    const completedRequired = requiredSteps.filter(Boolean).length;
    const completionPercentage = Math.round((completedRequired / requiredSteps.length) * 100);
    const isCompleted = completedRequired === requiredSteps.length;

    if (isCompleted && !user.isProfileComplete) {
      user.isProfileComplete = true;
      await user.save();
    }

    return {
      isCompleted,
      completionPercentage,
      steps,
    };
  }
}

export const onboardingService = new OnboardingService();
