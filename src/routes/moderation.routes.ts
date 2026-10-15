import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getBlockedUsersHandler,
  unblockUserHandler,
  getUserReportsHandler,
  getAllReportsHandler,
  updateReportStatusHandler,
  getReportReasonsHandler,
} from '../controllers/user.controller';
import {
  getBlockedUsersSchema,
  unblockUserSchema,
  getUserReportsSchema,
  getAllReportsSchema,
  updateReportStatusSchema,
} from '../schemas/user.schema';

const router = Router();

// Report reasons catalog
router.get('/reasons', getReportReasonsHandler);

// Authenticated endpoints for current user
router.get('/my-reports', authenticate, validate(getUserReportsSchema), getUserReportsHandler);
router.get('/blocked-users', authenticate, validate(getBlockedUsersSchema), getBlockedUsersHandler);
router.delete('/users/:userId/block', authenticate, validate(unblockUserSchema), unblockUserHandler);
router.post('/users/:userId/unblock', authenticate, validate(unblockUserSchema), unblockUserHandler);

// Moderation / Admin endpoints for reports (supports both /reports and /moderation/reports)
router.get('/', authenticate, validate(getAllReportsSchema), getAllReportsHandler);
router.get('/reports', authenticate, validate(getAllReportsSchema), getAllReportsHandler);
router.patch('/:reportId/status', authenticate, validate(updateReportStatusSchema), updateReportStatusHandler);
router.patch('/reports/:reportId/status', authenticate, validate(updateReportStatusSchema), updateReportStatusHandler);

export default router;
