import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getInteractionsHandler,
  getInteractionCountsHandler,
  markInteractionReadHandler,
} from '../controllers/interaction.controller';
import {
  getInteractionsSchema,
  markInteractionReadSchema,
} from '../schemas/interaction.schema';

const router = Router();

// All interaction routes require authentication
router.use(authenticate);

// 1. GET /api/v1/interactions/counts (Declared before parameterized routes)
router.get('/counts', getInteractionCountsHandler);

// 2. GET /api/v1/interactions?type=likes|you_liked|matches|compliments&limit=20&cursor=...&sort=recent
router.get('/', validate(getInteractionsSchema), getInteractionsHandler);

// 3. POST /api/v1/interactions/:interactionId/read
router.post(
  '/:interactionId/read',
  validate(markInteractionReadSchema),
  markInteractionReadHandler
);

export default router;
