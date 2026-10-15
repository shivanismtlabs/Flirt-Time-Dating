import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { OnboardingService, onboardingService, OnboardingServiceError } from '../services/onboarding.service';
import { formatMediaUrl, formatThumbnailUrl } from '../services/s3.service';

const getUserIdOrThrow = (req: AuthenticatedRequest, res: Response): string | null => {
  const userId = req.user?.id;
  if (!userId) {
    sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    return null;
  }
  return userId;
};

// 1. Preferences (Screen 21)
export const getPreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getPreferences(userId);
    return sendSuccess(res, 'Preferences retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const updatePreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const { lookingFor } = req.body;
    const result = await onboardingService.updatePreferences(userId, lookingFor);
    return sendSuccess(res, 'Preferences saved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 2. Gender Preference (Screen 22)
export const getGenderPreference = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getGenderPreference(userId);
    return sendSuccess(res, 'Gender preference retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const updateGenderPreference = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const { genderPreference } = req.body;
    const result = await onboardingService.updateGenderPreference(userId, genderPreference);
    return sendSuccess(res, 'Gender preference saved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 3. Religion (Screen 23)
export const getReligion = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getReligion(userId);
    return sendSuccess(res, 'Religion retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const updateReligion = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const { religion } = req.body;
    const result = await onboardingService.updateReligion(userId, religion);
    return sendSuccess(res, 'Religion saved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 4. Interests (Screen 24)
export const getUserInterests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getUserInterests(userId);
    return sendSuccess(res, 'User interests retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const updateUserInterests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const rawList = req.body.interestIds || req.body.interests || [];
    const interestIds: string[] = rawList.map((item: any) =>
      typeof item === 'object' && item?.id ? String(item.id) : String(item)
    );
    const result = await onboardingService.updateUserInterests(userId, interestIds);
    return sendSuccess(res, 'User interests saved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 5. Photos Gallery (Screen 25)
export const getUserPhotos = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getUserPhotos(userId);
    return sendSuccess(res, 'Profile photos retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const uploadPhoto = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;

    // 1. Extract all uploaded files across supported fields
    const fileList: Express.Multer.File[] = [];
    if (req.files) {
      const filesObj = req.files as Record<string, Express.Multer.File[]>;
      for (const field of ['photos', 'images', 'photo', 'image', 'files']) {
        if (Array.isArray(filesObj[field])) {
          fileList.push(...filesObj[field]);
        }
      }
    }
    if (req.file) {
      fileList.push(req.file);
    }

    // 2. Extract pre-uploaded keys, image URLs or existing photo IDs from req.body
    const preUploadedKeys: string[] = [];
    const bodySource =
      req.body?.imageKeys ??
      req.body?.photos ??
      req.body?.images ??
      req.body?.imageUrls ??
      req.body?.keys;

    if (bodySource !== undefined && bodySource !== null) {
      if (Array.isArray(bodySource)) {
        for (const item of bodySource) {
          if (typeof item === 'string' && item.trim()) {
            preUploadedKeys.push(item.trim());
          } else if (item && typeof item === 'object') {
            const val = item.key || item.imageKey || item.url || item.imageUrl || item.id;
            if (val && typeof val === 'string' && val.trim()) {
              preUploadedKeys.push(val.trim());
            }
          }
        }
      } else if (typeof bodySource === 'string' && bodySource.trim()) {
        try {
          const parsed = JSON.parse(bodySource);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (typeof item === 'string' && item.trim()) {
                preUploadedKeys.push(item.trim());
              } else if (item && typeof item === 'object') {
                const val = item.key || item.imageKey || item.url || item.imageUrl || item.id;
                if (val && typeof val === 'string' && val.trim()) {
                  preUploadedKeys.push(val.trim());
                }
              }
            }
          } else {
            preUploadedKeys.push(bodySource.trim());
          }
        } catch {
          if (bodySource.includes(',')) {
            preUploadedKeys.push(
              ...bodySource
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean)
            );
          } else {
            preUploadedKeys.push(bodySource.trim());
          }
        }
      }
    }

    // Single key fallbacks
    const singleKey = req.body?.imageKey || req.body?.imageUrl;
    if (singleKey && typeof singleKey === 'string' && singleKey.trim()) {
      if (!preUploadedKeys.includes(singleKey.trim())) {
        preUploadedKeys.push(singleKey.trim());
      }
    }

    const totalCount = fileList.length + preUploadedKeys.length;
    if (totalCount === 0) {
      return sendError(
        res,
        `No photos provided. You must upload at least ${OnboardingService.MIN_PHOTOS_COUNT} photos (minimum ${OnboardingService.MIN_PHOTOS_COUNT} and maximum ${OnboardingService.MAX_PHOTOS_COUNT} photos allowed).`,
        400,
        'MIN_PHOTOS_REQUIRED'
      );
    }

    if (totalCount < OnboardingService.MIN_PHOTOS_COUNT) {
      return sendError(
        res,
        `You must upload at least ${OnboardingService.MIN_PHOTOS_COUNT} photos (minimum ${OnboardingService.MIN_PHOTOS_COUNT} and maximum ${OnboardingService.MAX_PHOTOS_COUNT} photos allowed)`,
        400,
        'MIN_PHOTOS_REQUIRED'
      );
    }

    if (totalCount > OnboardingService.MAX_PHOTOS_COUNT) {
      return sendError(
        res,
        `Maximum ${OnboardingService.MAX_PHOTOS_COUNT} photos allowed (minimum ${OnboardingService.MIN_PHOTOS_COUNT} and maximum ${OnboardingService.MAX_PHOTOS_COUNT} photos allowed)`,
        400,
        'MAX_PHOTOS_EXCEEDED'
      );
    }

    const result = await onboardingService.savePhotos(userId, {
      files: fileList,
      preUploadedKeys,
      primaryIndex:
        req.body?.primaryIndex !== undefined && req.body?.primaryIndex !== null && String(req.body.primaryIndex).trim() !== ''
          ? Number(req.body.primaryIndex)
          : undefined,
    });

    return sendSuccess(res, 'Profile photos saved successfully', result, 201);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

/**
 * Dedicated profile photo upload handler
 * POST /api/v1/onboarding/profile-photo
 */
export const uploadProfilePhoto = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const photoFile =
      files?.['profilePhoto']?.[0] ||
      files?.['profile_photo']?.[0] ||
      files?.['photo']?.[0] ||
      files?.['image']?.[0] ||
      req.file;

    const { imageKey, imageUrl } = req.body || {};
    const preUploadedKey = imageKey || imageUrl;

    if (
      (!photoFile || !photoFile.buffer || photoFile.buffer.length === 0) &&
      !preUploadedKey
    ) {
      return sendError(
        res,
        'profilePhoto is required. Attach image in "profilePhoto" field or pass "imageKey"',
        400,
        'MISSING_FILE'
      );
    }

    const result = await onboardingService.uploadProfilePhoto(
      userId,
      photoFile?.buffer,
      photoFile?.mimetype,
      preUploadedKey
    );

    return sendSuccess(res, 'Profile photo uploaded successfully', result, 201);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const deletePhoto = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const photoId = req.params.photoId as string;
    const result = await onboardingService.deletePhoto(userId, photoId);
    return sendSuccess(res, result.message, null, 200);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const setPrimaryPhoto = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const photoId = req.params.photoId as string;
    const photo = await onboardingService.setPrimaryPhoto(userId, photoId);
    const profilePhotoUrl = formatMediaUrl(photo.imageUrl);
    const profileThumbnail = formatThumbnailUrl(photo.imageUrl);
    return sendSuccess(
      res,
      'Primary photo updated successfully',
      {
        photo,
        profilePhoto: profilePhotoUrl,
        profilePicture: photo.imageUrl,
        profileThumbnail,
        imageUrl: profilePhotoUrl,
        thumbnailUrl: profileThumbnail,
      },
      200
    );
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 6. Voice Prompt Audio
export const uploadAudio = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const audioFile = files?.['audio']?.[0] || files?.['voicePrompt']?.[0] || files?.['voice_prompt']?.[0] || req.file;

    if (!audioFile || !audioFile.buffer) {
      return sendError(res, 'No audio file provided. Attach recording in "audio" or "voicePrompt" field', 400, 'MISSING_FILE');
    }

    // Support 'duration', 'durationSeconds', 'duration_seconds', 'audioDuration'
    const rawDuration =
      req.body?.duration ??
      req.body?.durationSeconds ??
      req.body?.duration_seconds ??
      req.body?.audioDuration ??
      req.body?.voiceDuration;

    let durationSeconds: number | undefined = undefined;
    if (rawDuration !== undefined && rawDuration !== null && String(rawDuration).trim() !== '') {
      const num = parseFloat(String(rawDuration));
      if (!isNaN(num) && num > 0) {
        durationSeconds = Math.round(num);
      }
    }

    const result = await onboardingService.uploadAudio(userId, audioFile.buffer, audioFile.mimetype, durationSeconds);
    return sendSuccess(res, 'Voice prompt uploaded successfully', result, 201);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const getAudio = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getAudio(userId);
    return sendSuccess(res, 'Voice prompt retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

export const deleteAudio = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.deleteAudio(userId);
    return sendSuccess(res, result.message, null);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

// 7. Onboarding Progress
export const getProgress = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserIdOrThrow(req, res);
    if (!userId) return;
    const result = await onboardingService.getProgress(userId);
    return sendSuccess(res, 'Onboarding progress retrieved successfully', result);
  } catch (err: any) {
    return handleControllerError(res, err);
  }
};

const handleControllerError = (res: Response, err: any) => {
  if (err instanceof OnboardingServiceError) {
    return sendError(res, err.message, err.statusCode, err.errorCode);
  }
  console.error('[Onboarding Controller Error]:', err);
  return sendError(res, err.message || 'Server error', 500, 'INTERNAL_SERVER_ERROR');
};
