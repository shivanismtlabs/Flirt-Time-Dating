import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../src/app';
import { env } from '../src/config/env';
import { initDb, sequelize, User, UserIdentity } from '../src/models';
import { setGoogleJwksMock } from '../src/services/googleAuth.service';
import { verifyToken } from '../src/utils/jwt';

describe('Google Auth Controller (POST /api/v1/auth/google)', () => {
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
    testKid = 'test_google_key_1';
    defaultAudience = '1234567890-testgoogleclientid.apps.googleusercontent.com';
    env.GOOGLE_CLIENT_ID = defaultAudience;

    // Convert RSA public key to JWK and set mock JWKS provider
    const pubKeyObj = crypto.createPublicKey(rsaPublicKeyPem);
    const jwk = pubKeyObj.export({ format: 'jwk' });

    setGoogleJwksMock([
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
    await UserIdentity.destroy({ where: {} });
    await User.destroy({ where: {} });
  });

  afterAll(async () => {
    setGoogleJwksMock(null);
    await sequelize.close();
  });

  // Helper to create signed Google ID token
  const createTestGoogleToken = (
    payloadOverrides: Record<string, any> = {},
    headerOverrides: Record<string, any> = {}
  ) => {
    const payload = {
      iss: 'https://accounts.google.com',
      aud: defaultAudience,
      sub: 'google_sub_109283019283',
      email: 'googleuser@gmail.com',
      email_verified: true,
      name: 'Sarah Connor',
      given_name: 'Sarah',
      family_name: 'Connor',
      picture: 'https://lh3.googleusercontent.com/test_avatar.jpg',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000) - 60,
      ...payloadOverrides,
    };

    return jwt.sign(payload, rsaPrivateKeyPem, {
      algorithm: 'RS256',
      keyid: headerOverrides.kid || testKid,
    });
  };

  describe('1. Valid Google Login & User Creation', () => {
    it('should successfully authenticate new Google user and return JWT token', async () => {
      const token = createTestGoogleToken({
        sub: 'google_sub_111222333',
        email: 'newgoogleuser@gmail.com',
        name: 'John Connor',
        given_name: 'John',
        family_name: 'Connor',
        picture: 'https://lh3.googleusercontent.com/john_photo.jpg',
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({
          idToken: token,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/google login successful/i);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user).toBeDefined();

      expect(res.body.data.user.email).toBe('newgoogleuser@gmail.com');
      expect(res.body.data.user.fullName).toBe('John Connor');
      expect(res.body.data.user.firstName).toBe('John');
      expect(res.body.data.user.lastName).toBe('Connor');
      expect(res.body.data.user.profilePicture).toBe('https://lh3.googleusercontent.com/john_photo.jpg');

      // Verify JWT payload matches FlirtTime JWT architecture
      const decodedJwt: any = verifyToken(res.body.data.token);
      expect(decodedJwt.id).toBe(res.body.data.user.id);
      expect(decodedJwt.email).toBe('newgoogleuser@gmail.com');

      // Verify DB identity record
      const identity = await UserIdentity.findOne({
        where: { provider: 'google', providerUserId: 'google_sub_111222333' },
      });
      expect(identity).not.toBeNull();
      expect(identity?.userId).toBe(res.body.data.user.id);
      expect(identity?.email).toBe('newgoogleuser@gmail.com');
    });

    it('should also work with /api/auth/google route alias', async () => {
      const token = createTestGoogleToken({
        sub: 'google_sub_alias_test',
        email: 'aliasuser@gmail.com',
      });

      const res = await request(app)
        .post('/api/auth/google')
        .send({
          idToken: token,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('aliasuser@gmail.com');
    });
  });

  describe('2. Account Linking & Subsequent Logins', () => {
    it('should link existing user account when user with same email exists', async () => {
      const existingUser = await User.create({
        username: 'existing_regular_user',
        email: 'linkme@gmail.com',
        fullName: 'Existing User',
        role: 'user',
        isActive: true,
      });

      const token = createTestGoogleToken({
        sub: 'google_sub_link_456',
        email: 'linkme@gmail.com',
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(existingUser.id);

      const count = await User.count({ where: { email: 'linkme@gmail.com' } });
      expect(count).toBe(1);

      const identity = await UserIdentity.findOne({
        where: { provider: 'google', providerUserId: 'google_sub_link_456' },
      });
      expect(identity).not.toBeNull();
      expect(identity?.userId).toBe(existingUser.id);
    });

    it('should authenticate existing Google identity without duplicating user or resetting profile', async () => {
      const sub = 'google_sub_existing_789';
      const user = await User.create({
        username: 'existing_google_account',
        email: 'existinggoogle@gmail.com',
        fullName: 'Original Google User',
        isProfileComplete: true,
      });

      await UserIdentity.create({
        userId: user.id,
        provider: 'google',
        providerUserId: sub,
        email: 'existinggoogle@gmail.com',
      });

      const token = createTestGoogleToken({ sub, email: 'existinggoogle@gmail.com' });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(user.id);
      expect(res.body.data.user.isProfileComplete).toBe(true);

      const totalUsers = await User.count();
      expect(totalUsers).toBe(1);
    });
  });

  describe('3. Token Validation & Security Assertions', () => {
    it('should reject missing idToken with 400', async () => {
      const res = await request(app).post('/api/v1/auth/google').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed idToken with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'malformed.jwt.token' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject expired idToken with 401', async () => {
      const expiredToken = createTestGoogleToken({
        exp: Math.floor(Date.now() / 1000) - 3600,
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: expiredToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should reject invalid signature with 401', async () => {
      const { privateKey: fakeKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const badSigToken = jwt.sign(
        {
          iss: 'https://accounts.google.com',
          aud: defaultAudience,
          sub: 'google_sub_bad_sig',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        fakeKey,
        { algorithm: 'RS256', keyid: testKid }
      );

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: badSigToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/signature verification failed/i);
    });

    it('should reject wrong issuer with 401', async () => {
      const wrongIssToken = createTestGoogleToken({
        iss: 'https://fakeissuer.com',
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: wrongIssToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/issuer/i);
    });

    it('should reject wrong audience with 401', async () => {
      const wrongAudToken = createTestGoogleToken({
        aud: 'wrong-google-client-id.apps.googleusercontent.com',
      });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: wrongAudToken });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/audience/i);
    });

    it('should reject deactivated user with 403', async () => {
      const sub = 'google_sub_deactivated_user';
      const deactivatedUser = await User.create({
        username: 'deactivated_user',
        email: 'deactivated@gmail.com',
        isActive: false,
      });

      await UserIdentity.create({
        userId: deactivatedUser.id,
        provider: 'google',
        providerUserId: sub,
      });

      const token = createTestGoogleToken({ sub, email: 'deactivated@gmail.com' });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: token });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/deactivated/i);
    });

    it('should never expose sensitive password in Google auth response payload', async () => {
      const token = createTestGoogleToken({ sub: 'google_sub_sec_check' });

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.user.password).toBeUndefined();
    });
  });

  describe('4. Concurrency & Race Condition Protection', () => {
    it('should safely handle concurrent Google login requests without duplicate creation', async () => {
      const sub = 'google_sub_concurrent_test';
      const token = createTestGoogleToken({ sub, email: 'concurrentgoogle@gmail.com' });

      const [res1, res2, res3] = await Promise.all([
        request(app).post('/api/v1/auth/google').send({ idToken: token }),
        request(app).post('/api/v1/auth/google').send({ idToken: token }),
        request(app).post('/api/v1/auth/google').send({ idToken: token }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      const userId1 = res1.body.data.user.id;
      const userId2 = res2.body.data.user.id;
      const userId3 = res3.body.data.user.id;

      expect(userId1).toBe(userId2);
      expect(userId2).toBe(userId3);

      const userCount = await User.count({ where: { email: 'concurrentgoogle@gmail.com' } });
      const identityCount = await UserIdentity.count({ where: { providerUserId: sub } });

      expect(userCount).toBe(1);
      expect(identityCount).toBe(1);
    });
  });
});
