import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserBlock,
  UserReport,
  SwipeAction,
  Match,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { moderationService } from '../src/services/moderation.service';

describe('Report User and Block User APIs', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear all tables
    await UserReport.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'user_aarav',
      email: 'aarav@example.com',
      fullName: 'Aarav Sharma',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'user_meera',
      email: 'meera@example.com',
      fullName: 'Meera Patel',
      gender: 'female',
      genderPreference: 'men',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_priya',
      email: 'priya@example.com',
      fullName: 'Priya Sen',
      gender: 'female',
      genderPreference: 'men',
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
  });

  describe('1. Unauthenticated Requests', () => {
    it('should return 401 for report request without JWT', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .send({ reason: 'fake_profile' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for block request without JWT', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .send();

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Invalid or Nonexistent Target IDs', () => {
    it('should return 400 for malformed target UUID on report', async () => {
      const res = await request(app)
        .post('/api/v1/users/not-a-valid-uuid/report')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should return 400 for malformed target UUID on block', async () => {
      const res = await request(app)
        .post('/api/v1/users/not-a-valid-uuid/block')
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should return 404 for nonexistent target user on report', async () => {
      const nonexistent = 'b0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/users/${nonexistent}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'harassment' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found or unavailable/i);
    });

    it('should return 404 for nonexistent target user on block', async () => {
      const nonexistent = 'b0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/users/${nonexistent}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found or unavailable/i);
    });
  });

  describe('3. Self-Reporting and Self-Blocking Prevention', () => {
    it('should return 400 when attempting to report oneself', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userA.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'other', description: 'Self report attempt' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot report yourself/i);
    });

    it('should return 400 when attempting to block oneself', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userA.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot block yourself/i);
    });
  });

  describe('4. Invalid Report Reasons', () => {
    it('should reject unsupported report reason with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'invalid_reason_type' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });
  });

  describe('5. Description Validation', () => {
    it('should reject descriptions exceeding 1000 characters with 400', async () => {
      const longDescription = 'A'.repeat(1001);
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam', description: longDescription });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });
  });

  describe('6. Successful Report Creation', () => {
    it('should submit report successfully with pending status', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          reason: 'fake_profile',
          description: "This profile appears to be using someone else's photos.",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Report submitted successfully');
      expect(res.body.data.reportId).toBeDefined();
      expect(res.body.data.status).toBe('pending');

      const savedReport = await UserReport.findByPk(res.body.data.reportId);
      expect(savedReport).toBeDefined();
      expect(savedReport?.reporterId).toBe(userA.id);
      expect(savedReport?.targetUserId).toBe(userB.id);
      expect(savedReport?.reason).toBe('fake_profile');
      expect(savedReport?.description).toBe("This profile appears to be using someone else's photos.");
      expect(savedReport?.status).toBe('pending');
    });
  });

  describe('7. Duplicate Report Handling', () => {
    it('should handle repeated reports idempotently without creating duplicate records', async () => {
      const res1 = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam', description: 'Repeated promotional messages' });

      expect(res1.status).toBe(200);
      const firstReportId = res1.body.data.reportId;

      const res2 = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam', description: 'Repeated promotional messages again' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.reportId).toBe(firstReportId);
      expect(res2.body.data.status).toBe('pending');

      const totalReports = await UserReport.count({
        where: { reporterId: userA.id, targetUserId: userB.id },
      });
      expect(totalReports).toBe(1);
    });
  });

  describe('8. Successful Block Creation', () => {
    it('should block user successfully and return isBlocked true', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'Unsolicited messages' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User blocked successfully');
      expect(res.body.data.userId).toBe(userB.id);
      expect(res.body.data.isBlocked).toBe(true);

      const blockRecord = await UserBlock.findOne({
        where: { userId: userA.id, blockedUserId: userB.id },
      });
      expect(blockRecord).toBeDefined();
      expect(blockRecord?.reason).toBe('Unsolicited messages');
    });
  });

  describe('9. Repeated Block Requests (Idempotency)', () => {
    it('should handle repeated block requests gracefully and idempotently', async () => {
      await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      const res2 = await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.userId).toBe(userB.id);
      expect(res2.body.data.isBlocked).toBe(true);

      const count = await UserBlock.count({
        where: { userId: userA.id, blockedUserId: userB.id },
      });
      expect(count).toBe(1);
    });
  });

  describe('10. Concurrent Block Requests', () => {
    it('should handle simultaneous block requests safely without error', async () => {
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/users/${userC.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(),
        request(app)
          .post(`/api/v1/users/${userC.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send(),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.data.isBlocked).toBe(true);
      expect(res2.body.data.isBlocked).toBe(true);

      const count = await UserBlock.count({
        where: { userId: userA.id, blockedUserId: userC.id },
      });
      expect(count).toBe(1);
    });
  });

  describe('11. Blocked Users Excluded from Discovery Feed', () => {
    it('should exclude blocked user from GET /api/v1/discovery/people in both directions', async () => {
      // User A blocks User B
      await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      // Check User A's discovery feed: User B must not appear
      const feedA = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(feedA.status).toBe(200);
      const userIdsInFeedA = feedA.body.data.users.map((u: any) => u.userId);
      expect(userIdsInFeedA).not.toContain(userB.id);

      // Check User B's discovery feed: User A must not appear
      const feedB = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(feedB.status).toBe(200);
      const userIdsInFeedB = feedB.body.data.users.map((u: any) => u.userId);
      expect(userIdsInFeedB).not.toContain(userA.id);
    });
  });

  describe('12. Blocked Users Restricted from Relevant Interactions', () => {
    it('should reject swipe action with 403 when users are blocked', async () => {
      await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      // User A tries to swipe User B
      const swipeRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(swipeRes.status).toBe(403);
      expect(swipeRes.body.success).toBe(false);
      expect(swipeRes.body.message).toMatch(/privacy restrictions/i);
    });

    it('should reject profile viewing with 403 when users are blocked', async () => {
      await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      // User B tries to view User A's profile
      const profileRes = await request(app)
        .get(`/api/v1/users/${userA.id}/profile`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(profileRes.status).toBe(403);
      expect(profileRes.body.success).toBe(false);
      expect(profileRes.body.message).toMatch(/privacy restrictions/i);
    });
  });

  describe('13. Messaging / Communication Authorization After Blocking', () => {
    it('should indicate interaction is disallowed via canUsersInteract helper', async () => {
      expect(await moderationService.canUsersInteract(userA.id, userB.id)).toBe(true);

      await moderationService.blockUser(userA.id, userB.id);

      // Block must prevent interaction in both directions
      expect(await moderationService.canUsersInteract(userA.id, userB.id)).toBe(false);
      expect(await moderationService.canUsersInteract(userB.id, userA.id)).toBe(false);
    });
  });

  describe('14. Database Failures and Transaction Rollback', () => {
    it('should return 500 cleanly without leaking internal errors when report fails', async () => {
      const createSpy = jest
        .spyOn(UserReport, 'create')
        .mockRejectedValueOnce(new Error('DB Connection Dropped'));

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'spam' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/error submitting report/i);
      expect(res.body.stack).toBeUndefined();

      createSpy.mockRestore();
    });

    it('should return 500 cleanly when block fails', async () => {
      const createSpy = jest
        .spyOn(UserBlock, 'create')
        .mockRejectedValueOnce(new Error('Fatal DB Error'));

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send();

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/error processing block request/i);
      expect(res.body.stack).toBeUndefined();

      createSpy.mockRestore();
    });
  });

  describe('15. Preventing Report and Moderation Data Leakage', () => {
    it('should return minimal public confirmation without exposing moderation data or other reports', async () => {
      // First, another user (User C) reports User B
      const tokenC = generateToken({
        id: userC.id,
        email: userC.email,
        role: userC.role,
      });

      await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ reason: 'scam', description: 'Financial request' });

      // Now User A reports User B
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/report`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reason: 'fake_profile', description: 'Stolen photos' });

      expect(res.status).toBe(200);
      // Response must only contain reportId and status
      expect(Object.keys(res.body.data).sort()).toEqual(['reportId', 'status'].sort());
      // No report counts, other users' IDs, internal notes, passwords, or emails leaked
      expect(res.body.data.reportsCount).toBeUndefined();
      expect(res.body.data.otherReports).toBeUndefined();
      expect(res.body.data.reporterId).toBeUndefined();
      expect(res.body.data.targetUserId).toBeUndefined();
    });
  });
});
