import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateProfile,
  getProfile,
  getOtherUserProfileHandler,
  getOtherUserPhotosHandler,
  blockUserHandler,
  reportUserHandler,
  getBlockedUsersHandler,
  unblockUserHandler,
  getUserReportsHandler,
  getReportReasonsHandler,
  getMoreAboutMeHandler,
  updateMoreAboutMeHandler,
  uploadCoverPhotoHandler,
  requestProfileEmailOtpHandler,
  verifyProfileEmailOtpHandler,
  resendProfileEmailOtpHandler,
  requestProfilePhoneOtpHandler,
  verifyProfilePhoneOtpHandler,
  resendProfilePhoneOtpHandler,
  getUserLimitsHandler,
  deleteAccountHandler,
  getNotificationSettingsHandler,
  updateNotificationSettingsHandler,
} from '../controllers/user.controller';
import { deleteAccountSchema } from '../schemas/auth.schema';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { reportLimiter } from '../middlewares/rateLimiter.middleware';
import {
  getUserByIdSchema,
  updateUserSchema,
  updateProfileSchema,
  updateMoreAboutMeSchema,
  getOtherUserProfileSchema,
  blockUserSchema,
  reportUserSchema,
  getBlockedUsersSchema,
  unblockUserSchema,
  getUserReportsSchema,
  requestProfileEmailOtpSchema,
  verifyProfileEmailOtpSchema,
  resendProfileEmailOtpSchema,
  requestProfilePhoneOtpSchema,
  verifyProfilePhoneOtpSchema,
  resendProfilePhoneOtpSchema,
  notificationSettingsSchema,
} from '../schemas/user.schema';
import { getUserMomentsHandler } from '../controllers/moment.controller';
import { getUserMomentsSchema } from '../schemas/moment.schema';
import { registerDeviceTokenHandler } from '../controllers/connection.controller';
import { registerDeviceTokenSchema } from '../schemas/connection.schema';
import { handleUploadProfilePhoto, handleUploadCoverPhoto, handleUploadPhoto } from '../middlewares/upload.middleware';
import {
  uploadProfilePhoto,
  getUserInterests,
  updateUserInterests,
  setPrimaryPhoto,
  getUserPhotos,
  uploadPhoto,
  deletePhoto,
} from '../controllers/onboarding.controller';
import { updateInterestsSchema } from '../schemas/onboarding.schema';
import { sendComplimentHandler } from '../controllers/interaction.controller';
import { sendComplimentSchema } from '../schemas/interaction.schema';

import { searchUsersHandler } from '../controllers/userSearch.controller';
import { userSearchSchema } from '../schemas/userSearch.schema';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// User Search API: GET /api/v1/users/search and POST /api/v1/users/search
router.get('/search', validate(userSearchSchema), searchUsersHandler);
router.post('/search', validate(userSearchSchema), searchUsersHandler);

