import crypto from 'crypto';
import { getFirebaseAuth } from '../config/firebase';
import { sequelize } from '../config/database';
import { User } from '../models/user.model';
import { UserIdentity } from '../models/userIdentity.model';
import { generateToken } from '../utils/jwt';
import { normalizeEmail } from '../utils/normalization';

export class FirebaseValidationError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'FirebaseValidationError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, FirebaseValidationError.prototype);
  }
}

export interface FirebaseAuthInput {
  idToken: string;
}

export interface FirebaseAuthResult {
  user: any;
  token: string;
}

/**
 * Authenticates user with Firebase Auth (Phone / Social Sign-In):
 * 1. Cryptographically verifies Firebase ID token via Firebase Admin SDK.
 * 2. Finds or creates User and UserIdentity records atomically.
 * 3. Sets isPhoneVerified = true if phone number is authenticated via Firebase.
 * 4. Issues standard FlirtTime JWT access token.
 */
export const authenticateWithFirebase = async (
  input: FirebaseAuthInput
): Promise<FirebaseAuthResult> => {
  const { idToken } = input || {};

  if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
    throw new FirebaseValidationError('Firebase idToken is required', 400);
  }

  let decodedToken;
  try {
    const auth = getFirebaseAuth();
    decodedToken = await auth.verifyIdToken(idToken.trim());
  } catch (err: any) {

    if (err.code === 'auth/id-token-expired') {
      throw new FirebaseValidationError('Firebase idToken has expired', 401);
    }
    if (err.code === 'auth/argument-error' || err.code === 'auth/invalid-id-token') {
      throw new FirebaseValidationError('Invalid Firebase idToken', 401);
    }
    throw new FirebaseValidationError(
      `Firebase token verification failed: ${err.message || 'Unknown error'}`,
      401
    );
  }

  const firebaseUid = decodedToken.uid;
  const phoneNumber = decodedToken.phone_number ? decodedToken.phone_number.trim() : null;
  const email = decodedToken.email ? normalizeEmail(decodedToken.email) : null;
  const name = decodedToken.name ? decodedToken.name.trim() : null;

  if (!firebaseUid) {
    throw new FirebaseValidationError('Firebase token missing UID', 401);
  }

  const isPostgres = sequelize.getDialect() === 'postgres';
  let result: User | null = null;

  try {
    result = await sequelize.transaction(async (transaction) => {
      // 1. Look up existing identity
      let identity = await UserIdentity.findOne({
        where: { provider: 'firebase', providerUserId: firebaseUid },
        transaction,
        ...(isPostgres && { lock: transaction.LOCK.UPDATE }),
      });

      let user: User | null = null;

      if (identity) {
        user = await User.findByPk(identity.userId, { transaction });
        if (!user) {
          // Clean up orphan identity if user was deleted
          await identity.destroy({ transaction });
          identity = null;
        }
      }

      if (!identity) {
        // 2. Check if user already exists by phone or email
        if (phoneNumber) {
          user = await User.findOne({
            where: { phone: phoneNumber },
            transaction,
          });
        }

        if (!user && email) {
          user = await User.findOne({
            where: { email },
            transaction,
          });
        }

        // 3. If user doesn't exist, create a new user record
        if (!user) {
          const randomSuffix = crypto.randomBytes(3).toString('hex');
          let username = phoneNumber
            ? `user_${phoneNumber.replace(/\D/g, '').slice(-6)}_${randomSuffix}`
            : `user_fb_${firebaseUid.slice(0, 6)}_${randomSuffix}`;

          user = await User.create(
            {
              username,
              email: email || null,
              phone: phoneNumber || null,
              isPhoneVerified: Boolean(phoneNumber),
              fullName: name || null,
              role: 'user',
              isActive: true,
              isProfileComplete: false,
            },

            { transaction }
          );
        } else {
          // If existing user verified their phone via Firebase, update status
          if (phoneNumber && !user.isPhoneVerified) {
            user.isPhoneVerified = true;
            if (!user.phone) {
              user.phone = phoneNumber;
            }
            await user.save({ transaction });
          }
        }

        // 4. Link UserIdentity
        identity = await UserIdentity.create(
          {
            userId: user.id,
            provider: 'firebase',
            providerUserId: firebaseUid,
            email: email || null,
            isPrivateEmail: false,
          },
          { transaction }
        );
      }

      if (!user) {
        throw new FirebaseValidationError('Failed to find or create user account', 500);
      }

      if (!user.isActive) {
        throw new FirebaseValidationError('User account is deactivated', 403);
      }

      return user;
    });
  } catch (error: any) {
    if (error instanceof FirebaseValidationError) {
      throw error;
    }
    throw new FirebaseValidationError(error.message || 'Database error during authentication', 500);
  }

  if (!result) {
    throw new FirebaseValidationError('Failed to authenticate with Firebase', 500);
  }

  // Generate FlirtTime JWT access token
  const token = generateToken({
    id: result.id,
    email: result.email,
    phone: result.phone,
    role: result.role,
  });

  return {
    user: result.toJSON(),
    token,
  };
};
