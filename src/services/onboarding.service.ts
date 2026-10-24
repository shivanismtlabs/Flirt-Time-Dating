import { Op } from 'sequelize';
import { sequelize, User, Interest, UserInterest, UserPhoto } from '../models';
import {
  s3Service,
  formatMediaUrl,
  formatThumbnailUrl,
  extractS3Key,
} from './s3.service';
import { extractAudioDuration } from '../utils/audioDuration';
import {
  isOnboardingStep,
  nextOnboardingStep,
  OnboardingStep,
  OnboardingStepName,
  resolveCurrentStep,
  stepRank,
} from '../utils/onboardingStep';

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
  public static readonly MIN_PHOTOS_COUNT = 3;
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
    await this.moveToNextStep(user, 'preferences');
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
    await this.moveToNextStep(user, 'genderPreference');
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
    await this.moveToNextStep(user, 'religion');
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
    const user = await this.getUserOrThrow(userId);

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

    await this.moveToNextStep(user, 'interests');

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
      photos: photos.map((p) => ({
        ...p.toJSON(),
        imageUrl: formatMediaUrl(p.imageUrl),
        thumbnailUrl: formatThumbnailUrl(p.imageUrl),
      })),
    };
  }

  public async savePhotos(
    userId: string,
    input: {
      files?: Array<{ buffer: Buffer; mimetype?: string; originalname?: string; size?: number }>;
      preUploadedKeys?: string[];
      primaryIndex?: number;
    }
  ) {
    const user = await this.getUserOrThrow(userId);

    const files = input.files || [];
    const rawKeys = input.preUploadedKeys || [];

    // Filter valid non-empty pre-uploaded keys / strings
    const validKeys = rawKeys
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter(Boolean);

    const totalCount = files.length + validKeys.length;

    if (totalCount < 1) {
      throw new OnboardingServiceError(
        'No photos provided. Please upload at least one photo.',
        400,
        'PHOTOS_REQUIRED'
      );
    }

    // 1. Validate file buffers
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.buffer || file.buffer.length === 0) {
        throw new OnboardingServiceError(
          `Image ${i + 1} is empty or missing data`,
          400,
          'MISSING_FILE'
        );
      }
      const sig = OnboardingService.validateImageSignature(file.buffer);
      if (!sig.isValid) {
        throw new OnboardingServiceError(
          `Image ${i + 1} content is corrupted or in an unsupported format (JPEG, PNG, WebP).`,
          400,
          'INVALID_IMAGE_CONTENT'
        );
      }
    }

    // 2. Fetch user's current photos to recognize any existing retained photos
    const existingPhotos = await UserPhoto.findAll({
      where: { userId },
      order: [['displayOrder', 'ASC']],
    });
    const existingPhotoMap = new Map<string, UserPhoto>();
    for (const ep of existingPhotos) {
      existingPhotoMap.set(ep.id, ep);
      existingPhotoMap.set(ep.imageUrl, ep);
      const cleanEpKey = extractS3Key(ep.imageUrl);
      if (cleanEpKey) {
        existingPhotoMap.set(cleanEpKey, ep);
      }
    }

    // 3. Validate and verify pre-uploaded keys
    for (const keyOrId of validKeys) {
      if (existingPhotoMap.has(keyOrId)) {
        continue;
      }
      const cleanKey = extractS3Key(keyOrId);
      if (existingPhotoMap.has(cleanKey)) {
        continue;
      }

      if (!cleanKey.startsWith(`${userId}/`) && !cleanKey.includes(`/${userId}/`)) {
        throw new OnboardingServiceError(
          'You are not authorized to use this image key',
          403,
          'UNAUTHORIZED_IMAGE_KEY'
        );
      }

      const existsMeta = await s3Service.checkObjectExists(cleanKey);
      if (!existsMeta.exists) {
        throw new OnboardingServiceError(
          'Uploaded image not found in storage',
          400,
          'S3_OBJECT_NOT_FOUND'
        );
      }
    }

    // 4. Upload any new files to S3
    const newlyUploadedKeys: string[] = [];
    const orderedImageKeys: string[] = [];

    try {
      for (const keyOrId of validKeys) {
        const existing = existingPhotoMap.get(keyOrId) || existingPhotoMap.get(extractS3Key(keyOrId));
        if (existing) {
          orderedImageKeys.push(existing.imageUrl);
        } else {
          orderedImageKeys.push(extractS3Key(keyOrId));
        }
      }

      for (const file of files) {
        const s3Key = await s3Service.uploadMedia(
          file.buffer,
          userId,
          file.mimetype || 'image/jpeg',
          'photos'
        );
        newlyUploadedKeys.push(s3Key);
        orderedImageKeys.push(s3Key);
      }

      // 5. Database transaction to update UserPhoto records
      const retainedKeys = new Set(orderedImageKeys);
      const obsoletePhotos = existingPhotos.filter(
        (ep) => !retainedKeys.has(ep.imageUrl) && !retainedKeys.has(extractS3Key(ep.imageUrl))
      );

      const savedPhotos = await sequelize.transaction(async (transaction) => {
        // Delete obsolete photos from db
        if (obsoletePhotos.length > 0) {
          await UserPhoto.destroy({
            where: {
              id: obsoletePhotos.map((p) => p.id),
              userId,
            },
            transaction,
          });
        }

        // Remove and recreate all current photos in the submitted order
        await UserPhoto.destroy({
          where: { userId },
          transaction,
        });

        const createdList: UserPhoto[] = [];
        for (let i = 0; i < orderedImageKeys.length; i++) {
          const key = orderedImageKeys[i];
          const isPrimary =
            (input.primaryIndex !== undefined && input.primaryIndex === i) ||
            (input.primaryIndex === undefined && i === 0);

          const created = await UserPhoto.create(
            {
              userId,
              imageUrl: key,
              isPrimary,
              displayOrder: i,
              status: 'approved',
            },
            { transaction }
          );
          createdList.push(created);
        }

        // Update user.profilePicture to primary photo
        const primaryPhoto = createdList.find((p) => p.isPrimary) || createdList[0];
        user.profilePicture = primaryPhoto ? primaryPhoto.imageUrl : null;
        await user.save({ transaction });

        return createdList;
      });

      // 6. Asynchronously clean up old deleted S3 assets
      for (const oldPhoto of obsoletePhotos) {
        s3Service.deleteObject(oldPhoto.imageUrl).catch((err) => {
          console.error(`[S3 Cleanup Error] Failed to delete obsolete photo ${oldPhoto.imageUrl}:`, err.message);
        });
      }

      const formatted = savedPhotos.map((p) => ({
        id: p.id,
        imageUrl: formatMediaUrl(p.imageUrl),
        thumbnailUrl: formatThumbnailUrl(p.imageUrl),
        isPrimary: p.isPrimary,
        displayOrder: p.displayOrder,
        status: p.status,
      }));

      if (savedPhotos.length >= OnboardingService.MIN_PHOTOS_COUNT) {
        await this.moveToNextStep(user, 'photos');
      } else if (stepRank(user.onboardingStep) < stepRank('photos')) {
        user.onboardingStep = 'photos';
        await user.save();
      }

      return {
        photos: formatted,
        photo: formatted[0],
        totalPhotos: formatted.length,
      };
    } catch (err) {
      for (const newKey of newlyUploadedKeys) {
        await s3Service.deleteObject(newKey).catch(() => {});
      }
      throw err;
    }
  }

  public async addPhoto(
    userId: string,
    buffer?: Buffer,
    mimeType?: string,
    preUploadedKey?: string
  ) {
    const files = buffer && buffer.length > 0 ? [{ buffer, mimetype: mimeType }] : [];
    const preUploadedKeys = preUploadedKey ? [preUploadedKey] : [];
    return this.savePhotos(userId, { files, preUploadedKeys });
  }

  /**
   * Validates file signature (magic bytes) to ensure file content is a valid JPEG, PNG, or WebP image
   */
  public static validateImageSignature(buffer: Buffer): { isValid: boolean; format?: string } {
    if (!buffer || buffer.length < 12) {
      return { isValid: false };
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { isValid: true, format: 'jpeg' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { isValid: true, format: 'png' };
    }

    // WebP: RIFF .... WEBP
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return { isValid: true, format: 'webp' };
    }

    return { isValid: false };
  }

  /**
   * Dedicated profile photo upload handler:
   * Validates image content via magic bytes, stores to S3, updates User.profilePicture,
   * demotes any previous primary photo, and saves as UserPhoto (isPrimary: true).
   * Safely cleans up orphaned S3 object if database persistence fails.
   */
  public async uploadProfilePhoto(
    userId: string,
    buffer?: Buffer,
    mimeType?: string,
    preUploadedKey?: string
  ) {
    const user = await this.getUserOrThrow(userId);

    let s3Key: string;
    let isDirectUpload = false;

    if (buffer && buffer.length > 0) {
      // Validate image format using magic bytes
      const signature = OnboardingService.validateImageSignature(buffer);
      if (!signature.isValid) {
        throw new OnboardingServiceError(
          'Invalid or corrupted image content. File signature does not match supported image format (JPEG, PNG, WebP).',
          400,
          'INVALID_IMAGE_CONTENT'
        );
      }
      s3Key = await s3Service.uploadMedia(
        buffer,
        userId,
        mimeType || 'image/jpeg',
        'photos'
      );
      isDirectUpload = true;
    } else if (preUploadedKey) {
      const cleanKey = extractS3Key(preUploadedKey);
      if (!cleanKey.startsWith(`${userId}/`) && !cleanKey.includes(`/${userId}/`)) {
        throw new OnboardingServiceError(
          'You are not authorized to use this image key',
          403,
          'UNAUTHORIZED_IMAGE_KEY'
        );
      }
      const existsMeta = await s3Service.checkObjectExists(cleanKey);
      if (!existsMeta.exists) {
        throw new OnboardingServiceError(
          'Uploaded image not found in storage',
          400,
          'S3_OBJECT_NOT_FOUND'
        );
      }
      s3Key = cleanKey;
    } else {
      throw new OnboardingServiceError(
        'profilePhoto is required. Attach image in "profilePhoto" field or pass "imageKey"',
        400,
        'MISSING_FILE'
      );
    }

    try {
      const result = await sequelize.transaction(async (transaction) => {
        // Demote existing primary photo for this user
        await UserPhoto.update(
          { isPrimary: false },
          {
            where: { userId, isPrimary: true },
            transaction,
          }
        );

        // Create new primary photo record
        const photo = await UserPhoto.create(
          {
            userId,
            imageUrl: s3Key,
            isPrimary: true,
            displayOrder: 0,
            status: 'approved',
          },
          { transaction }
        );

        // Update user's main profilePicture column
        user.profilePicture = s3Key;
        if (stepRank(user.onboardingStep) < stepRank('photos')) {
          user.onboardingStep = 'photos';
        }
        await user.save({ transaction });

        return {
          photoId: photo.id,
          imageKey: photo.imageUrl,
          profilePhoto: photo.imageUrl,
          profileThumbnail: formatThumbnailUrl(photo.imageUrl),
          imageUrl: formatMediaUrl(photo.imageUrl),
          thumbnailUrl: formatThumbnailUrl(photo.imageUrl),
          isPrimary: photo.isPrimary,
        };
      });

      return result;
    } catch (dbError) {
      if (isDirectUpload) {
        await s3Service.deleteObject(s3Key);
      }
      throw dbError;
    }
  }

  public async deletePhoto(userId: string, photoId: string) {
    const user = await this.getUserOrThrow(userId);

    const currentCount = await UserPhoto.count({ where: { userId } });
    if (currentCount <= OnboardingService.MIN_PHOTOS_COUNT) {
      throw new OnboardingServiceError(
        `Minimum ${OnboardingService.MIN_PHOTOS_COUNT} profile photos required. You cannot delete this photo unless you have more than ${OnboardingService.MIN_PHOTOS_COUNT} photos.`,
        400,
        'MIN_PHOTOS_REQUIRED'
      );
    }

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

    // If duration was not provided in request or is non-positive, extract from audio buffer
    if (durationSeconds === undefined || durationSeconds <= 0) {
      const extracted = extractAudioDuration(buffer, mimeType);
      if (extracted !== null && extracted > 0) {
        durationSeconds = extracted;
      }
    }

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
    user.voicePromptDuration = (durationSeconds && durationSeconds > 0) ? durationSeconds : 30;
    await this.moveToNextStep(user, 'audio');

    return {
      voicePromptUrl: user.voicePromptUrl,
      durationSeconds: user.voicePromptDuration,
      duration: user.voicePromptDuration,
    };
  }

  public async getAudio(userId: string) {
    const user = await this.getUserOrThrow(userId);
    return {
      voicePromptUrl: user.voicePromptUrl || null,
      durationSeconds: user.voicePromptDuration || null,
      duration: user.voicePromptDuration || null,
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
      photos: photoCount >= OnboardingService.MIN_PHOTOS_COUNT,
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
      currentStep: resolveCurrentStep(user.onboardingStep, steps, isCompleted),
      steps,
    };
  }

  public async saveCurrentStep(userId: string, step: string) {
    if (!isOnboardingStep(step)) {
      throw new OnboardingServiceError('Invalid onboarding step', 400, 'INVALID_ONBOARDING_STEP');
    }

    const user = await this.getUserOrThrow(userId);
    user.onboardingStep = step;
    await user.save();

    return { currentStep: step as OnboardingStep };
  }

  /**
   * Moves the saved screen forward after a step is stored.
   * A later screen is left in place. A finished profile with no saved
   * screen is not pulled back into an earlier required step.
   */
  private async moveToNextStep(user: User, completedStep: OnboardingStepName) {
    const next = nextOnboardingStep(completedStep);
    if (stepRank(user.onboardingStep) < stepRank(next)) {
      if (!user.onboardingStep) {
        const [interestCount, photoCount] = await Promise.all([
          UserInterest.count({ where: { userId: user.id } }),
          UserPhoto.count({ where: { userId: user.id } }),
        ]);
        const requiredDone =
          !!(user.fullName && user.dateOfBirth && user.gender) &&
          !!user.lookingFor &&
          !!user.genderPreference &&
          interestCount >= 1 &&
          photoCount >= OnboardingService.MIN_PHOTOS_COUNT;
        if (!(requiredDone && stepRank(next) < stepRank('audio'))) {
          user.onboardingStep = next;
        }
      } else {
        user.onboardingStep = next;
      }
    }
    await user.save();
  }
}

export const onboardingService = new OnboardingService();
