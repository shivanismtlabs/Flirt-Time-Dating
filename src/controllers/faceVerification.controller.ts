import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import {
  faceVerificationService,
  FaceVerificationServiceError,
} from '../services/faceVerification.service';

/**
 * Controller for Laravel-Compatible Gesture/Selfie Face Verification
 * Handles POST /api/v1/gesture-upload, /api/gesture-upload, /api/v1/face-verification/upload
 */
export const uploadFaceVerification = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 1. Authenticate user strictly from verified JWT
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    // 2. Extract uploaded files from Multer
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const singleFile = req.file as Express.Multer.File | undefined;

    const imageFile =
      files?.['selfie_image']?.[0] ||
      files?.['image']?.[0] ||
      singleFile;

    const referenceFile =
      files?.['referenceImage']?.[0] ||
      files?.['reference_image']?.[0] ||
      files?.['profile_image']?.[0];

    if (!imageFile || !imageFile.buffer || imageFile.buffer.length === 0) {
      return sendError(
        res,
        'No selfie image provided. Please upload an image in the "selfie_image" or "image" form field.',
        400,
        'MISSING_IMAGE_FILE'
      );
    }

    const verificationType =
      req.body?.verification_type ||
      req.body?.verificationType ||
      'gesture';

    // 3. Run AWS Face Verification Workflow
    const result = await faceVerificationService.processFaceVerification({
      userId,
      imageBuffer: imageFile.buffer,
      originalFilename: imageFile.originalname,
      mimeType: imageFile.mimetype,
      fileSize: imageFile.size,
      verificationType,
      referenceImageBuffer: referenceFile?.buffer,
    });

    let message = 'Identity verification completed';
    if (result.status === 'approved') {
      message = 'Identity verification completed successfully';
    } else if (result.status === 'rejected') {
      message = result.reasonMessage || 'The selfie did not match the primary profile photo';
    } else if (result.status === 'action_required') {
      message = result.reasonMessage || 'Action required: Please provide a clear selfie photo';
    }

    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof FaceVerificationServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Face Verification Controller Error]:', error);
    return sendError(
      res,
      error.message || 'An unexpected error occurred during face verification.',
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
