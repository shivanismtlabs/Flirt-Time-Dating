import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Notification,
  UserDevice,
  SwipeAction,
  Match,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import * as firebaseConfig from '../src/config/firebase';
import { notificationService } from '../src/services/notification.service';

describe('FlirtTime Notifications & FCM APIs', () => {
  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;
  let mockSendEachForMulticast: jest.Mock;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Reset Firebase mock
    mockSendEachForMulticast = jest.fn().mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    jest.spyOn(firebaseConfig, 'getFirebaseMessaging').mockReturnValue({
      sendEachForMulticast: mockSendEachForMulticast,
    } as any);

    // Clean tables
    await Notification.destroy({ where: {} });
    await UserDevice.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'notif_user_a',
      email: 'usera_notif@example.com',
      fullName: 'Cindy Crawford',
      firstName: 'Cindy',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'notif_user_b',
      email: 'userb_notif@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email!, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email!, role: userB.role });
  });

  describe('1. Device Token Registration & Unregister', () => {
    it('should register a new device token successfully (POST /api/v1/devices/register)', async () => {
      const res = await request(app)
        .post('/api/v1/devices/register')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          token: 'fcm_token_alice_device',
          platform: 'ios',
          deviceId: 'iphone_15_pro',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registered).toBe(true);

      const device = await UserDevice.findOne({
        where: { deviceToken: 'fcm_token_alice_device' },
      });
      expect(device).not.toBeNull();
      expect(device?.userId).toBe(userA.id);
      expect(device?.isActive).toBe(true);
      expect(device?.platform).toBe('ios');
    });

    it('should safely rotate/reassign device token if another account logs into the same device', async () => {
      // First userA registers token
      await request(app)
        .post('/api/v1/devices/register')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ token: 'shared_device_token', platform: 'android' });

      // Then userB registers same token on the same phone
      const res = await request(app)
        .post('/api/v1/devices/register')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ token: 'shared_device_token', platform: 'android' });

      expect(res.status).toBe(200);
      const device = await UserDevice.findOne({
        where: { deviceToken: 'shared_device_token' },
      });
      // Ownership should belong to userB now, preventing push leaks
      expect(device?.userId).toBe(userB.id);
      expect(device?.isActive).toBe(true);
    });

    it('should unregister device token successfully (DELETE /api/v1/devices/unregister)', async () => {
      await UserDevice.create({
        userId: userA.id,
        deviceToken: 'token_to_unregister',
        platform: 'android',
        isActive: true,
      });

      const res = await request(app)
        .delete('/api/v1/devices/unregister')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ token: 'token_to_unregister' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const device = await UserDevice.findOne({
        where: { deviceToken: 'token_to_unregister' },
      });
      expect(device?.isActive).toBe(false);
    });
  });

  describe('2. Notifications Listing with Sectional Date Grouping', () => {
    it('should group notifications into Today, Yesterday, and Earlier sections', async () => {
      const now = new Date();
      const todayDate = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
      const yesterdayDate = new Date(now.getTime() - 26 * 60 * 60 * 1000); // 26 hours ago
      const earlierDate = new Date(now.getTime() - 72 * 60 * 60 * 1000); // 3 days ago

      // 1. Today notification
      await Notification.create({
        recipientId: userA.id,
        senderId: userB.id,
        type: 'match',
        title: "It's a match!",
        body: 'You and Alex liked each other. Say hi!',
        createdAt: todayDate,
        updatedAt: todayDate,
        isRead: false,
      });

      // 2. Yesterday notification
      await Notification.create({
        recipientId: userA.id,
        senderId: userB.id,
        type: 'like',
        title: 'New Like',
        body: 'Alex liked your profile!',
        createdAt: yesterdayDate,
        updatedAt: yesterdayDate,
        isRead: false,
      });

      // 3. Earlier notification
      await Notification.create({
        recipientId: userA.id,
        type: 'profile_verified',
        title: 'Profile Verified! ✅',
        body: 'Your selfie verification was approved!',
        createdAt: earlierDate,
        updatedAt: earlierDate,
        isRead: true,
      });

      const res = await request(app)
        .get('/api/v1/notifications?limit=20&timezone=UTC')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.sections)).toBe(true);

      const titles = res.body.data.sections.map((s: any) => s.title);
      expect(titles).toContain('Today');
      expect(titles).toContain('Yesterday');
      expect(titles).toContain('Earlier');

      const todaySection = res.body.data.sections.find((s: any) => s.title === 'Today');
      expect(todaySection.items).toHaveLength(1);
      expect(todaySection.items[0].type).toBe('match');
      expect(todaySection.items[0].sender.name).toBe('Alex');
    });

    it('should paginate notifications with cursor', async () => {
      for (let i = 0; i < 4; i++) {
        await Notification.create({
          recipientId: userA.id,
          type: 'like',
          title: `Like ${i}`,
          body: `Notification ${i}`,
          isRead: false,
        });
      }

      // Page 1
      const page1 = await request(app)
        .get('/api/v1/notifications?limit=2')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(page1.status).toBe(200);
      const totalItemsPage1 = page1.body.data.sections.reduce(
        (acc: number, s: any) => acc + s.items.length,
        0
      );
      expect(totalItemsPage1).toBe(2);
      expect(page1.body.data.pagination.hasMore).toBe(true);

      // Page 2 using cursor
      const cursor = page1.body.data.pagination.nextCursor;
      const page2 = await request(app)
        .get(`/api/v1/notifications?limit=2&cursor=${cursor}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(page2.status).toBe(200);
      const totalItemsPage2 = page2.body.data.sections.reduce(
        (acc: number, s: any) => acc + s.items.length,
        0
      );
      expect(totalItemsPage2).toBe(2);
      expect(page2.body.data.pagination.hasMore).toBe(false);
    });
  });

  describe('3. Unread Counts (GET /api/v1/notifications/counts)', () => {
    it('should return accurate unread notification count', async () => {
      // 2 unread for user A
      await Notification.create({
        recipientId: userA.id,
        type: 'like',
        title: 'Like 1',
        body: 'Body 1',
        isRead: false,
      });
      await Notification.create({
        recipientId: userA.id,
        type: 'match',
        title: 'Match 1',
        body: 'Body 2',
        isRead: false,
      });
      // 1 read for user A
      await Notification.create({
        recipientId: userA.id,
        type: 'profile_verified',
        title: 'Verified',
        body: 'Body 3',
        isRead: true,
      });

      const res = await request(app)
        .get('/api/v1/notifications/counts')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unreadCount).toBe(2);
    });
  });

  describe('4. Mark Read and Mark All Read', () => {
    it('should mark a single notification read (PATCH /api/v1/notifications/:id/read)', async () => {
      const notif = await Notification.create({
        recipientId: userA.id,
        type: 'like',
        title: 'Unread Like',
        body: 'Body',
        isRead: false,
      });

      const res = await request(app)
        .patch(`/api/v1/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      await notif.reload();
      expect(notif.isRead).toBe(true);
    });

    it('should not allow marking another user notification as read', async () => {
      const notifForB = await Notification.create({
        recipientId: userB.id,
        type: 'like',
        title: 'For User B',
        body: 'Body',
        isRead: false,
      });

      const res = await request(app)
        .patch(`/api/v1/notifications/${notifForB.id}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should mark all unread notifications as read (PATCH /api/v1/notifications/read-all)', async () => {
      await Notification.create({
        recipientId: userA.id,
        type: 'like',
        title: 'Notif 1',
        body: 'Body 1',
        isRead: false,
      });
      await Notification.create({
        recipientId: userA.id,
        type: 'like',
        title: 'Notif 2',
        body: 'Body 2',
        isRead: false,
      });

      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const unread = await Notification.count({
        where: { recipientId: userA.id, isRead: false },
      });
      expect(unread).toBe(0);
    });
  });

  describe('5. Delete Notification', () => {
    it('should delete a notification belonging to the user (DELETE /api/v1/notifications/:id)', async () => {
      const notif = await Notification.create({
        recipientId: userA.id,
        type: 'like',
        title: 'Delete me',
        body: 'Body',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/notifications/${notif.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const check = await Notification.findByPk(notif.id);
      expect(check).toBeNull();
    });

    it('should reject deleting another user notification with 404', async () => {
      const notifForB = await Notification.create({
        recipientId: userB.id,
        type: 'like',
        title: 'For User B',
        body: 'Body',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/notifications/${notifForB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('6. Real Business Events Wiring', () => {
    it('should automatically dispatch match notifications to both users when a reciprocal like occurs', async () => {
      // User A likes User B
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      // User B likes User A back -> Match
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ targetUserId: userA.id, action: 'like' });

      // Verify User A received Match notification
      const notifA = await Notification.findOne({
        where: { recipientId: userA.id, type: 'match' },
      });
      expect(notifA).not.toBeNull();
      expect(notifA?.title).toBe("It's a match!");

      // Verify User B received Match notification
      const notifB = await Notification.findOne({
        where: { recipientId: userB.id, type: 'match' },
      });
      expect(notifB).not.toBeNull();
      expect(notifB?.title).toBe("It's a match!");
    });

    it('should preserve database notification even when Firebase throws an error', async () => {
      mockSendEachForMulticast.mockRejectedValueOnce(new Error('FCM Connection Timeout'));

      // Register device for User B
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_user_b_token',
        platform: 'android',
        isActive: true,
      });

      // User A likes User B
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetUserId: userB.id, action: 'like' });

      expect(res.status).toBe(200);

      // Verify Notification was successfully persisted in DB despite FCM failure
      const notif = await Notification.findOne({
        where: { recipientId: userB.id, type: 'like' },
      });
      expect(notif).not.toBeNull();
      expect(notif?.title).toBe('New Like');
    });
  });

  describe('7. Silent incoming call pushes', () => {
    it('sends audio and video call pushes as data-only with no sound or banner', async () => {
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_call_token_user_b',
        platform: 'android',
        isActive: true,
      });

      for (const callType of ['audio', 'video'] as const) {
        mockSendEachForMulticast.mockClear();
        const result = await notificationService.dispatchNotification(userB.id, {
          type: 'incoming_call',
          title: 'Cindy Crawford',
          body: callType === 'video' ? 'Incoming video call' : 'Incoming voice call',
          senderId: userA.id,
          entityId: `call-${callType}`,
          idempotencyKey: `incoming_call:call-${callType}`,
          data: {
            type: 'incoming_call',
            callId: `call-${callType}`,
            callType,
            callerId: userA.id,
            channelName: `channel-${callType}`,
          },
          navigation: { type: 'incoming_call', targetId: `call-${callType}` },
        });

        expect(result.pushStatus).toBe('sent_to_fcm');
        expect(mockSendEachForMulticast).toHaveBeenCalledTimes(1);
        const message = mockSendEachForMulticast.mock.calls[0][0];
        expect(message.notification).toBeUndefined();
        expect(message.android.notification).toBeUndefined();
        expect(message.android.priority).toBe('high');
        expect(message.apns.payload.aps.alert).toBeUndefined();
        expect(message.apns.payload.aps.sound).toBeUndefined();
        expect(message.apns.payload.aps.contentAvailable).toBe(true);
        expect(message.apns.headers['apns-push-type']).toBe('background');
        expect(message.data.silent).toBe('true');
        expect(message.data.callType).toBe(callType);
        expect(message.data.type).toBe('incoming_call');
      }
    });

    it('keeps a normal alert with sound for non-call notifications', async () => {
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_like_token_user_b',
        platform: 'ios',
        isActive: true,
      });

      await notificationService.dispatchNotification(userB.id, {
        type: 'like',
        title: 'New Like',
        body: 'Someone liked you',
        senderId: userA.id,
        entityId: 'like-1',
      });

      const message = mockSendEachForMulticast.mock.calls[0][0];
      expect(message.notification).toEqual({ title: 'New Like', body: 'Someone liked you' });
      expect(message.android.notification.sound).toBe('default');
      expect(message.apns.payload.aps.sound).toBe('default');
      expect(message.data.silent).toBeUndefined();
    });
  });

  describe('8. Moment notification payload includes momentId', () => {
    const momentId = '6f1c2a30-7b4e-4d2a-9c11-0a1b2c3d4e5f';

    beforeEach(async () => {
      await UserDevice.create({
        userId: userB.id,
        deviceToken: 'fcm_moment_token_user_b',
        platform: 'ios',
        isActive: true,
      });
    });

    it('includes momentId for comment, comment like, and gift pushes and the in-app payload', async () => {
      await notificationService.sendCommentNotification(userB.id, {
        senderId: userA.id,
        senderName: 'Cindy',
        comment: 'Nice moment',
        momentId,
        commentId: '11111111-1111-4111-8111-111111111111',
      });

      await notificationService.sendCommentLikeNotification(userB.id, {
        senderId: userA.id,
        senderName: 'Cindy',
        commentId: '22222222-2222-4222-8222-222222222222',
        momentId,
        commentSnippet: 'Nice moment',
      });

      await notificationService.sendMomentGiftNotification(userB.id, {
        senderId: userA.id,
        senderName: 'Cindy',
        momentId,
        giftName: 'Rose',
        giftCode: 'rose',
        quantity: 1,
        totalCoins: 10,
      });

      expect(mockSendEachForMulticast).toHaveBeenCalledTimes(3);
      for (const call of mockSendEachForMulticast.mock.calls) {
        const message = call[0];
        expect(message.data.momentId).toBe(momentId);
        expect(message.apns.payload.momentId).toBe(momentId);
      }

      const res = await request(app)
        .get('/api/v1/notifications?limit=20&timezone=UTC')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      const items = res.body.data.notifications;
      expect(items).toHaveLength(3);
      for (const item of items) {
        expect(item.data.momentId).toBe(momentId);
      }
    });
  });
});
