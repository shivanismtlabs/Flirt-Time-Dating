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
  SwipeAction,
  UserPhoto,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import * as firebaseConfig from '../src/config/firebase';

describe('Profile Compliment API & Interactions Integration', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;

  let mockSendEachForMulticast: jest.Mock;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
    const timestamp = Date.now();

    userA = await User.create({
      username: `compliment_user_a_${timestamp}`,
      email: `user_a_${timestamp}@example.com`,
      firstName: 'Alex',
      fullName: 'Alex Morgan',
      nickName: 'Alex',
      dateOfBirth: '1998-05-12',
      gender: 'male',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: `compliment_user_b_${timestamp}`,
      email: `user_b_${timestamp}@example.com`,
      firstName: 'Sophia',
      fullName: 'Sophia Patel',
      nickName: 'Sophie',
      dateOfBirth: '2000-08-20',
      gender: 'female',
      profilePicture: 'https://flirttime-media.s3.amazonaws.com/profiles/sophia.jpg',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: `compliment_user_c_${timestamp}`,
      email: `user_c_${timestamp}@example.com`,
      firstName: 'Inactive',
      isActive: false,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
  });

  beforeEach(async () => {
    mockSendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    } as any);

    await ConnectionRequest.destroy({ where: {} });
    await Notification.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await UserDevice.destroy({ where: {} });
  });

  afterAll(async () => {
    await ConnectionRequest.destroy({ where: {} });
    await Notification.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await UserDevice.destroy({ where: {} });
    if (userA) await userA.destroy();
    if (userB) await userB.destroy();
    if (userC) await userC.destroy();
    await sequelize.close();
  });

  describe('1. Send Compliment via Profile Parameter (POST /api/v1/users/:userId/compliment)', () => {
    it('should send compliment successfully, trigger notification, and appear in target user interactions', async () => {
      // Register device token for userB
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_sophia_device_token',
        platform: 'android',
        isActive: true,
      });

      const complimentMessage = 'You have such a vibrant energy and an amazing smile!';

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          message: complimentMessage,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Compliment sent successfully');
      expect(res.body.data.complimentId).toBeDefined();
      expect(res.body.data.targetUserId).toBe(userB.id);
      expect(res.body.data.message).toBe(complimentMessage);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.isMatched).toBe(false);
      expect(res.body.data.matchId).toBeNull();

      const complimentId = res.body.data.complimentId;

      // 1. Verify In-App Notification in DB
      const inAppNotif = await Notification.findOne({
        where: { recipientId: userB.id, senderId: userA.id, type: 'compliment' },
      });
      expect(inAppNotif).not.toBeNull();
      expect(inAppNotif?.title).toBe('New Compliment!');
      expect(inAppNotif?.body).toContain('Alex sent you a compliment:');
      expect(inAppNotif?.body).toContain(complimentMessage);
      expect(inAppNotif?.entityId).toBe(complimentId);
      expect(inAppNotif?.isRead).toBe(false);

      // 2. Verify Push Notification via FCM
      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
      const fcmCall = mockSendEachForMulticast.mock.calls[0][0];
      expect(fcmCall.tokens).toContain('fcm_sophia_device_token');
      expect(fcmCall.data.type).toBe('compliment');
      expect(fcmCall.data.senderId).toBe(userA.id);
      expect(fcmCall.data.complimentId).toBe(complimentId);

      // 3. Verify target user sees compliment in GET /api/v1/interactions?type=compliments
      const interactionsRes = await request(app)
        .get('/api/v1/interactions?type=compliments')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(interactionsRes.status).toBe(200);
      expect(interactionsRes.body.success).toBe(true);
      expect(interactionsRes.body.data.type).toBe('compliments');
      expect(interactionsRes.body.data.items).toHaveLength(1);

      const receivedItem = interactionsRes.body.data.items[0];
      expect(receivedItem.interactionId).toBe(complimentId);
      expect(receivedItem.user.id).toBe(userA.id);
      expect(receivedItem.user.name).toBe('Alex');
      expect(receivedItem.interaction.message).toBe(complimentMessage);
      expect(receivedItem.interaction.type).toBe('compliments');
      expect(receivedItem.interaction.status).toBe('pending');
      expect(receivedItem.interaction.isRead).toBe(false);

      // 4. Verify interactions count includes compliment
      const countsRes = await request(app)
        .get('/api/v1/interactions/counts')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(countsRes.status).toBe(200);
      expect(countsRes.body.data.compliments).toBe(1);

      // 5. Verify marking interaction as read
      const markReadRes = await request(app)
        .post(`/api/v1/interactions/${complimentId}/read`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(markReadRes.status).toBe(200);
      expect(markReadRes.body.data.isRead).toBe(true);

      const updatedInteractions = await request(app)
        .get('/api/v1/interactions?type=compliments')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(updatedInteractions.body.data.items[0].interaction.isRead).toBe(true);
    });
  });

  describe('2. Send Compliment via Interactions Endpoint (POST /api/v1/interactions/compliments)', () => {
    it('should support sending compliment with targetUserId in request body', async () => {
      const res = await request(app)
        .post('/api/v1/interactions/compliments')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          targetUserId: userB.id,
          message: 'Loved your travel picture!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.targetUserId).toBe(userB.id);
      expect(res.body.data.message).toBe('Loved your travel picture!');

      // Check it appears in interactions
      const interactionsRes = await request(app)
        .get('/api/v1/interactions?type=compliments')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(interactionsRes.body.data.items).toHaveLength(1);
      expect(interactionsRes.body.data.items[0].interaction.message).toBe('Loved your travel picture!');
    });
  });

  describe('3. Validation & Edge Cases', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .send({ message: 'Hello!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty message with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject self-compliment with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userA.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'I love myself!' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot compliment your own profile/i);
    });

    it('should reject non-existent target user with 404 Not Found', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app)
        .post(`/api/v1/users/${fakeId}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'Nice profile!' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Target user does not exist/i);
    });

    it('should reject inactive target user with 404 Not Found', async () => {
      const res = await request(app)
        .post(`/api/v1/users/${userC.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'Nice profile!' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject compliment when users have blocked each other with 403 Forbidden', async () => {
      await UserBlock.create({
        userId: userB.id,
        blockedUserId: userA.id,
        reason: 'Harassment',
      });

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'Hey there!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/block restrictions/i);
    });

    it('should reject compliment when users are already matched with 400 Bad Request', async () => {
      const [u1, u2] = [userA.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'super_like',
        isActive: true,
      });

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'Hey again!' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already matched/i);
    });

    it('should reject duplicate compliment with 409 Conflict when one is already pending', async () => {
      await ConnectionRequest.create({
        requesterId: userA.id,
        targetUserId: userB.id,
        status: 'pending',
        message: 'Initial compliment',
      });

      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'Second compliment' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already pending/i);
    });

    it('should automatically match when target user previously sent a pending request', async () => {
      // User B previously sent a pending connection request to User A
      const prevReq = await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: userA.id,
        status: 'pending',
      });

      // User A compliments User B -> should trigger instant match
      const res = await request(app)
        .post(`/api/v1/users/${userB.id}/compliment`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ message: 'You look wonderful!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isMatched).toBe(true);
      expect(res.body.data.status).toBe('accepted');
      expect(res.body.data.matchId).toBeDefined();

      // Check Match in DB
      const [u1, u2] = [userA.id, userB.id].sort();
      const match = await Match.findOne({ where: { user1Id: u1, user2Id: u2, isActive: true } });
      expect(match).not.toBeNull();
    });
  });
});
