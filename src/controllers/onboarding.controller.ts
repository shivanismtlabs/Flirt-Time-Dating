import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { onboardingService, OnboardingServiceError } from '../services/onboarding.service';

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
    const { interestIds } = req.body;
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

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const photoFile = files?.['photo']?.[0] || files?.['image']?.[0] || req.file;

    if (!photoFile || !photoFile.buffer) {
      return sendError(res, 'No photo file provided. Attach image in "photo" or "image" field', 400, 'MISSING_FILE');
    }

    const photo = await onboardingService.addPhoto(userId, photoFile.buffer, photoFile.mimetype);
    return sendSuccess(res, 'Photo uploaded successfully', { photo }, 201);
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
    return sendSuccess(res, 'Primary photo updated successfully', { photo }, 200);
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

    const durationSeconds = req.body?.durationSeconds ? parseInt(req.body.durationSeconds, 10) : undefined;
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
