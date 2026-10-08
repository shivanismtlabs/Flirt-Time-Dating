import request from 'supertest';
import app from '../src/app';
import { sequelize, PhoneVerification } from '../src/models';
import { smsProvider } from '../src/services/sms.service';
import { comparePassword } from '../src/utils/password';
import { env } from '../src/config/env';

describe('Request Phone OTP Controller (POST /api/v1/auth/phone/request-otp)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await PhoneVerification.destroy({ where: {}, truncate: true });
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Valid Phone & OTP Request Flow', () => {
    it('should successfully request an OTP, create DB record, dispatch SMS, and return verificationId with metadata', async () => {
      let sentOtp = '';
      const smsSpy = jest.spyOn(smsProvider, 'sendOtp').mockImplementation(async (_phone, otp) => {
        sentOtp = otp;
        return true;
      });

      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+91',
          phone: '8371537712',
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

      // Verify SMS provider called with normalized phone (+918371537712) and 6-digit OTP
      expect(smsSpy).toHaveBeenCalledTimes(1);
      expect(smsSpy).toHaveBeenCalledWith('+918371537712', expect.stringMatching(/^\d{6}$/));
      expect(sentOtp).toMatch(/^\d{6}$/);

      // Verify DB record
      const dbRecord = await PhoneVerification.findByPk(res.body.data.verificationId);
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.phone).toBe('+918371537712');
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

  describe('2. Validation of Country Code and Phone', () => {
    it('should reject when countryCode is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          phone: '8371537712',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject when phone is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+91',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid country code format', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: 'invalid',
          phone: '8371537712',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid phone format (too short / letters)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+1',
          phone: '12',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. OTP Expiry Calculation', () => {
    it('should set expiresAt in database according to configured expiry window', async () => {
      const beforeTime = Date.now();
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+1',
          phone: '5551234567',
        });

      expect(res.status).toBe(200);
      const dbRecord = await PhoneVerification.findByPk(res.body.data.verificationId);
      const afterTime = Date.now();

      const expiresAtMs = new Date(dbRecord!.expiresAt).getTime();
      const expectedExpiryMsMin = beforeTime + (env.OTP_EXPIRY_SECONDS || 300) * 1000 - 2000;
      const expectedExpiryMsMax = afterTime + (env.OTP_EXPIRY_SECONDS || 300) * 1000 + 2000;

      expect(expiresAtMs).toBeGreaterThanOrEqual(expectedExpiryMsMin);
      expect(expiresAtMs).toBeLessThanOrEqual(expectedExpiryMsMax);
    });
  });

  describe('4. Resend Cooldown Enforcement', () => {
    it('should reject consecutive request for the same phone before cooldown period elapses', async () => {
      // 1st request: succeeds
      const res1 = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+91',
          phone: '9876543210',
        });
      expect(res1.status).toBe(200);

      // Immediate 2nd request: rejected by backend cooldown
      const res2 = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+91',
          phone: '9876543210',
        });

      expect(res2.status).toBe(429);
      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toMatch(/please wait before requesting another otp/i);
    });
  });

  describe('5. Rate Limiting Protection', () => {
    it('should block OTP requests when the rate limit threshold is exceeded within the rolling window', async () => {
      const targetPhone = '+919999900000';

      // Insert 5 (max allowed) historical requests within the current window
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await PhoneVerification.create({
          phone: targetPhone,
          otpHash: '$2a$10$fakehashfortestingratelimits0000000000000000000000',
          expiresAt: new Date(now.getTime() - 1000), // Expired
          isConsumed: true,
          createdAt: new Date(now.getTime() - (i + 1) * 60 * 1000), // Within last 10 mins
        });
      }

      // 6th request: rejected due to rate limiting
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+91',
          phone: '9999900000',
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/too many otp requests/i);
    });
  });

  describe('6. Security & Privacy: No OTP or Hash Leakage in Logs / Responses', () => {
    it('should never expose OTP or OTP hash in response body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+44',
          phone: '7911123456',
        });

      expect(res.status).toBe(200);
      const jsonStr = JSON.stringify(res.body);

      // Verify no field named otp or otpHash appears
      expect(res.body.data.otp).toBeUndefined();
      expect(res.body.data.otpHash).toBeUndefined();
      expect(jsonStr).not.toContain('$2a$');
      expect(jsonStr).not.toContain('$2b$');
    });
  });

  describe('7. Single Active Verification Session Enforcement', () => {
    it('should invalidate previous unconsumed verification session when a new OTP is requested after cooldown', async () => {
      const normalizedPhone = '+15556667777';

      // Create previous session sent 70 seconds ago (cooldown passed)
      const oldSession = await PhoneVerification.create({
        phone: normalizedPhone,
        otpHash: '$2a$10$oldfakehash0000000000000000000000000000000000000000',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        isConsumed: false,
        isVerified: false,
        createdAt: new Date(Date.now() - 70 * 1000),
        lastResentAt: new Date(Date.now() - 70 * 1000),
      });

      // Request new OTP
      const res = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({
          countryCode: '+1',
          phone: '5556667777',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationId).not.toBe(oldSession.id);

      // Previous session is marked consumed/invalidated
      const reloadedOld = await PhoneVerification.findByPk(oldSession.id);
      expect(reloadedOld?.isConsumed).toBe(true);

      // New session is active
      const newRecord = await PhoneVerification.findByPk(res.body.data.verificationId);
      expect(newRecord?.isConsumed).toBe(false);
    });
  });
});
