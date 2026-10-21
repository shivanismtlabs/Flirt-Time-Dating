import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  UserBlock,
  VideoCall,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { env } from '../src/config/env';

describe('FlirtTime Agora Video Calling APIs', () => {
  let userCaller: User;
  let userCallee: User;
  let userOther: User;
  let userBlocked: User;

  let tokenCaller: string;
  let tokenCallee: string;
  let tokenOther: string;
  let tokenBlocked: string;

  let conversation: Conversation;

  // Setup valid test Agora credentials
  const TEST_AGORA_APP_ID = '970ca35de60c44645bbae8a21506140d';
  const TEST_AGORA_CERTIFICATE = '5cfd2fd1755d40ecb729f39468041a97';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    env.AGORA_APP_ID = TEST_AGORA_APP_ID;
    env.AGORA_APP_CERTIFICATE = TEST_AGORA_CERTIFICATE;
    env.AGORA_TOKEN_EXPIRATION_SECONDS = 3600;
    env.AGORA_RINGING_EXPIRATION_SECONDS = 60;

    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Reset Agora env credentials in case a negative test altered them
    env.AGORA_APP_ID = TEST_AGORA_APP_ID;
    env.AGORA_APP_CERTIFICATE = TEST_AGORA_CERTIFICATE;

    await VideoCall.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    // 1. Caller
    userCaller = await User.create({
      username: 'caller_alex',
      email: 'alex@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      profilePicture: 'photos/alex.jpg',
      isActive: true,
      role: 'user',
    });
    tokenCaller = generateToken({ id: userCaller.id, role: userCaller.role });

    // 2. Callee (e.g. Cindy M matching screen design)
    userCallee = await User.create({
      username: 'cindy_m',
      email: 'cindy@example.com',
      fullName: 'Cindy M',
      firstName: 'Cindy',
      lastName: 'M',
      profilePicture: 'photos/cindy.jpg',
      isActive: true,
      role: 'user',
    });
    tokenCallee = generateToken({ id: userCallee.id, role: userCallee.role });

    // 3. Other user (for authorization / isolation tests)
    userOther = await User.create({
      username: 'other_user',
      email: 'other@example.com',
      fullName: 'Other User',
      isActive: true,
      role: 'user',
    });
    tokenOther = generateToken({ id: userOther.id, role: userOther.role });

    // 4. Blocked user
    userBlocked = await User.create({
      username: 'blocked_user',
      email: 'blocked@example.com',
      fullName: 'Blocked User',
      isActive: true,
      role: 'user',
    });
    tokenBlocked = generateToken({ id: userBlocked.id, role: userBlocked.role });

    // Create conversation between Caller and Callee
    conversation = await Conversation.create({
      user1Id: userCaller.id,
      user2Id: userCallee.id,
      lastMessage: 'Hey Cindy!',
    });
  });

  describe('1. Authentication & Security Guard', () => {
    it('should reject unauthenticated initiate requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .send({ calleeId: userCallee.id });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Authentication token');
    });

    it('should prevent user from calling themselves with 400', async () => {
      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCaller.id });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot call yourself/i);
    });

    it('should reject call initiation if calleeId is invalid UUID with 400', async () => {
      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject call to non-existent user with 404', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: fakeUuid });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject call if users are blocked with 403', async () => {
      // UserCaller blocked UserBlocked
      await UserBlock.create({
        userId: userCaller.id,
        blockedUserId: userBlocked.id,
      });

      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userBlocked.id });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot call this user/i);
    });
  });

  describe('2. Initiate Video Call (POST /api/v1/calls/video/initiate)', () => {
    it('should successfully initiate video call, generate short-lived token, and return clean DTO', async () => {
      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({
          calleeId: userCallee.id,
          conversationId: conversation.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/video call initiated/i);

      const data = res.body.data;
      expect(data).toBeDefined();
      expect(typeof data.callId).toBe('string');
      expect(typeof data.channelName).toBe('string');
      expect(data.channelName).toMatch(/^call_/);
      expect(typeof data.rtcToken).toBe('string');
      expect(data.rtcToken.length).toBeGreaterThan(20);
      expect(data.appId).toBe(TEST_AGORA_APP_ID);
      expect(typeof data.uid).toBe('number');
      expect(data.uid).toBeGreaterThan(0);
      expect(data.status).toBe('ringing');
      expect(data.expiresAt).toBeDefined();

      // Callee summary
      expect(data.callee).toBeDefined();
      expect(data.callee.id).toBe(userCallee.id);
      expect(data.callee.name).toBe('Cindy M');

      // Security Check: App Certificate and raw tokens must NEVER be leaked
      expect((res.body as any).appCertificate).toBeUndefined();
      expect((data as any).appCertificate).toBeUndefined();
      expect((data as any).app_certificate).toBeUndefined();

      // Check DB record
      const dbCall = await VideoCall.findByPk(data.callId);
      expect(dbCall).not.toBeNull();
      expect(dbCall?.callerId).toBe(userCaller.id);
      expect(dbCall?.calleeId).toBe(userCallee.id);
      expect(dbCall?.status).toBe('ringing');
      expect(dbCall?.callerUid).toBe(data.uid);
    });

    it('should fail safely with 500 when Agora configuration is missing without creating dangling record', async () => {
      env.AGORA_APP_ID = '';

      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/agora app id is not configured/i);

      // Verify no dangling call record in DB
      const callsCount = await VideoCall.count();
      expect(callsCount).toBe(0);
    });
  });

  describe('3. Active Call & Busy Constraints', () => {
    it('should reject call initiation if callee is already busy with 409', async () => {
      // Create an existing active call for Callee with userOther
      await VideoCall.create({
        callerId: userOther.id,
        calleeId: userCallee.id,
        channelName: 'call_existing_channel',
        callerUid: 111111,
        calleeUid: 222222,
        status: 'accepted',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });

      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/currently in another call/i);
    });

    it('should reject call initiation if caller already has an ongoing call with 409', async () => {
      // Create an existing call where Caller is already in a call
      await VideoCall.create({
        callerId: userCaller.id,
        calleeId: userOther.id,
        channelName: 'call_caller_busy_channel',
        callerUid: 333333,
        calleeUid: 444444,
        status: 'accepted',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });

      const res = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already have an active call/i);
    });
  });

  describe('4. Accept Video Call (POST /api/v1/calls/video/:callId/accept)', () => {
    let callId: string;

    beforeEach(async () => {
      const initRes = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      callId = initRes.body.data.callId;
    });

    it('should allow the intended recipient to accept the call and receive recipient-specific credentials', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/video call accepted/i);

      const data = res.body.data;
      expect(data.callId).toBe(callId);
      expect(data.status).toBe('accepted');
      expect(typeof data.rtcToken).toBe('string');
      expect(typeof data.uid).toBe('number');
      expect(data.appId).toBe(TEST_AGORA_APP_ID);
      expect(data.startedAt).toBeDefined();

      // Check DB transition
      const dbCall = await VideoCall.findByPk(callId);
      expect(dbCall?.status).toBe('accepted');
      expect(dbCall?.acceptedAt).not.toBeNull();
      expect(dbCall?.startedAt).not.toBeNull();
    });

    it('should reject non-recipient from accepting call with 403', async () => {
      // userOther attempts to accept userCallee's call
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should prevent caller from accepting their own call with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject accepting an already accepted call with 400', async () => {
      // First acceptance
      await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      // Second acceptance
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already been accepted/i);
    });

    it('should reject accepting an expired call with 410 and transition to missed', async () => {
      // Manually set expiration in the past
      await VideoCall.update(
        { expiresAt: new Date(Date.now() - 5000) },
        { where: { id: callId } }
      );

      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);

      // Verify DB status transitioned to missed
      const dbCall = await VideoCall.findByPk(callId);
      expect(dbCall?.status).toBe('missed');
    });
  });

  describe('5. Reject Video Call (POST /api/v1/calls/video/:callId/reject)', () => {
    let callId: string;

    beforeEach(async () => {
      const initRes = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      callId = initRes.body.data.callId;
    });

    it('should allow recipient to reject incoming ringing call', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/reject`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');

      const dbCall = await VideoCall.findByPk(callId);
      expect(dbCall?.status).toBe('rejected');
      expect(dbCall?.endedBy).toBe(userCallee.id);
    });

    it('should reject third party from rejecting call with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/reject`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should handle repeat reject requests idempotently', async () => {
      await request(app)
        .post(`/api/v1/calls/video/${callId}/reject`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/reject`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('rejected');
    });
  });

  describe('6. End Video Call (POST /api/v1/calls/video/:callId/end)', () => {
    let callId: string;

    beforeEach(async () => {
      const initRes = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      callId = initRes.body.data.callId;

      // Accept call
      await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();
    });

    it('should allow caller to end active video call', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/end`)
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ended');
      expect(res.body.data.endedAt).toBeDefined();

      const dbCall = await VideoCall.findByPk(callId);
      expect(dbCall?.status).toBe('ended');
      expect(dbCall?.endedBy).toBe(userCaller.id);
    });

    it('should allow callee to end active video call', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/end`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ended');

      const dbCall = await VideoCall.findByPk(callId);
      expect(dbCall?.status).toBe('ended');
      expect(dbCall?.endedBy).toBe(userCallee.id);
    });

    it('should reject non-participant from ending call with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/end`)
        .set('Authorization', `Bearer ${tokenOther}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should handle repeat end requests idempotently without error', async () => {
      await request(app)
        .post(`/api/v1/calls/video/${callId}/end`)
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send();

      const res = await request(app)
        .post(`/api/v1/calls/video/${callId}/end`)
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ended');
    });
  });

  describe('7. Get Active Video Call (GET /api/v1/calls/video/active)', () => {
    it('should return null when user has no active calls', async () => {
      const res = await request(app)
        .get('/api/v1/calls/video/active')
        .set('Authorization', `Bearer ${tokenCaller}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it('should return ongoing active call with refreshed token for participant', async () => {
      // Initiate and accept call
      const initRes = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      const callId = initRes.body.data.callId;

      await request(app)
        .post(`/api/v1/calls/video/${callId}/accept`)
        .set('Authorization', `Bearer ${tokenCallee}`)
        .send();

      // Callee retrieves active call
      const res = await request(app)
        .get('/api/v1/calls/video/active')
        .set('Authorization', `Bearer ${tokenCallee}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const data = res.body.data;
      expect(data.callId).toBe(callId);
      expect(data.status).toBe('accepted');
      expect(data.role).toBe('callee');
      expect(typeof data.rtcToken).toBe('string');
      expect(data.otherParticipant.id).toBe(userCaller.id);
      expect(data.otherParticipant.name).toBe('Alex Morgan');
    });
  });

  describe('8. Response Standard & Anti-Duplication Verification', () => {
    it('should ensure all responses follow camelCase and have no duplicate/redundant aliases', async () => {
      const initRes = await request(app)
        .post('/api/v1/calls/video/initiate')
        .set('Authorization', `Bearer ${tokenCaller}`)
        .send({ calleeId: userCallee.id });

      expect(initRes.status).toBe(201);
      const data = initRes.body.data;

      // Verify standard top-level envelope
      expect(Object.keys(initRes.body).sort()).toEqual(['data', 'message', 'success'].sort());

      // Verify no snake_case keys in data
      const keys = Object.keys(data);
      for (const key of keys) {
        expect(key).not.toMatch(/_/);
      }

      // Verify no redundant aliases
      expect(data.call_id).toBeUndefined();
      expect(data.channel_name).toBeUndefined();
      expect(data.rtc_token).toBeUndefined();
      expect(data.app_id).toBeUndefined();
      expect(data.expires_at).toBeUndefined();
    });
  });
});
