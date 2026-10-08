import request from 'supertest';
import app from '../src/app';
import { sequelize, User, PhoneVerification } from '../src/models';
import { hashPassword } from '../src/utils/password';
import { smsProvider } from '../src/services/sms.service';
import { env } from '../src/config/env';

describe('Resend Phone OTP Controller (POST /api/v1/auth/phone/resend-otp)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await PhoneVerification.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // Helper to create OTP record
  const createOtpRecord = async (overrides: Partial<any> = {}) => {
    const rawOtp = overrides.rawOtp || '123456';
    const otpHash = await hashPassword(rawOtp);
    const expiresAt = overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000);
    // Default createdAt 70 seconds ago so cooldown is not blocking unless overridden
    const createdAt = overrides.createdAt || new Date(Date.now() - 70 * 1000);

    const record = await PhoneVerification.create({
      phone: overrides.phone || '+1234567890',
      otpHash,
      expiresAt,
      isConsumed: overrides.isConsumed !== undefined ? overrides.isConsumed : false,
      isVerified: overrides.isVerified !== undefined ? overrides.isVerified : false,
      attempts: overrides.attempts !== undefined ? overrides.attempts : 2,
      maxAttempts: overrides.maxAttempts !== undefined ? overrides.maxAttempts : 5,
      resendCount: overrides.resendCount !== undefined ? overrides.resendCount : 0,
      maxResends: overrides.maxResends !== undefined ? overrides.maxResends : 3,
      lastResentAt: overrides.lastResentAt !== undefined ? overrides.lastResentAt : createdAt,
    });

    return { record, rawOtp };
  };

  describe('1. Successful OTP Resend Flow', () => {
    it('should successfully resend OTP, reset attempts, update expiry, increment resendCount, and return verificationId with metadata', async () => {
      const smsSpy = jest.spyOn(smsProvider, 'sendOtp').mockResolvedValue(true);
      const { record } = await createOtpRecord({ phone: '+15554443333', attempts: 3, resendCount: 0 });

      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: record.id,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Verification code resent successfully');
      expect(res.body.data.verificationId).toBe(record.id);
      expect(res.body.data.expiresIn).toBe(env.OTP_EXPIRY_SECONDS || 300);
      expect(res.body.data.resendAfter).toBe(env.OTP_RESEND_COOLDOWN_SECONDS || 60);

      // Ensure OTP and OTP hash are NEVER returned in response
      expect(res.body.data.otp).toBeUndefined();
      expect(res.body.data.otpHash).toBeUndefined();

      // Ensure SMS provider was called with 6-digit OTP
      expect(smsSpy).toHaveBeenCalledTimes(1);
      const calledPhone = smsSpy.mock.calls[0][0];
      const calledOtp = smsSpy.mock.calls[0][1];
      expect(calledPhone).toBe('+15554443333');
      expect(calledOtp).toMatch(/^\d{6}$/);

      // Verify DB state
      const updated = await PhoneVerification.findByPk(record.id);
      expect(updated?.resendCount).toBe(1);
      expect(updated?.attempts).toBe(0); // Attempts reset for new OTP
      expect(updated?.isConsumed).toBe(false);
      expect(updated?.lastResentAt).toBeDefined();
    });

    it('should immediately invalidate the old OTP and allow verification with the new OTP only', async () => {
      let sentNewOtp = '';
      jest.spyOn(smsProvider, 'sendOtp').mockImplementation(async (_phone, otp) => {
        sentNewOtp = otp;
        return true;
      });

      const { record, rawOtp: oldOtp } = await createOtpRecord({ phone: '+15557778888' });

      // Request resend
      const resendRes = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({ verificationId: record.id });
      expect(resendRes.status).toBe(200);
      expect(sentNewOtp).not.toBe(oldOtp);

      // Trying old OTP should fail
      const oldVerifyRes = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: oldOtp,
        });
      expect(oldVerifyRes.status).toBe(401);
      expect(oldVerifyRes.body.message).toBe('Invalid verification code');

      // Trying new OTP should succeed
      const newVerifyRes = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: sentNewOtp,
        });
      expect(newVerifyRes.status).toBe(200);
      expect(newVerifyRes.body.success).toBe(true);
      expect(newVerifyRes.body.data.user.phone).toBe('+15557778888');
    });
  });

  describe('2. Backend Resend Cooldown Enforcement', () => {
    it('should reject resend request if made before cooldown period has elapsed', async () => {
      // Just sent 5 seconds ago
      const recentDate = new Date(Date.now() - 5 * 1000);
      const { record } = await createOtpRecord({ lastResentAt: recentDate });

      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: record.id,
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Please wait before requesting another code');
    });
  });

  describe('3. Maximum Resend Limit Enforcement', () => {
    it('should reject resend when maximum resend attempts are reached', async () => {
      const { record } = await createOtpRecord({ resendCount: 3, maxResends: 3 });

      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: record.id,
        });

      expect(res.status).toBe(429);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/maximum resend attempts reached/i);
    });
  });

  describe('4. Ineligible Sessions (Already Consumed / Verified)', () => {
    it('should reject resend if verification is already consumed/verified', async () => {
      const { record } = await createOtpRecord({ isConsumed: true, isVerified: true });

      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: record.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already been used or completed/i);
    });
  });

  describe('5. Invalid Verification ID Handling', () => {
    it('should return 400 for malformed verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: 'invalid-id-format',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 for non-existent verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('6. Concurrent Resend Protection', () => {
    it('should handle concurrent resend requests safely and prevent duplicate active resends', async () => {
      const { record } = await createOtpRecord({ phone: '+15559990000', resendCount: 0 });

      // Fire 3 concurrent resends
      const requests = Array.from({ length: 3 }).map(() =>
        request(app)
          .post('/api/v1/auth/phone/resend-otp')
          .send({ verificationId: record.id })
      );

      const responses = await Promise.all(requests);
      const successes = responses.filter((r) => r.status === 200);
      const rejected = responses.filter((r) => r.status !== 200);

      // Exactly ONE resend succeeds, others are rejected by cooldown
      expect(successes.length).toBe(1);
      expect(rejected.length).toBe(2);

      const updated = await PhoneVerification.findByPk(record.id);
      expect(updated?.resendCount).toBe(1);
    });
  });

  describe('7. Security & Secrecy Assertions', () => {
    it('should never expose plain OTP or hash in response payload', async () => {
      const { record } = await createOtpRecord({ phone: '+15551112222' });

      const res = await request(app)
        .post('/api/v1/auth/phone/resend-otp')
        .send({
          verificationId: record.id,
        });

      expect(res.status).toBe(200);
      const rawBody = JSON.stringify(res.body);
      expect(res.body.data.otp).toBeUndefined();
      expect(res.body.data.otpHash).toBeUndefined();
      expect(rawBody).not.toContain('$2a$');
      expect(rawBody).not.toContain('$2b$');
    });
  });
});
