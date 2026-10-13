import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
  MomentGift,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Permanent Moments Feature APIs', () => {
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
    await MomentGift.destroy({ where: {} });
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

  describe('1. Creating Moments (POST /api/v1/moments)', () => {
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

    it('should successfully generate presigned upload URL with imageKey for moments', async () => {
      const res = await request(app)
        .post('/api/v1/media/presigned-url')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          folder: 'moments',
          mimeType: 'image/jpeg',
          expiresInSeconds: 900,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.imageKey).toBeDefined();
      expect(res.body.data.key).toBeDefined();
      expect(res.body.data.imageKey).toBe(res.body.data.key);
      expect(res.body.data.imageKey).toMatch(new RegExp(`^moments/${creatorUser.id}/`));
      expect(res.body.data.publicUrl).toBeDefined();
      expect(res.body.data.thumbnailUrl).toBeDefined();
    });

    it('should successfully create a moment with imageKey, caption, and location object', async () => {
      const testKey = `moments/${creatorUser.id}/${Date.now()}_unique1.jpg`;

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: testKey,
          caption: 'Enjoying my evening',
          location: {
            name: 'Indore',
            latitude: 22.7196,
            longitude: 75.8577,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBeDefined();
      expect(res.body.data.caption).toBe('Enjoying my evening');
      expect(res.body.data.locationLabel).toBe('Indore');
      expect(res.body.data.location).toEqual({ name: 'Indore' });
      expect(res.body.data.media).toHaveLength(1);
      expect(res.body.data.media[0].imageKey).toBe(testKey);
      expect(res.body.data.media[0].mediaUrl).toContain(testKey);
      expect(res.body.data.media[0].thumbnailUrl).toContain('thumbnails');

      // Verify PostgreSQL database persistence
      const savedMoment = await Moment.findByPk(res.body.data.momentId);
      expect(savedMoment).not.toBeNull();
      expect(savedMoment?.userId).toBe(creatorUser.id);
      expect(savedMoment?.caption).toBe('Enjoying my evening');
      expect(savedMoment?.locationLabel).toBe('Indore');

      const savedMedia = await MomentMedia.findAll({
        where: { momentId: res.body.data.momentId },
      });
      expect(savedMedia).toHaveLength(1);
      expect(savedMedia[0].mediaUrl).toBe(testKey);
    });

    it('should successfully create a moment with pre-uploaded S3 mediaUrls in JSON body', async () => {
      const testKey1 = `moments/${creatorUser.id}/${Date.now()}_pic1.jpg`;
      const testKey2 = `moments/${creatorUser.id}/${Date.now()}_pic2.jpg`;

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          caption: 'Direct S3 uploaded moment',
          audience: 'everyone',
          locationLabel: 'Goa Beach',
          mediaUrls: [
            `https://flirttime.s3.ap-south-1.amazonaws.com/${testKey1}`,
            `https://flirttime.s3.ap-south-1.amazonaws.com/${testKey2}`,
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentId).toBeDefined();
      expect(res.body.data.caption).toBe('Direct S3 uploaded moment');
      expect(res.body.data.media).toHaveLength(2);
      expect(res.body.data.media[0].displayOrder).toBe(0);
      expect(res.body.data.media[0].imageKey).toBe(testKey1);
      expect(res.body.data.media[1].displayOrder).toBe(1);
      expect(res.body.data.media[1].imageKey).toBe(testKey2);
    });

    it('should successfully create a moment with single mediaUrl in JSON body', async () => {
      const testKey = `moments/${creatorUser.id}/${Date.now()}_single.jpg`;

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          caption: 'Single photo moment',
          mediaUrl: `https://flirttime.s3.ap-south-1.amazonaws.com/${testKey}`,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.media).toHaveLength(1);
      expect(res.body.data.media[0].imageKey).toBe(testKey);
    });

    it('should reject attaching unauthorized S3 uploads belonging to another user with 403', async () => {
      const foreignKey = `moments/${viewerUser.id}/${Date.now()}_foreign.jpg`;

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: foreignKey,
          caption: 'Trying to steal someone else upload',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized/i);
    });

    it('should reject duplicate submission of the same imageKey with 409', async () => {
      const uniqueKey = `moments/${creatorUser.id}/${Date.now()}_first_submit.jpg`;

      // 1. Submit first time
      const res1 = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: uniqueKey,
          caption: 'Original post',
        });
      expect(res1.status).toBe(201);

      // 2. Submit same key second time
      const res2 = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: uniqueKey,
          caption: 'Duplicate attempt',
        });
      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toMatch(/already been submitted/i);
    });

    it('should reject creation when S3 object does not exist in storage with 400', async () => {
      const missingKey = `moments/${creatorUser.id}/${Date.now()}_missing.jpg`;
      jest.spyOn(s3Service, 'checkObjectExists').mockResolvedValueOnce({ exists: false });

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: missingKey,
          caption: 'Missing upload test',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found in storage/i);
    });

    it('should reject creation when S3 object exceeds 5MB size limit with 400', async () => {
      const oversizedKey = `moments/${creatorUser.id}/${Date.now()}_big.jpg`;
      jest.spyOn(s3Service, 'checkObjectExists').mockResolvedValueOnce({
        exists: true,
        contentLength: 6 * 1024 * 1024, // 6MB
        contentType: 'image/jpeg',
      });

      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          imageKey: oversizedKey,
          caption: 'Oversized upload test',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/exceeds the 5MB size limit/i);
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

    it('should retrieve authenticated user individual moments via GET /api/v1/moments/me and /my', async () => {
      const resMe = await request(app)
        .get('/api/v1/moments/me')
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(resMe.status).toBe(200);
      expect(resMe.body.success).toBe(true);
      expect(resMe.body.data.userId).toBe(creatorUser.id);
      expect(resMe.body.data.moments.length).toBeGreaterThanOrEqual(1);
      expect(resMe.body.data.moments[0].momentId).toBe(momentId);
      expect(resMe.body.data.moments[0].media).toBeDefined();
      expect(resMe.body.data.moments[0].likesCount).toBeDefined();
      expect(resMe.body.data.moments[0].commentsCount).toBeDefined();

      const resMy = await request(app)
        .get('/api/v1/moments/my')
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(resMy.status).toBe(200);
      expect(resMy.body.success).toBe(true);
      expect(resMy.body.data.userId).toBe(creatorUser.id);
    });

    it('should retrieve other users moments feed via GET /api/v1/moments?scope=others and GET /api/v1/moments/others', async () => {
      const resOthers = await request(app)
        .get('/api/v1/moments?scope=others&type=feed')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resOthers.status).toBe(200);
      expect(resOthers.body.success).toBe(true);
      const containsOthers = resOthers.body.data.moments.some((m: any) => m.creator.creatorId === creatorUser.id);
      expect(containsOthers).toBe(true);

      const resCreatorOthers = await request(app)
        .get('/api/v1/moments/others')
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(resCreatorOthers.status).toBe(200);
      expect(resCreatorOthers.body.success).toBe(true);
      const containsSelf = resCreatorOthers.body.data.moments.some((m: any) => m.creator?.creatorId === creatorUser.id);
      expect(containsSelf).toBe(false);
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

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should successfully post a comment via POST /api/v1/moments/:momentId/comments and retrieve via GET /api/v1/moments/:momentId/comments', async () => {
      // Post comment
      const postRes = await request(app)
        .post(`/api/v1/moments/${pastMomentId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ comment: 'Stunning capture! 🔥' });

      expect(postRes.status).toBe(201);
      expect(postRes.body.success).toBe(true);
      expect(postRes.body.data.comment).toBe('Stunning capture! 🔥');

      // Get comments list
      const getRes = await request(app)
        .get(`/api/v1/moments/${pastMomentId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.totalComments).toBeGreaterThanOrEqual(1);
      expect(getRes.body.data.comments[0].comment).toBe('Stunning capture! 🔥');
      expect(getRes.body.data.comments[0].user).toBeDefined();
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

    it('should update reaction when user changes emoji', async () => {
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

  describe('6. Privacy & Block Restrictions', () => {
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
  });

  describe('7. Delete Moment and Unlike APIs', () => {
    let momentId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Moment to test delete and unlike')
        .attach('images', validJpegBuffer, 'delete_test.jpg');
      momentId = res.body.data.momentId;
    });

    it('should successfully unlike / remove reaction via DELETE /api/v1/moments/:momentId/reactions', async () => {
      // First, like the moment
      await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'heart' });

      // Then unlike the moment
      const res = await request(app)
        .delete(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unliked).toBe(true);
      expect(res.body.data.isLiked).toBe(false);
      expect(res.body.data.totalReactions).toBe(0);
    });

    it('should successfully unlike via POST /api/v1/moments/:momentId/unlike', async () => {
      // First, like the moment
      await request(app)
        .post(`/api/v1/moments/${momentId}/reactions`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ reaction: 'fire' });

      // Then unlike
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/unlike`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unliked).toBe(true);
    });

    it('should allow author to delete their own moment via DELETE /api/v1/moments/:momentId', async () => {
      const res = await request(app)
        .delete(`/api/v1/moments/${momentId}`)
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/deleted successfully/i);

      // Verify moment is no longer available
      const getRes = await request(app)
        .get(`/api/v1/moments/${momentId}`)
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(getRes.status).toBe(404);
    });

    it('should reject non-author from deleting another user moment with 403', async () => {
      const res = await request(app)
        .delete(`/api/v1/moments/${momentId}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('8. Gifts Count in Moments Feed and User Profiles', () => {
    it('should accurately calculate and return giftsCount in feed and user moments after gifts are sent', async () => {
      // 1. Create a moment
      const createRes = await request(app)
        .post('/api/v1/moments')
        .set('Authorization', `Bearer ${creatorToken}`)
        .field('caption', 'Gift test moment')
        .attach('images', validJpegBuffer, 'gift_test.jpg');

      expect(createRes.status).toBe(201);
      const testMomentId = createRes.body.data.momentId;

      // 2. Initial feed check: giftsCount should be 0
      const feedRes1 = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${viewerToken}`);
      const momentInFeed1 = feedRes1.body.data.moments.find((m: any) => m.momentId === testMomentId);
      expect(momentInFeed1).toBeDefined();
      expect(momentInFeed1.giftsCount).toBe(0);

      // 3. Send 3 gifts (rose qty 1, chocolate qty 2)
      await MomentGift.create({
        momentId: testMomentId,
        senderId: viewerUser.id,
        recipientId: creatorUser.id,
        giftCode: 'rose',
        giftName: 'Rose',
        icon: '🌹',
        coins: 1,
        quantity: 1,
        totalCoins: 1,
      });

      await MomentGift.create({
        momentId: testMomentId,
        senderId: viewerUser.id,
        recipientId: creatorUser.id,
        giftCode: 'chocolate',
        giftName: 'Chocolate',
        icon: '🍫',
        coins: 10,
        quantity: 2,
        totalCoins: 20,
      });

      // 4. Feed check: giftsCount should now be 3 (1 + 2)
      const feedRes2 = await request(app)
        .get('/api/v1/moments')
        .set('Authorization', `Bearer ${viewerToken}`);
      const momentInFeed2 = feedRes2.body.data.moments.find((m: any) => m.momentId === testMomentId);
      expect(momentInFeed2).toBeDefined();
      expect(momentInFeed2.giftsCount).toBe(3);

      // 5. User moments check: giftsCount should also be 3
      const userMomentsRes = await request(app)
        .get(`/api/v1/users/${creatorUser.id}/moments`)
        .set('Authorization', `Bearer ${viewerToken}`);
      const momentInUser = userMomentsRes.body.data.moments.find((m: any) => m.momentId === testMomentId);
      expect(momentInUser).toBeDefined();
      expect(momentInUser.giftsCount).toBe(3);

      // 6. Moment detail check: giftsCount should also be 3
      const detailRes = await request(app)
        .get(`/api/v1/moments/${testMomentId}`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(detailRes.body.data.giftsCount).toBe(3);
    });
  });
});

