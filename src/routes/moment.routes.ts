import { Router } from 'express';
import {
  createMomentHandler,
  getMomentDetailHandler,
  reactMomentHandler,
  replyMomentHandler,
  getUserMomentsHandler,
} from '../controllers/moment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadMomentImages } from '../middlewares/upload.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createMomentSchema,
  getMomentDetailSchema,
  getUserMomentsSchema,
  reactMomentSchema,
  replyMomentSchema,
} from '../schemas/moment.schema';

const router = Router();

// All moments endpoints require authentication
router.use(authenticate);

// 1. Create Quick Moment (1-5 images)
router.post(
  '/',
  handleUploadMomentImages,
  validate(createMomentSchema),
  createMomentHandler
);

// 2. User Moments listing alias
router.get(
  '/user/:userId',
  validate(getUserMomentsSchema),
  getUserMomentsHandler
);

// 3. Full-screen Moment detail
router.get(
  '/:momentId',
  validate(getMomentDetailSchema),
  getMomentDetailHandler
);

// 4. React to Quick Moment
router.post(
  '/:momentId/reactions',
  validate(reactMomentSchema),
  reactMomentHandler
);

// 5. Reply to Quick Moment
router.post(
  '/:momentId/replies',
  validate(replyMomentSchema),
  replyMomentHandler
);

export default router;
