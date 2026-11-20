import crypto from 'crypto';
import https from 'https';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { sequelize, User, UserIdentity } from '../models';
import { generateToken } from '../utils/jwt';

export class GoogleValidationError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, GoogleValidationError.prototype);
  }
}

export interface GoogleJwkKey {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface GoogleJwksResponse {
  keys: GoogleJwkKey[];
}

let jwksMockKeys: GoogleJwkKey[] | null = null;
let jwksCache: { keys: GoogleJwkKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sets mock JWKS keys for unit testing.
 * Pass null to restore real network JWKS fetching.
 */
export const setGoogleJwksMock = (keys: GoogleJwkKey[] | null): void => {
  jwksMockKeys = keys;
};

/**
 * Fetches Google's public signing keys (JWKS) from https://www.googleapis.com/oauth2/v3/certs
 */
export const fetchGooglePublicKeys = async (forceRefresh = false): Promise<GoogleJwkKey[]> => {
  if (jwksMockKeys) {
    return jwksMockKeys;
  }

  const now = Date.now();
  if (!forceRefresh && jwksCache && now - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys;
  }

  return new Promise((resolve, reject) => {
    https
      .get('https://www.googleapis.com/oauth2/v3/certs', (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return reject(
                new GoogleValidationError(
                  `Failed to fetch Google public keys (HTTP ${res.statusCode})`,
                  500
                )
              );
            }
            const parsed: GoogleJwksResponse = JSON.parse(rawData);
            if (!parsed.keys || !Array.isArray(parsed.keys)) {
              return reject(
                new GoogleValidationError('Invalid JWKS response structure from Google', 500)
              );
            }
            jwksCache = { keys: parsed.keys, fetchedAt: now };
            resolve(parsed.keys);
          } catch (err: any) {
            reject(
              new GoogleValidationError(
                `Failed to parse Google JWKS keys: ${err.message}`,
                500
              )
            );
          }
        });
      })
      .on('error', (err) => {
        reject(
          new GoogleValidationError(`Network error fetching Google JWKS: ${err.message}`, 500)
        );
      });
  });
};

/**
 * Converts an RSA JWK (n, e) into a PEM public key string using Node.js crypto.
 */
export const convertJwkToPem = (jwk: GoogleJwkKey): string => {
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
    throw new GoogleValidationError(`Failed to parse Google public key JWK: ${err.message}`, 401);
  }
};

export interface VerifiedGoogleTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  locale?: string;
}

/**
 * Cryptographically verifies Google ID token against Google's public signing keys (JWKS).
 */
export const verifyGoogleIdToken = async (
  idToken: string
): Promise<VerifiedGoogleTokenPayload> => {
  if (!idToken || typeof idToken !== 'string') {
    throw new GoogleValidationError('Missing or invalid idToken', 400);
  }

  // 1. Decode header without verification to locate key ID (kid) and algorithm
  const unverified = jwt.decode(idToken, { complete: true });
  if (!unverified || typeof unverified === 'string' || !unverified.header) {
    throw new GoogleValidationError('Malformed or invalid idToken structure', 401);
  }

  const { kid, alg } = unverified.header;
  if (!kid) {
    throw new GoogleValidationError('idToken missing kid in header', 401);
  }

  if (alg !== 'RS256') {
    throw new GoogleValidationError(`Unsupported algorithm ${alg} in idToken`, 401);
  }

  // 2. Obtain Google public keys and match kid
  let googleKeys = await fetchGooglePublicKeys();
  let matchingKey = googleKeys.find((k) => k.kid === kid);

  // If not found in cache, force refresh keys once in case of recent key rotation
  if (!matchingKey && !jwksMockKeys) {
    googleKeys = await fetchGooglePublicKeys(true);
    matchingKey = googleKeys.find((k) => k.kid === kid);
  }

  if (!matchingKey) {
    throw new GoogleValidationError('Matching Google signing key not found for idToken', 401);
  }

  // 3. Convert JWK to PEM public key
  const pemPublicKey = convertJwkToPem(matchingKey);

  // 4. Verify signature & expiration
  let payload: VerifiedGoogleTokenPayload;
  try {
    payload = jwt.verify(idToken, pemPublicKey, {
      algorithms: ['RS256'],
    }) as VerifiedGoogleTokenPayload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw new GoogleValidationError('Google idToken has expired', 401);
    }
    throw new GoogleValidationError(
      `Google idToken signature verification failed: ${err.message}`,
      401
    );
  }

  // 5. Verify issuer
  const validIssuers = ['https://accounts.google.com', 'accounts.google.com'];
  if (!validIssuers.includes(payload.iss)) {
    throw new GoogleValidationError('Invalid issuer in Google idToken', 401);
  }

  // 6. Verify audience if configured
  const configuredClientId = env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  if (configuredClientId) {
    const allowedClientIds = configuredClientId
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (allowedClientIds.length > 0 && !allowedClientIds.includes(payload.aud)) {
      throw new GoogleValidationError('Invalid audience in Google idToken', 401);
    }
  }

  // 7. Verify subject (sub)
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    throw new GoogleValidationError('Google idToken missing subject (sub)', 401);
  }

  return payload;
};

