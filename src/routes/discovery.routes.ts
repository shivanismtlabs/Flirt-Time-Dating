import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { getDiscoveryPeople } from '../controllers/discovery.controller';

const router = Router();

// GET /api/v1/discovery/people (and /api/discovery/people)
router.get('/people', authenticate, getDiscoveryPeople);

export default router;
