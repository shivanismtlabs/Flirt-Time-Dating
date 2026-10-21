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
 * Middleware for gallery profile photo uploads (Max 5MB each, JPEG/PNG/WebP, up to 5 images)
 */
export const uploadPhoto = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB per photo
    files: 5,
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
    { name: 'photos', maxCount: 5 },
    { name: 'images', maxCount: 5 },
    { name: 'photo', maxCount: 5 },
    { name: 'image', maxCount: 5 },
    { name: 'files', maxCount: 5 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'Photo size exceeds 5MB limit. Please upload a smaller image.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
          return sendError(
            res,
            'Maximum 5 photos allowed. Please upload between 3 and 5 images.',
            400,
            'MAX_PHOTOS_EXCEEDED'
          );
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
 * Middleware for dedicated cover photo upload (Max 10MB, JPEG/PNG/WebP)
 * Supported fields: 'coverPhoto', 'coverPicture', 'cover_photo', 'cover_picture', 'cover', 'photo', 'image', 'file'
 */
export const uploadCoverPhoto = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
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

export const handleUploadCoverPhoto = (req: Request, res: Response, next: NextFunction) => {
  const upload = uploadCoverPhoto.fields([
    { name: 'coverPhoto', maxCount: 1 },
    { name: 'coverPicture', maxCount: 1 },
    { name: 'cover_photo', maxCount: 1 },
    { name: 'cover_picture', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
    { name: 'photo', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ]);

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'File size exceeds 10MB limit. Please upload a smaller cover image.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return sendError(
            res,
            `Unexpected field '${err.field}'. Use 'coverPhoto' or 'coverPicture' for the cover image.`,
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

/**
 * Universal media upload middleware for direct S3 file uploads
 * Max 50MB, supports images (jpeg, png, webp, gif, avif, heic), audio (mp3, m4a, wav, aac, ogg, webm), video (mp4, quicktime, mov, webm), pdf
 */
const allowedUniversalMediaMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
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
  'audio/caf',
  'audio/x-caf',
  'audio/3gpp',
  'audio/3gp',
  'audio/amr',
  'audio/flac',
  'audio/opus',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
  'application/pdf',
  'application/octet-stream',
];

export const uploadUniversalMedia = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype.toLowerCase();
    const isAllowed = allowedUniversalMediaMimeTypes.includes(mime);
    const hasAllowedExt = /\.(jpe?g|png|webp|gif|avif|heic|heif|mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus|mp4|mov|pdf)$/i.test(
      file.originalname
    );

    if (isAllowed || hasAllowedExt) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Unsupported file format (${file.mimetype}). Please upload an image, audio, or video file.`
        )
      );
    }
  },
});

export const handleUploadUniversalMedia = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const upload = uploadUniversalMedia.any();

  upload(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return sendError(
            res,
            'File size exceeds 50MB limit. Please upload a smaller file.',
            400,
            'FILE_TOO_LARGE'
          );
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return sendError(
            res,
            'Maximum 10 files allowed per upload.',
            400,
            'LIMIT_FILE_COUNT'
          );
        }
        return sendError(res, err.message, 400, err.code);
      }
      return sendError(res, err.message || 'Media upload error', 400, 'UPLOAD_ERROR');
    }

    // Populate req.file and structured map on req.files for compatibility
    if (Array.isArray(req.files) && req.files.length > 0) {
      req.file = req.files[0];
      const filesObj: Record<string, Express.Multer.File[]> = {};
      for (const f of req.files) {
        const field = f.fieldname || 'file';
        if (!filesObj[field]) {
          filesObj[field] = [];
        }
        filesObj[field].push(f);
      }
      // Attach named field lookup onto req.files array for dual access
      Object.assign(req.files, filesObj);
    } else if (req.files && typeof req.files === 'object' && !Array.isArray(req.files)) {
      const filesObj = req.files as Record<string, Express.Multer.File[]>;
      for (const key of Object.keys(filesObj)) {
        if (filesObj[key]?.length > 0) {
          req.file = filesObj[key][0];
          break;
        }
      }
    }

    return next();
  });
};

/**
 * Middleware for direct chat message media attachments (images, photos, voice notes).
 * Automatically parses multipart form-data, auto-detects messageType from file mime,
 * and sets placeholder content to pass schema validation.
 */
export const handleUploadChatMedia = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  handleUploadUniversalMedia(req, res, (err: any) => {
    if (err) {
      return next(err);
    }

    const attachedFiles: Express.Multer.File[] = [];
    if (Array.isArray(req.files) && req.files.length > 0) {
      attachedFiles.push(...req.files);
    } else if (req.file) {
      attachedFiles.push(req.file);
    }

    // Auto-detect message type if direct file is attached
    if (attachedFiles.length > 0) {
      req.file = attachedFiles[0];
      const mime = (attachedFiles[0].mimetype || '').toLowerCase();
      const origName = attachedFiles[0].originalname || '';
      const isAudio =
        mime.startsWith('audio/') ||
        /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr)$/i.test(origName);

      if (!req.body.messageType && !req.body.type) {
        req.body.messageType = isAudio ? 'audio' : 'image';
      }
      if (
        !req.body.content &&
        !req.body.imageUrl &&
        !req.body.image &&
        !req.body.mediaUrl &&
        !req.body.audioUrl &&
        !req.body.audio &&
        !req.body.voiceUrl &&
        !req.body.images &&
        !req.body.imageUrls
      ) {
        req.body.content = '__FILE_ATTACHMENT__';
      }
    }

    // Parse JSON strings from multipart fields
    if (typeof req.body.metadata === 'string') {
      try {
        req.body.metadata = JSON.parse(req.body.metadata);
      } catch {}
    }

    if (typeof req.body.images === 'string') {
      try {
        req.body.images = JSON.parse(req.body.images);
      } catch {}
    }

    if (typeof req.body.imageUrls === 'string') {
      try {
        req.body.imageUrls = JSON.parse(req.body.imageUrls);
      } catch {}
    }

    if (req.body.duration && !isNaN(Number(req.body.duration))) {
      req.body.duration = Number(req.body.duration);
    }

    if (typeof req.body.recipientIds === 'string') {
      try {
        req.body.recipientIds = JSON.parse(req.body.recipientIds);
      } catch {
        if (req.body.recipientIds.includes(',')) {
          req.body.recipientIds = req.body.recipientIds
            .split(',')
            .map((id: string) => id.trim())
            .filter(Boolean);
        } else if (req.body.recipientIds.trim()) {
          req.body.recipientIds = [req.body.recipientIds.trim()];
        }
      }
    }

    return next();
  });
};
