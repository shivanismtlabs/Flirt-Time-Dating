import { Request, Response } from 'express';
import {
  authenticateWithFirebase,
  FirebaseValidationError,
} from '../services/firebaseAuth.service';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to handle Firebase Authentication (Phone Auth / Social Sign-In)
 * POST /api/v1/auth/firebase
 * POST /api/v1/auth/firebase-phone
 */
export const firebaseAuth = async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    const result = await authenticateWithFirebase({
      idToken,
    });

    return sendSuccess(res, 'Firebase authentication successful', result, 200);
  } catch (error: any) {
    if (error instanceof FirebaseValidationError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error authenticating with Firebase', 500);
  }
};
