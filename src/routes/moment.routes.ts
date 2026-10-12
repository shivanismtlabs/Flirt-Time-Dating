import { Router } from 'express';
import {
  createMomentHandler,
  getMomentDetailHandler,
  reactMomentHandler,
  replyMomentHandler,
  getUserMomentsHandler,
  getAllMomentsHandler,
  getMyMomentsHandler,
  reportMomentHandler,
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
  getAllMomentsSchema,
  reportMomentSchema,
} from '../schemas/moment.schema';

const router = Router();

// All moments endpoints require authentication
router.use(authenticate);

// 1. All Active Moments Feed / Stories (GET /api/v1/moments?page=1&limit=20&type=feed|stories&scope=all|others|self|matches)
router.get(
  '/',
  validate(getAllMomentsSchema),
  getAllMomentsHandler
);

// 2. Feed alias (GET /api/v1/moments/feed)
router.get(
  '/feed',
  validate(getAllMomentsSchema),
  getAllMomentsHandler
);

// 3. See Others' Moments Feed (GET /api/v1/moments/others)
router.get(
  '/others',
  (req, _res, next) => {
    req.query.scope = req.query.scope || 'others';
    next();
  },
  validate(getAllMomentsSchema),
  getAllMomentsHandler
);

// 4. Authenticated User's Individual Moments (GET /api/v1/moments/me & /my)
router.get(
  '/me',
  getMyMomentsHandler
);

router.get(
  '/my',
  getMyMomentsHandler
);

// 5. Create Moment (1-5 images)
router.post(
  '/',
  handleUploadMomentImages,
  validate(createMomentSchema),
  createMomentHandler
);

// 6. User Moments listing by User ID (GET /api/v1/moments/user/:userId)
router.get(
  '/user/:userId',
  validate(getUserMomentsSchema),
  getUserMomentsHandler
);

// 7. Full-screen Moment detail
router.get(
  '/:momentId',
  validate(getMomentDetailSchema),
  getMomentDetailHandler
);

// 4. React to Moment
router.post(
  '/:momentId/reactions',
  validate(reactMomentSchema),
  reactMomentHandler
);

// 5. Reply to Moment
router.post(
  '/:momentId/replies',
  validate(replyMomentSchema),
  replyMomentHandler
);

// 6. Report Moment
router.post(
  '/:momentId/report',
  validate(reportMomentSchema),
  reportMomentHandler
);

export default router;
