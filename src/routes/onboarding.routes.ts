import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  handleUploadPhoto,
  handleUploadAudio,
  handleUploadProfilePhoto,
} from '../middlewares/upload.middleware';
import {
  updatePreferencesSchema,
  updateGenderPreferenceSchema,
  updateReligionSchema,
  updateInterestsSchema,
  updateOnboardingStepSchema,
} from '../schemas/onboarding.schema';
import {
  getPreferences,
  updatePreferences,
  getGenderPreference,
  updateGenderPreference,
  getReligion,
  updateReligion,
  getUserInterests,
  updateUserInterests,
  getUserPhotos,
  uploadPhoto,
  deletePhoto,
  setPrimaryPhoto,
  uploadProfilePhoto,
  uploadAudio,
  getAudio,
  deleteAudio,
  getProgress,
  saveCurrentStep,
} from '../controllers/onboarding.controller';

const router = Router();

// All onboarding endpoints require authentication
router.use(authenticate);

// Screen 21: Dating Preferences
router.get('/preferences', getPreferences);
router.put('/preferences', validate(updatePreferencesSchema), updatePreferences);

// Screen 22: Gender Preference
router.get('/gender-preference', getGenderPreference);
router.put('/gender-preference', validate(updateGenderPreferenceSchema), updateGenderPreference);

// Screen 23: Religious Belief
router.get('/religion', getReligion);
router.put('/religion', validate(updateReligionSchema), updateReligion);

// Screen 24: Matching Interests
router.get('/interests', getUserInterests);
router.put('/interests', validate(updateInterestsSchema), updateUserInterests);

// Screen 25: Profile Photos Gallery & Dedicated Profile Photo Upload
router.post('/profile-photo', handleUploadProfilePhoto, uploadProfilePhoto);
router.get('/photos', getUserPhotos);
router.post('/photos', handleUploadPhoto, uploadPhoto);
router.put('/photos', handleUploadPhoto, uploadPhoto);
router.patch('/photos', handleUploadPhoto, uploadPhoto);
router.delete('/photos/:photoId', deletePhoto);
router.patch('/photos/:photoId/primary', setPrimaryPhoto);

// Voice Prompt Audio
router.post('/audio', handleUploadAudio, uploadAudio);
router.get('/audio', getAudio);
router.delete('/audio', deleteAudio);

// Screen the user is on. Saved so a killed app reopens on the same step.
router.put('/step', validate(updateOnboardingStepSchema), saveCurrentStep);
router.patch('/step', validate(updateOnboardingStepSchema), saveCurrentStep);

// Onboarding Progress & Completion
router.get('/progress', getProgress);

export default router;
