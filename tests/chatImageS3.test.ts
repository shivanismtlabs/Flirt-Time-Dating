import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Chat Image Messaging via AWS S3 (Multipart Upload, Base64, and Dedicated Endpoints)', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let convAB: Conversation;

  // 1x1 valid sample image buffers with correct magic bytes
  const sampleJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
    0xff, 0xd9,
  ]);

  const samplePngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_s3',
      email: 'alice_s3@flirttime.test',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      lastName: 'Walker',
      dateOfBirth: '1998-04-12',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob_s3',
      email: 'bob_s3@flirttime.test',
      fullName: 'Bob Martin',
      firstName: 'Bob',
      lastName: 'Martin',
      dateOfBirth: '1996-09-24',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'charlie_s3',
      email: 'charlie_s3@flirttime.test',
      fullName: 'Charlie Green',
      firstName: 'Charlie',
      lastName: 'Green',
      dateOfBirth: '1997-11-05',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
    tokenC = generateToken({ id: userC.id, email: userC.email, role: userC.role });

    convAB = await Conversation.create({
      user1Id: userA.id,
      user2Id: userB.id,
    });
  });

  // =========================================================================
  // 1. Direct Multipart Form-Data Image Upload in Send Message Endpoint
  // =========================================================================
  describe('1. Direct Multipart Image Upload on POST /api/v1/chats/:conversationId/messages', () => {
    it('should upload image directly to S3 via multipart/form-data and create image message', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .field('messageType', 'image')
        .field('caption', 'Check out this photo!')
        .attach('image', sampleJpegBuffer, 'vacation.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.content).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
      expect(res.body.data.metadata).toBeDefined();
      expect(res.body.data.metadata.thumbnailUrl).toBeDefined();
      expect(res.body.data.metadata.imageUrl).toBeDefined();
      expect(res.body.data.metadata.mediaUrl).toBeDefined();
      expect(res.body.data.metadata.mimeType).toBe('image/jpeg');

      // Verify conversation lastMessage preview
      const conv = await Conversation.findByPk(convAB.id);
      expect(conv?.lastMessage).toBe('📷 Photo');
    });

    it('should auto-detect messageType="image" when file is attached without explicit messageType', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', samplePngBuffer, 'screenshot.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.content).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.png$`));
      expect(res.body.data.metadata.mimeType).toBe('image/png');
    });
  });

  // =========================================================================
  // 2. Base64 Encoded Image Upload in JSON Body
  // =========================================================================
  describe('2. Base64 Encoded Image Upload in JSON Body', () => {
    it('should decode data:image/jpeg;base64 payload, upload to S3, and save message with S3 key', async () => {
      const base64Data = `data:image/jpeg;base64,${sampleJpegBuffer.toString('base64')}`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: base64Data,
          metadata: {
            source: 'camera',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      // Content must NOT be the large base64 string, but the uploaded S3 key
      expect(res.body.data.content).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
      expect(res.body.data.metadata.thumbnailUrl).toBeDefined();
      expect(res.body.data.metadata.imageUrl).toBeDefined();
      expect(res.body.data.metadata.mediaUrl).toBeDefined();
      expect(res.body.data.metadata.source).toBe('camera');
    });
  });

  // =========================================================================
  // 3. Multi-Send / Broadcast Image Upload (WhatsApp Style)
  // =========================================================================
  describe('3. Multi-Send Image Broadcast to Multiple Recipients', () => {
    it('should upload image once to S3 and deliver to all selected recipients via multipart/form-data', async () => {
      const res = await request(app)
        .post('/api/v1/chats/messages')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('recipientIds', JSON.stringify([userB.id, userC.id]))
        .field('messageType', 'image')
        .field('caption', 'Group update!')
        .attach('photo', sampleJpegBuffer, 'broadcast_photo.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(2);
      expect(res.body.data.successCount).toBe(2);

      const results = res.body.data.results;
      expect(results).toHaveLength(2);

      // Verify both recipients received the message with identical uploaded S3 key
      const key0 = results[0].message.content;
      const key1 = results[1].message.content;
      expect(key0).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
      expect(key0).toBe(key1); // Uploaded once, distributed to both

      expect(results[0].message.metadata.thumbnailUrl).toBeDefined();
      expect(results[1].message.metadata.thumbnailUrl).toBeDefined();
    });

    it('should support base64 image in multi-send broadcast endpoint', async () => {
      const base64Data = `data:image/png;base64,${samplePngBuffer.toString('base64')}`;

      const res = await request(app)
        .post('/api/v1/chats/messages')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          recipientIds: [userB.id, userC.id],
          messageType: 'image',
          content: base64Data,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.successCount).toBe(2);
      expect(res.body.data.results[0].message.content).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.png$`));
    });
  });

  // =========================================================================
  // 4. Dedicated S3 Chat Media Upload Endpoints
  // =========================================================================
  describe('4. Dedicated S3 Chat Media Upload Endpoints (POST /api/v1/chats/upload & /media)', () => {
    it('should upload image file to S3 via POST /api/v1/chats/upload and return S3 keys and URLs', async () => {
      const res = await request(app)
        .post('/api/v1/chats/upload')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('image', sampleJpegBuffer, 'direct_chat_upload.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.data).toHaveProperty('url');
      expect(res.body.data).toHaveProperty('publicUrl');
      expect(res.body.data).toHaveProperty('thumbnailUrl');
      expect(res.body.data.key).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
    });

    it('should generate S3 presigned PUT upload URL when called without file on POST /api/v1/chats/upload', async () => {
      const res = await request(app)
        .post('/api/v1/chats/upload')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          mimeType: 'image/jpeg',
          expiresInSeconds: 900,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('uploadUrl');
      expect(res.body.data).toHaveProperty('key');
      expect(res.body.data.key).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.jpg$`));
    });

    it('should support conversation-scoped upload endpoint POST /api/v1/chats/:conversationId/upload', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/upload`)
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', samplePngBuffer, 'scoped_upload.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toMatch(new RegExp(`^chat/${userA.id}/\\d+_[a-f0-9]+\\.png$`));
    });
  });

  // =========================================================================
  // 5. Convenient Field Aliases Support (imageUrl, image, mediaUrl)
  // =========================================================================
  describe('5. Field Aliases (imageUrl, image, mediaUrl)', () => {
    it('should accept "imageUrl" field instead of "content" without validation error', async () => {
      const validKey = `chat/${userA.id}/1700000000_alias.jpg`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          imageUrl: validKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe(validKey);
      expect(res.body.data.metadata.thumbnailUrl).toBeDefined();
    });

    it('should accept "image" field instead of "content"', async () => {
      const validKey = `chat/${userA.id}/1700000001_image_alias.jpg`;

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          image: validKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe(validKey);
    });
  });

  // =========================================================================
  // 6. Message History Enriched with Full S3 Public URLs
  // =========================================================================
  describe('6. Message History Retrieval Enriched with Full S3 URLs', () => {
    it('should return fully resolved S3 public URLs in metadata when fetching messages', async () => {
      const photoKey = `chat/${userA.id}/1700000002_history.jpg`;

      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: photoKey,
        });

      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toHaveLength(1);

      const msg = res.body.data.messages[0];
      expect(msg.messageType).toBe('image');
      expect(msg.content).toBe(photoKey);
      expect(msg.metadata).toBeDefined();
      expect(msg.metadata.thumbnailUrl).toContain('thumbnails');
      expect(msg.metadata.imageUrl).toContain(photoKey);
      expect(msg.metadata.mediaUrl).toContain(photoKey);
    });
  });
});
