import { Request, Response } from 'express';
import { otpService } from '../services/otp.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Thin Controller for requesting an Email OTP
 * Route: POST /api/v1/auth/email/request-otp
 *
 * Keeps controller thin: Delegates business logic to OtpService
 */
export const requestEmailOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};

    const result = await otpService.requestEmailOtp(email);

    if (result.error) {
      return sendError(res, result.error, result.statusCode);
    }

    return sendSuccess(
      res,
      'Verification code sent successfully',
      result.data,
      result.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Internal server error while requesting email OTP', 500);
  }
};
