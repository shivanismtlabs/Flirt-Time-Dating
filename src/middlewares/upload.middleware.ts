import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/response';
import { env } from '../config/env';

// Store in memory for immediate processing and memory cleanup (biometric privacy)
const storage = multer.memoryStorage();

const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

export const uploadSelfie = multer({
  storage,
  limits: {
    fileSize: env.FACE_UPLOAD_MAX_SIZE_BYTES, // 5 MB configurable
    files: 3,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format (${file.mimetype}). Please upload a JPEG, PNG, or WebP image.`
        )
      );
    }
  },
});

/**
 * Express middleware wrapper to handle Multer upload errors gracefully
 */
export const handleUploadSelfie = (req: Request, res: Response, next: NextFunction) => {
  const upload = uploadSelfie.fields([
    { name: 'selfie_image', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'referenceImage', maxCount: 1 },
    { name: 'reference_image', maxCount: 1 },
    { name: 'profile_image', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            `File size exceeds ${Math.round(env.FACE_UPLOAD_MAX_SIZE_BYTES / (1024 * 1024))}MB limit. Please upload a smaller photo.`,
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(
            res,
            `Unexpected field '${err.field}'. Use 'selfie_image' or 'image' for the selfie file.`,
            400,
            'UNEXPECTED_FIELD'
          );
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(res, err.message || 'File upload error', 400, 'UPLOAD_ERROR');
    }
    return next();
  });
};

