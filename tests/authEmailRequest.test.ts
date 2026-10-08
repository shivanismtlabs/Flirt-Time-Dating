import request from 'supertest';
import app from '../src/app';
import { sequelize, EmailVerification } from '../src/models';
import { emailProvider } from '../src/services/email.service';
import { comparePassword } from '../src/utils/password';
import { env } from '../src/config/env';

describe('Request Email OTP Controller (POST /api/v1/auth/email/request-otp)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await EmailVerification.destroy({ where: {}, truncate: true });
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Valid Email & OTP Generation Flow', () => {
    it('should successfully request an Email OTP, create DB record, dispatch email, and return metadata', async () => {
      let sentOtp = '';
      const emailSpy = jest.spyOn(emailProvider, 'sendOtp').mockImplementation(async (_email, otp) => {
        sentOtp = otp;
        return true;
      });

      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'testuser@example.com',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/verification code sent successfully/i);
      expect(res.body.data).toBeDefined();
      expect(typeof res.body.data.verificationId).toBe('string');
      expect(res.body.data.expiresIn).toBe(env.OTP_EXPIRY_SECONDS || 300);
      expect(res.body.data.resendAfter).toBe(env.OTP_RESEND_COOLDOWN_SECONDS || 60);

      // Verify OTP is NEVER returned in response
      expect(res.body.data.otp).toBeUndefined();
      expect(res.body.data.otpHash).toBeUndefined();

      // Verify Email provider called with normalized email and 6-digit numeric OTP
      expect(emailSpy).toHaveBeenCalledTimes(1);
      expect(emailSpy).toHaveBeenCalledWith('testuser@example.com', expect.stringMatching(/^\d{6}$/));
      expect(sentOtp).toMatch(/^\d{6}$/);

      // Verify DB record
      const dbRecord = await EmailVerification.findByPk(res.body.data.verificationId);
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.email).toBe('testuser@example.com');
      expect(dbRecord?.isConsumed).toBe(false);
      expect(dbRecord?.isVerified).toBe(false);

      // Plaintext OTP is NEVER stored in database
      expect(dbRecord?.otpHash).not.toBe(sentOtp);
      expect(dbRecord?.otpHash).toMatch(/^\$2[aby]\$/); // Bcrypt hash pattern

      // Secure hash validates with sent OTP
      const isHashValid = await comparePassword(sentOtp, dbRecord!.otpHash);
      expect(isHashValid).toBe(true);
    });
  });

  describe('2. Email Validation & Normalization', () => {
    it('should reject missing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid email format', async () => {
      const invalidEmails = ['invalid-email', '@missinguser.com', 'user@domain', 'user@.com'];

      for (const invalidEmail of invalidEmails) {
        const res = await request(app)
          .post('/api/v1/auth/email/request-otp')
          .send({ email: invalidEmail });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });

    it('should consistently normalize email address to lowercase and trimmed string in DB and dispatch', async () => {
      let sentToEmail = '';
      jest.spyOn(emailProvider, 'sendOtp').mockImplementation(async (email) => {
        sentToEmail = email;
        return true;
      });

      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: '  Alice.Smith+Testing@EXAMPLE.COM  ',
        });

      expect(res.status).toBe(200);
      expect(sentToEmail).toBe('alice.smith+testing@example.com');

      const dbRecord = await EmailVerification.findByPk(res.body.data.verificationId);
      expect(dbRecord?.email).toBe('alice.smith+testing@example.com');
    });
  });

  describe('3. OTP Expiry Calculation', () => {
    it('should set expiresAt in database according to configured expiry window', async () => {
      const beforeTime = Date.now();
      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'expirytest@example.com',
        });

      expect(res.status).toBe(200);
      const dbRecord = await EmailVerification.findByPk(res.body.data.verificationId);
      const afterTime = Date.now();

      const expiresAtMs = new Date(dbRecord!.expiresAt).getTime();
      const expectedExpiryMsMin = beforeTime + (env.OTP_EXPIRY_SECONDS || 300) * 1000 - 2000;
      const expectedExpiryMsMax = afterTime + (env.OTP_EXPIRY_SECONDS || 300) * 1000 + 2000;

      expect(expiresAtMs).toBeGreaterThanOrEqual(expectedExpiryMsMin);
      expect(expiresAtMs).toBeLessThanOrEqual(expectedExpiryMsMax);
    });
  });

  describe('4. Resend Cooldown Enforcement', () => {
    it('should reject consecutive request for the same email before cooldown period elapses', async () => {
      // 1st request: succeeds
      const res1 = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'cooldowntest@example.com',
        });
      expect(res1.status).toBe(200);

      // Immediate 2nd request: rejected by backend cooldown
      const res2 = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'cooldowntest@example.com',
        });

      expect(res2.status).toBe(429);
      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toMatch(/please wait before requesting another/i);
    });
  });

  describe('5. Rate Limiting Protection', () => {
    it('should block email OTP requests when rate limit threshold is exceeded within the rolling window', async () => {
      const targetEmail = 'ratelimited@example.com';

      // Insert 5 historical requests within window
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await EmailVerification.create({
          email: targetEmail,
          otpHash: '$2a$10$fakehashfortestingratelimits0000000000000000000000',
          expiresAt: new Date(now.getTime() - 1000),
          isConsumed: true,
          createdAt: new Date(now.getTime() - (i + 1) * 60 * 1000),
        });
      }

      // 6th request: blocked by rate limiter
      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: targetEmail,
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/too many otp requests/i);
    });
  });

  describe('6. Security & Secrecy Assertions', () => {
    it('should never expose OTP or OTP hash in response body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'securitytest@example.com',
        });

      expect(res.status).toBe(200);
      const jsonStr = JSON.stringify(res.body);

      expect(res.body.data.otp).toBeUndefined();
      expect(res.body.data.otpHash).toBeUndefined();
      expect(jsonStr).not.toContain('$2a$');
      expect(jsonStr).not.toContain('$2b$');
    });
  });

  describe('7. Email Provider Failure Handling', () => {
    it('should return error when email provider dispatch fails and not return fake success', async () => {
      jest.spyOn(emailProvider, 'sendOtp').mockResolvedValue(false);

      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: 'providerfailure@example.com',
        });

      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('8. Single Active Verification Session Enforcement', () => {
    it('should invalidate previous unconsumed verification session when new OTP is requested after cooldown', async () => {
      const targetEmail = 'singleactive@example.com';

      // Old session created 70s ago
      const oldSession = await EmailVerification.create({
        email: targetEmail,
        otpHash: '$2a$10$oldfakehash0000000000000000000000000000000000000000',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        isConsumed: false,
        isVerified: false,
        createdAt: new Date(Date.now() - 70 * 1000),
        lastResentAt: new Date(Date.now() - 70 * 1000),
      });

      const res = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({
          email: targetEmail,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationId).not.toBe(oldSession.id);

      const reloadedOld = await EmailVerification.findByPk(oldSession.id);
      expect(reloadedOld?.isConsumed).toBe(true);

      const newRecord = await EmailVerification.findByPk(res.body.data.verificationId);
      expect(newRecord?.isConsumed).toBe(false);
    });
  });
});
