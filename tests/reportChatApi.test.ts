import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  UserReport,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Report Chat API (POST /api/v1/users/:userId/report)', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let convAB: Conversation;
  let convBC: Conversation;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear reports and conversations before each test
    await UserReport.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'user_alex',
      email: 'alex@example.com',
      fullName: 'Alex River',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'cindy_m',
      email: 'cindy@example.com',
      fullName: 'Cindy M',
      gender: 'female',
      genderPreference: 'men',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_third',
      email: 'third@example.com',
      fullName: 'Third User',
      gender: 'other',
      genderPreference: 'all',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({
      id: userA.id,
      email: userA.email,
      role: userA.role,
    });

    tokenB = generateToken({
      id: userB.id,
      email: userB.email,
      role: userB.role,
    });

    tokenC = generateToken({
      id: userC.id,
      email: userC.email,
      role: userC.role,
    });

    convAB = await Conversation.create({
      user1Id: userA.id,
      user2Id: userB.id,
      lastMessage: 'Hey Cindy!',
      lastMessageAt: new Date(),
    });

    convBC = await Conversation.create({
      user1Id: userB.id,
      user2Id: userC.id,
      lastMessage: 'Hello there',
      lastMessageAt: new Date(),
    });
  });

  describe('1. Authentication Verification', () => {
    it('should reject unauthenticated report requests with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .send({ reason: 'spam' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed or invalid token with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', 'Bearer invalid-jwt-token')
        .send({ reason: 'spam' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Parameter & Target User Validation', () => {
    it('should reject invalid UUID target format with 400', async () => {
      const res = await request(app)
        .post('/api/v1/users/not-a-valid-uuid/report')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should reject report against nonexistent target user with 404', async () => {
      const nonexistentId = 'a0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/users/${nonexistentId}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/user not found/i);
    });

    it('should reject self-reporting with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userA.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'harassment' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot report yourself/i);
    });
  });

  describe('3. Report Reasons Supported by UI Modal', () => {
    const supportedModalReasons = [
      { reason: 'spam', label: 'Spam' },
      { reason: 'inappropriate_content', label: 'Inappropriate content' },
      { reason: 'fake_profile', label: 'Fake profile' },
      { reason: 'harassment', label: 'Harassment' },
    ];

    for (const { reason, label } of supportedModalReasons) {
      it(`should successfully accept and persist report reason "${reason}" (${label})`, async () => {
        const res = await request(app)
          .post(`/api/v1/users/${userB.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ reason });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Report submitted successfully');
        expect(res.body.data).toHaveProperty('reportId');
        expect(res.body.data.status).toBe('pending');

        const saved = await UserReport.findByPk(res.body.data.reportId);
        expect(saved).not.toBeNull();
        expect(saved!.reason).toBe(reason);
        expect(saved!.reporterId).toBe(userA.id);
        expect(saved!.targetUserId).toBe(userB.id);
        expect(saved!.status).toBe('pending');

        // Clean up between iterations
        await UserReport.destroy({ where: {} });
      });
    }

    it('should reject unsupported reasons with 400 validation error', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'i_just_dislike_them' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });
  });

  describe('4. Chat Association and Membership Validation', () => {
    it('should successfully associate report with conversation when reporter and target are participants', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'spam',
          conversationId: convAB.id,
          description: 'Spam links shared in chat',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('reportId');

      const saved = await UserReport.findByPk(res.body.data.reportId);
      expect(saved).not.toBeNull();
      expect(saved!.conversationId).toBe(convAB.id);
      expect(saved!.targetType).toBe('chat');
      expect(saved!.reason).toBe('spam');
      expect(saved!.description).toBe('Spam links shared in chat');
    });

    it('should reject report if conversationId does not exist with 404', async () => {
      const nonexistentConvId = 'b0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'spam',
          conversationId: nonexistentConvId,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/conversation not found/i);
    });

    it('should reject report if reporter is not a participant in the specified conversation with 403', async () => {
      // userA is not a participant in convBC (between userB and userC)
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'harassment',
          conversationId: convBC.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not a participant in this conversation/i);
    });

    it('should reject report if target user is not a participant in the specified conversation with 400', async () => {
      // convAB is between userA and userB; attempting to report userC using convAB
      const res = await request(app)
        .post(`/api/v1/users/${userC.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'harassment',
          conversationId: convAB.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/reported user is not a participant/i);
    });
  });

  describe('5. Duplicate Submission & Idempotent Retry Handling', () => {
    it('should return existing pending report idempotently without creating duplicate DB rows', async () => {
      // Initial submission
      const res1 = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'spam',
          conversationId: convAB.id,
        });

      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);
      const firstReportId = res1.body.data.reportId;

      // Duplicate / retry submission
      const res2 = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'spam',
          conversationId: convAB.id,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.reportId).toBe(firstReportId);

      // Verify DB count is exactly 1
      const totalReports = await UserReport.count({
        where: {
          reporterId: userA.id,
          targetUserId: userB.id,
        },
      });
      expect(totalReports).toBe(1);
    });

    it('should allow different users to report the same target participant independently', async () => {
      // userA reports userB
      const resA = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });
      expect(resA.status).toBe(200);

      // userC reports userB
      const resC = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ reason: 'spam' });
      expect(resC.status).toBe(200);

      // Both reports exist independently
      const totalReports = await UserReport.count({
        where: { targetUserId: userB.id },
      });
      expect(totalReports).toBe(2);
    });
  });

  describe('6. Response Envelope & Anti-Aliasing Guard', () => {
    it('should return strict envelope { success, message, data } without duplicate aliases', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'harassment' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'Report submitted successfully');
      expect(res.body).toHaveProperty('data');

      const data = res.body.data;
      expect(data).toHaveProperty('reportId');
      expect(data).toHaveProperty('status', 'pending');

      // Verify no duplicate keys or aliases
      expect(data.report_id).toBeUndefined();
      expect(data.userId).toBeUndefined();
      expect(data.reportedUserId).toBeUndefined();
      expect(data.targetUserId).toBeUndefined();
      expect(data.reporterId).toBeUndefined();
      expect(data.data).toBeUndefined();
    });

    it('should confirm that duplicate chat-specific endpoints do not exist', async () => {
      const duplicateRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });

      expect(duplicateRes.status).toBe(404);
    });
  });

  describe('7. Rate Limiter Enforcement', () => {
    it('should enforce rate limit when x-test-rate-limit header is present', async () => {
      // Send 10 successful requests
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post(`/api/v1/users/${userB.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`)
          .set('x-test-rate-limit', 'true')
          .send({ reason: 'spam' });
      }

      // The 11th request should be rate-limited with 429
      const rateLimitedRes = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-test-rate-limit', 'true')
        .send({ reason: 'spam' });

      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.success).toBe(false);
      expect(rateLimitedRes.body.message).toMatch(/too many reports/i);
    });
  });
});
