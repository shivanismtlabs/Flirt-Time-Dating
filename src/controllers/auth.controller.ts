import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User } from '../models/user.model';
import { UserDevice } from '../models/userDevice.model';
import { notificationService } from '../services/notification.service';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { checkUsernameAvailability, ServiceError } from '../services/user.service';

/**
 * Signup username availability check.
 * GET /api/v1/auth/username/availability?username=
 *
 * Public: the signup screen calls this before an account exists.
 * Success:
 * {
 *   "success": true,
 *   "message": "Username is available" | "Username is already taken",
 *   "data": { "username": "alex", "available": true }
 * }
 */
export const checkUsernameAvailabilityHandler = async (req: Request, res: Response) => {
  try {
    const result = await checkUsernameAvailability(String(req.query.username ?? ''));
    const message = result.available ? 'Username is available' : 'Username is already taken';
    return sendSuccess(res, message, result);
  } catch (error: any) {
    if (error instanceof ServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Error checking username availability', 500);
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { username, email, password, role } = req.body;

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [{ email }, { username }],
      },
    });

    if (existingUser) {
      return sendError(res, 'User with provided email or username already exists', 400);
    }

    const hashedPassword = await hashPassword(password);

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      role: role || 'user',
      isActive: true,
    });

    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    });

    return sendSuccess(
      res,
      'User registered successfully',
      {
        user: newUser.toJSON(),
        token,
      },
      201
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Error registering user', 500);
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return sendError(res, 'Invalid credentials', 401);
    }

    if (!user.isActive) {
      return sendError(res, 'User account is deactivated', 403);
    }

    if (!user.password) {
      return sendError(res, 'Invalid credentials', 401);
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return sendError(res, 'Invalid credentials', 401);
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    return sendSuccess(res, 'Login successful', {
      user: user.toJSON(),
      token,
    });
  } catch (error: any) {
    return sendError(res, error.message || 'Error logging in', 500);
  }
};

export const getProfile = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user) {
      return sendError(res, 'Not authenticated', 401);
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return sendError(res, 'User not found', 404);
    }

    return sendSuccess(res, 'User profile fetched successfully', {
      user: user.toJSON(),
    });
  } catch (error: any) {
    return sendError(res, error.message || 'Error fetching profile', 500);
  }
};

/**
 * User Logout
 * POST /api/v1/auth/logout
 *
 * In accordance with FlirtTime API Standards:
 * - Deactivates user's registered device token or all device tokens if requested.
 * - Adheres strictly to the standard response envelope:
 *   {
 *     "success": true,
 *     "message": "User logged out successfully",
 *     "data": {}
 *   }
 */
export const logout = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return sendError(res, 'Not authenticated', 401);
    }

    const userId = req.user.id;
    const { deviceToken, fcmToken, allDevices } = req.body || {};
    const rawToken = (deviceToken || fcmToken || '').trim();

    if (allDevices === true) {
      await UserDevice.update({ isActive: false }, { where: { userId } });
    } else if (rawToken) {
      await notificationService.deactivateDeviceToken(rawToken, userId);
    }

    return sendSuccess(res, 'User logged out successfully', {});
  } catch (error: any) {
    return sendError(res, error.message || 'Error logging out', 500);
  }
};

