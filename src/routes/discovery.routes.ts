import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getDiscoveryPeople,
  recordDiscoveryAction,
  getDiscoveryInterests,
  getInterestUsers,
  getFeaturedInterests,
  seedDummyUsersHandler,
} from '../controllers/discovery.controller';
import {
  getDiscoveryInterestsSchema,
  getInterestUsersSchema,
  getFeaturedInterestsSchema,
} from '../schemas/discovery.schema';

import {
  getDiscoveryFilterOptions,
  getDiscoveryFilters,
  updateDiscoveryFilters,
  resetDiscoveryFilters,
  searchDiscoveryProfiles,
} from '../controllers/discoveryFilter.controller';
import { getUserLimitsHandler } from '../controllers/user.controller';
import {
  updateDiscoveryFiltersSchema,
  discoverySearchSchema,
} from '../schemas/discoveryFilter.schema';

const router = Router();

// ==========================================
// DISCOVERY FILTERS & SEARCH ENDPOINTS
// ==========================================

// GET /api/v1/discovery/filters/options (and /api/discovery/filters/options)
router.get('/filters/options', authenticate, getDiscoveryFilterOptions);

// GET /api/v1/discovery/filters (and /api/discovery/filters)
router.get('/filters', authenticate, getDiscoveryFilters);

// PUT /api/v1/discovery/filters (and /api/discovery/filters)
router.put(
  '/filters',
  authenticate,
  validate(updateDiscoveryFiltersSchema),
  updateDiscoveryFilters
);

// POST /api/v1/discovery/filters/reset (and /api/discovery/filters/reset)
router.post('/filters/reset', authenticate, resetDiscoveryFilters);

// POST /api/v1/discovery/search (and /api/discovery/search)
router.post(
  '/search',
  authenticate,
  validate(discoverySearchSchema),
  searchDiscoveryProfiles
);

// GET /api/v1/discovery/search (optional query support)
router.get('/search', authenticate, searchDiscoveryProfiles);

// POST /api/v1/discovery/seed-dummy-data (Seeds 50 dummy discovery users)
router.post('/seed-dummy-data', seedDummyUsersHandler);

// GET /api/v1/discovery/limits (Convenience alias for /api/v1/users/limits)
router.get('/limits', authenticate, getUserLimitsHandler);
router.get('/:userId/limits', authenticate, getUserLimitsHandler);

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
