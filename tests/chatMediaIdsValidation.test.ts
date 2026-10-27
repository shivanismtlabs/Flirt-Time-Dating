import http from 'http';
import { AddressInfo } from 'net';
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
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Chat API Image Validation & mediaIds Handling', () => {
  let httpServer: http.Server;
  let serverUrl: string;

  let senderUser: User;
  let recipientUser: User;
  let senderToken: string;
  let conversation: Conversation;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    httpServer = http.createServer(app);
    initSocketServer(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    senderUser = await User.create({
      username: 'sender_sam',
      email: 'sender@flirttime.test',
      fullName: 'Sam Sender',
      firstName: 'Sam',
      lastName: 'Sender',
      dateOfBirth: '1998-01-01',
      profilePicture: 'photos/sam.jpg',
      isActive: true,
      role: 'user',
    });

    recipientUser = await User.create({
      username: 'recipient_alice',
      email: 'alice@flirttime.test',
      fullName: 'Alice Recipient',
      firstName: 'Alice',
      dateOfBirth: '1999-02-02',
      profilePicture: 'photos/alice.jpg',
      isActive: true,
      role: 'user',
    });

    senderToken = generateToken({
      id: senderUser.id,
      email: senderUser.email,
      role: senderUser.role,
    });

    const [u1, u2] = [senderUser.id, recipientUser.id].sort();
    conversation = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: '',
      lastMessageAt: new Date(),
    });
  });

  describe('1. Single image sending flow', () => {
    it('should send single image with content', async () => {
      const imageKey = `uploads/${senderUser.id}/single_photo.jpg`;
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          type: 'image',
          content: imageKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const msg = res.body.data.results[0].message;
      expect(msg.messageType).toBe('image');
      expect(msg.content).toBe(imageKey);
      expect(msg.imageUrl).toContain(imageKey);

      const dbMsgs = await ChatMessage.findAll();
      expect(dbMsgs).toHaveLength(1);
    });

    it('should send single image with mediaIds only (when content is missing)', async () => {
      const imageKey = `uploads/${senderUser.id}/image1.jpg`;
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: [imageKey],
          metadata: {
            height: 1600,
            source: 'photo',
            width: 740,
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      const msg = res.body.data.results[0].message;
      expect(msg.messageType).toBe('image');
      expect(msg.content).toBe(imageKey);
      expect(msg.imageUrl).toContain(imageKey);
      expect(msg.images).toBeDefined();
      expect(msg.images.length).toBe(1);

      const dbMsgs = await ChatMessage.findAll();
      expect(dbMsgs).toHaveLength(1);
      expect(dbMsgs[0].content).toBe(imageKey);
    });
  });

  describe('2. Multi-image sending with mediaIds', () => {
    it('should create exactly ONE chat message containing an image gallery in original order', async () => {
      const key1 = `uploads/${senderUser.id}/gallery_1.jpg`;
      const key2 = `uploads/${senderUser.id}/gallery_2.jpg`;
      const key3 = `uploads/${senderUser.id}/gallery_3.jpg`;

      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'image',
          type: 'image',
          mediaIds: [key1, key2, key3],
          clientMessageId: '30627276-7511-417E-AF6D-CF8B155D7589',
          metadata: {
            source: 'photo',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const msg = res.body.data;
      expect(msg.messageType).toBe('image');
      expect(msg.content).toBe(key1);

      // Verify gallery structure
      expect(Array.isArray(msg.images)).toBe(true);
      expect(msg.images).toHaveLength(3);
      expect(msg.images[0].key).toBe(key1);
      expect(msg.images[1].key).toBe(key2);
      expect(msg.images[2].key).toBe(key3);

      expect(Array.isArray(msg.imageUrls)).toBe(true);
      expect(msg.imageUrls).toHaveLength(3);

      expect(Array.isArray(msg.medias)).toBe(true);
      expect(msg.medias).toHaveLength(3);
      expect(msg.medias[0].key).toBe(key1);
      expect(msg.medias[1].key).toBe(key2);
      expect(msg.medias[2].key).toBe(key3);

      // Ensure EXACTLY one message row was created in the database
      const dbCount = await ChatMessage.count();
      expect(dbCount).toBe(1);
    });

    it('should not duplicate mediaIds[0] when both content and mediaIds are provided', async () => {
      const key1 = `uploads/${senderUser.id}/pic1.jpg`;
      const key2 = `uploads/${senderUser.id}/pic2.jpg`;

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          content: key1,
          mediaIds: [key1, key2],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const msg = res.body.data.results[0].message;
      expect(msg.images).toHaveLength(2);
      expect(msg.images[0].key).toBe(key1);
      expect(msg.images[1].key).toBe(key2);

      const dbCount = await ChatMessage.count();
      expect(dbCount).toBe(1);
    });
  });

  const getErrorText = (res: request.Response): string =>
    JSON.stringify(res.body);

  describe('3. Validation failures: missing content and missing mediaIds', () => {
    it('should return 400 when both content and mediaIds are missing for image message', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Image URL or storage key is required in content for image message');
    });

    it('should return 400 when mediaIds is an empty array', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('mediaIds array cannot be empty');
    });
  });

  describe('4. Validation failures: malformed and invalid mediaIds', () => {
    it('should return 400 when mediaIds is a non-array type', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: 12345,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('mediaIds must be an array of storage key strings');
    });

    it('should return 400 when mediaIds contains a non-string item', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: [123],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Each mediaId must be a valid image storage key string');
    });

    it('should return 400 when mediaIds contains an empty string', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: ['   '],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Image storage key cannot be empty');
    });

    it('should return 400 when mediaIds contains [object Object]', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: ['[object Object]'],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Invalid image reference in mediaIds');
    });

    it('should return 400 when mediaIds contains local device URI', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: ['file:///var/mobile/Containers/Data/temp.jpg'],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Local device file URI is not permitted in mediaIds');
    });

    it('should return 400 when mediaIds contains path traversal', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipientUser.id],
          messageType: 'image',
          type: 'image',
          mediaIds: ['uploads/../../etc/passwd'],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(getErrorText(res)).toContain('Invalid media storage key path');
    });
  });

  describe('5. Idempotency and clientMessageId retry', () => {
    it('should return existing message without duplicates when retried with same clientMessageId', async () => {
      const clientMessageId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const key1 = `uploads/${senderUser.id}/retry1.jpg`;
      const key2 = `uploads/${senderUser.id}/retry2.jpg`;

      const res1 = await request(app)
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          type: 'image',
          mediaIds: [key1, key2],
          clientMessageId,
        });

      expect(res1.status).toBe(201);
      const msgId1 = res1.body.data.id;

      // Retry with identical clientMessageId
      const res2 = await request(app)
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          type: 'image',
          mediaIds: [key1, key2],
          clientMessageId,
        });

      expect(res2.status).toBe(201);
      const msgId2 = res2.body.data.id;

      expect(msgId1).toBe(msgId2);
      const count = await ChatMessage.count();
      expect(count).toBe(1);
    });
  });

  describe('6. Regression: Text and Voice messages', () => {
    it('should send standard text message without regression', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          type: 'text',
          content: 'Hello Alice, how are you?',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hello Alice, how are you?');
      expect(res.body.data.messageType).toBe('text');
    });

    it('should send voice message without regression', async () => {
      const voiceKey = `uploads/${senderUser.id}/voice_sample.mp3`;
      const res = await request(app)
        .post(`/api/v1/chat/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          type: 'audio',
          content: voiceKey,
          duration: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('audio');
      expect(res.body.data.content).toBe(voiceKey);
    });
  });
});
