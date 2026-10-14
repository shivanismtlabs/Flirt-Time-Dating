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
    { name: 'selfie', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'gesture', maxCount: 1 },
    { name: 'gesture_image', maxCount: 1 },
    { name: 'avatar', maxCount: 1 },
    { name: 'referenceImage', maxCount: 1 },
    { name: 'reference_image', maxCount: 1 },
    { name: 'profile_image', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 },
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
            `Unexpected field '${err.field}'. Use 'selfie_image', 'image', 'selfie', or 'file' for the selfie file.`,
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

/**
 * Middleware for gallery profile photo uploads (Max 5MB, JPEG/PNG/WebP)
 */
export const uploadPhoto = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image format (${file.mimetype}). Please upload a JPEG, PNG, or WebP photo.`));
    }
  },
});

export const handleUploadPhoto = (req: Request, res: Response, next: NextFunction) => {
  const upload = uploadPhoto.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 'Photo size exceeds 5MB limit. Please upload a smaller image.', 400, 'FILE_TOO_LARGE');
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(res, err.message || 'Photo upload error', 400, 'UPLOAD_ERROR');
    }
    return next();
  });
};

/**
 * Middleware for audio voice recording uploads (Max 10MB, MP3/M4A/WAV/AAC/OGG/WEBM)
 */
const allowedAudioMimeTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'video/webm',
  'video/mp4',
];

export const uploadAudio = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const isAllowedMime = allowedAudioMimeTypes.includes(mime);
    const hasAudioExt = /\.(mp3|m4a|wav|aac|ogg|webm|mp4)$/i.test(file.originalname);

    if (isAllowedMime || hasAudioExt) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format (${file.mimetype}). Please upload an MP3, M4A, WAV, AAC, or OGG recording.`));
    }
  },
});

export const handleUploadAudio = (req: Request, res: Response, next: NextFunction) => {
  const upload = uploadAudio.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'voicePrompt', maxCount: 1 },
    { name: 'voice_prompt', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(res, 'Audio file exceeds 10MB limit. Please upload a shorter voice note.', 400, 'FILE_TOO_LARGE');
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(res, err.message || 'Audio upload error', 400, 'UPLOAD_ERROR');
    }
    return next();
  });
};

/**
 * Middleware for dedicated profile photo upload (Max 5MB, JPEG/PNG/WebP)
 * Field: 'profilePhoto' (also supports 'profile_photo', 'photo', 'image')
 */
export const uploadProfilePhoto = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image format (${file.mimetype}). Please upload a JPEG, PNG, or WebP image.`));
    }
  },
});

export const handleUploadProfilePhoto = (req: Request, res: Response, next: NextFunction) => {
  const upload = uploadProfilePhoto.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'File size exceeds 5MB limit. Please upload a smaller image.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(
            res,
            `Unexpected field '${err.field}'. Use 'profilePhoto' for the image file.`,
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

/**
 * Middleware for Quick Moments multi-image upload (1 to 5 images, Max 5MB each, JPEG/PNG/WebP)
 * Field: 'images' (also supports 'image')
 */
export const uploadMomentImages = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per image
    files: 5,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported image format (${file.mimetype}). Please upload JPEG, PNG, or WebP images.`
        )
      );
    }
  },
});

export const handleUploadMomentImages = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const upload = uploadMomentImages.fields([
    { name: 'images', maxCount: 5 },
    { name: 'image', maxCount: 5 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'One or more images exceed the 5MB size limit. Please upload smaller photos.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(
            res,
            `Too many files uploaded or unexpected field '${err.field}'. Maximum 5 images allowed under 'images'.`,
            400,
            'TOO_MANY_FILES'
          );
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(
        res,
        err.message || 'Image upload error',
        400,
        'UPLOAD_ERROR'
      );
    }
    return next();
  });
};

/**
 * Middleware for single Quick Moment image/media upload (Max 10MB)
 * Field: 'image', 'photo', 'media', 'file'
 */
export const uploadQuickMomentMedia = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image format (${file.mimetype}). Please upload JPEG, PNG, or WebP.`));
    }
  },
});

export const handleUploadQuickMomentMedia = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const upload = uploadQuickMomentMedia.fields([
    { name: 'image', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'media', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'File size exceeds 10MB limit. Please upload a smaller image.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(res, err.message || 'Media upload error', 400, 'UPLOAD_ERROR');
    }

    // Populate req.file for single-file handlers
    if (req.files) {
      const filesObj = req.files as Record<string, Express.Multer.File[]>;
      const matched =
        filesObj.image?.[0] ||
        filesObj.photo?.[0] ||
        filesObj.media?.[0] ||
        filesObj.file?.[0];
      if (matched) {
        req.file = matched;
      }
    }

    return next();
  });
};


