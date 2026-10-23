import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handleUploadQuickMomentMedia } from '../middlewares/upload.middleware';
import {
  getTrayHandler,
  getMyQuickMomentsHandler,
  getUserQuickMomentsHandler,
  getQuickMomentReactionsHandler,
  reactQuickMomentHandler,
  replyQuickMomentHandler,
  getQuickMomentRepliesHandler,
  markViewedHandler,
  getViewersHandler,
  createQuickMomentHandler,
  deleteQuickMomentHandler,
  getPresignedUploadUrlHandler,
} from '../controllers/quickMoment.controller';
import {
  createQuickMomentSchema,
  reactQuickMomentSchema,
  replyQuickMomentSchema,
  getQuickMomentRepliesSchema,
  getQuickMomentReactionsSchema,
  getTargetUserQuickMomentsSchema,
  getPresignedUploadUrlSchema,
} from '../schemas/quickMoment.schema';

const router = Router();

// All Quick Moments routes require authentication
router.use(authenticate);

// 1. Screen 1: Story tray / bar (GET /api/v1/quick-moments/tray and /api/v1/quick-moments)
router.get('/tray', (req, res) => getTrayHandler(req, res));
router.get('/', (req, res) => getTrayHandler(req, res));

// 2. Screen 2: View own active Quick Moments slides (GET /api/v1/quick-moments/me)
router.get('/me', (req, res) => getMyQuickMomentsHandler(req, res));

// 3. S3 Presigned Upload URL generation (POST /api/v1/quick-moments/upload-url)
router.post(
  '/upload-url',
  validate(getPresignedUploadUrlSchema),
  (req, res) => getPresignedUploadUrlHandler(req, res)
);

// 4. Create Quick Moment (image or text story) (POST /api/v1/quick-moments)
router.post(
  '/',
  handleUploadQuickMomentMedia,
  validate(createQuickMomentSchema),
  (req, res) => createQuickMomentHandler(req, res)
);

// 5. Screen 3: View other user's active Quick Moments (GET /api/v1/quick-moments/user/:userId)
router.get(
  '/user/:userId',
  validate(getTargetUserQuickMomentsSchema),
  (req, res) => getUserQuickMomentsHandler(req, res)
);

// 6. Screen 1 reaction list: "1 image me jo reaction wo kisne hme reaction diye wo he if more than willopen list"
// (GET /api/v1/quick-moments/:momentId/reactions)
router.get(
  '/:momentId/reactions',
  validate(getQuickMomentReactionsSchema),
  (req, res) => getQuickMomentReactionsHandler(req, res)
);

// 7. React to Quick Moment with emoji (POST /api/v1/quick-moments/:momentId/react)
router.post(
  '/:momentId/react',
  validate(reactQuickMomentSchema),
  (req, res) => reactQuickMomentHandler(req, res)
);

// 8. Reply to Quick Moment (POST /api/v1/quick-moments/:momentId/reply)
router.post(
  '/:momentId/reply',
  validate(replyQuickMomentSchema),
  (req, res) => replyQuickMomentHandler(req, res)
);

// 8b. Reply list for the owner activity sheet
// GET /api/v1/quick-moments/:momentId/replies?page=1&limit=30
router.get(
  '/:momentId/replies',
  validate(getQuickMomentRepliesSchema),
  (req, res) => getQuickMomentRepliesHandler(req, res)
);

// 9. Mark Quick Moment as viewed / seen (POST /api/v1/quick-moments/:momentId/view)
router.post('/:momentId/view', (req, res) => markViewedHandler(req, res));

// 10. Get viewers of a Quick Moment (GET /api/v1/quick-moments/:momentId/viewers)
router.get('/:momentId/viewers', (req, res) => getViewersHandler(req, res));

// 11. Delete own Quick Moment (DELETE /api/v1/quick-moments/:momentId)
router.delete('/:momentId', (req, res) => deleteQuickMomentHandler(req, res));

export default router;
