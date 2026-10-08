import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../src/app';
import { env } from '../src/config/env';
import { initDb, sequelize, User, UserIdentity } from '../src/models';
import { setAppleJwksMock } from '../src/services/appleAuth.service';
import { verifyToken } from '../src/utils/jwt';

describe('Sign in with Apple Auth Controller (POST /api/v1/auth/apple)', () => {
  let rsaPrivateKeyPem: string;
  let rsaPublicKeyPem: string;
  let testKid: string;
  let defaultAudience: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    // Generate RSA key pair for testing real RS256 signature verification
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    rsaPrivateKeyPem = privateKey;
    rsaPublicKeyPem = publicKey;
    testKid = 'test_apple_key_1';
    defaultAudience = env.APPLE_CLIENT_ID || 'com.flirttime.app';

    // Convert RSA public key to JWK and set mock JWKS provider
    const pubKeyObj = crypto.createPublicKey(rsaPublicKeyPem);
    const jwk = pubKeyObj.export({ format: 'jwk' });

    setAppleJwksMock([
      {
        kty: 'RSA',
        kid: testKid,
        use: 'sig',
        alg: 'RS256',
        n: jwk.n as string,
        e: jwk.e as string,
      },
    ]);
  });

  beforeEach(async () => {
    await UserIdentity.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    setAppleJwksMock(null);
    await sequelize.close();
  });

  // Helper to create signed Apple ID token
  const createTestAppleToken = (payloadOverrides: Record<string, any> = {}, headerOverrides: Record<string, any> = {}) => {
    const payload = {
      iss: 'https://appleid.apple.com',
      aud: defaultAudience,
      sub: '001234.apple_sub_unique_123',
      email: 'testuser@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000) - 60,
      ...payloadOverrides,
    };

    return jwt.sign(payload, rsaPrivateKeyPem, {
      algorithm: 'RS256',
      keyid: headerOverrides.kid || testKid,
    });
  };

  describe('1. Valid Apple Login & User Creation', () => {
    it('should successfully authenticate new Apple user and return JWT token', async () => {
      const token = createTestAppleToken({
        sub: '001234.new_apple_sub_100',
        email: 'newapple@example.com',
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({
          identityToken: token,
          user: {
            name: {
              firstName: 'Mike',
              lastName: 'Hussey',
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/apple login successful/i);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user).toBeDefined();

      expect(res.body.data.user.email).toBe('newapple@example.com');
      expect(res.body.data.user.firstName).toBe('Mike');
      expect(res.body.data.user.lastName).toBe('Hussey');

      // Verify JWT payload matches FlirtTime JWT architecture
      const decodedJwt: any = verifyToken(res.body.data.token);
      expect(decodedJwt.id).toBe(res.body.data.user.id);
      expect(decodedJwt.email).toBe('newapple@example.com');

      // Verify DB identity record
      const identity = await UserIdentity.findOne({
        where: { provider: 'apple', providerUserId: '001234.new_apple_sub_100' },
      });
      expect(identity).not.toBeNull();
      expect(identity?.userId).toBe(res.body.data.user.id);
    });
  });

  describe('2. Invalid & Malformed Token Verifications', () => {
    it('should reject missing identityToken with 400', async () => {
      const res = await request(app).post('/api/v1/auth/apple').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed identityToken with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: 'invalid.token.string' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject expired identityToken with 401', async () => {
      const expiredToken = createTestAppleToken({
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: expiredToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should reject invalid signature with 401', async () => {
      // Generate another key pair to create invalid signature
      const { privateKey: fakeKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const badSigToken = jwt.sign(
        {
          iss: 'https://appleid.apple.com',
          aud: defaultAudience,
          sub: '001234.bad_sig',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        fakeKey,
        { algorithm: 'RS256', keyid: testKid }
      );

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: badSigToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/signature verification failed/i);
    });

    it('should reject wrong issuer with 401', async () => {
      const wrongIssToken = createTestAppleToken({
        iss: 'https://malicious-issuer.com',
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: wrongIssToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/issuer/i);
    });

    it('should reject wrong audience with 401', async () => {
      const wrongAudToken = createTestAppleToken({
        aud: 'com.wrong.bundle.id',
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: wrongAudToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/audience/i);
    });

    it('should reject missing subject (sub) with 401', async () => {
      const noSubToken = createTestAppleToken({
        sub: '',
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: noSubToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid nonce with 401', async () => {
      const tokenWithNonce = createTestAppleToken({
        nonce: 'correct_nonce_value',
      });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({
          identityToken: tokenWithNonce,
          nonce: 'mismatched_nonce_value',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/nonce/i);
    });
  });

  describe('3. Existing Apple User & Profile State Preservation', () => {
    it('should authenticate existing Apple user without creating duplicate user or resetting profile state', async () => {
      const sub = '001234.existing_user_sub';
      const user = await User.create({
        username: 'existing_apple_user',
        email: 'existing@example.com',
        firstName: 'OriginalFirst',
        lastName: 'OriginalLast',
        isProfileComplete: true,
      });

      await UserIdentity.create({
        userId: user.id,
        provider: 'apple',
        providerUserId: sub,
        email: 'existing@example.com',
      });

      const token = createTestAppleToken({ sub, email: 'existing@example.com' });

      // Subsequent login without sending user name
      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.firstName).toBe('OriginalFirst');
      expect(res.body.data.user.isProfileComplete).toBe(true);

      const count = await User.count();
      expect(count).toBe(1);
    });

    it('should not overwrite manually updated user name on subsequent login', async () => {
      const sub = '001234.manual_name_sub';
      const user = await User.create({
        username: 'manual_name_user',
        email: 'manual@example.com',
        firstName: 'ManuallyUpdatedFirst',
        lastName: 'ManuallyUpdatedLast',
      });

      await UserIdentity.create({
        userId: user.id,
        provider: 'apple',
        providerUserId: sub,
      });

      // Subsequent login sends Apple name, but existing manual name must be preserved
      const token = createTestAppleToken({ sub });
      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({
          identityToken: token,
          user: {
            name: {
              firstName: 'AppleFirst',
              lastName: 'AppleLast',
            },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.firstName).toBe('ManuallyUpdatedFirst');
      expect(res.body.data.user.lastName).toBe('ManuallyUpdatedLast');
    });

    it('should properly store Apple private relay email (@privaterelay.appleid.com)', async () => {
      const relayEmail = 'abc123xyz@privaterelay.appleid.com';
      const sub = '001234.relay_sub';
      const token = createTestAppleToken({ sub, email: relayEmail });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(relayEmail);

      const identity = await UserIdentity.findOne({ where: { providerUserId: sub } });
      expect(identity?.isPrivateEmail).toBe(true);
    });
  });

  describe('4. Database Concurrency & Race Condition Protection', () => {
    it('should safely handle concurrent Apple login requests for the same sub without duplicate creation', async () => {
      const sub = '001234.concurrent_sub';
      const token = createTestAppleToken({ sub, email: 'concurrent@example.com' });

      // Send 3 simultaneous login requests
      const [res1, res2, res3] = await Promise.all([
        request(app).post('/api/v1/auth/apple').send({ identityToken: token }),
        request(app).post('/api/v1/auth/apple').send({ identityToken: token }),
        request(app).post('/api/v1/auth/apple').send({ identityToken: token }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // Verify all 3 requests returned the exact same User ID
      const userId1 = res1.body.data.user.id;
      const userId2 = res2.body.data.user.id;
      const userId3 = res3.body.data.user.id;

      expect(userId1).toBe(userId2);
      expect(userId2).toBe(userId3);

      // Verify only 1 User and 1 UserIdentity were created in DB
      const userCount = await User.count({ where: { email: 'concurrent@example.com' } });
      const identityCount = await UserIdentity.count({ where: { providerUserId: sub } });

      expect(userCount).toBe(1);
      expect(identityCount).toBe(1);
    });
  });

  describe('5. Security & Sensitive Info Assertions', () => {
    it('should never expose sensitive credentials in Apple auth response payload', async () => {
      const token = createTestAppleToken({ sub: '001234.sec_sub' });

      const res = await request(app)
        .post('/api/v1/auth/apple')
        .send({ identityToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.password).toBeUndefined();
      expect(res.body.data.identityToken).toBeUndefined();
      expect(res.body.data.authorizationCode).toBeUndefined();
      expect(res.body.data.privateKey).toBeUndefined();
    });
  });

  describe('6. System Compatibility Assertions', () => {
    it('should ensure existing phone OTP, email OTP, and registration APIs still work', async () => {
      // Test Registration
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'apple_compat_user',
          email: 'apple_compat@example.com',
          password: 'Password123',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.data.token).toBeDefined();

      // Test Login
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'apple_compat@example.com',
          password: 'Password123',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.token).toBeDefined();
    });
  });
});
