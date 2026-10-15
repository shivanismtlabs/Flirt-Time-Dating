import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserBlock,
  UserReport,
  Moment,
  MomentMedia,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Block and Report List APIs', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;
  let momentB: Moment;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await UserReport.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'user_aarav',
      email: 'aarav@example.com',
      fullName: 'Aarav Sharma',
      firstName: 'Aarav',
      gender: 'male',
      city: 'Mumbai',
      profilePicture: 'https://flirttime-media.s3.amazonaws.com/profiles/aarav.jpg',
      isFaceVerified: true,
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'user_meera',
      email: 'meera@example.com',
      fullName: 'Meera Patel',
      firstName: 'Meera',
      gender: 'female',
      city: 'Delhi',
      profilePicture: 'https://flirttime-media.s3.amazonaws.com/profiles/meera.jpg',
      isFaceVerified: true,
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_priya',
      email: 'priya@example.com',
      fullName: 'Priya Sen',
      firstName: 'Priya',
      gender: 'female',
      city: 'Bangalore',
      profilePicture: null,
      isFaceVerified: false,
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

    momentB = await Moment.create({
      userId: userB.id,
      caption: 'Sunset vibes',
      publishedAt: new Date(),
      audience: 'everyone',
      status: 'active',
    });

    await MomentMedia.create({
      momentId: momentB.id,
      mediaUrl: 'https://flirttime-media.s3.amazonaws.com/moments/sunset.jpg',
      mediaType: 'image',
      displayOrder: 1,
    });
  });

  describe('1. Blocked Users List API (GET /api/v1/users/blocked)', () => {
    it('should return 401 if unauthenticated', async () => {
      const res = await request(app).get('/api/v1/users/blocked');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return empty list when no users are blocked', async () => {
      const res = await request(app)
        .get('/api/v1/users/blocked')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.blockedUsers).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('should return list of blocked users with details and pagination', async () => {
      // User A blocks User B and User C
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
        reason: 'Harassment',
      });
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userC.id,
        reason: 'Spam',
      });

      const res = await request(app)
        .get('/api/v1/users/blocked?page=1&limit=10')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.blockedUsers).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(2);
      expect(res.body.data.pagination.page).toBe(1);

      const meeraBlock = res.body.data.blockedUsers.find((b: any) => b.userId === userB.id);
      expect(meeraBlock).toBeDefined();
      expect(meeraBlock.username).toBe('user_meera');
      expect(meeraBlock.fullName).toBe('Meera Patel');
      expect(meeraBlock.firstName).toBe('Meera');
      expect(meeraBlock.city).toBe('Delhi');
      expect(meeraBlock.profilePhoto).toContain('meera.jpg');
      expect(meeraBlock.isVerified).toBe(true);
      expect(meeraBlock.reason).toBe('Harassment');
      expect(meeraBlock.blockedAt).toBeDefined();
    });

    it('should work via route alias /api/v1/users/blocks', async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
        reason: 'Inappropriate',
      });

      const res = await request(app)
        .get('/api/v1/users/blocks')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.blockedUsers).toHaveLength(1);
    });

    it('should work via moderation alias /api/v1/moderation/blocked-users', async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
      });

      const res = await request(app)
        .get('/api/v1/moderation/blocked-users')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.blockedUsers).toHaveLength(1);
    });
  });

  describe('2. Unblock User API (DELETE /api/v1/users/:userId/block)', () => {
    beforeEach(async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
        reason: 'Harassment',
      });
    });

    it('should return 401 if unauthenticated', async () => {
      const res = await request(app).delete(`/api/v1/users/${userB.id}/block`);
      expect(res.status).toBe(401);
    });

    it('should return 400 when attempting to unblock self', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${userA.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot unblock yourself/i);
    });

    it('should return 404 when unblocking a user that is not blocked', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${userC.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not blocked/i);
    });

    it('should successfully unblock user via DELETE /api/v1/users/:userId/block', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isBlocked).toBe(false);

      // Verify block record is removed from DB
      const blockCount = await UserBlock.count({
        where: { userId: userA.id, blockedUserId: userB.id },
      });
      expect(blockCount).toBe(0);

      // Verify list endpoint is empty
      const listRes = await request(app)
        .get('/api/v1/users/blocked')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listRes.body.data.blockedUsers).toHaveLength(0);
    });

    it('should successfully unblock user via POST /api/v1/users/:userId/unblock alias', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/unblock`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isBlocked).toBe(false);
    });
  });

  describe('3. User Reports List API (GET /api/v1/users/reports)', () => {
    it('should return 401 if unauthenticated', async () => {
      const res = await request(app).get('/api/v1/users/reports');
      expect(res.status).toBe(401);
    });

    it('should return empty list when user has filed no reports', async () => {
      const res = await request(app)
        .get('/api/v1/users/reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reports).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it('should return filed user and moment reports with details', async () => {
      // User A reports User B
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'user',
        reason: 'fake_profile',
        description: 'Impersonating another person',
        status: 'pending',
      });

      // User A reports Moment B
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'moment',
        momentId: momentB.id,
        reason: 'inappropriate_content',
        description: 'Offensive image',
        status: 'reviewed',
      });

      const res = await request(app)
        .get('/api/v1/users/reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reports).toHaveLength(2);
      expect(res.body.data.pagination.total).toBe(2);

      const userReport = res.body.data.reports.find((r: any) => r.targetType === 'user');
      expect(userReport).toBeDefined();
      expect(userReport.reason).toBe('fake_profile');
      expect(userReport.description).toBe('Impersonating another person');
      expect(userReport.targetUser.username).toBe('user_meera');
      expect(userReport.targetUser.profilePhoto).toContain('meera.jpg');

      const momentReport = res.body.data.reports.find((r: any) => r.targetType === 'moment');
      expect(momentReport).toBeDefined();
      expect(momentReport.momentId).toBe(momentB.id);
      expect(momentReport.moment.caption).toBe('Sunset vibes');
    });

    it('should filter reports by status', async () => {
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'user',
        reason: 'spam',
        status: 'pending',
      });
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userC.id,
        targetType: 'user',
        reason: 'harassment',
        status: 'resolved',
      });

      const res = await request(app)
        .get('/api/v1/users/reports?status=resolved')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.reports).toHaveLength(1);
      expect(res.body.data.reports[0].status).toBe('resolved');
    });

    it('should work via /api/v1/reports/my-reports alias', async () => {
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'user',
        reason: 'scam',
        status: 'pending',
      });

      const res = await request(app)
        .get('/api/v1/reports/my-reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reports).toHaveLength(1);
    });
  });

  describe('4. Report Reasons Catalog API (GET /api/v1/reports/reasons)', () => {
    it('should return catalog of user and moment report reasons', async () => {
      const res = await request(app).get('/api/v1/reports/reasons');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userReportReasons).toBeDefined();
      expect(Array.isArray(res.body.data.userReportReasons)).toBe(true);
      expect(res.body.data.userReportReasons.length).toBeGreaterThan(0);

      const fakeProfileReason = res.body.data.userReportReasons.find(
        (r: any) => r.key === 'fake_profile'
      );
      expect(fakeProfileReason).toBeDefined();
      expect(fakeProfileReason.label).toBeDefined();

      expect(res.body.data.momentReportReasons).toBeDefined();
      expect(Array.isArray(res.body.data.momentReportReasons)).toBe(true);
    });

    it('should work via /api/v1/users/report-reasons alias', async () => {
      const res = await request(app)
        .get('/api/v1/users/report-reasons')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userReportReasons).toBeDefined();
    });
  });

  describe('5. Moderation/Admin All Reports API (GET /api/v1/reports)', () => {
    beforeEach(async () => {
      await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'user',
        reason: 'harassment',
        status: 'pending',
      });
      await UserReport.create({
        reporterId: userB.id,
        targetUserId: userA.id,
        targetType: 'user',
        reason: 'fake_profile',
        status: 'resolved',
      });
    });

    it('should retrieve all reports with counts', async () => {
      const res = await request(app)
        .get('/api/v1/reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reports).toHaveLength(2);
      expect(res.body.data.counts).toBeDefined();
      expect(res.body.data.counts.pending).toBe(1);
      expect(res.body.data.counts.resolved).toBe(1);
      expect(res.body.data.counts.total).toBe(2);
    });

    it('should work via /api/v1/moderation/reports alias', async () => {
      const res = await request(app)
        .get('/api/v1/moderation/reports')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reports).toHaveLength(2);
    });
  });

  describe('6. Update Report Status API (PATCH /api/v1/reports/:reportId/status)', () => {
    let report: UserReport;

    beforeEach(async () => {
      report = await UserReport.create({
        reporterId: userA.id,
        targetUserId: userB.id,
        targetType: 'user',
        reason: 'harassment',
        status: 'pending',
      });
    });

    it('should update report status to reviewed', async () => {
      const res = await request(app)
        .patch(`/api/v1/reports/${report.id}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'reviewed' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.report.status).toBe('reviewed');

      const updated = await UserReport.findByPk(report.id);
      expect(updated?.status).toBe('reviewed');
    });

    it('should return 400 for invalid status', async () => {
      const res = await request(app)
        .patch(`/api/v1/reports/${report.id}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'invalid_status_value' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
