import { Router } from 'express';
import { mediaController } from '../controllers/media.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { generatePresignedUrlSchema } from '../schemas/media.schema';

const router = Router();

// Universal S3 presigned upload URL endpoints
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

export default router;