export interface GoogleAuthInput {
  idToken: string;
  serverAuthCode?: string;
  user?: {
    name?: string;
    email?: string;
    photo?: string;
  };
}

/**
 * Authenticates user with Google Sign In end-to-end:
 * 1. Cryptographically verifies Google ID token.
 * 2. Finds or creates UserIdentity and User records atomically.
 * 3. Links existing account if email matches.
 * 4. Issues standard FlirtTime JWT access token.
 */
export const authenticateWithGoogle = async (input: GoogleAuthInput) => {
  // 1. Verify Google idToken
  const verifiedToken = await verifyGoogleIdToken(input.idToken);

  const googleSub = verifiedToken.sub;
  const googleEmail = verifiedToken.email ? verifiedToken.email.trim().toLowerCase() : null;
  const googleName = (verifiedToken.name || input.user?.name || '').trim() || null;
  const googleFirstName = (verifiedToken.given_name || '').trim() || null;
  const googleLastName = (verifiedToken.family_name || '').trim() || null;
  const googlePicture = verifiedToken.picture || input.user?.photo || null;

  // 2. Perform atomic database find or create inside a transaction
  let result: User | null = null;

  try {
    result = await sequelize.transaction(async (transaction) => {
      // Look up existing Google identity
      let identity = await UserIdentity.findOne({
        where: { provider: 'google', providerUserId: googleSub },
        transaction,
      });

      let user: User | null = null;

      if (identity) {
        // Existing Google User
        user = await User.findByPk(identity.userId, { transaction });

        if (!user) {
          // Handle stale orphan identity gracefully
          await identity.destroy({ transaction });
          identity = null;
        }
      }

      if (!identity) {
        // First Google Login or link identity
        if (googleEmail) {
          user = await User.findOne({
            where: { email: googleEmail },
            transaction,
          });
        }

        if (!user) {
          // Create new User record
          const randomSuffix = crypto.randomBytes(3).toString('hex');
          const username = `user_google_${googleSub.slice(0, 6)}_${randomSuffix}`;

          const firstName = googleFirstName || (googleName ? googleName.split(' ')[0] : null);
          const lastName =
            googleLastName ||
            (googleName && googleName.includes(' ')
              ? googleName.split(' ').slice(1).join(' ')
              : null);

          user = await User.create(
            {
              username,
              email: googleEmail,
              fullName: googleName,
              firstName,
              lastName,
              profilePicture: googlePicture,
              role: 'user',
              isActive: true,
              isProfileComplete: false,
            },
            { transaction }
          );
        } else {
          // Existing user linking Google identity
          let shouldSave = false;
          if (!user.profilePicture && googlePicture) {
            user.profilePicture = googlePicture;
            shouldSave = true;
          }
          if (!user.fullName && googleName) {
            user.fullName = googleName;
            shouldSave = true;
          }
          if (shouldSave) {
            await user.save({ transaction });
          }
        }

        // Create linked UserIdentity
        identity = await UserIdentity.create(
          {
            userId: user.id,
            provider: 'google',
            providerUserId: googleSub,
            email: googleEmail,
            isPrivateEmail: false,
          },
          { transaction }
        );
      }

      if (!user) {
        throw new GoogleValidationError('Failed to find or create user account', 500);
      }

      if (!user.isActive) {
        throw new GoogleValidationError('User account is deactivated', 403);
      }

      return user;
    });
  } catch (error: any) {
    if (error instanceof GoogleValidationError) {
      throw error;
    }

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
          where: { provider: 'google', providerUserId: googleSub },
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
    throw new GoogleValidationError('Failed to authenticate with Google', 500);
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
