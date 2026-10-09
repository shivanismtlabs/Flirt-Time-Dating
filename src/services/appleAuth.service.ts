import crypto from 'crypto';
import https from 'https';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sequelize, User, UserIdentity } from '../models';
import { generateToken } from '../utils/jwt';

export class AppleValidationError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppleValidationError.prototype);
  }
}

interface AppleJwkKey {
  kty: string;
  kid: string;
  use: string;
  alg: string;
  n: string;
  e: string;
}

interface AppleJwksResponse {
  keys: AppleJwkKey[];
}

let jwksMockKeys: AppleJwkKey[] | null = null;
let jwksCache: { keys: AppleJwkKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sets mock JWKS keys for unit testing.
 * Pass null to restore real network JWKS fetching.
 */
export const setAppleJwksMock = (keys: AppleJwkKey[] | null): void => {
  jwksMockKeys = keys;
};

/**
 * Fetches Apple's public signing keys (JWKS) from https://appleid.apple.com/auth/keys
 */
export const fetchApplePublicKeys = async (): Promise<AppleJwkKey[]> => {
  if (jwksMockKeys) {
    return jwksMockKeys;
  }

  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  return new Promise((resolve, reject) => {
    https
      .get('https://appleid.apple.com/auth/keys', (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return reject(
                new AppleValidationError(
                  `Failed to fetch Apple public keys (HTTP ${res.statusCode})`,
                  500
                )
              );
            }
            const parsed: AppleJwksResponse = JSON.parse(rawData);
            if (!parsed.keys || !Array.isArray(parsed.keys)) {
              return reject(
                new AppleValidationError('Invalid JWKS response structure from Apple', 500)
              );
            }
            jwksCache = { keys: parsed.keys, fetchedAt: now };
            resolve(parsed.keys);
          } catch (err: any) {
            reject(
              new AppleValidationError(
                `Failed to parse Apple JWKS keys: ${err.message}`,
                500
              )
            );
          }
        });
      })
      .on('error', (err) => {
        reject(
          new AppleValidationError(`Network error fetching Apple JWKS: ${err.message}`, 500)
        );
      });
  });
};

/**
 * Converts an RSA JWK (n, e) into a PEM public key string using Node.js crypto.
 */
export const convertJwkToPem = (jwk: AppleJwkKey): string => {
  try {
    const keyObject = crypto.createPublicKey({
      key: {
        kty: jwk.kty,
        n: jwk.n,
        e: jwk.e,
      },
      format: 'jwk',
    });
    return keyObject.export({ type: 'spki', format: 'pem' }).toString();
  } catch (err: any) {
    throw new AppleValidationError(`Failed to parse Apple public key JWK: ${err.message}`, 401);
  }
};

export interface VerifiedAppleTokenPayload {
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
  nonce?: string;
}

/**
 * Cryptographically verifies Apple identity token against Apple public keys.
 */
export const verifyAppleIdentityToken = async (
  identityToken: string,
  expectedNonce?: string
): Promise<VerifiedAppleTokenPayload> => {
  if (!identityToken || typeof identityToken !== 'string') {
    throw new AppleValidationError('Missing or invalid identityToken', 400);
  }

  // 1. Decode header without verification to locate key ID (kid)
  const unverified = jwt.decode(identityToken, { complete: true });
  if (!unverified || typeof unverified === 'string' || !unverified.header) {
    throw new AppleValidationError('Malformed or invalid identityToken structure', 401);
  }

  const { kid, alg } = unverified.header;
  if (!kid) {
    throw new AppleValidationError('identityToken missing kid in header', 401);
  }

  if (alg !== 'RS256') {
    throw new AppleValidationError(`Unsupported algorithm ${alg} in identityToken`, 401);
  }

  // 2. Obtain Apple public keys and match kid
  const appleKeys = await fetchApplePublicKeys();
  const matchingKey = appleKeys.find((k) => k.kid === kid);

  if (!matchingKey) {
    throw new AppleValidationError('Matching Apple signing key not found for identityToken', 401);
  }

  // 3. Convert JWK to PEM public key
  const pemPublicKey = convertJwkToPem(matchingKey);

  // 4. Verify signature & expiration
  let payload: VerifiedAppleTokenPayload;
  try {
    payload = jwt.verify(identityToken, pemPublicKey, {
      algorithms: ['RS256'],
      issuer: 'https://appleid.apple.com',
    }) as VerifiedAppleTokenPayload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new AppleValidationError('Apple identityToken has expired', 401);
    }
    throw new AppleValidationError(`Apple identityToken signature verification failed: ${err.message}`, 401);
  }

  // 5. Verify issuer
  if (payload.iss !== 'https://appleid.apple.com') {
    throw new AppleValidationError('Invalid issuer in Apple identityToken', 401);
  }

  // 6. Verify audience
  const configuredClientId = env.APPLE_CLIENT_ID || process.env.APPLE_CLIENT_ID;
  if (configuredClientId) {
    const allowedClientIds = configuredClientId.split(',').map((id) => id.trim());
    if (!allowedClientIds.includes(payload.aud)) {
      throw new AppleValidationError('Invalid audience in Apple identityToken', 401);
    }
  }

  // 7. Verify subject (sub)
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    throw new AppleValidationError('Apple identityToken missing subject (sub)', 401);
  }

  // 8. Verify nonce if expected
  if (expectedNonce) {
    if (!payload.nonce) {
      throw new AppleValidationError('Nonce expected but not present in Apple identityToken', 401);
    }

    const hashedHex = crypto.createHash('sha256').update(expectedNonce).digest('hex');
    const hashedBase64Url = crypto.createHash('sha256').update(expectedNonce).digest('base64url');

    const matches =
      payload.nonce === expectedNonce ||
      payload.nonce === hashedHex ||
      payload.nonce === hashedBase64Url;

    if (!matches) {
      throw new AppleValidationError('Nonce verification failed for Apple identityToken', 401);
    }
  }

  return payload;
};

