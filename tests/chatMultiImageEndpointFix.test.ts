import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Fix Multi-Image Send and Media Images Upload APIs', () => {
  let userA: User;
  let userB: User;
  let tokenA: string;
  let convAB: Conversation;

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
    await initDb(false);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'multi_img_sender',
      email: 'multi_sender@test.com',
      fullName: 'Sender User',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'multi_img_recipient',
      email: 'multi_recipient@test.com',
      fullName: 'Recipient User',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });

    convAB = await Conversation.create({
      user1Id: userA.id,
      user2Id: userB.id,
    });
  });

  describe('1. API 1: /api/v1/media/images Route & HTTP Methods', () => {
    it('POST /api/v1/media/images should upload image successfully and return 201', async () => {
      const res = await request(app)
        .post('/api/v1/media/images')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('image', sampleJpegBuffer, 'photo1.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBeDefined();
      expect(res.body.data.key).toBeDefined();
    });

    it('PUT /api/v1/media/images should not 404 and handle upload', async () => {
      const res = await request(app)
        .put('/api/v1/media/images')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('file', samplePngBuffer, 'photo2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBeDefined();
    });

    it('POST /api/v1/media/images should support multiple files upload', async () => {
      const res = await request(app)
        .post('/api/v1/media/images')
        .set('Authorization', `Bearer ${tokenA}`)
        .attach('images', sampleJpegBuffer, 'img1.jpg')
        .attach('images', samplePngBuffer, 'img2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.images)).toBe(true);
      expect(res.body.data.images.length).toBe(2);
      expect(res.body.data.imageUrls.length).toBe(2);
    });

    it('POST /api/v1/media/images should generate presigned upload URL if no file is sent', async () => {
      const res = await request(app)
        .post('/api/v1/media/images')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ folder: 'chat', mimeType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.key).toContain('chat/');
    });
  });

  describe('2. API 2: POST /api/v1/chats/:conversationId/messages with Multiple Images', () => {
    it('should successfully send multiple images using images array of string URLs without content field', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          images: [
            'https://s3.flirttime.test/chat/photo1.jpg',
            'https://s3.flirttime.test/chat/photo2.jpg',
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images using images array of objects without content field', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          images: [
            { url: 'https://s3.flirttime.test/chat/photoA.jpg' },
            { url: 'https://s3.flirttime.test/chat/photoB.jpg' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images when content is sent as empty string or whitespace', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          content: '   ',
          images: [
            { url: 'https://s3.flirttime.test/chat/photo1.jpg' },
            { url: 'https://s3.flirttime.test/chat/photo2.jpg' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images when images is passed as a JSON string', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          images: JSON.stringify([
            'https://s3.flirttime.test/chat/photo1.jpg',
            'https://s3.flirttime.test/chat/photo2.jpg',
          ]),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images using snake_case image_urls', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          image_urls: [
            'https://s3.flirttime.test/chat/photo1.jpg',
            'https://s3.flirttime.test/chat/photo2.jpg',
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images provided inside metadata.images', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          messageType: 'image',
          metadata: {
            images: [
              'https://s3.flirttime.test/chat/photo1.jpg',
              'https://s3.flirttime.test/chat/photo2.jpg',
            ],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });

    it('should successfully send multiple images via multipart/form-data directly on message route', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .field('messageType', 'image')
        .attach('images', sampleJpegBuffer, 'shot1.jpg')
        .attach('images', samplePngBuffer, 'shot2.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.images.length).toBe(2);
    });
  });
});
