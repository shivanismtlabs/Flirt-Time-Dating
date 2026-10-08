import { Request, Response } from 'express';
import { otpService } from '../services/otp.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Thin Controller for resending Phone OTP
 * Route: POST /api/v1/auth/phone/resend-otp
 */
export const resendPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { verificationId } = req.body || {};

    const result = await otpService.resendPhoneOtp(verificationId);

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      'Verification code resent successfully',
      result.data,
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Internal server error during OTP resend', 500);
  }
};
