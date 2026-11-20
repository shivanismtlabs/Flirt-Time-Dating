import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserBlock,
  Conversation,
  VideoCall,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Calls API — Call History & Screen Requirements', () => {
  let currentUser: User;
  let userRiya: User;
  let userMaya: User;
  let userPriya: User;
  let userMeera: User;
  let userTanya: User;
  let userNisha: User;
  let userSara: User;
  let userBlocked: User;

  let currentToken: string;
  let blockedToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await VideoCall.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Current active user
    currentUser = await User.create({
      username: 'main_user',
      email: 'main@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      isActive: true,
      role: 'user',
    });
    currentToken = generateToken({ id: currentUser.id, role: currentUser.role });

    // Users matching the Calls Screen screenshot
    userRiya = await User.create({
      username: 'riya_shah',
      email: 'riya@example.com',
      fullName: 'Riya',
      firstName: 'Riya',
      profilePicture: 'photos/riya.jpg',
      isActive: true,
      role: 'user',
    });

    userMaya = await User.create({
      username: 'maya_kapoor',
      email: 'maya@example.com',
      fullName: 'Maya',
      firstName: 'Maya',
      isActive: true,
      role: 'user',
    });

    userPriya = await User.create({
      username: 'priya_verma',
      email: 'priya@example.com',
      fullName: 'Priya',
      firstName: 'Priya',
      profilePicture: 'photos/priya.jpg',
      isActive: true,
      role: 'user',
    });

    userMeera = await User.create({
      username: 'meera_sen',
      email: 'meera@example.com',
      fullName: 'Meera',
      firstName: 'Meera',
      isActive: true,
      role: 'user',
    });

    userTanya = await User.create({
      username: 'tanya_roy',
      email: 'tanya@example.com',
      fullName: 'Tanya',
      firstName: 'Tanya',
      isActive: true,
      role: 'user',
    });

    userNisha = await User.create({
      username: 'nisha_patel',
      email: 'nisha@example.com',
      fullName: 'Nisha',
      firstName: 'Nisha',
      isActive: true,
      role: 'user',
    });

    userSara = await User.create({
      username: 'sara_khan',
      email: 'sara@example.com',
      fullName: 'Sara',
      firstName: 'Sara',
      isActive: true,
      role: 'user',
    });

    userBlocked = await User.create({
      username: 'blocked_person',
      email: 'blocked@example.com',
      fullName: 'Blocked Person',
      isActive: true,
      role: 'user',
    });
    blockedToken = generateToken({ id: userBlocked.id, role: userBlocked.role });
  });

  describe('1. Authentication Guard', () => {
    it('should reject unauthenticated call history request with 401', async () => {
      const res = await request(app).get('/api/v1/calls');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Empty State & Response Envelope', () => {
    it('should return 200 with standard envelope and empty array when user has no calls', async () => {
      const res = await request(app)
        .get('/api/v1/calls')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Call history fetched successfully');
      expect(res.body.data).toBeDefined();
      expect(res.body.data.calls).toEqual([]);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasMore: false,
      });
    });
  });

  describe('3. Calls List Matching Screen Data & Anti-Duplication Verification', () => {
    it('should return call logs matching the screen design with only required keys and no duplicate aliases', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const eighteenMinutesAgo = new Date(now.getTime() - 18 * 60 * 1000);

      // 1. Riya: Missed Video (Caller: Riya, Callee: currentUser, status: missed, callType: video)
      const callRiya = await VideoCall.create({
        callerId: userRiya.id,
        calleeId: currentUser.id,
        channelName: 'call_riya_1',
        callerUid: 1001,
        calleeUid: 1002,
        callType: 'video',
        status: 'missed',
        expiresAt: twoMinutesAgo,
        createdAt: twoMinutesAgo,
      });

      // 2. Maya: Outgoing Audio · 4:12 (252s) (Caller: currentUser, Callee: Maya, status: ended, callType: audio)
      const startMaya = new Date(eighteenMinutesAgo.getTime() - 252 * 1000);
      const callMaya = await VideoCall.create({
        callerId: currentUser.id,
        calleeId: userMaya.id,
        channelName: 'call_maya_1',
        callerUid: 2001,
        calleeUid: 2002,
        callType: 'audio',
        status: 'ended',
        startedAt: startMaya,
        acceptedAt: startMaya,
        endedAt: eighteenMinutesAgo,
        expiresAt: eighteenMinutesAgo,
        createdAt: startMaya,
      });

      const res = await request(app)
        .get('/api/v1/calls')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.calls).toHaveLength(2);
      expect(data.pagination.total).toBe(2);

      // Verify Riya (Missed Video call)
      const riyaItem = data.calls.find((c: any) => c.id === callRiya.id);
      expect(riyaItem).toBeDefined();
      expect(riyaItem.callType).toBe('video');
      expect(riyaItem.direction).toBe('missed');
      expect(riyaItem.status).toBe('missed');
      expect(riyaItem.duration).toBe(0);
      expect(riyaItem.user).toEqual({
        id: userRiya.id,
        name: 'Riya',
        avatarUrl: expect.stringContaining('photos/riya.jpg'),
      });
      expect(typeof riyaItem.createdAt).toBe('string');

      // Verify Maya (Outgoing Audio · 4:12)
      const mayaItem = data.calls.find((c: any) => c.id === callMaya.id);
      expect(mayaItem).toBeDefined();
      expect(mayaItem.callType).toBe('audio');
      expect(mayaItem.direction).toBe('outgoing');
      expect(mayaItem.status).toBe('ended');
      expect(mayaItem.duration).toBe(252);
      expect(mayaItem.user).toEqual({
        id: userMaya.id,
        name: 'Maya',
        avatarUrl: null,
      });

      // STRICT 8-PILLAR GLOBAL API RESPONSE STANDARD VERIFICATION:
      // 1. Envelope has strictly: data, message, success
      expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'success'].sort());

      // 2. data has strictly: calls, pagination
      expect(Object.keys(data).sort()).toEqual(['calls', 'pagination'].sort());

      // 3. pagination has strictly: hasMore, limit, page, total, totalPages
      expect(Object.keys(data.pagination).sort()).toEqual(
        ['hasMore', 'limit', 'page', 'total', 'totalPages'].sort()
      );

      // 4. Each call item has strictly ONLY required keys matching screen:
      // ['callType', 'createdAt', 'direction', 'duration', 'id', 'status', 'user']
      const requiredItemKeys = ['callType', 'createdAt', 'direction', 'duration', 'id', 'status', 'user'].sort();
      for (const item of data.calls) {
        expect(Object.keys(item).sort()).toEqual(requiredItemKeys);

        // 5. Each user object has strictly ONLY required keys:
        // ['avatarUrl', 'id', 'name']
        expect(Object.keys(item.user).sort()).toEqual(['avatarUrl', 'id', 'name'].sort());

        // 6. NO snake_case keys anywhere
        for (const key of Object.keys(item)) {
          expect(key).not.toMatch(/_/);
        }
        for (const userKey of Object.keys(item.user)) {
          expect(userKey).not.toMatch(/_/);
        }

        // 7. NO redundant aliases or leaked ORM attributes
        expect(item.callId).toBeUndefined();
        expect(item.call_id).toBeUndefined();
        expect(item.userId).toBeUndefined();
        expect(item.user_id).toBeUndefined();
        expect(item.callerId).toBeUndefined();
        expect(item.calleeId).toBeUndefined();
        expect(item.channelName).toBeUndefined();
        expect(item.callerUid).toBeUndefined();
        expect(item.calleeUid).toBeUndefined();
        expect(item.expiresAt).toBeUndefined();
        expect(item.endedBy).toBeUndefined();
        expect(item.updatedAt).toBeUndefined();
        expect(item.conversationId).toBeUndefined();
        expect(item.created_at).toBeUndefined();
        expect(item.call_type).toBeUndefined();
      }
    });

    it('should support incoming video calls with duration', async () => {
      const now = new Date();
      const startPriya = new Date(now.getTime() - 728 * 1000);

      // Priya: Incoming Video · 12:08 (728s) (Caller: Priya, Callee: currentUser)
      const callPriya = await VideoCall.create({
        callerId: userPriya.id,
        calleeId: currentUser.id,
        channelName: 'call_priya_1',
        callerUid: 3001,
        calleeUid: 3002,
        callType: 'video',
        status: 'ended',
        startedAt: startPriya,
        acceptedAt: startPriya,
        endedAt: now,
        expiresAt: now,
        createdAt: startPriya,
      });

      const res = await request(app)
        .get('/api/v1/calls')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      const priyaItem = res.body.data.calls.find((c: any) => c.id === callPriya.id);
      expect(priyaItem).toBeDefined();
      expect(priyaItem.callType).toBe('video');
      expect(priyaItem.direction).toBe('incoming');
      expect(priyaItem.status).toBe('ended');
      expect(priyaItem.duration).toBe(728);
      expect(priyaItem.user.name).toBe('Priya');
    });
  });

  describe('4. Search Filter (Search Bar)', () => {
    beforeEach(async () => {
      const now = new Date();
      // Call with Riya
      await VideoCall.create({
        callerId: userRiya.id,
        calleeId: currentUser.id,
        channelName: 'call_riya_s',
        callerUid: 4001,
        calleeUid: 4002,
        callType: 'video',
        status: 'missed',
        expiresAt: now,
        createdAt: now,
      });

      // Call with Maya
      await VideoCall.create({
        callerId: currentUser.id,
        calleeId: userMaya.id,
        channelName: 'call_maya_s',
        callerUid: 4003,
        calleeUid: 4004,
        callType: 'audio',
        status: 'ended',
        startedAt: now,
        acceptedAt: now,
        endedAt: now,
        expiresAt: now,
        createdAt: now,
      });
    });

    it('should filter call logs by search query matching user name', async () => {
      const res = await request(app)
        .get('/api/v1/calls?search=Maya')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.calls).toHaveLength(1);
      expect(res.body.data.calls[0].user.name).toBe('Maya');
    });

    it('should return empty list when search does not match any contact', async () => {
      const res = await request(app)
        .get('/api/v1/calls?search=NonExistentPerson')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.calls).toHaveLength(0);
      expect(res.body.data.pagination.total).toBe(0);
    });
  });

  describe('5. Pagination & Ordering', () => {
    it('should paginate results and order by newest first', async () => {
      const baseTime = Date.now();
      // Create 3 calls with spaced timestamps
      for (let i = 0; i < 3; i++) {
        const time = new Date(baseTime + i * 10000);
        await VideoCall.create({
          callerId: currentUser.id,
          calleeId: userNisha.id,
          channelName: `call_nisha_p_${i}`,
          callerUid: 5000 + i * 2,
          calleeUid: 5001 + i * 2,
          callType: 'audio',
          status: 'ended',
          startedAt: time,
          acceptedAt: time,
          endedAt: time,
          expiresAt: time,
          createdAt: time,
        });
      }

      // Page 1, limit 2
      const resPage1 = await request(app)
        .get('/api/v1/calls?page=1&limit=2')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.calls).toHaveLength(2);
      expect(resPage1.body.data.pagination.page).toBe(1);
      expect(resPage1.body.data.pagination.limit).toBe(2);
      expect(resPage1.body.data.pagination.total).toBe(3);
      expect(resPage1.body.data.pagination.totalPages).toBe(2);
      expect(resPage1.body.data.pagination.hasMore).toBe(true);

      // Page 2, limit 2
      const resPage2 = await request(app)
        .get('/api/v1/calls?page=2&limit=2')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.calls).toHaveLength(1);
      expect(resPage2.body.data.pagination.page).toBe(2);
      expect(resPage2.body.data.pagination.hasMore).toBe(false);
    });
  });

  describe('6. Blocked User Privacy Guard', () => {
    it('should exclude calls with blocked users from call history', async () => {
      const now = new Date();
      await VideoCall.create({
        callerId: userBlocked.id,
        calleeId: currentUser.id,
        channelName: 'call_blocked_1',
        callerUid: 6001,
        calleeUid: 6002,
        callType: 'video',
        status: 'ended',
        startedAt: now,
        acceptedAt: now,
        endedAt: now,
        expiresAt: now,
        createdAt: now,
      });

      // Block the user
      await UserBlock.create({
        userId: currentUser.id,
        blockedUserId: userBlocked.id,
      });

      const res = await request(app)
        .get('/api/v1/calls')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.calls).toHaveLength(0);
    });
  });

  describe('7. Route Aliases & Backward Compatibility', () => {
    it('should return identical data via /api/v1/calls/history alias', async () => {
      const now = new Date();
      await VideoCall.create({
        callerId: currentUser.id,
        calleeId: userSara.id,
        channelName: 'call_sara_alias',
        callerUid: 7001,
        calleeUid: 7002,
        callType: 'audio',
        status: 'ended',
        startedAt: now,
        acceptedAt: now,
        endedAt: now,
        expiresAt: now,
        createdAt: now,
      });

      const resDirect = await request(app)
        .get('/api/v1/calls')
        .set('Authorization', `Bearer ${currentToken}`);

      const resAlias = await request(app)
        .get('/api/v1/calls/history')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(resDirect.status).toBe(200);
      expect(resAlias.status).toBe(200);
      expect(resDirect.body.data.calls).toEqual(resAlias.body.data.calls);
    });
  });

  describe('8. Delete Call Log (DELETE /api/v1/calls/:callId)', () => {
    it('should allow participant to delete a call log with minimal response', async () => {
      const now = new Date();
      const call = await VideoCall.create({
        callerId: currentUser.id,
        calleeId: userTanya.id,
        channelName: 'call_to_delete',
        callerUid: 8001,
        calleeUid: 8002,
        callType: 'audio',
        status: 'missed',
        expiresAt: now,
        createdAt: now,
      });

      const delRes = await request(app)
        .delete(`/api/v1/calls/${call.id}`)
        .set('Authorization', `Bearer ${currentToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
      expect(delRes.body.message).toMatch(/deleted successfully/i);
      expect(delRes.body.data).toEqual({ id: call.id });

      // Verify removed from DB
      const dbCall = await VideoCall.findByPk(call.id);
      expect(dbCall).toBeNull();
    });

    it('should reject deleting call log by a non-participant with 403', async () => {
      const now = new Date();
      const call = await VideoCall.create({
        callerId: userRiya.id,
        calleeId: userMaya.id,
        channelName: 'call_other_users',
        callerUid: 9001,
        calleeUid: 9002,
        callType: 'video',
        status: 'ended',
        expiresAt: now,
        createdAt: now,
      });

      const res = await request(app)
        .delete(`/api/v1/calls/${call.id}`)
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
