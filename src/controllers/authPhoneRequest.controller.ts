import { Request, Response } from 'express';
import { otpService } from '../services/otp.service';
import {
  clientProofFromBody,
  FirebasePhoneError,
  verifyFirebaseIosClient,
} from '../services/firebasePhone.service';
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

    const result = await otpService.requestPhoneOtp(countryCode, phone, {
      clientVerification: clientProofFromBody(req.body),
    });

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

/**
 * Exchanges an APNs device token for the Firebase receipt.
 * Route: POST /api/v1/auth/phone/ios/verify-client
 * The secret is delivered to the phone by a silent push and is not returned here.
 */
export const verifyIosClient = async (req: Request, res: Response) => {
  try {
    const { apnsToken, isSandbox, iosBundleId } = req.body || {};
    const result = await verifyFirebaseIosClient({
      appToken: apnsToken,
      isSandbox,
      iosBundleId,
    });
    return sendSuccess(res, 'iOS app verification started', result);
  } catch (error: unknown) {
    if (error instanceof FirebasePhoneError) {
      return sendError(res, error.message, error.statusCode);
    }
    const message = error instanceof Error ? error.message : 'Internal server error while verifying the iOS app';
    return sendError(res, message, 500);
  }
};
