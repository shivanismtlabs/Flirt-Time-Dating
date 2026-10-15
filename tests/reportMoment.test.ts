import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserBlock,
  UserReport,
  Moment,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { moderationService } from '../src/services/moderation.service';

describe('Report Moment API (POST /api/v1/moments/:momentId/report)', () => {
  let creatorUser: User;
  let reporterUser: User;
  let thirdPartyUser: User;
  let activeMoment: Moment;
  let expiredMoment: Moment;
  let deletedMoment: Moment;

  let creatorToken: string;
  let reporterToken: string;
  let thirdPartyToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up report, moment, and user tables
    await UserReport.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await User.destroy({ where: {} });

    creatorUser = await User.create({
      username: 'creator_priya',
      email: 'priya@example.com',
      fullName: 'Priya Sharma',
      gender: 'female',
      genderPreference: 'men',
      isActive: true,
      role: 'user',
    });

    reporterUser = await User.create({
      username: 'reporter_aarav',
      email: 'aarav@example.com',
      fullName: 'Aarav Mehta',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      role: 'user',
    });

    thirdPartyUser = await User.create({
      username: 'user_rohit',
      email: 'rohit@example.com',
      fullName: 'Rohit Verma',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      role: 'user',
    });

    creatorToken = generateToken({
      id: creatorUser.id,
      email: creatorUser.email,
      role: creatorUser.role,
    });

    reporterToken = generateToken({
      id: reporterUser.id,
      email: reporterUser.email,
      role: reporterUser.role,
    });

    thirdPartyToken = generateToken({
      id: thirdPartyUser.id,
      email: thirdPartyUser.email,
      role: thirdPartyUser.role,
    });

    const now = new Date();
    const future24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const past1h = new Date(now.getTime() - 60 * 60 * 1000);

    // Active Moment
    activeMoment = await Moment.create({
      userId: creatorUser.id,
      caption: 'Sunset vibes at the beach!',
      audience: 'everyone',
      status: 'active',
      publishedAt: now,
      expiresAt: future24h,
    });

    // Expired Moment
    expiredMoment = await Moment.create({
      userId: creatorUser.id,
      caption: 'Yesterday concert memory',
      audience: 'everyone',
      status: 'expired',
      publishedAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
      expiresAt: past1h,
    });

    // Deleted Moment
    deletedMoment = await Moment.create({
      userId: creatorUser.id,
      caption: 'Accidental upload',
      audience: 'everyone',
      status: 'deleted',
      publishedAt: now,
      expiresAt: future24h,
    });
  });

  describe('1. Authentication Validation', () => {
    it('should reject request without Authorization header with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .send({
          reason: 'inappropriate_content',
          description: 'Violates community guidelines',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/token/i);
    });

    it('should reject request with invalid JWT with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', 'Bearer invalid.token.value')
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Moment ID Validation', () => {
    it('should return 400 for malformed UUID format', async () => {
      const res = await request(app)
        .post('/api/v1/moments/invalid-uuid-format/report')
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should return 404 for nonexistent Moment ID', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/moments/${fakeUuid}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/moment not found/i);
    });
  });

  describe('3. Self-Reporting Prevention', () => {
    it('should reject when a user attempts to report their own Moment with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot report your own Moment/i);
    });
  });

  describe('4. Reason and Description Validation', () => {
    it('should reject invalid report reason with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'invalid_reason_code_123',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should reject excessively long descriptions exceeding 1000 characters with 400', async () => {
      const longDescription = 'A'.repeat(1001);
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
          description: longDescription,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should accept supported reasons: nudity, harassment, violence, spam, fake_content, other', async () => {
      const reasons = [
        'nudity',
        'harassment',
        'violence',
        'spam',
        'fake_content',
        'other',
      ] as const;

      for (const reason of reasons) {
        // Create a separate moment for each reason test to test fresh persistence
        const moment = await Moment.create({
          userId: creatorUser.id,
          caption: `Test for reason ${reason}`,
          audience: 'everyone',
          status: 'active',
          publishedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

        const res = await request(app)
          .post(`/api/v1/moments/${moment.id}/report`)
          .set('Authorization', `Bearer ${reporterToken}`)
          .send({ reason });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('pending');
      }
    });
  });

  describe('5. Successful Report Persistence', () => {
    it('should successfully persist report with reason, trimmed description, and correct links', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
          description: '  This Moment contains offensive language and gestures.  ',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Moment reported successfully');
      expect(res.body.data).toHaveProperty('reportId');
      expect(res.body.data.momentId).toBe(activeMoment.id);
      expect(res.body.data.status).toBe('pending');

      // Verify row in database
      const savedReport = await UserReport.findByPk(res.body.data.reportId);
      expect(savedReport).not.toBeNull();
      expect(savedReport!.reporterId).toBe(reporterUser.id);
      expect(savedReport!.targetUserId).toBe(creatorUser.id);
      expect(savedReport!.targetType).toBe('moment');
      expect(savedReport!.momentId).toBe(activeMoment.id);
      expect(savedReport!.reason).toBe('inappropriate_content');
      expect(savedReport!.description).toBe(
        'This Moment contains offensive language and gestures.'
      );
      expect(savedReport!.status).toBe('pending');
    });

    it('should persist successfully when description is omitted', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'spam',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBe(activeMoment.id);

      const savedReport = await UserReport.findByPk(res.body.data.reportId);
      expect(savedReport).not.toBeNull();
      expect(savedReport!.description).toBeNull();
    });
  });

  describe('6. Idempotency and Concurrent Submissions', () => {
    it('should return the existing pending report idempotently without creating duplicate DB rows', async () => {
      // First submission
      const firstRes = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'harassment',
          description: 'First report attempt',
        });

      expect(firstRes.status).toBe(201);
      const firstReportId = firstRes.body.data.reportId;

      // Duplicate submission by same reporter on same moment
      const duplicateRes = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'harassment',
          description: 'Repeated report attempt',
        });

      expect(duplicateRes.status).toBe(201);
      expect(duplicateRes.body.data.reportId).toBe(firstReportId);
      expect(duplicateRes.body.data.status).toBe('pending');

      // Verify exactly 1 report in DB for this reporter & moment
      const count = await UserReport.count({
        where: {
          reporterId: reporterUser.id,
          momentId: activeMoment.id,
        },
      });
      expect(count).toBe(1);
    });

    it('should handle concurrent submissions gracefully', async () => {
      const results = await Promise.all([
        request(app)
          .post(`/api/v1/moments/${activeMoment.id}/report`)
          .set('Authorization', `Bearer ${thirdPartyToken}`)
          .send({ reason: 'spam', description: 'Concurrent spam report 1' }),
        request(app)
          .post(`/api/v1/moments/${activeMoment.id}/report`)
          .set('Authorization', `Bearer ${thirdPartyToken}`)
          .send({ reason: 'spam', description: 'Concurrent spam report 2' }),
      ]);

      expect(results[0].status).toBe(201);
      expect(results[1].status).toBe(201);
      expect(results[0].body.data.reportId).toBe(results[1].body.data.reportId);

      const count = await UserReport.count({
        where: {
          reporterId: thirdPartyUser.id,
          momentId: activeMoment.id,
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('7. Expired or Deleted Moment Handling', () => {
    it('should reject reporting an expired Moment with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${expiredMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should reject reporting a deleted Moment with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${deletedMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'inappropriate_content',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/deleted|unavailable/i);
    });
  });

  describe('8. Privacy and Security', () => {
    it('should NOT leak reporter identity or creator sensitive data in response', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'nudity',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        reportId: expect.any(String),
        momentId: activeMoment.id,
        status: 'pending',
      });
      expect(res.body.data).not.toHaveProperty('reporterId');
      expect(res.body.data).not.toHaveProperty('reporter');
      expect(res.body.data).not.toHaveProperty('targetUserId');
    });

    it('should not automatically delete the Moment or ban creator on report submission', async () => {
      await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'violence',
          description: 'Serious allegation',
        });

      const momentAfterReport = await Moment.findByPk(activeMoment.id);
      expect(momentAfterReport).not.toBeNull();
      expect(momentAfterReport!.status).toBe('active');

      const creatorAfterReport = await User.findByPk(creatorUser.id);
      expect(creatorAfterReport).not.toBeNull();
      expect(creatorAfterReport!.isActive).toBe(true);
    });

    it('should respect block rules (blocked user cannot report moment)', async () => {
      // Creator blocks reporter
      await UserBlock.create({
        userId: creatorUser.id,
        blockedUserId: reporterUser.id,
      });

      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'harassment',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/block|privacy/i);
    });
  });

  describe('9. Database Failure Handling', () => {
    it('should handle internal database errors gracefully with 500', async () => {
      jest.spyOn(UserReport, 'create').mockRejectedValueOnce(new Error('DB Connection Timeout'));

      const res = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'spam',
        });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('10. Compatibility with Existing Report User API', () => {
    it('should ensure POST /api/v1/users/:userId/report remains 100% functional', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${creatorUser.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'harassment',
          description: 'Harassing profile bio',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('reportId');
      expect(res.body.data.status).toBe('pending');

      const report = await UserReport.findByPk(res.body.data.reportId);
      expect(report).not.toBeNull();
      expect(report!.targetUserId).toBe(creatorUser.id);
      expect(report!.momentId).toBeNull();
      expect(report!.targetType).toBe('user');
    });
  });

  describe('11. Feed and Discovery Hiding for Reporter', () => {
    it('should hide reported moment and its creator from feed and discovery for reporter', async () => {
      // 1. Before report, reporter can see the moment in feed
      const feedBefore = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${reporterToken}`);
      expect(feedBefore.status).toBe(200);
      const momentIdsBefore = feedBefore.body.data.moments.map((m: any) => m.id);
      expect(momentIdsBefore).toContain(activeMoment.id);

      // 2. Reporter reports the moment
      const reportRes = await request(app)
        .post(`/api/v1/moments/${activeMoment.id}/report`)
        .set('Authorization', `Bearer ${reporterToken}`)
        .send({
          reason: 'harassment',
          description: 'Harassing moment',
        });
      expect(reportRes.status).toBe(201);

      // 3. After report, reporter must NOT see the moment or creator in moments feed
      const feedAfter = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${reporterToken}`);
      expect(feedAfter.status).toBe(200);
      const momentIdsAfter = feedAfter.body.data.moments.map((m: any) => m.id);
      expect(momentIdsAfter).not.toContain(activeMoment.id);
      const creatorMoments = feedAfter.body.data.moments.filter(
        (m: any) => m.userId === creatorUser.id
      );
      expect(creatorMoments.length).toBe(0);

      // 4. Third-party user should still see the moment (it is not deleted globally)
      const feedThirdParty = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${thirdPartyToken}`);
      expect(feedThirdParty.status).toBe(200);
      const thirdPartyIds = feedThirdParty.body.data.moments.map((m: any) => m.id);
      expect(thirdPartyIds).toContain(activeMoment.id);

      // 5. Reporter should not see creator in discovery feed
      const discoveryRes = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${reporterToken}`);
      expect(discoveryRes.status).toBe(200);
      const discoveryUserIds = discoveryRes.body.data.users.map((u: any) => u.userId);
      expect(discoveryUserIds).not.toContain(creatorUser.id);

      // 6. Direct moment detail for reporter should return 404
      const detailRes = await request(app)
        .get(`/api/v1/moments/${activeMoment.id}`)
        .set('Authorization', `Bearer ${reporterToken}`);
      expect(detailRes.status).toBe(404);

      // 7. Direct moment detail for third party should succeed
      const detailThirdParty = await request(app)
        .get(`/api/v1/moments/${activeMoment.id}`)
        .set('Authorization', `Bearer ${thirdPartyToken}`);
      expect(detailThirdParty.status).toBe(200);
    });
  });
});
