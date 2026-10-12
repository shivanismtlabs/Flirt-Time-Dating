import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getDiscoveryPeople,
  recordDiscoveryAction,
  getDiscoveryInterests,
  getInterestUsers,
  getFeaturedInterests,
} from '../controllers/discovery.controller';
import {
  getDiscoveryInterestsSchema,
  getInterestUsersSchema,
  getFeaturedInterestsSchema,
} from '../schemas/discovery.schema';

const router = Router();

// GET /api/v1/discovery/people (and /api/discovery/people)
router.get('/people', authenticate, getDiscoveryPeople);

// POST /api/v1/discovery/actions (and /api/discovery/actions)
router.post('/actions', authenticate, recordDiscoveryAction);

// GET /api/v1/discovery/interests (and /api/discovery/interests)
router.get(
  '/interests',
  authenticate,
  validate(getDiscoveryInterestsSchema),
  getDiscoveryInterests
);

// GET /api/v1/discovery/interests/featured (and /api/discovery/interests/featured)
// Declared BEFORE :interestId/users to prevent route parameter collision
router.get(
  '/interests/featured',
  authenticate,
  validate(getFeaturedInterestsSchema),
  getFeaturedInterests
);

// GET /api/v1/discovery/interests/:interestId/users (and /api/discovery/interests/:interestId/users)
router.get(
  '/interests/:interestId/users',
  authenticate,
  validate(getInterestUsersSchema),
  getInterestUsers
);

export default router;
