import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  getDiscoveryPeople,
  recordDiscoveryAction,
} from '../controllers/discovery.controller';

const router = Router();

// GET /api/v1/discovery/people (and /api/discovery/people)
router.get('/people', authenticate, getDiscoveryPeople);

// POST /api/v1/discovery/actions (and /api/discovery/actions)
router.post('/actions', authenticate, recordDiscoveryAction);

export default router;

