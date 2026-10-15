import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserPhoto,
  QuickMoment,
  QuickMomentReaction,
  QuickMomentView,
  Notification,
  Interest,
  UserInterest,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Profile Photo Updates and Quick Moment Reactions', () => {
  let userA: User;
  let userB: User;
  let userTokenA: string;
  let userTokenB: string;
  let sharedInterest: Interest;

  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0xff, 0xd9,
  ]);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    [sharedInterest] = await Interest.findOrCreate({
      where: { name: 'Photography_Test' },
      defaults: { name: 'Photography_Test', icon: '📸', isActive: true },
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await Notification.destroy({ where: {} });
    await QuickMomentView.destroy({ where: {} });
    await QuickMomentReaction.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await UserPhoto.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });

    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(
      async (_buf, userId, _mime, folder) => `${folder}/${userId}/${Date.now()}_test.jpg`
    );

    userA = await User.create({
      username: 'alice_react',
      email: 'alice@flirttime.app',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      gender: 'female',
      genderPreference: 'men',
      city: 'Mumbai',
      profilePicture: 'photos/alice_initial.jpg',
      isActive: true,
      isProfileComplete: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob_react',
      email: 'bob@flirttime.app',
      fullName: 'Bob Smith',
      firstName: 'Bob',
      gender: 'male',
      genderPreference: 'women',
      city: 'Mumbai',
      profilePicture: 'photos/bob_initial.jpg',
      isActive: true,
      isProfileComplete: true,
      role: 'user',
    });

    await UserPhoto.create({
      userId: userA.id,
      imageUrl: 'photos/alice_initial.jpg',
      isPrimary: true,
      status: 'approved',
      displayOrder: 0,
    });

    await UserPhoto.create({
      userId: userB.id,
      imageUrl: 'photos/bob_initial.jpg',
      isPrimary: true,
      status: 'approved',
      displayOrder: 0,
    });

    await UserInterest.create({ userId: userA.id, interestId: sharedInterest.id });
    await UserInterest.create({ userId: userB.id, interestId: sharedInterest.id });

    userTokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    userTokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
  });

  describe('1. Latest Profile Photo Updates and Cache Prevention', () => {
    it('should return the latest profile photo with version parameter when another user opens profile', async () => {
      // Bob checks Alice profile initially
      const resBefore = await request(app)
        .get(`/api/v1/users/${userA.id}/profile`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(resBefore.status).toBe(200);
      expect(resBefore.header['cache-control']).toContain('no-cache');
      expect(resBefore.body.data.profilePhoto).toContain('photos/alice_initial.jpg');
      expect(resBefore.body.data.profilePhoto).toContain('v=');

      // Alice updates her profile photo
      const newPhotoKey = `photos/${userA.id}/new_updated_pic.jpg`;
      const updateRes = await request(app)
        .post('/api/v1/users/profile-photo')
        .set('Authorization', `Bearer ${userTokenA}`)
        .attach('profilePhoto', validJpegBuffer, 'avatar.jpg');

      expect(updateRes.status).toBe(201);

      // Bob views Alice profile again: MUST immediately show the new photo with new version
      const resAfter = await request(app)
        .get(`/api/v1/users/${userA.id}/profile`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(resAfter.status).toBe(200);
      expect(resAfter.header['cache-control']).toContain('no-cache');
      expect(resAfter.body.data.profilePhoto).not.toContain('photos/alice_initial.jpg');
      expect(resAfter.body.data.profilePhoto).toContain('v=');
      expect(resAfter.body.data.profileThumbnail).toContain('v=');
    });

    it('should show the latest profile photo on Discover card feed with versioned URL and no-cache headers', async () => {
      // Bob checks Discover people feed
      const discBefore = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(discBefore.status).toBe(200);
      expect(discBefore.header['cache-control']).toContain('no-cache');
      const aliceCardBefore = discBefore.body.data.users.find((u: any) => u.id === userA.id);
      expect(aliceCardBefore).toBeDefined();
      expect(aliceCardBefore.profilePhoto).toContain('photos/alice_initial.jpg');
      expect(aliceCardBefore.profilePhoto).toContain('v=');

      // Alice sets a new primary photo
      const secondPhoto = await UserPhoto.create({
        userId: userA.id,
        imageUrl: `photos/${userA.id}/second_glamour.jpg`,
        isPrimary: false,
        status: 'approved',
        displayOrder: 1,
      });

      const setPrimaryRes = await request(app)
        .patch(`/api/v1/users/photos/${secondPhoto.id}/primary`)
        .set('Authorization', `Bearer ${userTokenA}`);

      expect(setPrimaryRes.status).toBe(200);

      // Bob views Discover card again: MUST reflect Alice second photo immediately
      const discAfter = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(discAfter.status).toBe(200);
      const aliceCardAfter = discAfter.body.data.users.find((u: any) => u.id === userA.id);
      expect(aliceCardAfter.profilePhoto).toContain('second_glamour.jpg');
      expect(aliceCardAfter.profilePhoto).toContain('v=');
    });

    it('should sync profile photo when updated via profile edit PATCH /api/v1/users/profile', async () => {
      const newKey = `photos/${userA.id}/custom_edit_pic.jpg`;
      const editRes = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${userTokenA}`)
        .send({ profilePicture: newKey });

      expect(editRes.status).toBe(200);

      // Bob checks Alice profile
      const res = await request(app)
        .get(`/api/v1/users/${userA.id}/profile`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.data.profilePhoto).toContain('custom_edit_pic.jpg');
      expect(res.body.data.profilePhoto).toContain('v=');
    });
  });

  describe('2. Quick Moment Reactions and Notification Flow', () => {
    let aliceMomentId: string;

    beforeEach(async () => {
      const moment = await QuickMoment.create({
        userId: userA.id,
        type: 'text',
        text: 'Chilling in the sunshine! ☀️',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });
      aliceMomentId = moment.id;
    });

    it('should show no reaction indicator or notification when no reaction has been made', async () => {
      // Bob views Alice story
      const res = await request(app)
        .get(`/api/v1/quick-moments/user/${userA.id}`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(res.status).toBe(200);
      const slide = res.body.data.stories[0];
      expect(slide.myReaction).toBeNull();
      expect(slide.reactionsCount).toBe(0);
      expect(slide.badgeText).toBeNull();

      // Alice checks notifications: must be empty
      const notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userTokenA}`);

      expect(notifsRes.status).toBe(200);
      const momentNotifs = (notifsRes.body.data?.sections || [])
        .flatMap((s: any) => s.items)
        .filter((n: any) => n.type === 'moment_reaction');
      expect(momentNotifs).toHaveLength(0);
    });

    it('should not treat simply viewing a moment as a reaction', async () => {
      // Bob views Alice moment
      const viewRes = await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/view`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(viewRes.status).toBe(200);
      expect(viewRes.body.data.isViewed).toBe(true);

      // Reactions count must strictly remain 0
      const reactionCount = await QuickMomentReaction.count({
        where: { quickMomentId: aliceMomentId },
      });
      expect(reactionCount).toBe(0);

      // No notification should be sent to Alice
      const notifCount = await Notification.count({
        where: { recipientId: userA.id, type: 'moment_reaction' },
      });
      expect(notifCount).toBe(0);
    });

    it('should create reaction record and send notification to moment owner when Bob reacts', async () => {
      // Bob reacts with 😍
      const reactRes = await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({ emoji: '😍' });

      expect(reactRes.status).toBe(200);
      expect(reactRes.body.data.action).toBe('added');
      expect(reactRes.body.data.myReaction).toBe('😍');
      expect(reactRes.body.data.totalReactions).toBe(1);

      // Notification must exist for Alice
      const notif = await Notification.findOne({
        where: {
          recipientId: userA.id,
          senderId: userB.id,
          type: 'moment_reaction',
          entityId: aliceMomentId,
        },
      });
      expect(notif).not.toBeNull();
      expect(notif?.body).toContain('reacted 😍');

      // Alice checks notifications via API
      const notifsRes = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${userTokenA}`);

      expect(notifsRes.status).toBe(200);
      const items = (notifsRes.body.data?.sections || []).flatMap((s: any) => s.items);
      const notifItem = items.find((n: any) => n.type === 'moment_reaction');
      expect(notifItem).toBeDefined();
      expect(notifItem.sender.id).toBe(userB.id);
      expect(notifItem.sender.profilePhotoUrl).toContain('v=');
    });

    it('should remove notification when reaction is toggled off (avoid stale reaction indicator/notification)', async () => {
      // Bob reacts with 🔥
      await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({ emoji: '🔥' });

      let notifCount = await Notification.count({
        where: { recipientId: userA.id, senderId: userB.id, entityId: aliceMomentId },
      });
      expect(notifCount).toBe(1);

      // Bob toggles off the reaction (sends same emoji again)
      const toggleRes = await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({ emoji: '🔥' });

      expect(toggleRes.status).toBe(200);
      expect(toggleRes.body.data.action).toBe('removed');
      expect(toggleRes.body.data.myReaction).toBeNull();
      expect(toggleRes.body.data.totalReactions).toBe(0);

      // Notification must be deleted: no reaction, no notification
      notifCount = await Notification.count({
        where: { recipientId: userA.id, senderId: userB.id, entityId: aliceMomentId },
      });
      expect(notifCount).toBe(0);
    });
  });

  describe('3. Correct Ownership and Reaction Permissions', () => {
    let aliceMomentId: string;

    beforeEach(async () => {
      const moment = await QuickMoment.create({
        userId: userA.id,
        type: 'text',
        text: 'Owner only reaction test',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });
      aliceMomentId = moment.id;

      // Bob reacts to Alice moment
      await QuickMomentReaction.create({
        quickMomentId: aliceMomentId,
        userId: userB.id,
        emoji: '❤️',
      });
    });

    it('should allow the moment owner (Alice) to view the reactors list', async () => {
      const res = await request(app)
        .get(`/api/v1/quick-moments/${aliceMomentId}/reactions`)
        .set('Authorization', `Bearer ${userTokenA}`);

      expect(res.status).toBe(200);
      expect(res.header['cache-control']).toContain('no-cache');
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalReactions).toBe(1);
      expect(res.body.data.reactors).toHaveLength(1);
      expect(res.body.data.reactors[0].user.id).toBe(userB.id);
      expect(res.body.data.reactors[0].emoji).toBe('❤️');
      expect(res.body.data.reactors[0].user.avatar).toContain('v=');
    });

    it('should reject unauthorized non-owner users from viewing reactions list with 403 Forbidden', async () => {
      // Bob is NOT the author of aliceMomentId
      const res = await request(app)
        .get(`/api/v1/quick-moments/${aliceMomentId}/reactions`)
        .set('Authorization', `Bearer ${userTokenB}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Only the moment owner can view reaction details');
    });
  });

  describe('4. Avoid Duplicates (Reaction Records and Notifications)', () => {
    let aliceMomentId: string;

    beforeEach(async () => {
      const moment = await QuickMoment.create({
        userId: userA.id,
        type: 'text',
        text: 'Deduplication test',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });
      aliceMomentId = moment.id;
    });

    it('should update reaction and not create duplicate reaction records or duplicate notifications when changing emoji', async () => {
      // 1. Bob reacts with 😍
      await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({ emoji: '😍' });

      // 2. Bob changes reaction to 🔥
      const updateRes = await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenB}`)
        .send({ emoji: '🔥' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.action).toBe('updated');
      expect(updateRes.body.data.myReaction).toBe('🔥');

      // Check DB records: exactly 1 reaction record
      const reactions = await QuickMomentReaction.findAll({
        where: { quickMomentId: aliceMomentId, userId: userB.id },
      });
      expect(reactions).toHaveLength(1);
      expect(reactions[0].emoji).toBe('🔥');

      // Check DB notifications: exactly 1 notification, updated with new emoji
      const notifications = await Notification.findAll({
        where: { recipientId: userA.id, senderId: userB.id, entityId: aliceMomentId },
      });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].body).toContain('reacted 🔥');
    });

    it('should not send notification when author reacts to their own moment', async () => {
      // Alice reacts to her own moment
      const res = await request(app)
        .post(`/api/v1/quick-moments/${aliceMomentId}/react`)
        .set('Authorization', `Bearer ${userTokenA}`)
        .send({ emoji: '👏' });

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('added');

      // Self reaction should NOT create a notification
      const selfNotifs = await Notification.findAll({
        where: { recipientId: userA.id, senderId: userA.id },
      });
      expect(selfNotifs).toHaveLength(0);
    });
  });
});
