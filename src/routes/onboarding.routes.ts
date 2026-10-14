import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  handleUploadPhoto,
  handleUploadAudio,
  handleUploadProfilePhoto,
  handleUploadCoverPhoto,
} from '../middlewares/upload.middleware';
import { uploadCoverPhotoHandler } from '../controllers/user.controller';
import {
  updatePreferencesSchema,
  updateGenderPreferenceSchema,
  updateReligionSchema,
  updateInterestsSchema,
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

// Screen 25: Profile Photos Gallery & Dedicated Profile / Cover Photo Upload
router.post('/profile-photo', handleUploadProfilePhoto, uploadProfilePhoto);
router.post('/cover-photo', handleUploadCoverPhoto, uploadCoverPhotoHandler);
router.post('/cover-picture', handleUploadCoverPhoto, uploadCoverPhotoHandler);
router.get('/photos', getUserPhotos);
router.post('/photos', handleUploadPhoto, uploadPhoto);
router.delete('/photos/:photoId', deletePhoto);
router.patch('/photos/:photoId/primary', setPrimaryPhoto);

// Voice Prompt Audio
router.post('/audio', handleUploadAudio, uploadAudio);
router.get('/audio', getAudio);
router.delete('/audio', deleteAudio);

// Onboarding Progress & Completion
router.get('/progress', getProgress);

export default router;
