import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { Interest } from '../models';
import { sendSuccess, sendError } from '../utils/response';

/**
 * Controller to list all available interests
 * GET /api/v1/interests (and /api/interests)
 * Supports optional search ?search=gaming
 */
export const getAllInterests = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;

    const whereClause: any = { isActive: true };
    if (search && search.trim()) {
      whereClause.name = { [Op.iLike || Op.like]: `%${search.trim()}%` };
    }

    const interests = await Interest.findAll({
      where: whereClause,
      order: [['name', 'ASC']],
    });

    return sendSuccess(res, 'Interests retrieved successfully', { interests }, 200);
  } catch (error: any) {
    console.error('[Interest Controller Error]:', error);
    return sendError(res, error.message || 'Error fetching interests', 500);
  }
};
