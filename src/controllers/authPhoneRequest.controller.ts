import { Request, Response } from 'express';
import { otpService } from '../services/otp.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller for requesting a Phone OTP
 * Route: POST /api/v1/auth/phone/request-otp
 *
 * Keeps controller thin: Delegates business logic to OtpService
 */
export const requestPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { countryCode, phone } = req.body || {};

    const result = await otpService.requestPhoneOtp(countryCode, phone);

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
    return sendError(res, error.message || 'Internal server error while requesting OTP', 500);
  }
};
