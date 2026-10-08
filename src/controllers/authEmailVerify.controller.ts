import { Request, Response } from 'express';
import { otpService } from '../services/otp.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to verify a 6-digit Email OTP and authenticate/create user.
 * 
 * Flow:
 * 1. Validate request body (verificationId, otp)
 * 2. Require exactly 6 numeric digits for OTP
 * 3. Find EmailVerification record in PostgreSQL within transaction with row locking
 * 4. Verify record existence, expiration, consumption, max attempts
 * 5. Compare OTP against bcrypt hash securely
 * 6. Atomically update attempts / invalidate on failure
 * 7. Atomically consume OTP with conditional update, mark email verified, find/create user, generate JWT on success
 * 8. Never leak OTP or hash in logs or responses
 */
export const verifyEmailOtp = async (req: Request, res: Response) => {
  try {
    const { verificationId, otp } = req.body || {};

    const result = await otpService.verifyEmailOtp(verificationId, otp);

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      result.message || 'Email verified successfully',
      result.data,
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Internal server error during verification', 500);
  }
};
