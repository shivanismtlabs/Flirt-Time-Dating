import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  SwipeAction,
  Moment,
  UserReport,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Fix 1: Reload Cards When All Swiped & Fix 2: Report Single Moment Only Hides Reported Moment', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Fix 1: Reload Cards Once All Swiped (Including Nopes) to Avoid Blank Screen', () => {
    let mainUser: User;
    let card1: User;
    let card2: User;
    let mainToken: string;

    beforeEach(async () => {
      await SwipeAction.destroy({ where: {} });
      await UserReport.destroy({ where: {} });
      await Moment.destroy({ where: {} });
      await User.destroy({ where: {} });

      mainUser = await User.create({
        username: 'swiping_user',
        email: 'swiping_user@example.com',
        fullName: 'Swiper Main',
        gender: 'man',
        genderPreference: 'women',
        isActive: true,
        role: 'user',
      });

      card1 = await User.create({
        username: 'ananya_card',
        email: 'ananya@example.com',
        fullName: 'Ananya Sharma',
        gender: 'female',
        isActive: true,
        role: 'user',
      });

      card2 = await User.create({
        username: 'priya_card',
        email: 'priya@example.com',
        fullName: 'Priya Verma',
        gender: 'female',
        isActive: true,
        role: 'user',
      });

      mainToken = generateToken({
        id: mainUser.id,
        email: mainUser.email,
        role: mainUser.role,
      });
    });

    it('reloads and shows all cards again (including noped cards) once all cards are swiped, avoiding a blank screen', async () => {
      // 1. Initial fetch returns 2 eligible cards
      const resInitial = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${mainToken}`);

      expect(resInitial.status).toBe(200);
      expect(resInitial.body.success).toBe(true);
      expect(resInitial.body.data.users.length).toBe(2);

      // 2. User swipes "nope" on both cards (all cards swiped)
      const swipe1 = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${mainToken}`)
        .send({
          targetUserId: card1.id,
          action: 'nope',
        });
      expect(swipe1.status).toBe(200);

      const swipe2 = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${mainToken}`)
        .send({
          targetUserId: card2.id,
          action: 'nope',
        });
      expect(swipe2.status).toBe(200);

      // 3. Next fetch: Since all cards were swiped, server reloads deck and shows cards again
      const resReloaded = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${mainToken}`);

      expect(resReloaded.status).toBe(200);
      expect(resReloaded.body.success).toBe(true);
      // Deck should NOT be empty (no blank screen)
      expect(resReloaded.body.data.users.length).toBe(2);
      expect(resReloaded.body.data.pagination.total).toBe(2);

      const returnedIds = resReloaded.body.data.users.map((u: any) => u.userId || u.id);
      expect(returnedIds).toContain(card1.id);
      expect(returnedIds).toContain(card2.id);

      // 4. User can now swipe "like" on reloaded card without 409 conflict error
      const swipeLike = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${mainToken}`)
        .send({
          targetUserId: card1.id,
          action: 'like',
        });

      expect(swipeLike.status).toBe(200);
      expect(swipeLike.body.success).toBe(true);
      expect(swipeLike.body.data.action).toBe('like');
    });
  });

  describe('Fix 2: Report User / Moment Functionality Hides ONLY the Reported Moment', () => {
    let tusharUser: User;
    let viewerUser: User;
    let viewerToken: string;
    let moment1: Moment;
    let moment2: Moment;
    let moment3: Moment;

    beforeEach(async () => {
      await UserReport.destroy({ where: {} });
      await Moment.destroy({ where: {} });
      await User.destroy({ where: {} });

      tusharUser = await User.create({
        username: 'tushar42',
        email: 'tushar42@example.com',
        fullName: 'Tushar Gupta',
        gender: 'male',
        isActive: true,
        role: 'user',
      });

      viewerUser = await User.create({
        username: 'viewer_user',
        email: 'viewer@example.com',
        fullName: 'Viewer User',
        gender: 'female',
        isActive: true,
        role: 'user',
      });

      viewerToken = generateToken({
        id: viewerUser.id,
        email: viewerUser.email,
        role: viewerUser.role,
      });

      // Create 3 active moments for tushar42
      moment1 = await Moment.create({
        userId: tusharUser.id,
        caption: 'First moment by tushar42',
        publishedAt: new Date(),
        audience: 'everyone',
        status: 'active',
      });

      moment2 = await Moment.create({
        userId: tusharUser.id,
        caption: 'Second moment by tushar42',
        publishedAt: new Date(),
        audience: 'everyone',
        status: 'active',
      });

      moment3 = await Moment.create({
        userId: tusharUser.id,
        caption: 'Third moment by tushar42',
        publishedAt: new Date(),
        audience: 'everyone',
        status: 'active',
      });
    });

    it('when viewer reports one of tushar42 moments via reportMoment, ONLY that moment is hidden and other moments remain visible', async () => {
      // 1. Initially, viewer sees all 3 moments of tushar42
      const resInitial = await request(app)
        .get(`/api/v1/users/${tusharUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resInitial.status).toBe(200);
      expect(resInitial.body.data.moments.length).toBe(3);

      // 2. Viewer reports moment1
      const reportRes = await request(app)
        .post(`/api/v1/moments/${moment1.id}/report`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          reason: 'inappropriate_content',
          description: 'Not suitable',
        });

      expect(reportRes.status).toBe(201);
      expect(reportRes.body.success).toBe(true);

      // 3. Fetch tushar42 moments again: moment1 should be hidden, but moment2 and moment3 MUST remain visible!
      const resAfterReport = await request(app)
        .get(`/api/v1/users/${tusharUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resAfterReport.status).toBe(200);
      expect(resAfterReport.body.data.moments.length).toBe(2);

      const visibleIds = resAfterReport.body.data.moments.map((m: any) => m.id);
      expect(visibleIds).not.toContain(moment1.id);
      expect(visibleIds).toContain(moment2.id);
      expect(visibleIds).toContain(moment3.id);

      // 4. In moments feed: moment1 should be hidden, but moment2 and moment3 MUST remain visible
      const feedRes = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(feedRes.status).toBe(200);
      const feedIds = feedRes.body.data.moments.map((m: any) => m.id);
      expect(feedIds).not.toContain(moment1.id);
      expect(feedIds).toContain(moment2.id);
      expect(feedIds).toContain(moment3.id);
    });

    it('when viewer reports moment via POST /api/v1/users/:userId/report with momentId, ONLY that moment is hidden', async () => {
      // Viewer reports moment2 via user report endpoint with momentId
      const reportRes = await request(app)
        .post(`/api/v1/users/${tusharUser.id}/report`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({
          reason: 'inappropriate_content',
          description: 'Reporting moment2',
          momentId: moment2.id,
        });

      expect(reportRes.status).toBe(200);
      expect(reportRes.body.success).toBe(true);

      // Check tushar42's moments: moment2 is hidden, moment1 and moment3 remain visible
      const resMoments = await request(app)
        .get(`/api/v1/users/${tusharUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resMoments.status).toBe(200);
      expect(resMoments.body.data.moments.length).toBe(2);

      const visibleIds = resMoments.body.data.moments.map((m: any) => m.id);
      expect(visibleIds).not.toContain(moment2.id);
      expect(visibleIds).toContain(moment1.id);
      expect(visibleIds).toContain(moment3.id);
    });
  });
});
