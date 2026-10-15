import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  updateProfile,
  getProfile,
  getOtherUserProfileHandler,
  blockUserHandler,
  reportUserHandler,
  getMoreAboutMeHandler,
  updateMoreAboutMeHandler,
  uploadCoverPhotoHandler,
  requestProfileEmailOtpHandler,
  verifyProfileEmailOtpHandler,
  resendProfileEmailOtpHandler,
  requestProfilePhoneOtpHandler,
  verifyProfilePhoneOtpHandler,
  resendProfilePhoneOtpHandler,
} from '../controllers/user.controller';
import { authenticate, authorize } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getUserByIdSchema,
  updateUserSchema,
  updateProfileSchema,
  updateMoreAboutMeSchema,
  getOtherUserProfileSchema,
  blockUserSchema,
  reportUserSchema,
  requestProfileEmailOtpSchema,
  verifyProfileEmailOtpSchema,
  resendProfileEmailOtpSchema,
  requestProfilePhoneOtpSchema,
  verifyProfilePhoneOtpSchema,
  resendProfilePhoneOtpSchema,
} from '../schemas/user.schema';
import { getUserMomentsHandler } from '../controllers/moment.controller';
import { getUserMomentsSchema } from '../schemas/moment.schema';
import { registerDeviceTokenHandler } from '../controllers/connection.controller';
import { registerDeviceTokenSchema } from '../schemas/connection.schema';
import { handleUploadProfilePhoto, handleUploadCoverPhoto } from '../middlewares/upload.middleware';
import {
  uploadProfilePhoto,
  getUserInterests,
  updateUserInterests,
  setPrimaryPhoto,
} from '../controllers/onboarding.controller';
import { updateInterestsSchema } from '../schemas/onboarding.schema';

const router = Router();

// All user management routes require authentication
router.use(authenticate);

// Device token registration for push notifications (and aliases)
router.post('/device-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/fcm-token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);
router.post('/token', validate(registerDeviceTokenSchema), registerDeviceTokenHandler);

// Profile Onboarding & Edit Profile Endpoints
router.get('/profile', (req, res) => getProfile(req, res));
router.patch('/profile', validate(updateProfileSchema), updateProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);
router.post('/profile-photo', handleUploadProfilePhoto, uploadProfilePhoto);
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

// Target / Other User Profile Detail Screen
router.get('/:userId/profile', validate(getOtherUserProfileSchema), (req, res) => getOtherUserProfileHandler(req, res));
router.get('/profile/:userId', validate(getOtherUserProfileSchema), (req, res) => getOtherUserProfileHandler(req, res));

// User Visible Moments Thumbnails Screen
router.get(
  '/:userId/moments',
  validate(getUserMomentsSchema),
  (req, res) => getUserMomentsHandler(req, res)
);

// Moderation Endpoints: Block and Report User
router.post('/:userId/block', validate(blockUserSchema), blockUserHandler);
router.post('/:userId/report', validate(reportUserSchema), reportUserHandler);

// Admin / User Management Endpoints
router.get('/', authorize('admin'), getAllUsers);
router.get('/:id', validate(getUserByIdSchema), getUserById);
router.put('/:id', authorize('admin'), validate(updateUserSchema), updateUser);
router.delete('/:id', authorize('admin'), validate(getUserByIdSchema), deleteUser);

export default router;
