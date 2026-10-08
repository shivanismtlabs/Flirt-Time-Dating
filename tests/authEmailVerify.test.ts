import request from 'supertest';
import app from '../src/app';
import { sequelize, User, EmailVerification } from '../src/models';
import { hashPassword } from '../src/utils/password';
import { verifyToken } from '../src/utils/jwt';

describe('Email OTP Verification Controller (POST /api/v1/auth/email/verify-otp)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await EmailVerification.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // Helper to create Email OTP record
  const createEmailOtpRecord = async (overrides: Partial<any> = {}) => {
    const rawOtp = overrides.rawOtp || '123456';
    const otpHash = await hashPassword(rawOtp);
    const expiresAt = overrides.expiresAt || new Date(Date.now() + 10 * 60 * 1000); // 10 mins in future

    const record = await EmailVerification.create({
      email: (overrides.email || 'testuser@example.com').toLowerCase().trim(),
      otpHash,
      expiresAt,
      isConsumed: overrides.isConsumed !== undefined ? overrides.isConsumed : false,
      isVerified: overrides.isVerified !== undefined ? overrides.isVerified : false,
      attempts: overrides.attempts !== undefined ? overrides.attempts : 0,
      maxAttempts: overrides.maxAttempts !== undefined ? overrides.maxAttempts : 5,
    });

    return { record, rawOtp };
  };

  // Test 1: Correct OTP
  describe('1. Correct OTP & Verification Flow', () => {
    it('should successfully verify correct OTP, consume record, create user, and return JWT token', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ email: 'john.doe@example.com' });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Email verified successfully');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('john.doe@example.com');
      expect(res.body.data.user.password).toBeUndefined(); // Never leak password hash
      expect(res.body.data.token).toBeDefined();

      // Verify DB record state
      const updatedRecord = await EmailVerification.findByPk(record.id);
      expect(updatedRecord?.isConsumed).toBe(true);
      expect(updatedRecord?.isVerified).toBe(true);
      expect(updatedRecord?.consumedAt).toBeDefined();

      // Verify user created
      const createdUser = await User.findOne({ where: { email: 'john.doe@example.com' } });
      expect(createdUser).not.toBeNull();
      expect(createdUser?.email).toBe('john.doe@example.com');
    });
  });

  // Test 2: Incorrect OTP
  describe('2. Incorrect OTP', () => {
    it('should reject incorrect OTP with 401 and increment failed attempts', async () => {
      const { record } = await createEmailOtpRecord({ email: 'user@example.com' });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '654321', // Wrong OTP
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Invalid verification code');

      // Assert attempts incremented in DB
      const updatedRecord = await EmailVerification.findByPk(record.id);
      expect(updatedRecord?.attempts).toBe(1);
      expect(updatedRecord?.isConsumed).toBe(false);
    });
  });

  // Test 3: Expired OTP
  describe('3. Expired OTP', () => {
    it('should reject OTP verification when expiresAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 5000); // 5 seconds in past
      const { record, rawOtp } = await createEmailOtpRecord({ expiresAt: pastDate });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);

      // Should be marked consumed to prevent further attempts
      const updatedRecord = await EmailVerification.findByPk(record.id);
      expect(updatedRecord?.isConsumed).toBe(true);
    });
  });

  // Test 4: Already Consumed OTP
  describe('4. Already Consumed OTP', () => {
    it('should reject verification if the OTP has already been consumed', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ isConsumed: true });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already.*(used|consumed)/i);
    });
  });

  // Test 5: Invalid verificationId
  describe('5. Invalid Verification ID Handling', () => {
    it('should return 400 for missing verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 for malformed verificationId', async () => {
      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: 'not-a-valid-uuid-1234',
          otp: '123456',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid.*verification.*id/i);
    });

    it('should return 404 for non-existent verificationId', async () => {
      const nonExistentUuid = 'a0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: nonExistentUuid,
          otp: '123456',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  // Tests 6, 7, 8: Malformed OTP Formats
  describe('6, 7 & 8. Malformed OTP Formats', () => {
    it('6. should reject OTP less than 6 digits (5 digits)', async () => {
      const { record } = await createEmailOtpRecord();

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '12345',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('7. should reject OTP greater than 6 digits (7 digits)', async () => {
      const { record } = await createEmailOtpRecord();

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '1234567',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('8. should reject non-numeric OTP (letters and special characters)', async () => {
      const { record } = await createEmailOtpRecord();

      const resLetters = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: 'abcdef',
        });
      expect(resLetters.status).toBe(400);

      const resSpecial = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '12@456',
        });
      expect(resSpecial.status).toBe(400);
    });
  });

  // Test 9: Maximum failed attempts
  describe('9. Maximum Failed Attempts', () => {
    it('should invalidate record and reject when maximum failed attempts are reached', async () => {
      const { record } = await createEmailOtpRecord({ attempts: 4, maxAttempts: 5 });

      // 5th attempt with wrong OTP
      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '999999',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/maximum.*attempts/i);

      // Verify DB record is invalidated (isConsumed: true)
      const updatedRecord = await EmailVerification.findByPk(record.id);
      expect(updatedRecord?.attempts).toBe(5);
      expect(updatedRecord?.isConsumed).toBe(true);

      // Subsequent attempt should be blocked as consumed
      const subsequentRes = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: '123456',
        });
      expect(subsequentRes.status).toBe(400);
    });
  });

  // Test 10: OTP reuse
  describe('10. OTP Reuse Prevention', () => {
    it('should prevent the same OTP from being used a second time after first success', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ email: 'reuse@example.com' });

      // First verification attempt - should succeed
      const firstRes = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.success).toBe(true);

      // Second verification attempt with same OTP - should fail
      const secondRes = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.message).toMatch(/already.*used/i);
    });
  });

  // Test 11: Concurrent verification
  describe('11. Concurrent Verification Protection', () => {
    it('should handle simultaneous concurrent requests safely and allow only one success', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ email: 'concurrent@example.com' });

      // Fire 5 concurrent verify requests simultaneously
      const responses = await Promise.all([
        request(app).post('/api/v1/auth/email/verify-otp').send({ verificationId: record.id, otp: rawOtp }),
        request(app).post('/api/v1/auth/email/verify-otp').send({ verificationId: record.id, otp: rawOtp }),
        request(app).post('/api/v1/auth/email/verify-otp').send({ verificationId: record.id, otp: rawOtp }),
        request(app).post('/api/v1/auth/email/verify-otp').send({ verificationId: record.id, otp: rawOtp }),
        request(app).post('/api/v1/auth/email/verify-otp').send({ verificationId: record.id, otp: rawOtp }),
      ]);

      const successResponses = responses.filter((r) => r.status === 200);
      const nonSuccessResponses = responses.filter((r) => r.status !== 200);

      expect(successResponses.length).toBe(1);
      expect(nonSuccessResponses.length).toBe(4);

      // Verify only 1 user was created
      const userCount = await User.count({ where: { email: 'concurrent@example.com' } });
      expect(userCount).toBe(1);
    });
  });

  // Test 12: JWT Generation & Payload
  describe('12. JWT Generation & Payload Verification', () => {
    it('should generate a valid JWT with user id, email, and role in token payload', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ email: 'jwt.user@example.com' });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      const token = res.body.data.token;
      expect(token).toBeDefined();

      const decoded = verifyToken(token);
      expect(decoded.id).toBe(res.body.data.user.id);
      expect(decoded.email).toBe('jwt.user@example.com');
      expect(decoded.role).toBe('user');
    });

    it('should support route aliases /api/v1/auth/email/verify and /api/auth/verify-email-otp', async () => {
      const { record: r1, rawOtp: o1 } = await createEmailOtpRecord({ email: 'alias1@example.com' });
      const res1 = await request(app)
        .post('/api/v1/auth/email/verify')
        .send({ verificationId: r1.id, otp: o1 });
      expect(res1.status).toBe(200);

      const { record: r2, rawOtp: o2 } = await createEmailOtpRecord({ email: 'alias2@example.com' });
      const res2 = await request(app)
        .post('/api/v1/auth/verify-email-otp')
        .send({ verificationId: r2.id, otp: o2 });
      expect(res2.status).toBe(200);
    });
  });

  // Test 13: New Email User
  describe('13. New Email User Registration via OTP', () => {
    it('should create new user with normalized email, default role, and active status', async () => {
      const { record, rawOtp } = await createEmailOtpRecord({ email: 'brandnew.user@example.com' });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('brandnew.user@example.com');
      expect(res.body.data.user.role).toBe('user');
      expect(res.body.data.user.isActive).toBe(true);

      const dbUser = await User.findOne({ where: { email: 'brandnew.user@example.com' } });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.username).toBeDefined();
    });
  });

  // Test 14: Existing Email User
  describe('14. Existing Email User Authentication', () => {
    it('should find and authenticate existing user without duplicate creation', async () => {
      const existingUser = await User.create({
        username: 'existing_email_user',
        email: 'veteran@example.com',
        password: await hashPassword('KnownPassword123!'),
        role: 'user',
        isActive: true,
      });

      const { record, rawOtp } = await createEmailOtpRecord({ email: 'veteran@example.com' });

      const res = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: record.id,
          otp: rawOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(existingUser.id);
      expect(res.body.data.user.username).toBe('existing_email_user');

      // Verify no duplicate users created
      const count = await User.count({ where: { email: 'veteran@example.com' } });
      expect(count).toBe(1);
    });
  });
});
