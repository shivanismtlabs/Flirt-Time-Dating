import { Router } from 'express';
import { getAllInterests } from '../controllers/interest.controller';

const router = Router();

// GET /api/v1/interests (and /api/interests)
router.get('/', getAllInterests);

export default router;
