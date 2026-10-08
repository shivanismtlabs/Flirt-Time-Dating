import crypto from 'crypto';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { env } from '../config/env';
import { PhoneVerification } from '../models/phoneVerification.model';
import { EmailVerification } from '../models/emailVerification.model';
import { User } from '../models/user.model';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { combineAndNormalizePhone, isValidCountryCode, isValidPhone } from '../utils/phone';
import { normalizeEmail } from '../utils/normalization';
import { smsProvider } from './sms.service';
import { emailProvider } from './email.service';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_REGEX = /^\d{6}$/;

export interface RequestOtpResult {
  statusCode: number;
  error?: string;
  data?: {
    verificationId: string;
    expiresIn: number;
    resendAfter: number;
  };
}

export interface ResendOtpResult {
  statusCode: number;
  error?: string;
  data?: {
    verificationId: string;
    expiresIn: number;
    resendAfter: number;
  };
}

export interface VerifyOtpResult {
  statusCode: number;
  error?: string;
  message?: string;
  data?: {
    token: string;
    user: any;
  };
}

/**
 * Service to manage Phone & Email OTP lifecycles.
 */
export class OtpService {
  /**
   * Request an initial Phone OTP
   */
  public async requestPhoneOtp(countryCode: string, phone: string): Promise<RequestOtpResult> {
    if (!countryCode || !isValidCountryCode(countryCode)) {
      return {
        statusCode: 400,
        error: 'Invalid or missing country code',
      };
    }

    if (!phone || !isValidPhone(phone)) {
      return {
        statusCode: 400,
        error: 'Invalid or missing phone number',
      };
    }

    const normalizedPhone = combineAndNormalizePhone(countryCode, phone);
    if (!normalizedPhone || normalizedPhone.length < 5) {
      return {
        statusCode: 400,
        error: 'Invalid phone number format',
      };
    }

    const now = new Date();
    const rateLimitWindowMs = (env.OTP_RATE_LIMIT_WINDOW_SECONDS || 3600) * 1000;
    const windowStart = new Date(now.getTime() - rateLimitWindowMs);
    const maxRequests = env.OTP_RATE_LIMIT_MAX || 5;

    // Rate limiting
    const recentRequestsCount = await PhoneVerification.count({
      where: {
        phone: normalizedPhone,
        createdAt: {
          [Op.gte]: windowStart,
        },
      },
    });

    if (recentRequestsCount >= maxRequests) {
      return {
        statusCode: 429,
        error: 'Too many OTP requests for this phone number. Please try again later.',
      };
    }

    const isPostgres = sequelize.getDialect() === 'postgres';
    const cooldownSeconds = env.OTP_RESEND_COOLDOWN_SECONDS || 60;
    const expiresIn = env.OTP_EXPIRY_SECONDS || 300;
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);

    const result = await sequelize.transaction(async (t) => {
      const activeRecord = await PhoneVerification.findOne({
        where: {
          phone: normalizedPhone,
          isConsumed: false,
          isVerified: false,
          expiresAt: {
            [Op.gt]: now,
          },
        },
        order: [['createdAt', 'DESC']],
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (activeRecord) {
        const lastSent = activeRecord.lastResentAt || activeRecord.createdAt;
        if (lastSent) {
          const elapsedSeconds = (now.getTime() - new Date(lastSent).getTime()) / 1000;
          if (elapsedSeconds < cooldownSeconds) {
            return {
              statusCode: 429,
              error: 'Please wait before requesting another OTP',
            };
          }
        }

        activeRecord.isConsumed = true;
        await activeRecord.save({ transaction: t });
      }

      // Generate cryptographically secure 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();
      const otpHash = await hashPassword(otp);

      const verificationRecord = await PhoneVerification.create(
        {
          phone: normalizedPhone,
          otpHash,
          expiresAt,
          isConsumed: false,
          isVerified: false,
          attempts: 0,
          maxAttempts: 5,
          resendCount: 0,
          maxResends: env.MAX_OTP_RESENDS || 3,
          lastResentAt: now,
        },
        { transaction: t }
      );

      await smsProvider.sendOtp(normalizedPhone, otp);

      return {
        statusCode: 200,
        data: {
          verificationId: verificationRecord.id,
          expiresIn,
          resendAfter: cooldownSeconds,
        },
      };
    });

    return result;
  }

  /**
   * Request an initial Email OTP
   */
  public async requestEmailOtp(rawEmail: string): Promise<RequestOtpResult> {
    if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.trim()) {
      return {
        statusCode: 400,
        error: 'Email is required',
      };
    }

    const normalizedEmail = normalizeEmail(rawEmail);
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return {
        statusCode: 400,
        error: 'Invalid email address format',
      };
    }

