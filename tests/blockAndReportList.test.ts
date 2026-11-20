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

describe('Block and Report APIs', () => {
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

    it('should return clean list of blocked users without unnecessary fields', async () => {
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
      expect(meeraBlock).toEqual({
        userId: userB.id,
        name: 'user_meera',
        username: 'user_meera',
        profilePhoto: 'https://flirttime-media.s3.amazonaws.com/profiles/meera.jpg',
        reason: 'Harassment',
        blockedAt: expect.any(String),
      });

      // Verify no unnecessary fields are exposed
      expect(meeraBlock.blockId).toBeUndefined();
      expect(meeraBlock.city).toBeUndefined();
      expect(meeraBlock.gender).toBeUndefined();
      expect(meeraBlock.isVerified).toBeUndefined();
      expect(meeraBlock.fullName).toBeUndefined();
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

    it('should successfully unblock user', async () => {
      const res = await request(app)
        .delete(`/api/v1/users/${userB.id}/block`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        userId: userB.id,
        isBlocked: false,
      });

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

    it('should return clean report records with concise target info', async () => {
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
      expect(userReport).toEqual({
        id: expect.any(String),
        targetType: 'user',
        targetUserId: userB.id,
        targetName: 'user_meera',
        username: 'user_meera',
        targetPhoto: 'https://flirttime-media.s3.amazonaws.com/profiles/meera.jpg',
        momentId: null,
        momentThumbnail: null,
        reason: 'fake_profile',
        description: 'Impersonating another person',
        status: 'pending',
        createdAt: expect.any(String),
      });

      const momentReport = res.body.data.reports.find((r: any) => r.targetType === 'moment');
      expect(momentReport).toEqual({
        id: expect.any(String),
        targetType: 'moment',
        targetUserId: userB.id,
        targetName: 'user_meera',
        username: 'user_meera',
        targetPhoto: 'https://flirttime-media.s3.amazonaws.com/profiles/meera.jpg',
        momentId: momentB.id,
        momentThumbnail: 'https://flirttime-media.s3.amazonaws.com/moments/sunset.jpg',
        reason: 'inappropriate_content',
        description: 'Offensive image',
        status: 'reviewed',
        createdAt: expect.any(String),
      });

      // Verify no reporter details or internal DB bloat leaked
      expect(userReport.reporterId).toBeUndefined();
      expect(userReport.reporter).toBeUndefined();
      expect(userReport.updatedAt).toBeUndefined();
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
  });

  describe('4. Report Reasons Catalog API (GET /api/v1/users/report-reasons)', () => {
    it('should return clean report reasons list with key and label only', async () => {
      const res = await request(app)
        .get('/api/v1/users/report-reasons')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userReasons).toBeDefined();
      expect(res.body.data.momentReasons).toBeDefined();

      const fakeProfile = res.body.data.userReasons.find((r: any) => r.key === 'fake_profile');
      expect(fakeProfile).toEqual({
        key: 'fake_profile',
        label: 'Fake profile / Impersonation',
      });
      expect(fakeProfile.description).toBeUndefined();
    });
  });
});
