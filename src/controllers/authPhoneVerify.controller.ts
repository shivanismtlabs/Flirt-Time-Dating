import { Request, Response } from 'express';
import crypto from 'crypto';
import { sequelize } from '../config/database';
import { PhoneVerification } from '../models/phoneVerification.model';
import { User } from '../models/user.model';
import { comparePassword, hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { sendSuccess, sendError } from '../utils/response';
import { normalizePhone } from '../utils/phone';

// UUID validation regex (supports all standard 32-hex 8-4-4-4-12 UUID variants)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Exactly 6 numeric digits
const OTP_REGEX = /^\d{6}$/;

/**
 * Controller to verify a 6-digit phone OTP and authenticate/create user.
 * 
 * Flow:
 * 1. Validate request body (verificationId, otp)
 * 2. Require exactly 6 numeric digits for OTP
 * 3. Find PhoneVerification record in PostgreSQL within transaction with row locking
 * 4. Verify record existence, expiration, consumption, max attempts
 * 5. Compare OTP against bcrypt hash securely
 * 6. Atomically update attempts / invalidate on failure
 * 7. Atomically consume OTP with conditional update, mark phone verified, find/create user, generate JWT on success
 * 8. Never leak OTP or hash in logs or responses
 */
export const verifyPhoneOtp = async (req: Request, res: Response) => {
  try {
    const { verificationId, otp } = req.body || {};

    // 1 & 2: Require verificationId
    if (!verificationId || typeof verificationId !== 'string' || !verificationId.trim()) {
      return sendError(res, 'Verification ID is required', 400);
    }

    const trimmedVerificationId = verificationId.trim();

    // Validate UUID format to prevent invalid syntax SQL errors
    if (!UUID_REGEX.test(trimmedVerificationId)) {
      return sendError(res, 'Invalid verification ID format', 400);
    }

    // 1, 3 & 4: Require OTP with exactly 6 numeric digits
    if (!otp || typeof otp !== 'string' || !otp.trim()) {
      return sendError(res, 'OTP is required', 400);
    }

    const trimmedOtp = otp.trim();

    if (!OTP_REGEX.test(trimmedOtp)) {
      return sendError(res, 'OTP must be exactly 6 numeric digits', 400);
    }

    const isPostgres = sequelize.getDialect() === 'postgres';

    // Use managed database transaction with row locking to protect against concurrent verification race conditions
    const transactionResult = await sequelize.transaction(async (t) => {
      // 5: Find record with row lock (FOR UPDATE in PostgreSQL)
      const verificationRecord = await PhoneVerification.findByPk(trimmedVerificationId, {
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      // 6: Check that record exists
      if (!verificationRecord) {
        return {
          statusCode: 404,
          error: 'Verification record not found or invalid verification ID',
        };
      }

      // 8: Check that it is not already consumed
      if (verificationRecord.isConsumed) {
        return {
          statusCode: 400,
          error: 'OTP has already been used. Please request a new OTP.',
        };
      }

      // 7: Check that it is not expired
      const now = new Date();
      if (new Date(verificationRecord.expiresAt) < now) {
        // Mark as consumed to prevent future attempts on expired token
        verificationRecord.isConsumed = true;
        await verificationRecord.save({ transaction: t });
        return {
          statusCode: 400,
          error: 'OTP has expired. Please request a new OTP.',
        };
      }

      // 9: Check maximum verification attempts
      if (verificationRecord.attempts >= verificationRecord.maxAttempts) {
        verificationRecord.isConsumed = true;
        await verificationRecord.save({ transaction: t });
        return {
          statusCode: 400,
          error: 'Maximum verification attempts exceeded. Please request a new OTP.',
        };
      }

      // 10: Securely compare submitted OTP with stored hash
      const isMatch = await comparePassword(trimmedOtp, verificationRecord.otpHash);

      // 11: If incorrect:
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

      // 12 & 13: If correct: consume OTP atomically using atomic conditional update
      const [affectedRows] = await PhoneVerification.update(
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

      const normalizedPhone = normalizePhone(verificationRecord.phone);

      // Find or create user
      let user = await User.findOne({
        where: { phone: normalizedPhone },
        transaction: t,
        ...(isPostgres && { lock: t.LOCK.UPDATE }),
      });

      if (user) {
        if (!user.isPhoneVerified) {
          user.isPhoneVerified = true;
          await user.save({ transaction: t });
        }
      } else {
        // Generate unique username based on phone
        const cleanPhoneDigits = normalizedPhone.replace(/\D/g, '');
        let username = `user_${cleanPhoneDigits}`;

        // Ensure username collision avoidance
        const existingUserByUsername = await User.findOne({
          where: { username },
          transaction: t,
        });

        if (existingUserByUsername) {
          const suffix = crypto.randomBytes(3).toString('hex');
          username = `user_${cleanPhoneDigits}_${suffix}`;
        }

        const defaultEmail = `${cleanPhoneDigits}@phone.flirttime.app`;
        const randomPassword = crypto.randomBytes(24).toString('hex');
        const hashedPassword = await hashPassword(randomPassword);

        user = await User.create(
          {
            username,
            phone: normalizedPhone,
            isPhoneVerified: true,
            email: defaultEmail,
            password: hashedPassword,
            role: 'user',
            isActive: true,
          },
          { transaction: t }
        );
      }

      // Generate JWT Token
      const token = generateToken({
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
      });

      return {
        statusCode: 200,
        data: {
          token,
          user: user.toJSON(),
        },
      };
    });

    if (transactionResult.error) {
      return sendError(res, transactionResult.error, transactionResult.statusCode);
    }

    return sendSuccess(
      res,
      'Phone verified successfully',
      transactionResult.data,
      transactionResult.statusCode
    );
  } catch (error: any) {
    return sendError(res, error.message || 'Internal server error during verification', 500);
  }
};