    const now = new Date();
    const rateLimitWindowMs = (env.OTP_RATE_LIMIT_WINDOW_SECONDS || 3600) * 1000;
    const windowStart = new Date(now.getTime() - rateLimitWindowMs);
    const maxRequests = env.OTP_RATE_LIMIT_MAX || 5;

    // Rate limiting: count requests for this email in rolling window
    const recentRequestsCount = await EmailVerification.count({
      where: {
        email: normalizedEmail,
        createdAt: {
          [Op.gte]: windowStart,
        },
      },
    });

    if (recentRequestsCount >= maxRequests) {
      return {
        statusCode: 429,
        error: 'Too many OTP requests for this email address. Please try again later.',
      };
    }

    const isPostgres = sequelize.getDialect() === 'postgres';
    const cooldownSeconds = env.OTP_RESEND_COOLDOWN_SECONDS || 60;
    const expiresIn = env.OTP_EXPIRY_SECONDS || 300;
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);

    // Atomic transaction for single active session and cooldown check
    const result = await sequelize.transaction(async (t) => {
      const activeRecord = await EmailVerification.findOne({
        where: {
          email: normalizedEmail,
          isConsumed: false,
          isVerified: false,
          expiresAt: {
            [Op.gt]: now,
          },
        },
        order: [['createdAt', 'DESC']],
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (activeRecord) {
        const lastSent = activeRecord.lastResentAt || activeRecord.createdAt;
        if (lastSent) {
          const elapsedSeconds = (now.getTime() - new Date(lastSent).getTime()) / 1000;
          if (elapsedSeconds < cooldownSeconds) {
            return {
              statusCode: 429,
              error: 'Please wait before requesting another code',
            };
          }
        }

        // Invalidate previous unconsumed verification session
        activeRecord.isConsumed = true;
        await activeRecord.save({ transaction: t });
      }

      // Generate cryptographically secure 6-digit OTP (NEVER Math.random)
      const otp = crypto.randomInt(100000, 1000000).toString();

      // Securely hash OTP before storage
      const otpHash = await hashPassword(otp);

      // Store new email verification record
      const verificationRecord = await EmailVerification.create(
        {
          email: normalizedEmail,
          otpHash,
          expiresAt,
          isConsumed: false,
          isVerified: false,
          attempts: 0,
          maxAttempts: 5,
          resendCount: 0,
          maxResends: env.MAX_OTP_RESENDS || 3,
          lastResentAt: now,
        },
        { transaction: t }
      );

      // Dispatch OTP through Email provider abstraction
      const sent = await emailProvider.sendOtp(normalizedEmail, otp);
      if (!sent) {
        throw new Error('Email service provider dispatch failed');
      }

      return {
        statusCode: 200,
        data: {
          verificationId: verificationRecord.id,
          expiresIn,
          resendAfter: cooldownSeconds,
        },
      };
    });

    return result;
  }

  /**
   * Resend Phone OTP for an active verification session
   */
  public async resendPhoneOtp(verificationId: string): Promise<ResendOtpResult> {
    if (!verificationId || typeof verificationId !== 'string' || !verificationId.trim()) {
      return {
        statusCode: 400,
        error: 'Verification ID is required',
      };
    }

    const trimmedId = verificationId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return {
        statusCode: 400,
        error: 'Invalid verification ID format',
      };
    }

    const isPostgres = sequelize.getDialect() === 'postgres';
    const cooldownSeconds = env.OTP_RESEND_COOLDOWN_SECONDS || 60;
    const expiresIn = env.OTP_EXPIRY_SECONDS || 300;

    const result = await sequelize.transaction(async (t) => {
      const verificationRecord = await PhoneVerification.findByPk(trimmedId, {
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (!verificationRecord) {
        return {
          statusCode: 404,
          error: 'Verification record not found or invalid verification ID',
        };
      }

      if (verificationRecord.isConsumed || verificationRecord.isVerified) {
        return {
          statusCode: 400,
          error: 'Cannot resend OTP. Verification session has already been used or completed.',
        };
      }

      const now = new Date();

      const lastSent = verificationRecord.lastResentAt || verificationRecord.createdAt;
      if (lastSent) {
        const elapsedSeconds = (now.getTime() - new Date(lastSent).getTime()) / 1000;
        if (elapsedSeconds < cooldownSeconds) {
          return {
            statusCode: 429,
            error: 'Please wait before requesting another code',
          };
        }
      }

      const maxResends = verificationRecord.maxResends || env.MAX_OTP_RESENDS || 3;
      if (verificationRecord.resendCount >= maxResends) {
        return {
          statusCode: 429,
          error: 'Maximum resend attempts reached for this verification session. Please start a new verification.',
        };
      }

      const newOtp = crypto.randomInt(100000, 1000000).toString();
      const newOtpHash = await hashPassword(newOtp);
      const newExpiresAt = new Date(now.getTime() + expiresIn * 1000);

      verificationRecord.otpHash = newOtpHash;
      verificationRecord.attempts = 0;
      verificationRecord.resendCount += 1;
      verificationRecord.lastResentAt = now;
      verificationRecord.expiresAt = newExpiresAt;

      await verificationRecord.save({ transaction: t });

      await smsProvider.sendOtp(verificationRecord.phone, newOtp);

      return {
        statusCode: 200,
        data: {
          verificationId: verificationRecord.id,
          expiresIn,
          resendAfter: cooldownSeconds,
        },
      };
    });

    return result;
  }

  /**
   * Verify an Email OTP and find/create user with JWT token
   */
  public async verifyEmailOtp(verificationId: string, otp: string): Promise<VerifyOtpResult> {
    if (!verificationId || typeof verificationId !== 'string' || !verificationId.trim()) {
      return {
        statusCode: 400,
        error: 'Verification ID is required',
      };
    }

    const trimmedId = verificationId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return {
        statusCode: 400,
        error: 'Invalid verification ID format',
      };
    }

    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      return {
        statusCode: 400,
        error: 'OTP is required',
      };
    }

    const trimmedOtp = otp.trim();
    if (!OTP_REGEX.test(trimmedOtp)) {
      return {
        statusCode: 400,
        error: 'OTP must be exactly 6 numeric digits',
      };
    }

    const isPostgres = sequelize.getDialect() === 'postgres';

    const result = await sequelize.transaction(async (t) => {
      const verificationRecord = await EmailVerification.findByPk(trimmedId, {
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (!verificationRecord) {
        return {
          statusCode: 404,
          error: 'Verification record not found or invalid verification ID',
        };
      }

      if (verificationRecord.isConsumed) {
        return {
          statusCode: 400,
          error: 'OTP has already been used. Please request a new OTP.',
        };
      }

      const now = new Date();
      if (new Date(verificationRecord.expiresAt) < now) {
        verificationRecord.isConsumed = true;
        await verificationRecord.save({ transaction: t });
        return {
          statusCode: 400,
          error: 'OTP has expired. Please request a new OTP.',
        };
      }

      if (verificationRecord.attempts >= verificationRecord.maxAttempts) {
        verificationRecord.isConsumed = true;
        await verificationRecord.save({ transaction: t });
        return {
          statusCode: 400,
          error: 'Maximum verification attempts exceeded. Please request a new OTP.',
        };
      }

      const isMatch = await comparePassword(trimmedOtp, verificationRecord.otpHash);
      if (!isMatch) {
        verificationRecord.attempts += 1;
        const reachedMax = verificationRecord.attempts >= verificationRecord.maxAttempts;
        if (reachedMax) {
          verificationRecord.isConsumed = true;
        }
        await verificationRecord.save({ transaction: t });

        return {
          statusCode: 401,
          error: reachedMax
            ? 'Maximum verification attempts exceeded. Please request a new OTP.'
            : 'Invalid verification code',
        };
      }

      // Atomically consume OTP with conditional check
      const [affectedRows] = await EmailVerification.update(
        {
          isConsumed: true,
          isVerified: true,
          consumedAt: now,
        },
        {
          where: {
            id: verificationRecord.id,
            isConsumed: false,
          },
          transaction: t,
        }
      );

      if (affectedRows === 0) {
        return {
          statusCode: 400,
          error: 'OTP has already been used. Please request a new OTP.',
        };
      }

      const normalizedEmail = normalizeEmail(verificationRecord.email);

      // Find or create user
      let user = await User.findOne({
        where: { email: normalizedEmail },
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (!user) {
        const emailPrefix = normalizedEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');
        let username = emailPrefix.length >= 3 ? emailPrefix.slice(0, 30) : `user_${crypto.randomBytes(4).toString('hex')}`;

        const existingUserByUsername = await User.findOne({
          where: { username },
          transaction: t,
        });

        if (existingUserByUsername) {
          const suffix = crypto.randomBytes(3).toString('hex');
          username = `${username.slice(0, 20)}_${suffix}`;
        }

        const randomPassword = crypto.randomBytes(24).toString('hex');
        const hashedPassword = await hashPassword(randomPassword);

        user = await User.create(
          {
            username,
            email: normalizedEmail,
            password: hashedPassword,
            role: 'user',
            isActive: true,
          },
          { transaction: t }
        );
      }

      const token = generateToken({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
      });

      return {
        statusCode: 200,
        message: 'Email verified successfully',
        data: {
          token,
          user: user.toJSON(),
        },
      };
    });

    return result;
  }

  /**
   * Resend Email OTP for an active verification session
   */
  public async resendEmailOtp(verificationId: string): Promise<ResendOtpResult> {
    if (!verificationId || typeof verificationId !== 'string' || !verificationId.trim()) {
      return {
        statusCode: 400,
        error: 'Verification ID is required',
      };
    }

    const trimmedId = verificationId.trim();
    if (!UUID_REGEX.test(trimmedId)) {
      return {
        statusCode: 400,
        error: 'Invalid verification ID format',
      };
    }

    const isPostgres = sequelize.getDialect() === 'postgres';
    const cooldownSeconds = env.OTP_RESEND_COOLDOWN_SECONDS || 60;
    const expiresIn = env.OTP_EXPIRY_SECONDS || 300;

    const result = await sequelize.transaction(async (t) => {
      const verificationRecord = await EmailVerification.findByPk(trimmedId, {
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (!verificationRecord) {
        return {
          statusCode: 404,
          error: 'Verification record not found or invalid verification ID',
        };
      }

      if (verificationRecord.isConsumed || verificationRecord.isVerified) {
        return {
          statusCode: 400,
          error: 'Cannot resend OTP. Verification session has already been used or completed.',
        };
      }

      const now = new Date();

      const lastSent = verificationRecord.lastResentAt || verificationRecord.createdAt;
      if (lastSent) {
        const elapsedSeconds = (now.getTime() - new Date(lastSent).getTime()) / 1000;
        if (elapsedSeconds < cooldownSeconds) {
          return {
            statusCode: 429,
            error: 'Please wait before requesting another code',
          };
        }
      }

      const maxResends = verificationRecord.maxResends || env.MAX_OTP_RESENDS || 3;
      if (verificationRecord.resendCount >= maxResends) {
        return {
          statusCode: 429,
          error: 'Maximum resend attempts reached for this verification session. Please start a new verification.',
        };
      }

      // Generate cryptographically secure 6-digit numeric OTP (NEVER Math.random)
      const newOtp = crypto.randomInt(100000, 1000000).toString();
      const newOtpHash = await hashPassword(newOtp);
      const newExpiresAt = new Date(now.getTime() + expiresIn * 1000);

      // Update state
      verificationRecord.otpHash = newOtpHash;
      verificationRecord.attempts = 0; // Reset failed attempts for new OTP
      verificationRecord.resendCount += 1;
      verificationRecord.lastResentAt = now;
      verificationRecord.expiresAt = newExpiresAt;

      await verificationRecord.save({ transaction: t });

      // Dispatch through email provider abstraction
      const sent = await emailProvider.sendOtp(verificationRecord.email, newOtp);
      if (!sent) {
        throw new Error('Email service provider dispatch failed');
      }

      return {
        statusCode: 200,
        data: {
          verificationId: verificationRecord.id,
          expiresIn,
          resendAfter: cooldownSeconds,
        },
      };
    });

    return result;
  }
}

export const otpService = new OtpService();
