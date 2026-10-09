import { Router } from 'express';
import { register, login, getProfile } from '../controllers/auth.controller';
import { appleAuth } from '../controllers/authApple.controller';
import { firebaseAuth } from '../controllers/authFirebase.controller';
import { requestPhoneOtp } from '../controllers/authPhoneRequest.controller';
import { verifyPhoneOtp } from '../controllers/authPhoneVerify.controller';
import { resendPhoneOtp } from '../controllers/authPhoneResend.controller';
import { requestEmailOtp } from '../controllers/authEmailRequest.controller';
import { verifyEmailOtp } from '../controllers/authEmailVerify.controller';
import { resendEmailOtp } from '../controllers/authEmailResend.controller';
import { validate } from '../middlewares/validate.middleware';
import {
  registerSchema,
  loginSchema,
  appleAuthSchema,
  firebaseAuthSchema,
  requestPhoneOtpSchema,
  requestEmailOtpSchema,
  verifyPhoneOtpSchema,
  resendPhoneOtpSchema,
  verifyEmailOtpSchema,
  resendEmailOtpSchema,
} from '../schemas/auth.schema';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Standard Auth
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.post('/apple', validate(appleAuthSchema), appleAuth);
router.post('/firebase', validate(firebaseAuthSchema), firebaseAuth);
router.post('/firebase-phone', validate(firebaseAuthSchema), firebaseAuth);
router.get('/me', authenticate, getProfile);


// Phone Auth Routes
router.post('/phone/request-otp', validate(requestPhoneOtpSchema), requestPhoneOtp);
router.post('/request-otp', validate(requestPhoneOtpSchema), requestPhoneOtp);

router.post('/phone/verify', validate(verifyPhoneOtpSchema), verifyPhoneOtp);
router.post('/phone/verify-otp', validate(verifyPhoneOtpSchema), verifyPhoneOtp);
router.post('/verify-phone-otp', validate(verifyPhoneOtpSchema), verifyPhoneOtp);
router.post('/verify-otp', validate(verifyPhoneOtpSchema), verifyPhoneOtp);

router.post('/phone/resend-otp', validate(resendPhoneOtpSchema), resendPhoneOtp);
router.post('/resend-otp', validate(resendPhoneOtpSchema), resendPhoneOtp);

// Email Auth Routes
router.post('/email/request-otp', validate(requestEmailOtpSchema), requestEmailOtp);
router.post('/email/verify-otp', validate(verifyEmailOtpSchema), verifyEmailOtp);
router.post('/email/verify', validate(verifyEmailOtpSchema), verifyEmailOtp);
router.post('/verify-email-otp', validate(verifyEmailOtpSchema), verifyEmailOtp);

router.post('/email/resend-otp', validate(resendEmailOtpSchema), resendEmailOtp);
router.post('/email/resend', validate(resendEmailOtpSchema), resendEmailOtp);
router.post('/resend-email-otp', validate(resendEmailOtpSchema), resendEmailOtp);

export default router;


