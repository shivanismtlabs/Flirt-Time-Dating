import { Router } from 'express';
import {
  createMomentHandler,
  getMomentDetailHandler,
  likeMomentHandler,
  reactMomentHandler,
  replyMomentHandler,
  getUserMomentsHandler,
  getAllMomentsHandler,
  getMyMomentsHandler,
  reportMomentHandler,
  deleteMomentHandler,
  unlikeMomentHandler,
  getMomentCommentsHandler,
  deleteMomentCommentHandler,
  getMomentLikesHandler,
  getMomentGiftsCatalogHandler,
  sendMomentGiftHandler,
  getMomentGiftsReceivedHandler,
} from '../controllers/moment.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { handleUploadMomentImages } from '../middlewares/upload.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  createMomentSchema,
  getMomentDetailSchema,
  getUserMomentsSchema,
  likeMomentSchema,
  reactMomentSchema,
  replyMomentSchema,
  getAllMomentsSchema,
  reportMomentSchema,
  deleteMomentSchema,
  unlikeMomentSchema,
  getMomentCommentsSchema,
  deleteMomentCommentSchema,
  getMomentLikesSchema,
  sendMomentGiftSchema,
  getMomentGiftsCatalogSchema,
  getMomentGiftsReceivedSchema,
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

// General Gifts Catalog & User Coins Balance (GET /api/v1/moments/gifts)
router.get(
  '/gifts',
  validate(getMomentGiftsCatalogSchema),
  getMomentGiftsCatalogHandler
);

// 7. Full-screen Moment detail
router.get(
  '/:momentId',
  validate(getMomentDetailSchema),
  getMomentDetailHandler
);

// 4. Like / Unlike Toggle Moment (Single API)
router.post(
  '/:momentId/like',
  validate(likeMomentSchema),
  likeMomentHandler
);

router.post(
  '/:momentId/toggle-like',
  validate(likeMomentSchema),
  likeMomentHandler
);

// Reaction endpoint (supports specific emoji reactions like fire, laugh, clap, etc.)
router.post(
  '/:momentId/reactions',
  validate(reactMomentSchema),
  reactMomentHandler
);

// Get Likes / Reactions List for a Moment
router.get(
  '/:momentId/likes',
  validate(getMomentLikesSchema),
  getMomentLikesHandler
);

router.get(
  '/:momentId/reactions',
  validate(getMomentLikesSchema),
  getMomentLikesHandler
);

// 5. Comments & Replies to Moment
router.post(
  '/:momentId/comments',
  validate(replyMomentSchema),
  replyMomentHandler
);

router.post(
  '/:momentId/replies',
  validate(replyMomentSchema),
  replyMomentHandler
);

router.get(
  '/:momentId/comments',
  validate(getMomentCommentsSchema),
  getMomentCommentsHandler
);

router.get(
  '/:momentId/replies',
  validate(getMomentCommentsSchema),
  getMomentCommentsHandler
);

// Delete Comment / Reply
router.delete(
  '/:momentId/comments/:commentId',
  validate(deleteMomentCommentSchema),
  deleteMomentCommentHandler
);

router.delete(
  '/:momentId/replies/:commentId',
  validate(deleteMomentCommentSchema),
  deleteMomentCommentHandler
);

router.delete(
  '/comments/:commentId',
  validate(deleteMomentCommentSchema),
  deleteMomentCommentHandler
);

// 6. Gifts on Moment (Send Gift & Gifts Catalog)
router.get(
  '/:momentId/gifts',
  validate(getMomentGiftsCatalogSchema),
  getMomentGiftsCatalogHandler
);

router.post(
  '/:momentId/gifts',
  validate(sendMomentGiftSchema),
  sendMomentGiftHandler
);

router.post(
  '/:momentId/send-gift',
  validate(sendMomentGiftSchema),
  sendMomentGiftHandler
);

router.get(
  '/:momentId/gifts/received',
  validate(getMomentGiftsReceivedSchema),
  getMomentGiftsReceivedHandler
);

router.get(
  '/:momentId/gifts/list',
  validate(getMomentGiftsReceivedSchema),
  getMomentGiftsReceivedHandler
);

// 6. Report Moment
router.post(
  '/:momentId/report',
  validate(reportMomentSchema),
  reportMomentHandler
);

// 7. Delete Moment (Author only)
router.delete(
  '/:momentId',
  validate(deleteMomentSchema),
  deleteMomentHandler
);

// 8. Unlike Moment / Remove Reaction
router.delete(
  '/:momentId/reactions',
  validate(unlikeMomentSchema),
  unlikeMomentHandler
);

router.delete(
  '/:momentId/like',
  validate(unlikeMomentSchema),
  unlikeMomentHandler
);

router.post(
  '/:momentId/unlike',
  validate(unlikeMomentSchema),
  unlikeMomentHandler
);

export default router;

