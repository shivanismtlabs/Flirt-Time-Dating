import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  SwipeAction,
  Match,
  ConnectionRequest,
  UserBlock,
  UserPhoto,
  Notification,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('FlirtTime Interactions API (GET /api/v1/interactions)', () => {
  let currentUser: User;
  let userB: User;
  let userC: User;
  let userD: User;
  let inactiveUser: User;
  let tokenCurrent: string;
  let tokenB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear action and interaction tables
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await ConnectionRequest.destroy({ where: {} });
    await Notification.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await UserPhoto.destroy({ where: {} });
    await User.destroy({ where: {} });

    currentUser = await User.create({
      username: 'current_user',
      email: 'current@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      nickName: 'Al',
      dateOfBirth: '1996-06-15',
      gender: 'male',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'user_cindy',
      email: 'cindy@example.com',
      fullName: 'Cindy Crawford',
      firstName: 'Cindy',
      dateOfBirth: '2000-01-20',
      gender: 'female',
      city: 'Mumbai',
      latitude: 19.1136,
      longitude: 72.8697,
      isFaceVerified: true,
      profilePicture: 'https://flirttime-media.s3.amazonaws.com/profiles/cindy.jpg',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_priya',
      email: 'priya@example.com',
      fullName: 'Priya Sharma',
      firstName: 'Priya',
      dateOfBirth: '1998-04-10',
      gender: 'female',
      city: 'Delhi',
      latitude: 28.6139,
      longitude: 77.209,
      isFaceVerified: false,
      isActive: true,
      role: 'user',
    });

    userD = await User.create({
      username: 'user_david',
      email: 'david@example.com',
      fullName: 'David Miller',
      firstName: 'David',
      dateOfBirth: '1995-11-05',
      gender: 'male',
      city: 'Mumbai',
      isActive: true,
      role: 'user',
    });

    inactiveUser = await User.create({
      username: 'inactive_sam',
      email: 'inactive@example.com',
      fullName: 'Inactive Sam',
      isActive: false,
      role: 'user',
    });

    tokenCurrent = generateToken({
      id: currentUser.id,
      email: currentUser.email!,
      role: currentUser.role,
    });
    tokenB = generateToken({
      id: userB.id,
      email: userB.email!,
      role: userB.role,
    });
  });

  describe('1. Authentication and Query Parameter Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/interactions?type=likes');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid or missing interaction type with 400', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=invalid_type')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/invalid/i);
    });

    it('should reject invalid sort parameter with 400', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=likes&sort=unsupported_sort')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/Supported values: recent/i);
    });

    it('should reject out-of-range limit with 400', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=likes&limit=100')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/between 1 and 50/i);
    });
  });

  describe('2. Likes Tab (Incoming Likes)', () => {
    it('should return eligible users who liked the authenticated user', async () => {
      // User B liked currentUser
      const swipe = await SwipeAction.create({
        userId: userB.id,
        targetUserId: currentUser.id,
        action: 'like',
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=likes')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('likes');
      expect(res.body.data.items).toHaveLength(1);

      const item = res.body.data.items[0];
      expect(item.interactionId).toBe(swipe.id);
      expect(item.user.id).toBe(userB.id);
      expect(item.user.name).toBe('Cindy');
      expect(typeof item.user.age).toBe('number');
      expect(item.user.isVerified).toBe(true);
      expect(typeof item.user.distanceKm).toBe('number');
      expect(item.user.locationLabel).toBe('Mumbai');
      expect(item.interaction.type).toBe('likes');
      expect(item.interaction.action).toBe('like');
    });

    it('should exclude mutual matches from Likes tab', async () => {
      // User B and currentUser liked each other -> Match created
      await SwipeAction.create({
        userId: userB.id,
        targetUserId: currentUser.id,
        action: 'like',
      });
      await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: userB.id,
        action: 'like',
      });

      const [u1, u2] = [currentUser.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      // User C liked currentUser (unmatched)
      await SwipeAction.create({
        userId: userC.id,
        targetUserId: currentUser.id,
        action: 'like',
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=likes')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].user.id).toBe(userC.id);
    });

    it('should exclude inactive or blocked users from Likes tab', async () => {
      // Inactive user liked current user
      await SwipeAction.create({
        userId: inactiveUser.id,
        targetUserId: currentUser.id,
        action: 'like',
      });

      // User D liked current user, but current user blocked User D
      await SwipeAction.create({
        userId: userD.id,
        targetUserId: currentUser.id,
        action: 'like',
      });
      await UserBlock.create({
        userId: currentUser.id,
        blockedUserId: userD.id,
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=likes')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });
  });

  describe('3. You Liked Tab (Outgoing Likes)', () => {
    it('should return users liked by authenticated user with isMatched flag', async () => {
      // Current user liked User B
      const swipeB = await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: userB.id,
        action: 'like',
      });

      // Current user liked User C
      const swipeC = await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: userC.id,
        action: 'super_like',
      });

      // User B is also matched
      const [u1, u2] = [currentUser.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=you_liked')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('you_liked');
      expect(res.body.data.items).toHaveLength(2);

      const itemB = res.body.data.items.find((i: any) => i.user.id === userB.id);
      const itemC = res.body.data.items.find((i: any) => i.user.id === userC.id);

      expect(itemB).toBeDefined();
      expect(itemB.interaction.isMatched).toBe(true);
      expect(itemC).toBeDefined();
      expect(itemC.interaction.isMatched).toBe(false);
      expect(itemC.interaction.action).toBe('super_like');
    });

    it('should exclude blocked users in You Liked tab', async () => {
      await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: userB.id,
        action: 'like',
      });

      // User B blocked current user
      await UserBlock.create({
        userId: userB.id,
        blockedUserId: currentUser.id,
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=you_liked')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });
  });

  describe('4. Matches Tab', () => {
    it('should return mutual matches returning the counterpart participant', async () => {
      const [u1, u2] = [currentUser.id, userB.id].sort();
      const match = await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=matches')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('matches');
      expect(res.body.data.items).toHaveLength(1);

      const item = res.body.data.items[0];
      expect(item.interactionId).toBe(match.id);
      expect(item.user.id).toBe(userB.id); // Must be the counterpart, NOT currentUser
      expect(item.user.name).toBe('Cindy');
      expect(item.interaction.type).toBe('matches');
      expect(item.interaction.matchedBy).toBe('like');
    });

    it('should exclude inactive matches (unmatched)', async () => {
      const [u1, u2] = [currentUser.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: false, // inactive
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=matches')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });
  });

  describe('5. Compliments Tab', () => {
    it('should return received compliments with reason, message and read state', async () => {
      const connReq = await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: currentUser.id,
        status: 'pending',
        reason: 'Love their vibe',
        message: 'You have an amazing smile!',
      });

      // Notification exists and marked read
      await Notification.create({
        recipientId: currentUser.id,
        senderId: userB.id,
        type: 'connection_request',
        title: 'New Connect Request',
        body: 'Cindy sent you a compliment',
        entityId: connReq.id,
        isRead: true,
      });

      const res = await request(app)
        .get('/api/v1/interactions?type=compliments')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe('compliments');
      expect(res.body.data.items).toHaveLength(1);

      const item = res.body.data.items[0];
      expect(item.interactionId).toBe(connReq.id);
      expect(item.user.id).toBe(userB.id);
      expect(item.interaction.reason).toBe('Love their vibe');
      expect(item.interaction.message).toBe('You have an amazing smile!');
      expect(item.interaction.isRead).toBe(true);
    });
  });

  describe('6. Tab Badge Counts API (GET /api/v1/interactions/counts)', () => {
    it('should calculate accurate badge counts across all four tabs', async () => {
      // 1. Likes: User C liked currentUser
      await SwipeAction.create({
        userId: userC.id,
        targetUserId: currentUser.id,
        action: 'like',
      });

      // 2. You Liked: currentUser liked User D
      await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: userD.id,
        action: 'like',
      });

      // 3. Matches: currentUser matched with User B
      const [u1, u2] = [currentUser.id, userB.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });
      // (Also create underlying swipes for realism)
      await SwipeAction.create({ userId: currentUser.id, targetUserId: userB.id, action: 'like' });
      await SwipeAction.create({ userId: userB.id, targetUserId: currentUser.id, action: 'like' });

      // 4. Compliments: User B sent compliment to currentUser
      await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: currentUser.id,
        status: 'pending',
        reason: 'Great energy',
      });

      const res = await request(app)
        .get('/api/v1/interactions/counts')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        likes: 1, // User C (User B is already matched)
        you_liked: 2, // User D + User B
        matches: 1, // User B
        compliments: 1, // User B
      });
    });
  });

  describe('7. Keyset Pagination & Cursors', () => {
    it('should paginate items with nextCursor and hasMore', async () => {
      // Seed 5 likes
      for (let i = 0; i < 5; i++) {
        const u = await User.create({
          username: `page_user_${i}`,
          email: `page_${i}@example.com`,
          fullName: `Page User ${i}`,
          isActive: true,
          role: 'user',
        });
        await SwipeAction.create({
          userId: u.id,
          targetUserId: currentUser.id,
          action: 'like',
        });
      }

      // Page 1 with limit 3
      const page1 = await request(app)
        .get('/api/v1/interactions?type=likes&limit=3')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(page1.status).toBe(200);
      expect(page1.body.data.items).toHaveLength(3);
      expect(page1.body.data.pagination.hasMore).toBe(true);
      expect(page1.body.data.pagination.nextCursor).toBeDefined();

      // Page 2 using cursor
      const cursor = page1.body.data.pagination.nextCursor;
      const page2 = await request(app)
        .get(`/api/v1/interactions?type=likes&limit=3&cursor=${cursor}`)
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.items).toHaveLength(2);
      expect(page2.body.data.pagination.hasMore).toBe(false);

      // Verify no overlap between pages
      const page1Ids = page1.body.data.items.map((i: any) => i.interactionId);
      const page2Ids = page2.body.data.items.map((i: any) => i.interactionId);
      const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('should reject malformed cursor with 400', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=likes&cursor=invalid_base64_string')
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid pagination cursor/i);
    });
  });

  describe('8. Read State API (POST /api/v1/interactions/:interactionId/read)', () => {
    it('should mark interaction read idempotently for authorized recipient', async () => {
      const connReq = await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: currentUser.id,
        status: 'pending',
        reason: 'Love their vibe',
      });

      const notif = await Notification.create({
        recipientId: currentUser.id,
        senderId: userB.id,
        type: 'connection_request',
        title: 'New Connect Request',
        body: 'Cindy wants to connect',
        entityId: connReq.id,
        isRead: false,
      });

      const res = await request(app)
        .post(`/api/v1/interactions/${connReq.id}/read`)
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRead).toBe(true);

      // Verify notification updated in DB
      await notif.reload();
      expect(notif.isRead).toBe(true);
    });

    it('should reject unauthorized user trying to read another user interaction with 403', async () => {
      const connReq = await ConnectionRequest.create({
        requesterId: userB.id,
        targetUserId: userC.id, // target is User C, NOT currentUser
        status: 'pending',
      });

      const res = await request(app)
        .post(`/api/v1/interactions/${connReq.id}/read`)
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-existent interaction with 404', async () => {
      const nonexistentUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/interactions/${nonexistentUuid}/read`)
        .set('Authorization', `Bearer ${tokenCurrent}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
