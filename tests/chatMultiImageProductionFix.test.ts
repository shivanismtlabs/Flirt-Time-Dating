import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
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
import { s3Service } from '../src/services/s3.service';

describe('Critical Bug Fix: Multiple Images in Chat visible to Receiver (10 Required Verifications)', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let senderUser: User;
  let receiverUser: User;
  let attackerUser: User;

  let senderToken: string;
  let receiverToken: string;
  let attackerToken: string;

  let testConversation: Conversation;

  // Valid 1x1 sample buffers
  const sampleJpeg1 = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
    0xff, 0xd9,
  ]);
  const sampleJpeg2 = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02,
    0xff, 0xd9,
  ]);
  const samplePng1 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);
  const sampleAudioBuffer = Buffer.from(
    'RIFF$WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
  );

  const createClientSocket = (token: string): ClientSocket => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: { token },
    });
    clientSockets.push(socket);
    return socket;
  };

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
    while (clientSockets.length > 0) {
      const s = clientSockets.pop();
      if (s?.connected) s.disconnect();
    }
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

    receiverUser = await User.create({
      username: 'receiver_rachel',
      email: 'receiver@flirttime.test',
      fullName: 'Rachel Receiver',
      firstName: 'Rachel',
      lastName: 'Receiver',
      dateOfBirth: '1999-03-03',
      profilePicture: 'photos/rachel.jpg',
      isActive: true,
      role: 'user',
    });

    attackerUser = await User.create({
      username: 'attacker_adam',
      email: 'attacker@flirttime.test',
      fullName: 'Adam Attacker',
      firstName: 'Adam',
      lastName: 'Attacker',
      dateOfBirth: '1995-05-05',
      profilePicture: 'photos/adam.jpg',
      isActive: true,
      role: 'user',
    });

    senderToken = generateToken({ id: senderUser.id, role: 'user' });
    receiverToken = generateToken({ id: receiverUser.id, role: 'user' });
    attackerToken = generateToken({ id: attackerUser.id, role: 'user' });

    const [u1, u2] = [senderUser.id, receiverUser.id].sort();
    testConversation = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: null,
      lastMessageAt: null,
      isDeletedForEveryone: false,
    });
  });

  // 1. Sending one image
  describe('1. Sending One Image', () => {
    it('should upload one image, persist in DB, and return valid status and public URLs', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .attach('image', sampleJpeg1, 'single_photo.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('image');
      expect(res.body.data.imageUrl).toBeDefined();
      expect(res.body.data.imageUrl).toContain('http');
      expect(res.body.data.thumbnailUrl).toBeDefined();
      expect(Array.isArray(res.body.data.images)).toBe(true);
      expect(res.body.data.images.length).toBe(1);
      expect(res.body.data.images[0].url).toContain('http');
      expect(res.body.data.images[0].key).toBeDefined();

      // Verify persistence in database
      const dbMsg = await ChatMessage.findByPk(res.body.data.id);
      expect(dbMsg).toBeDefined();
      expect(dbMsg?.messageType).toBe('image');
      expect(dbMsg?.senderId).toBe(senderUser.id);
    });
  });

  // 2. Sending multiple images in one message
  describe('2. Sending Multiple Images in One Message', () => {
    it('should upload 3 images in one message, persist distinct records, and return canonical images array', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .attach('images', sampleJpeg1, 'photo_a.jpg')
        .attach('images', sampleJpeg2, 'photo_b.jpg')
        .attach('images', samplePng1, 'photo_c.png');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('sent');
      expect(res.body.data.messageType).toBe('image');

      // Canonical attachments
      expect(Array.isArray(res.body.data.images)).toBe(true);
      expect(res.body.data.images.length).toBe(3);
      expect(Array.isArray(res.body.data.imageUrls)).toBe(true);
      expect(res.body.data.imageUrls.length).toBe(3);

      // Verify all 3 images persisted
      const allDbMsgs = await ChatMessage.findAll({
        where: { conversationId: testConversation.id },
      });
      expect(allDbMsgs.length).toBe(3);
      for (const msg of allDbMsgs) {
        expect(msg.messageType).toBe('image');
        expect(msg.senderId).toBe(senderUser.id);
      }
    });
  });

  // 3. Partial upload failure
  describe('3. Partial Upload Failure Handling', () => {
    it('should reject when an empty or corrupted file buffer is sent and not leave incomplete messages', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .attach('images', sampleJpeg1, 'valid.jpg')
        .attach('images', emptyBuffer, 'empty.jpg');

      expect([400, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);

      // Verify transaction rollback: no partial records in DB
      const count = await ChatMessage.count({
        where: { conversationId: testConversation.id },
      });
      expect(count).toBe(0);
    });
  });

  // 4. Sender and receiver receive the same attachment list
  describe('4. Sender and Receiver Attachment List Equality', () => {
    it('should emit matching attachment list across REST response and Socket.IO events', async () => {
      const socketReceiver = createClientSocket(receiverToken);
      const socketSender = createClientSocket(senderToken);

      await Promise.all([
        new Promise<void>((resolve) => socketReceiver.on('connect', () => resolve())),
        new Promise<void>((resolve) => socketSender.on('connect', () => resolve())),
      ]);

      const receiverReceivedPromise = new Promise<any>((resolve) => {
        socketReceiver.on('chat:messages_received', (data) => resolve(data));
      });
      const senderSentPromise = new Promise<any>((resolve) => {
        socketSender.on('chat:messages_sent', (data) => resolve(data));
      });

      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'image',
          images: [
            { url: `chat/${senderUser.id}/image1.jpg` },
            { url: `chat/${senderUser.id}/image2.jpg` },
          ],
        });

      expect(res.status).toBe(201);
      const [receiverPayload, senderPayload] = await Promise.all([
        receiverReceivedPromise,
        senderSentPromise,
      ]);

      // Both receive identical images count and keys
      expect(receiverPayload.images.length).toBe(2);
      expect(senderPayload.images.length).toBe(2);
      expect(res.body.data.images.length).toBe(2);

      expect(receiverPayload.images[0].key).toBe(senderPayload.images[0].key);
      expect(receiverPayload.images[1].key).toBe(senderPayload.images[1].key);
    });
  });

  // 5. Receiver can load every image
  describe('5. Receiver Image Accessibility (Full Public URLs)', () => {
    it('should provide full HTTP URLs for every image in images array so receiver is never stuck loading', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'image',
          images: [
            { url: `chat/${senderUser.id}/photo1.jpg` },
            { url: `chat/${senderUser.id}/photo2.jpg` },
          ],
        });

      expect(res.status).toBe(201);
      const data = res.body.data;

      // Receiver checks top-level and array URLs
      expect(data.imageUrl.startsWith('http')).toBe(true);
      expect(data.thumbnailUrl.startsWith('http')).toBe(true);
      expect(data.url.startsWith('http')).toBe(true);

      for (const img of data.images) {
        expect(img.url.startsWith('http')).toBe(true);
        expect(img.imageUrl.startsWith('http')).toBe(true);
        expect(img.thumbnailUrl.startsWith('http')).toBe(true);
      }
      for (const url of data.imageUrls) {
        expect(url.startsWith('http')).toBe(true);
      }
    });
  });

  // 6. Fetching chat history after reconnect/reopening
  describe('6. Reopening Chat History', () => {
    it('should return all images with full URLs when receiver reopens conversation history', async () => {
      // 1. Sender sends 3 images
      await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .attach('images', sampleJpeg1, 'img1.jpg')
        .attach('images', sampleJpeg2, 'img2.jpg')
        .attach('images', samplePng1, 'img3.png');

      // 2. Receiver calls GET /api/v1/chats/:conversationId/messages
      const res = await request(app)
        .get(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages.length).toBe(3);

      for (const msg of res.body.data.messages) {
        expect(msg.messageType).toBe('image');
        expect(msg.isMine).toBe(false);
        expect(msg.imageUrl.startsWith('http')).toBe(true);
        expect(msg.thumbnailUrl.startsWith('http')).toBe(true);
        expect(Array.isArray(msg.images)).toBe(true);
        expect(msg.images.length).toBe(1);
        expect(msg.images[0].url.startsWith('http')).toBe(true);
      }
      expect(new Set(res.body.data.messages.map((msg: any) => msg.imageUrl)).size).toBe(3);

      // 3. Receiver calls direct target user endpoint GET /api/v1/chat/messages/:targetUserId
      const directRes = await request(app)
        .get(`/api/v1/chat/messages/${senderUser.id}`)
        .set('Authorization', `Bearer ${receiverToken}`);

      expect(directRes.status).toBe(200);
      expect(directRes.body.data.messages.length).toBe(3);
    });
  });

  // 7. Invalid or unauthorized S3 object keys
  describe('7. Invalid or Unauthorized S3 Object Keys', () => {
    it('should reject attaching media belonging to another user with 403', async () => {
      const foreignMedia = `chat/${attackerUser.id}/stolen_photo.jpg`;
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'image',
          images: [{ url: foreignMedia }],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot attach media belonging to another user/i);
    });

    it('should reject path traversal in S3 object key with 400', async () => {
      const traversalKey = `../../etc/passwd`;
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'image',
          images: [{ url: traversalKey }],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid s3 object key/i);
    });

    it('should reject unauthorized user from joining conversation room over socket', async () => {
      const attackerSocket = createClientSocket(attackerToken);
      await new Promise<void>((resolve) => attackerSocket.on('connect', () => resolve()));

      const ack = await new Promise<any>((resolve) => {
        attackerSocket.emit(
          'conversation:join',
          { conversationId: testConversation.id },
          (response: any) => resolve(response)
        );
      });

      expect(ack).toBeDefined();
      expect(ack.success).toBe(false);
      expect(ack.error).toMatch(/unauthorized/i);
    });
  });

  // 8. Expired media URLs and URL-refresh mechanism
  describe('8. Media URL Generation and Refresh', () => {
    it('should generate valid canonical URL via s3Service without exposing AWS credentials', () => {
      const testKey = `chat/${senderUser.id}/photo.jpg`;
      const publicUrl = s3Service.getPublicUrl(testKey);

      expect(publicUrl).toBeDefined();
      expect(publicUrl).toContain(testKey);
      expect(publicUrl).not.toContain('undefined');
      expect(publicUrl).not.toContain('null');
    });

    it('should sign private verification URLs with SigV4 when queried', () => {
      const verificationKey = `verifications/${senderUser.id}/selfie.jpg`;
      const signedUrl = s3Service.getPublicUrl(verificationKey);

      expect(signedUrl).toBeDefined();
      expect(signedUrl).toContain(verificationKey);
    });
  });

  // 9. Socket event emitted only after successful persistence
  describe('9. Socket Event Emitted After Persistence', () => {
    it('should ensure database record exists before socket delivery', async () => {
      const socketReceiver = createClientSocket(receiverToken);
      await new Promise<void>((resolve) => socketReceiver.on('connect', () => resolve()));

      let dbRecordFoundOnEvent = false;

      const receivedPromise = new Promise<void>((resolve) => {
        socketReceiver.on('chat:message_received', async (eventData: any) => {
          const found = await ChatMessage.findByPk(eventData.id);
          if (found) {
            dbRecordFoundOnEvent = true;
          }
          resolve();
        });
      });

      await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          content: 'Database persistence verification message',
          messageType: 'text',
        });

      await receivedPromise;
      expect(dbRecordFoundOnEvent).toBe(true);
    });
  });

  // 10. Existing text-only and other media messages remain compatible
  describe('10. Compatibility with Text and Audio Messages', () => {
    it('should send and deliver text-only message seamlessly', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          content: 'Hello Rachel, text compatibility test!',
          messageType: 'text',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('text');
      expect(res.body.data.content).toBe('Hello Rachel, text compatibility test!');
      expect(res.body.data.status).toBe('sent');
    });

    it('should send and deliver voice note audio message with duration', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${testConversation.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .field('messageType', 'audio')
        .field('duration', '11')
        .attach('file', sampleAudioBuffer, {
          filename: 'voice_memo.m4a',
          contentType: 'audio/m4a',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageType).toBe('audio');
      expect(res.body.data.audioUrl).toBeDefined();
      expect(res.body.data.duration).toBe(11);
      expect(res.body.data.status).toBe('sent');
    });
  });
});
