import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { coinPackageService, CoinPackageServiceError } from '../services/coinPackage.service';
import { GetCoinPackagesQuery } from '../schemas/coinPackage.schema';

/**
 * Controller to fetch Coin Packages
 * GET /api/v1/coin-packages (and /api/coin-packages)
 *
 * Matches legacy Laravel response:
 * {
 *   "status": true,
 *   "message": "Coin packages retrieved successfully",
 *   "data": [ ... ],
 *   "pagination": { ... }
 * }
 */
export const getCoinPackagesHandler = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const query = req.query as unknown as GetCoinPackagesQuery;
    const result = await coinPackageService.getCoinPackages(query);

    return res.status(200).json({
      status: true,
      success: true,
      message: 'Coin packages retrieved successfully',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error: any) {
    if (error instanceof CoinPackageServiceError) {
      return res.status(error.statusCode).json({
        status: false,
        success: false,
        message: error.message,
        errorCode: error.errorCode,
      });
    }

    // Secure production error handling: never leak SQL statements or stack traces
    console.error('[CoinPackages Controller Error]:', error?.message || 'Unknown database error');

    return res.status(500).json({
      status: false,
      success: false,
      message: 'Internal server error while retrieving coin packages',
    });
  }
};
