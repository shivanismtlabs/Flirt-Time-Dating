import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Match,
  UserBlock,
  ConnectionRequest,
  UserDevice,
  Notification,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import * as firebaseConfig from '../src/config/firebase';

describe('Connect API & Firebase Push Notifications', () => {
  let userA: any;
  let userB: any;
  let userC: any;
  let tokenA: string;
  let tokenB: string;

  // Mock messaging instance
  let mockSendEachForMulticast: jest.Mock;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // Synchronize models
    const timestamp = Date.now();

    // Create test users
    userA = await User.create({
      username: `connect_user_a_${timestamp}`,
      email: `aarav_${timestamp}@example.com`,
      firstName: 'Aarav',
      nickName: 'Aarav',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: `connect_user_b_${timestamp}`,
      email: `diya_${timestamp}@example.com`,
      firstName: 'Diya',
      nickName: 'Diya',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: `connect_user_c_${timestamp}`,
      email: `kabir_${timestamp}@example.com`,
      firstName: 'Kabir',
      isActive: false, // inactive user
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
  });

  beforeEach(async () => {
    // Reset mock
    mockSendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    } as any);

    // Clean up connections, notifications, blocks, matches
    await ConnectionRequest.destroy({ where: {} });
    await Notification.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await UserDevice.destroy({ where: {} });
  });

  afterAll(async () => {
    await ConnectionRequest.destroy({ where: {} });
    await Notification.destroy({ where: {} });
    await UserDevice.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    if (userA) await userA.destroy();
    if (userB) await userB.destroy();
    if (userC) await userC.destroy();
    await sequelize.close();
  });

  describe('1. Device Token Registration (POST /api/v1/users/device-token)', () => {
    it('should register a new FCM device token successfully', async () => {
      const res = await request(app)
        .post('/api/v1/users/device-token')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          deviceToken: 'fcm_test_token_user_b_1',
          platform: 'android',
          deviceId: 'pixel_7_pro',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registered).toBe(true);
      expect(res.body.data.platform).toBe('android');

      const saved = await UserDevice.findOne({
        where: { userId: userB.id, deviceToken: 'fcm_test_token_user_b_1' },
      });
      expect(saved).not.toBeNull();
      expect(saved?.isActive).toBe(true);
    });

    it('should reject empty device token with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/users/device-token')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          deviceToken: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Request Validation & Authorization', () => {
    it('should reject unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/connections/request')
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed target user UUID with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: 'not-a-valid-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/valid UUID/i);
    });

    it('should prevent self-connection with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userA.id });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot send a connection request to yourself/i);
    });

    it('should reject nonexistent target user with 404 Not Found', async () => {
      const nonexistentId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: nonexistentId });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Target user does not exist/i);
    });

    it('should reject inactive target user with 404 Not Found', async () => {
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userC.id });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Privacy & Block Restrictions', () => {
    it('should reject request when requester has blocked target user with 403 Forbidden', async () => {
      await UserBlock.create({ userId: userA.id, blockedUserId: userB.id });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy or block restrictions/i);
    });

    it('should reject request when target user has blocked requester with 403 Forbidden', async () => {
      await UserBlock.create({ userId: userB.id, blockedUserId: userA.id });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy or block restrictions/i);
    });
  });

  describe('4. Successful Connect Request & FCM Delivery', () => {
    it('should create connection request, in-app notification, and deliver FCM push when tokens exist', async () => {
      // Register device token for User B
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_valid_b_token',
        platform: 'ios',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.targetUserId).toBe(userB.id);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.notification.inAppCreated).toBe(true);
      expect(res.body.data.notification.pushStatus).toBe('sent_to_fcm');

      // Verify FCM multicast was called with correct data payload
      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
      const callArg = mockSendEachForMulticast.mock.calls[0][0];
      expect(callArg.tokens).toContain('fcm_valid_b_token');
      expect(callArg.data.type).toBe('connection_request');
      expect(callArg.data.senderId).toBe(userA.id);

      // Verify in-app notification in DB
      const inAppNotif = await Notification.findOne({
        where: { recipientId: userB.id, senderId: userA.id, type: 'connection_request' },
      });
      expect(inAppNotif).not.toBeNull();
      expect(inAppNotif?.isRead).toBe(false);
    });

    it('should report no_device_tokens when target user has no registered active devices', async () => {
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.notification.inAppCreated).toBe(true);
      expect(res.body.data.notification.pushStatus).toBe('no_device_tokens');
      expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    });
  });

  describe('5. Duplicate, Concurrent & Existing Match Handling', () => {
    it('should reject duplicate request with 409 Conflict when request is already pending', async () => {
      await ConnectionRequest.create({
        requesterId: userA.id,
        targetUserId: userB.id,
        status: 'pending',
      });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already pending/i);
    });

    it('should reject request with 400 Bad Request when users are already matched', async () => {
      const [u1, u2] = [userA.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'super_like',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already matched/i);
    });

    it('should automatically accept and create Match if target user already sent a pending request', async () => {
      // User B previously sent pending request to User A
      const pendingFromB = await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: userA.id,
        status: 'pending',
      });

      // Now User A sends connect request to User B -> should auto-match
      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('accepted');
      expect(res.body.data.isMatched).toBe(true);
      expect(res.body.data.matchId).toBeDefined();

      // Check DB request was updated to accepted
      await pendingFromB.reload();
      expect(pendingFromB.status).toBe('accepted');

      // Check Match exists in DB
      const [u1, u2] = [userA.id, userB.id].sort();
      const match = await Match.findOne({ where: { user1Id: u1, user2Id: u2 } });
      expect(match).not.toBeNull();
      expect(match?.isActive).toBe(true);
    });
  });

  describe('6. Resilient Error Handling & Token Cleanup', () => {
    it('should keep DB request persisted even when Firebase throws a network failure', async () => {
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_device_network_err',
        platform: 'android',
        isActive: true,
      });

      mockSendEachForMulticast.mockRejectedValue(new Error('Firebase service unavailable'));

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.notification.pushStatus).toBe('failed');

      // Ensure DB request was NOT deleted
      const savedInDb = await ConnectionRequest.findOne({
        where: { requesterId: userA.id, targetUserId: userB.id },
      });
      expect(savedInDb).not.toBeNull();
    });

    it('should automatically deactivate expired or unregistered FCM tokens', async () => {
      const deadToken = 'fcm_dead_unregistered_token';
      await UserDevice.create({
        userId: userB.id,
        deviceToken: deadToken,
        platform: 'android',
        isActive: true,
      });

      mockSendEachForMulticast.mockResolvedValue({
        successCount: 0,
        failureCount: 1,
        responses: [
          {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
              message: 'Token has been unregistered or uninstalled',
            },
          },
        ],
      });

      const res = await request(app)
        .post('/api/v1/connections/request')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id });

      expect(res.status).toBe(201);
      expect(res.body.data.notification.pushStatus).toBe('failed');

      // Verify token in UserDevice was marked inactive
      const device = await UserDevice.findOne({ where: { deviceToken: deadToken } });
      expect(device?.isActive).toBe(false);
    });
  });
});