export interface AppleAuthInput {
  identityToken: string;
  authorizationCode?: string;
  nonce?: string;
  user?: {
    name?: {
      firstName?: string;
      lastName?: string;
    };
    email?: string;
  };
}

/**
 * Authenticates user with Apple Sign In end-to-end:
 * 1. Cryptographically verifies identity token.
 * 2. Finds or creates UserIdentity and User records atomically.
 * 3. Issues standard FlirtTime JWT access token.
 */
export const authenticateWithApple = async (input: AppleAuthInput) => {
  // 1. Verify Apple identityToken
  const verifiedToken = await verifyAppleIdentityToken(input.identityToken, input.nonce);

  const appleSub = verifiedToken.sub;
  const appleEmail = verifiedToken.email ? verifiedToken.email.trim().toLowerCase() : null;
  const isPrivateRelay = appleEmail ? appleEmail.endsWith('@privaterelay.appleid.com') : false;

  // 2. Perform atomic database find or create inside a transaction
  let result: User | null = null;

  try {
    result = await sequelize.transaction(async (transaction) => {
      // Look up existing Apple identity
      let identity = await UserIdentity.findOne({
        where: { provider: 'apple', providerUserId: appleSub },
        transaction,
      });

      let user: User | null = null;

      if (identity) {
        // Existing Apple User
        user = await User.findByPk(identity.userId, { transaction });

        if (!user) {
          // Handle stale orphan identity gracefully
          await identity.destroy({ transaction });
          identity = null;
        }
      }

      if (!identity) {
        // First Apple Login or new identity creation
        if (appleEmail) {
          // Check if an existing account uses this verified email
          user = await User.findOne({
            where: { email: appleEmail },
            transaction,
          });
        }

        if (!user) {
          // Create new User record
          const randomSuffix = crypto.randomBytes(3).toString('hex');
          const username = `user_apple_${appleSub.slice(0, 6)}_${randomSuffix}`;

          const nameParts = [input.user?.name?.firstName, input.user?.name?.lastName]
            .filter(Boolean)
            .map((s) => s?.trim());
          const fullName = nameParts.length > 0 ? nameParts.join(' ') : null;

          user = await User.create(
            {
              username,
              email: appleEmail,
              fullName,
              firstName: input.user?.name?.firstName?.trim() || null,
              lastName: input.user?.name?.lastName?.trim() || null,
              role: 'user',
              isActive: true,
              isProfileComplete: false,
            },
            { transaction }
          );

        }

        // Create linked UserIdentity
        identity = await UserIdentity.create(
          {
            userId: user.id,
            provider: 'apple',
            providerUserId: appleSub,
            email: appleEmail,
            isPrivateEmail: isPrivateRelay,
          },
          { transaction }
        );
      }

      if (!user) {
        throw new AppleValidationError('Failed to find or create user account', 500);
      }

      if (!user.isActive) {
        throw new AppleValidationError('User account is deactivated', 403);
      }

      return user;
    });
  } catch (error: any) {
    const isBusyOrUniqueErr =
      error.name === 'SequelizeUniqueConstraintError' ||
      error.name === 'UniqueConstraintError' ||
      error.name === 'SequelizeDatabaseError' ||
      error.name === 'SequelizeTimeoutError' ||
      (error.message && /unique|busy|locked|constraint/i.test(error.message));

    if (isBusyOrUniqueErr) {
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        const existingIdentity = await UserIdentity.findOne({
          where: { provider: 'apple', providerUserId: appleSub },
        });
        if (existingIdentity) {
          result = await User.findByPk(existingIdentity.userId);
          if (result) break;
        }
      }
    }

    if (!result) {
      throw error;
    }
  }

  if (!result) {
    throw new AppleValidationError('Failed to authenticate with Apple', 500);
  }

  // 3. Issue FlirtTime JWT
  const token = generateToken({
    id: result.id,
    email: result.email,
    role: result.role,
  });

  return {
    user: result.toJSON(),
    token,
  };
};
