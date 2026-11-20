import request from 'supertest';
import app from '../src/app';
import { sequelize, User, SwipeAction, Match, UserBlock, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Common Swipe Action API (POST /api/v1/discovery/actions)', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let inactiveUser: User;
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
    // Clear action tables
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'usera_swipe',
      email: 'usera@example.com',
      fullName: 'Aarav Sharma',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'userb_swipe',
      email: 'userb@example.com',
      fullName: 'Meera Patel',
      gender: 'female',
      genderPreference: 'men',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'userc_swipe',
      email: 'userc@example.com',
      fullName: 'Priya Sen',
      gender: 'female',
      genderPreference: 'men',
      isActive: true,
      role: 'user',
    });

    inactiveUser = await User.create({
      username: 'inactive_user',
      email: 'inactive@example.com',
      fullName: 'Inactive User',
      gender: 'female',
      isActive: false,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email!, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email!, role: userB.role });
  });

  describe('1. Authentication and Request Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing targetUserId with 400', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ action: 'like' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/targetUserId/i);
    });

    it('should reject malformed targetUserId with 400', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: 'invalid-uuid-123', action: 'like' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject unsupported action value with 400', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'super_hate' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid action/i);
    });

    it('should reject action on oneself with 400', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userA.id, action: 'like' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/yourself/i);
    });

    it('should reject non-existent targetUserId with 404', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: nonExistentUuid, action: 'like' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Target user does not exist/i);
    });

    it('should reject inactive target user with 404', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: inactiveUser.id, action: 'like' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Like Action (Interested)', () => {
    it('should save Like action successfully without immediate match', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Like saved successfully');
      expect(res.body.data).toEqual({
        targetUserId: userB.id,
        action: 'like',
        isMatched: false,
        matchId: null,
      });

      // Verify persisted in DB
      const swipe = await SwipeAction.findOne({
        where: { userId: userA.id, targetUserId: userB.id },
      });
      expect(swipe).not.toBeNull();
      expect(swipe!.action).toBe('like');
    });

    it('should accept "interested" alias and normalize to "like"', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'interested' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe('like');
    });

    it('should handle repeated identical Like requests idempotently', async () => {
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isMatched).toBe(false);

      const count = await SwipeAction.count({
        where: { userId: userA.id, targetUserId: userB.id },
      });
      expect(count).toBe(1);
    });

    it('should reject conflicting action change with 409', async () => {
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'nope' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Conflicting action/i);
    });
  });

  describe('3. Nope Action (Not My Vibe / Not Interested)', () => {
    it('should save Nope action and never create a match', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'nope' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Nope saved successfully');
      expect(res.body.data).toEqual({
        targetUserId: userB.id,
        action: 'nope',
        isMatched: false,
        matchId: null,
      });

      const matchCount = await Match.count();
      expect(matchCount).toBe(0);
    });

    it('should accept "not_interested" alias and normalize to "nope"', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'not_interested' });

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('nope');
    });
  });

  describe('4. Super Like / Connect Action', () => {
    it('should save Super Like action successfully', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'super_like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Super Like saved successfully');
      expect(res.body.data.action).toBe('super_like');
      expect(res.body.data.isMatched).toBe(false);
    });

    it('should accept "connect" alias and normalize to "super_like"', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'connect' });

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('super_like');
    });
  });

  describe('5. Reciprocal Likes and Match Creation', () => {
    it('should create Match when user B reciprocal likes user A', async () => {
      // User A likes User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      // User B likes User A back
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("It's a match!");
      expect(res.body.data.isMatched).toBe(true);
      expect(res.body.data.matchId).toBeDefined();
      expect(typeof res.body.data.matchId).toBe('string');

      // Verify Match in DB
      const match = await Match.findByPk(res.body.data.matchId);
      expect(match).not.toBeNull();
      expect(match!.isActive).toBe(true);

      // Verify canonical ID ordering (user1Id < user2Id)
      const [expectedUser1, expectedUser2] = [userA.id, userB.id].sort();
      expect(match!.user1Id).toBe(expectedUser1);
      expect(match!.user2Id).toBe(expectedUser2);
    });

    it('should create Match when reciprocal action is super_like', async () => {
      // User A super likes User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'super_like' });

      // User B likes User A back
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.data.isMatched).toBe(true);
      expect(res.body.data.matchId).toBeDefined();
    });

    it('should not create a match if reciprocal action is nope', async () => {
      // User A nopes User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'nope' });

      // User B likes User A
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.data.isMatched).toBe(false);
      expect(res.body.data.matchId).toBeNull();
    });

    it('should prevent duplicate matches on concurrent or repeated reciprocal requests', async () => {
      // User A likes User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      // User B sends two requests
      const res1 = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      const res2 = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.body.data.matchId).toBe(res2.body.data.matchId);

      const totalMatches = await Match.count();
      expect(totalMatches).toBe(1);
    });

    it('should put a rematch back on the matches list after a nope', async () => {
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'nope' });

      const hidden = await request(app)
        .get('/api/v1/interactions?limit=20&type=matches')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(hidden.body.data.items).toHaveLength(0);

      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      const shown = await request(app)
        .get('/api/v1/interactions?limit=20&type=matches')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(shown.status).toBe(200);
      expect(shown.body.data.items).toHaveLength(1);
      expect(shown.body.data.items[0].user.id).toBe(userB.id);
      expect(shown.body.data.items[0].user.name).toBe('Meera');
    });
  });

  describe('6. Blocked User Restrictions', () => {
    it('should reject action with 403 when current user has blocked target user', async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
      });

      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/block or privacy/i);
    });

    it('should reject action with 403 when target user has blocked current user', async () => {
      await UserBlock.create({
        userId: userB.id,
        blockedUserId: userA.id,
      });

      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('7. Feed Integration: Already Swiped Profiles Exclusion', () => {
    it('should exclude swiped profiles from discovery people feed', async () => {
      // Before swipe: User A sees User B and User C
      const feedBefore = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(feedBefore.status).toBe(200);
      const userIdsBefore = feedBefore.body.data.users.map((u: any) => u.userId);
      expect(userIdsBefore).toContain(userB.id);
      expect(userIdsBefore).toContain(userC.id);

      // User A swipes like on User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      // After swipe: User A should no longer see User B in feed
      const feedAfter = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(feedAfter.status).toBe(200);
      const userIdsAfter = feedAfter.body.data.users.map((u: any) => u.userId);
      expect(userIdsAfter).not.toContain(userB.id);
      expect(userIdsAfter).toContain(userC.id);
    });
  });
});
