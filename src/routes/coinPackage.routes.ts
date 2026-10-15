import { Router } from 'express';
import { getCoinPackagesHandler } from '../controllers/coinPackage.controller';
import { validate } from '../middlewares/validate.middleware';
import { getCoinPackagesSchema } from '../schemas/coinPackage.schema';
import { optionalAuthenticate } from '../middlewares/auth.middleware';

const router = Router();

/**
 * GET /api/v1/coin-packages
 * Optional authentication: public access allowed, but attaches user context if Bearer token present
 */
router.get(
  '/',
  optionalAuthenticate,
  validate(getCoinPackagesSchema),
  getCoinPackagesHandler
);

export default router;
