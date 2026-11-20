import { Request, Response } from 'express';
import {
  authenticateWithGoogle,
  GoogleValidationError,
} from '../services/googleAuth.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to handle Google Sign-In authentication
 * POST /api/v1/auth/google (and /api/auth/google)
 */
export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { idToken, serverAuthCode, user } = req.body;

    const result = await authenticateWithGoogle({
      idToken,
      serverAuthCode,
      user,
    });

    return sendSuccess(res, 'Google login successful', result, 200);
  } catch (error: any) {
    if (error instanceof GoogleValidationError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error authenticating with Google', 500);
  }
};