// Device token registration for push notifications (and aliases)
router.post('/device-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/fcm-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);

// Profile Onboarding & Edit Profile Endpoints
router.get('/profile', (req, res) => getProfile(req, res));
router.post('/profile', validate(updateProfileSchema), updateProfile);
router.patch('/profile', validate(updateProfileSchema), updateProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);
router.post('/profile-photo', handleUploadProfilePhoto, uploadProfilePhoto);
router.get('/photos', getUserPhotos);
router.post('/photos', handleUploadPhoto, uploadPhoto);
router.put('/photos', handleUploadPhoto, uploadPhoto);
router.patch('/photos', handleUploadPhoto, uploadPhoto);
router.delete('/photos/:photoId', deletePhoto);
router.patch('/photos/:photoId/primary', setPrimaryPhoto);

// User Interests Endpoints (Edit Profile "Interests" section)
router.get('/interests', getUserInterests);
router.put('/interests', validate(updateInterestsSchema), updateUserInterests);
router.patch('/interests', validate(updateInterestsSchema), updateUserInterests);
router.post('/interests', validate(updateInterestsSchema), updateUserInterests);

// Cover Picture Upload Endpoint (Edit Profile "Cover Picture" section)
router.post('/cover-photo', handleUploadCoverPhoto, uploadCoverPhotoHandler);

// Edit Profile Email Add / Verify Endpoints
router.post('/profile/email/request-otp', validate(requestProfileEmailOtpSchema), requestProfileEmailOtpHandler);
router.post('/profile/email/verify-otp', validate(verifyProfileEmailOtpSchema), verifyProfileEmailOtpHandler);
router.post('/profile/email/resend-otp', validate(resendProfileEmailOtpSchema), resendProfileEmailOtpHandler);

// Edit Profile Phone Add / Verify Endpoints
router.post('/profile/phone/request-otp', validate(requestProfilePhoneOtpSchema), requestProfilePhoneOtpHandler);
router.post('/profile/phone/verify-otp', validate(verifyProfilePhoneOtpSchema), verifyProfilePhoneOtpHandler);
router.post('/profile/phone/resend-otp', validate(resendProfilePhoneOtpSchema), resendProfilePhoneOtpHandler);

// More About Me Screen Endpoints
router.get('/more-about-me', getMoreAboutMeHandler);
router.patch('/more-about-me', validate(updateMoreAboutMeSchema), updateMoreAboutMeHandler);
router.put('/more-about-me', validate(updateMoreAboutMeSchema), updateMoreAboutMeHandler);

// User Limits & Free Tier Quotas (/api/v1/users/limits)
router.get('/limits', getUserLimitsHandler);
// Notification Preferences Endpoints
router.get('/notification-settings', getNotificationSettingsHandler);
router.patch('/notification-settings', validate(notificationSettingsSchema), updateNotificationSettingsHandler);
router.put('/notification-settings', validate(notificationSettingsSchema), updateNotificationSettingsHandler);

// Target / Other User Profile Detail Screen
router.get('/:userId/profile', validate(getOtherUserProfileSchema), (req, res) => getOtherUserProfileHandler(req, res));
router.get('/:userId/photos', validate(getOtherUserProfileSchema), (req, res) => getOtherUserPhotosHandler(req, res));
router.post('/:userId/compliment', validate(sendComplimentSchema), sendComplimentHandler);
router.post('/:userId/compliments', validate(sendComplimentSchema), sendComplimentHandler);
router.post('/compliment', validate(sendComplimentSchema), sendComplimentHandler);
router.post('/compliments', validate(sendComplimentSchema), sendComplimentHandler);


// User Visible Moments Thumbnails Screen
router.get(
  '/:userId/moments',
  validate(getUserMomentsSchema),
  (req, res) => getUserMomentsHandler(req, res)
);

// Moderation Endpoints: Block, Unblock, and Report User
router.get('/blocked', validate(getBlockedUsersSchema), getBlockedUsersHandler);
router.post('/:userId/block', validate(blockUserSchema), blockUserHandler);
router.delete('/:userId/block', validate(unblockUserSchema), unblockUserHandler);

router.get('/reports', validate(getUserReportsSchema), getUserReportsHandler);
router.get('/report-reasons', getReportReasonsHandler);
router.post('/:userId/report', reportLimiter, validate(reportUserSchema), reportUserHandler);

// Account Session & Lifecycle Endpoints
router.delete('/account', validate(deleteAccountSchema), deleteAccountHandler);
router.delete('/me', validate(deleteAccountSchema), deleteAccountHandler);
router.post('/delete-account', validate(deleteAccountSchema), deleteAccountHandler);
router.delete('/delete-account', validate(deleteAccountSchema), deleteAccountHandler);

// Admin / User Management Endpoints
router.get('/', authorize('admin'), getAllUsers);
router.get('/:id', validate(getUserByIdSchema), getUserById);
router.put('/:id', authorize('admin'), validate(updateUserSchema), updateUser);
router.delete('/:id', authorize('admin'), validate(getUserByIdSchema), deleteUser);

export default router;
