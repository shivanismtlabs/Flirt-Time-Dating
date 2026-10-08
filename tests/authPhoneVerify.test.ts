import request from 'supertest';
import app from '../src/app';
import { sequelize, User, PhoneVerification } from '../src/models';
import { hashPassword } from '../src/utils/password';
import { verifyToken } from '../src/utils/jwt';

describe('Phone OTP Verification Controller (POST /api/v1/auth/phone/verify-otp)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await PhoneVerification.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // Helper to create OTP record
  const createOtpRecord = async (overrides: Partial<any> = {}) => {
    const rawOtp = overrides.rawOtp || '123456';
    const otpHash = await hashPassword(rawOtp);
    const expiresAt = overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000); // 10 mins in future

    const record = await PhoneVerification.create({
      phone: overrides.phone || '+1234567890',
      otpHash,
      expiresAt,
      isConsumed: overrides.isConsumed !== undefined ? overrides.isConsumed : false,
      isVerified: overrides.isVerified !== undefined ? overrides.isVerified : false,
      attempts: overrides.attempts !== undefined ? overrides.attempts : 0,
      maxAttempts: overrides.maxAttempts !== undefined ? overrides.maxAttempts : 3,
    });

    return { record, rawOtp };
  };

  // Test 1 & 13: Correct OTP and New user phone verification
  describe('1. Correct OTP & New User Phone Verification', () => {
    it('should successfully verify correct OTP, create new user, and return JWT token and user info', async () => {
      const { record, rawOtp } = await createOtpRecord({ phone: '+15551234567' });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Phone verified successfully');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.phone).toBe('+15551234567');
      expect(res.body.data.user.isPhoneVerified).toBe(true);
      expect(res.body.data.user.password).toBeUndefined(); // Never leak password
      expect(res.body.data.token).toBeDefined();

      // Check DB record updated to consumed
      const updatedRecord = await PhoneVerification.findByPk(record.id);
      expect(updatedRecord?.isConsumed).toBe(true);
      expect(updatedRecord?.isVerified).toBe(true);
      expect(updatedRecord?.consumedAt).toBeDefined();

      // Check User created in DB
      const createdUser = await User.findOne({ where: { phone: '+15551234567' } });
      expect(createdUser).not.toBeNull();
      expect(createdUser?.isPhoneVerified).toBe(true);
    });
  });

  // Test 14: Existing user phone verification
  describe('2. Existing User Phone Verification', () => {
    it('should successfully link and authenticate existing user if phone already exists', async () => {
      const existingUser = await User.create({
        username: 'existinguser',
        email: 'existing@example.com',
        phone: '+15559876543',
        password: await hashPassword('Secret123!'),
        role: 'user',
        isActive: true,
        isPhoneVerified: false,
      });

      const { record, rawOtp } = await createOtpRecord({ phone: '+15559876543' });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(existingUser.id);
      expect(res.body.data.user.username).toBe('existinguser');

      const reloaded = await User.findByPk(existingUser.id);
      expect(reloaded?.isPhoneVerified).toBe(true);
    });
  });

  // Test 2: Incorrect OTP
  describe('3. Incorrect OTP', () => {
    it('should fail with 401 when an incorrect OTP is provided and increment attempts', async () => {
      const { record } = await createOtpRecord({ rawOtp: '654321', maxAttempts: 3 });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: '111222',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid verification code');

      // Verify attempts incremented
      const updatedRecord = await PhoneVerification.findByPk(record.id);
      expect(updatedRecord?.attempts).toBe(1);
      expect(updatedRecord?.isConsumed).toBe(false);
    });
  });

  // Test 3: Expired OTP
  describe('4. Expired OTP', () => {
    it('should reject OTP verification when expiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 5 * 60 * 1000); // 5 mins ago
      const { record, rawOtp } = await createOtpRecord({ expiresAt: pastDate });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  // Test 4 & 10: Already Consumed OTP and OTP Reuse
  describe('5. Already Consumed OTP & OTP Reuse Prevention', () => {
    it('should reject verification if the OTP has already been consumed', async () => {
      const { record, rawOtp } = await createOtpRecord({ isConsumed: true, isVerified: true });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already been used/i);
    });

    it('should prevent the same OTP from being used a second time after first success (reuse)', async () => {
      const { record, rawOtp } = await createOtpRecord();

      // First attempt: succeeds
      const res1 = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });
      expect(res1.status).toBe(200);

      // Second attempt: rejected
      const res2 = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });
      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/already been used/i);
    });
  });

  // Test 9: Maximum failed attempts
  describe('6. Maximum Failed Attempts', () => {
    it('should invalidate record and reject when maximum attempts are reached', async () => {
      const { record } = await createOtpRecord({ rawOtp: '999888', maxAttempts: 3, attempts: 2 });

      // Attempt 3 (reaches max)
      const res1 = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: '000000',
        });

      expect(res1.status).toBe(401);
      expect(res1.body.message).toMatch(/maximum verification attempts exceeded/i);

      // Check that record is marked consumed
      const updated = await PhoneVerification.findByPk(record.id);
      expect(updated?.attempts).toBe(3);
      expect(updated?.isConsumed).toBe(true);

      // Subsequent attempt with even the correct OTP is rejected
      const res2 = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: '999888',
        });

      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/already been used|maximum verification attempts exceeded/i);
    });
  });

  // Test 5: Invalid verificationId
  describe('7. Invalid Verification ID', () => {
    it('should return 400 for missing verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for malformed verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: 'not-a-valid-uuid',
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 for non-existent verificationId', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: nonExistentUuid,
          otp: '123456',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  // Test 6, 7 & 8: Malformed OTP formats (less than 6 digits, greater than 6 digits, non-numeric)
  describe('8. Malformed OTP Formats', () => {
    it('should reject OTP less than 6 digits (5 digits)', async () => {
      const { record } = await createOtpRecord();
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({ verificationId: record.id, otp: '12345' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject OTP greater than 6 digits (7 digits)', async () => {
      const { record } = await createOtpRecord();
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({ verificationId: record.id, otp: '1234567' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-numeric OTP (letters)', async () => {
      const { record } = await createOtpRecord();
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({ verificationId: record.id, otp: '12A456' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-numeric OTP (special characters)', async () => {
      const { record } = await createOtpRecord();
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({ verificationId: record.id, otp: '123-56' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty OTP', async () => {
      const { record } = await createOtpRecord();
      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({ verificationId: record.id, otp: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // Test 11: Concurrent OTP verification
  describe('9. Concurrent OTP Verification Protection', () => {
    it('should handle concurrent requests safely and allow only one success', async () => {
      const { record, rawOtp } = await createOtpRecord({ phone: '+19998887777' });

      // Fire 5 concurrent verification requests with the same valid OTP
      const concurrentRequests = Array.from({ length: 5 }).map(() =>
        request(app)
          .post('/api/v1/auth/phone/verify-otp')
          .send({
            verificationId: record.id,
            otp: rawOtp,
          })
      );

      const responses = await Promise.all(concurrentRequests);

      const successResponses = responses.filter((r) => r.status === 200);
      const nonSuccessResponses = responses.filter((r) => r.status !== 200);

      // Exactly ONE request should succeed
      expect(successResponses.length).toBe(1);
      // All other concurrent requests should be rejected
      expect(nonSuccessResponses.length).toBe(4);

      // User should only be created once
      const users = await User.findAll({ where: { phone: '+19998887777' } });
      expect(users.length).toBe(1);
    });
  });

  // Test 12: JWT generation
  describe('10. JWT Generation & Payload Verification', () => {
    it('should generate a valid JWT with user id, phone, and role in token payload', async () => {
      const { record, rawOtp } = await createOtpRecord({ phone: '+18005550199' });

      const res = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      const token = res.body.data.token;
      expect(typeof token).toBe('string');

      // Verify the JWT signature and payload
      const payload = verifyToken(token);
      expect(payload).toBeDefined();
      expect(payload.id).toBe(res.body.data.user.id);
      expect(payload.phone).toBe('+18005550199');
      expect(payload.role).toBe('user');
    });

    it('should work via alternative route aliases /api/v1/auth/phone/verify and /api/auth/verify-otp', async () => {
      const { record: r1, rawOtp: o1 } = await createOtpRecord({ phone: '+18005550299' });
      const res1 = await request(app)
        .post('/api/v1/auth/phone/verify')
        .send({ verificationId: r1.id, otp: o1 });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      const { record: r2, rawOtp: o2 } = await createOtpRecord({ phone: '+18005550399' });
      const res2 = await request(app)
        .post('/api/auth/verify-otp')
        .send({ verificationId: r2.id, otp: o2 });
      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
    });
  });
});
