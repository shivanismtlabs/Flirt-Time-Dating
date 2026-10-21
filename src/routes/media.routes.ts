import { Router } from 'express';
import { mediaController } from '../controllers/media.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handleUploadUniversalMedia } from '../middlewares/upload.middleware';
import { generatePresignedUrlSchema } from '../schemas/media.schema';

const router = Router();

// 1. Direct S3 Media Upload & Presigned URL Generation
// Supports POST /api/v1/media/uploads, POST /api/v1/media/upload, POST /api/v1/media
router.post(
  '/uploads',
  authenticate,
  handleUploadUniversalMedia,
  mediaController.uploadMediaHandler
);

router.post(
  '/upload',
  authenticate,
  handleUploadUniversalMedia,
  mediaController.uploadMediaHandler
);

router.post(
  '/',
  authenticate,
  handleUploadUniversalMedia,
  mediaController.uploadMediaHandler
);

// GET /api/v1/media/uploads or /api/v1/media/upload for presigned URL / info retrieval
router.get(
  '/uploads',
  authenticate,
  mediaController.uploadMediaHandler
);

router.get(
  '/upload',
  authenticate,
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
