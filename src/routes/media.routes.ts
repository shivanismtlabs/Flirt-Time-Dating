import { Router } from 'express';
import { mediaController } from '../controllers/media.controller';
import { authenticate, optionalAuthenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handleUploadUniversalMedia } from '../middlewares/upload.middleware';
import { generatePresignedUrlSchema } from '../schemas/media.schema';

const router = Router();

// Direct S3 Media Upload & Presigned URL Generation
// Supports POST, PUT, PATCH, GET on /api/v1/media/uploads, /upload, /images, /image, /photos, /photo, /files, /file, /
router.all(
  [
    '/uploads',
    '/uploads/*',
    '/upload',
    '/upload/*',
    '/images',
    '/images/*',
    '/image',
    '/image/*',
    '/photos',
    '/photos/*',
    '/photo',
    '/photo/*',
    '/files',
    '/files/*',
    '/file',
    '/file/*',
    '/',
  ],
  optionalAuthenticate,
  handleUploadUniversalMedia,
  mediaController.uploadMediaHandler
);

// 2. Canonical S3 Presigned Upload URL endpoints
router.post(
  '/presigned-url',
  authenticate,
  validate(generatePresignedUrlSchema),
  mediaController.getPresignedUploadUrl
);

router.post(
  '/upload-url',
  authenticate,
  validate(generatePresignedUrlSchema),
  mediaController.getPresignedUploadUrl
);

router.get(
  '/presigned-url',
  authenticate,
  mediaController.getPresignedUploadUrl
);

router.get(
  '/upload-url',
  authenticate,
  mediaController.getPresignedUploadUrl
);

export default router;
