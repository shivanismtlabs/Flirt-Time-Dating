import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { User } from '../models/user.model';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';

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
