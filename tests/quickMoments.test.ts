import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Quick Moments Feature APIs', () => {
  let creatorUser: User;
  let viewerUser: User;
  let blockedUser: User;
  let creatorToken: string;
  let viewerToken: string;
  let blockedToken: string;

  // Valid 1x1 test JPEG buffer (magic bytes FF D8 FF)
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0xff, 0xd9,
  ]);

  // Valid PNG buffer (magic bytes 89 50 4E 47)
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  ]);

  // Corrupted buffer (fake extension but bad magic bytes)
  const corruptedBuffer = Buffer.from('NOT_AN_IMAGE_FILE_CONTENT_AT_ALL');

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear all tables
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await MomentReaction.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Mock S3 operations in tests to prevent external storage dependency
    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(
      async (_buf, userId, _mime, folder) => `${folder}/${userId}/${Date.now()}_test.jpg`
    );
    jest.spyOn(s3Service, 'deleteObject').mockResolvedValue(undefined);

    creatorUser = await User.create({
      username: 'meera_creator',
      email: 'meera@example.com',
      fullName: 'Meera Patel',
      firstName: 'Meera',
      city: 'Mumbai',
      isActive: true,
      role: 'user',
    });

    viewerUser = await User.create({
      username: 'aarav_viewer',
      email: 'aarav@example.com',
      fullName: 'Aarav Sharma',
      firstName: 'Aarav',
      city: 'Mumbai',
      isActive: true,
      role: 'user',
    });

    blockedUser = await User.create({
      username: 'blocked_user',
      email: 'blocked@example.com',
      fullName: 'Blocked User',
      isActive: true,
      role: 'user',
    });

    creatorToken = generateToken({
      id: creatorUser.id,
      email: creatorUser.email,
      role: creatorUser.role,
    });

    viewerToken = generateToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    });

    blockedToken = generateToken({
      id: blockedUser.id,
      email: blockedUser.email,
      role: blockedUser.role,
    });

    // Setup block between creatorUser and blockedUser
    await UserBlock.create({
      userId: creatorUser.id,
      blockedUserId: blockedUser.id,
      reason: 'Harassment',
    });
  });

  describe('1. Creating Quick Moments (POST /api/v1/moments)', () => {
    it('should successfully create a moment with 1 image', async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Sunday coffee walk ☕')
        .field('audience', 'everyone')
        .field('locationLabel', 'Bandra, Mumbai')
        .attach('images', validJpegBuffer, 'coffee.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBeDefined();
      expect(res.body.data.creatorId).toBe(creatorUser.id);
      expect(res.body.data.caption).toBe('Sunday coffee walk ☕');
      expect(res.body.data.audience).toBe('everyone');
      expect(res.body.data.media).toHaveLength(1);
      expect(res.body.data.media[0].displayOrder).toBe(0);

      // Verify moment does not have a 24-hour expiry
      expect(res.body.data.expiresAt).toBeNull();
    });

    it('should successfully create a moment with 5 images and preserve ordering', async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Weekend photo dump')
        .attach('images', validJpegBuffer, 'img1.jpg')
        .attach('images', validPngBuffer, 'img2.png')
        .attach('images', validJpegBuffer, 'img3.jpg')
        .attach('images', validPngBuffer, 'img4.png')
        .attach('images', validJpegBuffer, 'img5.jpg');

      expect(res.status).toBe(201);
      expect(res.body.data.media).toHaveLength(5);
      const orders = res.body.data.media.map((m: any) => m.displayOrder);
      expect(orders).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('2. Validation & Image Integrity', () => {
    it('should reject requests with 0 images', async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'No images test');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/at least 1 image is required/i);
    });

    it('should reject requests exceeding 5 images', async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .attach('images', validJpegBuffer, '1.jpg')
        .attach('images', validJpegBuffer, '2.jpg')
        .attach('images', validJpegBuffer, '3.jpg')
        .attach('images', validJpegBuffer, '4.jpg')
        .attach('images', validJpegBuffer, '5.jpg')
        .attach('images', validJpegBuffer, '6.jpg');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject corrupted image whose magic bytes do not match JPEG/PNG/WebP', async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .attach('images', corruptedBuffer, 'corrupted.jpg');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/corrupted or in an unsupported format/i);
    });
  });

  describe('3. Moment Listing and Detail Retrieval', () => {
    let momentId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Sunset view')
        .attach('images', validJpegBuffer, 'sunset.jpg');
      momentId = res.body.data.momentId;
    });

    it('should retrieve user visible moment thumbnails via GET /api/v1/users/:userId/moments', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${creatorUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe(creatorUser.id);
      expect(res.body.data.moments).toHaveLength(1);
      expect(res.body.data.moments[0].momentId).toBe(momentId);
      expect(res.body.data.moments[0].timeRemainingMinutes).toBeNull();
    });

    it('should retrieve all users active moments feed via GET /api/v1/moments', async () => {
      const res = await request(app)
        .get('/api/v1/moments?page=1&limit=20')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('feed');
      expect(res.body.data.moments.length).toBeGreaterThanOrEqual(1);
      const found = res.body.data.moments.find((m: any) => m.momentId === momentId);
      expect(found).toBeDefined();
      expect(found.creator.creatorId).toBe(creatorUser.id);
      expect(found.media).toHaveLength(1);
    });

    it('should retrieve all users active moments grouped as stories via GET /api/v1/moments?type=stories', async () => {
      const res = await request(app)
        .get('/api/v1/moments?type=stories')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('stories');
      expect(res.body.data.stories.length).toBeGreaterThanOrEqual(1);
      const story = res.body.data.stories.find((s: any) => s.creatorId === creatorUser.id);
      expect(story).toBeDefined();
      expect(story.momentsCount).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve full-screen Moment details via GET /api/v1/moments/:momentId', async () => {
      const res = await request(app)
        .get(`/api/v1/moments/${momentId}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBe(momentId);
      expect(res.body.data.creator.name).toBe('Meera');
      expect(res.body.data.media).toHaveLength(1);
      expect(res.body.data.canReply).toBe(true);
      expect(res.body.data.reactionCounts).toBeDefined();
    });
  });

  describe('4. Permanent Moments (No 24-Hour Expiry)', () => {
    let pastMomentId: string;

    beforeEach(async () => {
      // Create a moment published 25 hours ago
      const publishedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);

      const m = await Moment.create({
        userId: creatorUser.id,
        caption: 'Past moment (permanent)',
        audience: 'everyone',
        status: 'active',
        publishedAt,
        expiresAt: null,
      });

      await MomentMedia.create({
        momentId: m.id,
        mediaUrl: 'moments/test_past.jpg',
        mediaType: 'image',
        displayOrder: 0,
      });

      pastMomentId = m.id;
    });

    it('should include moments older than 24 hours in GET /api/v1/users/:userId/moments', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${creatorUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      const ids = res.body.data.moments.map((item: any) => item.momentId);
      expect(ids).toContain(pastMomentId);
    });

    it('should successfully retrieve GET /api/v1/moments/:momentId for moments older than 24 hours', async () => {
      const res = await request(app)
        .get(`/api/v1/moments/${pastMomentId}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBe(pastMomentId);
    });

    it('should allow reactions on moments older than 24 hours', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${pastMomentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'heart' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should allow replies on moments older than 24 hours', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${pastMomentId}/replies`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ message: 'Nice!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('5. Moment Reactions (POST /api/v1/moments/:momentId/reactions)', () => {
    let momentId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Cute puppy!')
        .attach('images', validJpegBuffer, 'puppy.jpg');
      momentId = res.body.data.momentId;
    });

    it('should save reaction successfully', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'love_eyes' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reaction).toBe('love_eyes');
      expect(res.body.data.totalReactions).toBe(1);
      expect(res.body.data.reactionCounts.love_eyes).toBe(1);
    });

    it('should update reaction when user changes emoji (1 reaction per viewer)', async () => {
      await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'heart' });

      const res2 = await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'fire' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.reaction).toBe('fire');
      expect(res2.body.data.totalReactions).toBe(1);
      expect(res2.body.data.reactionCounts.fire).toBe(1);
      expect(res2.body.data.reactionCounts.heart).toBe(0);
    });

    it('should reject invalid reaction type with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'thumbs_up_invalid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });
  });

  describe('6. Moment Direct Replies (POST /api/v1/moments/:momentId/replies)', () => {
    let momentId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Homemade sourdough bread')
        .attach('images', validJpegBuffer, 'bread.jpg');
      momentId = res.body.data.momentId;
    });

    it('should deliver reply through direct conversation/message system', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/replies`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ message: 'This looks delicious! Can you share the recipe?' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replyId).toBeDefined();
      expect(res.body.data.conversationId).toBeDefined();
      expect(res.body.data.recipientId).toBe(creatorUser.id);
      expect(res.body.data.message).toBe('This looks delicious! Can you share the recipe?');

      // Verify conversation and chat message persisted
      const chatMsg = await ChatMessage.findByPk(res.body.data.replyId);
      expect(chatMsg).toBeDefined();
      expect(chatMsg?.content).toBe('This looks delicious! Can you share the recipe?');
      expect(chatMsg?.messageType).toBe('moment_reply');
    });

    it('should reject empty reply message with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/replies`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ message: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should reject self-reply to own moment with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ message: 'Replying to myself' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot reply to your own moment/i);
    });
  });

  describe('7. Privacy & Block Restrictions', () => {
    let momentId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Private test')
        .attach('images', validJpegBuffer, 'test.jpg');
      momentId = res.body.data.momentId;
    });

    it('should reject blocked user from viewing creator moments with 403', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${creatorUser.id}/moments`)
        .set('Authorization', `Bearer ${blockedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });

    it('should reject blocked user from getting moment detail with 403', async () => {
      const res = await request(app)
        .get(`/api/v1/moments/${momentId}`)
        .set('Authorization', `Bearer ${blockedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });

    it('should reject blocked user from reacting with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${blockedToken}`)
        .send({ reaction: 'heart' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject blocked user from replying with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/replies`)
        .set('Authorization', `Bearer ${blockedToken}`)
        .send({ message: 'Hello' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('8. Transaction Rollback & Orphan Cleanup', () => {
    it('should clean up uploaded files and rollback DB when database throws error', async () => {
      const momentCreateSpy = jest
        .spyOn(Moment, 'create')
        .mockRejectedValueOnce(new Error('DB Constraint Failure'));

      const deleteObjectSpy = jest.spyOn(s3Service, 'deleteObject');

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Fail test')
        .attach('images', validJpegBuffer, 'fail.jpg');

      expect(res.status).toBe(500);
      expect(deleteObjectSpy).toHaveBeenCalled();

      momentCreateSpy.mockRestore();
    });
  });
});
