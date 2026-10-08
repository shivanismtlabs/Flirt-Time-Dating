import { Request, Response } from 'express';
import { authenticateWithApple, AppleValidationError } from '../services/appleAuth.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to handle Sign in with Apple authentication
 * POST /api/v1/auth/apple (and /api/auth/apple)
 */
export const appleAuth = async (req: Request, res: Response) => {
  try {
    const { identityToken, authorizationCode, nonce, user } = req.body;

    const result = await authenticateWithApple({
      identityToken,
      authorizationCode,
      nonce,
      user,
    });

    return sendSuccess(res, 'Apple login successful', result, 200);
  } catch (error: any) {
    if (error instanceof AppleValidationError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error authenticating with Apple', 500);
  }
};
