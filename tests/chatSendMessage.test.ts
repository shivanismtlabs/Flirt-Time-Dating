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
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Production-Ready Send Message API + Socket.IO Delivery', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let senderUser: User;
  let recipient1: User;
  let recipient2: User;
  let recipient3: User;
  let blockedUser: User;
  let inactiveUser: User;

  let senderToken: string;
  let recipient1Token: string;
  let recipient2Token: string;
  let recipient3Token: string;
  let blockedToken: string;

  const createClientSocket = (
    options: Parameters<typeof ioClient>[1] = {}
  ): ClientSocket => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      ...options,
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
    await UserBlock.destroy({ where: {}, force: true });
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

    recipient1 = await User.create({
      username: 'recipient_one',
      email: 'rec1@flirttime.test',
      fullName: 'Alice First',
      firstName: 'Alice',
      dateOfBirth: '1999-02-02',
      profilePicture: 'photos/alice.jpg',
      isActive: true,
      role: 'user',
    });

    recipient2 = await User.create({
      username: 'recipient_two',
      email: 'rec2@flirttime.test',
      fullName: 'Bob Second',
      firstName: 'Bob',
      dateOfBirth: '1997-03-03',
      profilePicture: 'photos/bob.jpg',
      isActive: true,
      role: 'user',
    });

    recipient3 = await User.create({
      username: 'recipient_three',
      email: 'rec3@flirttime.test',
      fullName: 'Carol Third',
      firstName: 'Carol',
      dateOfBirth: '1996-04-04',
      profilePicture: 'photos/carol.jpg',
      isActive: true,
      role: 'user',
    });

    blockedUser = await User.create({
      username: 'blocked_user',
      email: 'blocked@flirttime.test',
      fullName: 'Blocked User',
      firstName: 'Blocked',
      dateOfBirth: '1995-05-05',
      isActive: true,
      role: 'user',
    });

    inactiveUser = await User.create({
      username: 'inactive_user',
      email: 'inactive@flirttime.test',
      fullName: 'Inactive User',
      firstName: 'Inactive',
      dateOfBirth: '1994-06-06',
      isActive: false,
      role: 'user',
    });

    // Create block between sender and blockedUser
    await UserBlock.create({
      userId: blockedUser.id,
      blockedUserId: senderUser.id,
      reason: 'Harassment',
    });

    senderToken = generateToken({ id: senderUser.id, role: 'user' });
    recipient1Token = generateToken({ id: recipient1.id, role: 'user' });
    recipient2Token = generateToken({ id: recipient2.id, role: 'user' });
    recipient3Token = generateToken({ id: recipient3.id, role: 'user' });
    blockedToken = generateToken({ id: blockedUser.id, role: 'user' });
  });

  describe('1. Authentication and Input Validation', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Hello!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject request without recipients or conversationId with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          type: 'text',
          content: 'Hello without recipient',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty recipientIds array with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [],
          type: 'text',
          content: 'Hello',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid recipient UUID with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: ['not-a-valid-uuid'],
          type: 'text',
          content: 'Hello',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty text message content with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: '   ',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject image message without content (URL/key) with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'image',
          content: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject audio message without content with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'audio',
          content: '',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid message type with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'unsupported_type_xyz',
          content: 'Hello',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should prevent sender from sending a message solely to themselves with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [senderUser.id],
          type: 'text',
          content: 'Hello to myself',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot send a message to yourself/i);
    });

    it('should enforce recipient limit (max 50) with 400', async () => {
      const fakeUuids = Array.from({ length: 51 }, (_, i) =>
        `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`
      );
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: fakeUuids,
          type: 'text',
          content: 'Hello to 51 users',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Send to One Person (POST /api/v1/chat/messages & /api/v1/chats/messages)', () => {
    it('should send a text message to one recipient and create 1-to-1 conversation', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Hey Alice! Hope you are doing well.',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(1);
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.failureCount).toBe(0);

      const resultItem = res.body.data.results[0];
      expect(resultItem.recipientId).toBe(recipient1.id);
      expect(resultItem.status).toBe('success');
      expect(resultItem.conversationId).toBeDefined();
      expect(resultItem.message).toBeDefined();
      expect(resultItem.message.content).toBe('Hey Alice! Hope you are doing well.');
      expect(resultItem.message.senderId).toBe(senderUser.id);
      expect(resultItem.message.recipientId).toBe(recipient1.id);
      expect(resultItem.message.status).toBe('sent');
      expect(resultItem.message.isDelivered).toBe(false);
      expect(resultItem.message.isRead).toBe(false);

      // Verify conversation exists in database with sender and recipient
      const conv = await Conversation.findByPk(resultItem.conversationId);
      expect(conv).not.toBeNull();
      const participants = [conv!.user1Id, conv!.user2Id].sort();
      const expected = [senderUser.id, recipient1.id].sort();
      expect(participants).toEqual(expected);
      expect(conv!.lastMessage).toBe('Hey Alice! Hope you are doing well.');
    });

    it('should support singular recipientId parameter', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientId: recipient2.id,
          type: 'text',
          content: 'Hello Bob via recipientId!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.results[0].recipientId).toBe(recipient2.id);
      expect(res.body.data.results[0].message.content).toBe('Hello Bob via recipientId!');
    });

    it('should reuse existing 1-to-1 conversation when sending subsequent messages', async () => {
      // First message
      const res1 = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'First message',
        });
      const convId1 = res1.body.data.results[0].conversationId;

      // Second message
      const res2 = await request(app)
        .post('/api/v1/chats/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Second message',
        });
      const convId2 = res2.body.data.results[0].conversationId;

      expect(convId1).toBe(convId2);

      // Verify database contains 2 messages in this conversation
      const messageCount = await ChatMessage.count({ where: { conversationId: convId1 } });
      expect(messageCount).toBe(2);
    });

    it('should support sending by conversationId', async () => {
      // Create conversation first
      const [u1, u2] = [senderUser.id, recipient1.id].sort();
      const conv = await Conversation.create({
        user1Id: u1,
        user2Id: u2,
      });

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          conversationId: conv.id,
          type: 'text',
          content: 'Message directed to existing conversation',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results[0].conversationId).toBe(conv.id);
      expect(res.body.data.results[0].recipientId).toBe(recipient1.id);
    });

    it('should support existing endpoint POST /api/v1/chats/:conversationId/messages without breaking', async () => {
      const [u1, u2] = [senderUser.id, recipient1.id].sort();
      const conv = await Conversation.create({
        user1Id: u1,
        user2Id: u2,
      });

      const res = await request(app)
        .post(`/api/v1/chats/${conv.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageType: 'text',
          content: 'Existing endpoint message test',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.conversationId).toBe(conv.id);
      expect(res.body.data.content).toBe('Existing endpoint message test');
    });
  });

  describe('3. Send to Selected Multiple People (WhatsApp Broadcast Style)', () => {
    it('should send the same message to 3 selected recipients in separate 1-to-1 chats', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, recipient2.id, recipient3.id],
          type: 'text',
          content: 'Hey everyone, check this out!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(3);
      expect(res.body.data.successCount).toBe(3);
      expect(res.body.data.failureCount).toBe(0);
      expect(res.body.data.results).toHaveLength(3);

      const convIds = res.body.data.results.map((r: any) => r.conversationId);
      // All 3 conversation IDs must be distinct (each is an individual 1-to-1 conversation)
      const uniqueConvIds = new Set(convIds);
      expect(uniqueConvIds.size).toBe(3);

      // Verify each recipient has their message
      for (const recipient of [recipient1, recipient2, recipient3]) {
        const item = res.body.data.results.find((r: any) => r.recipientId === recipient.id);
        expect(item).toBeDefined();
        expect(item.status).toBe('success');
        expect(item.message.content).toBe('Hey everyone, check this out!');
        expect(item.message.senderId).toBe(senderUser.id);
        expect(item.message.recipientId).toBe(recipient.id);
      }

      // Verify database has 3 conversations and 3 messages
      expect(await Conversation.count()).toBe(3);
      expect(await ChatMessage.count()).toBe(3);
    });

    it('should deduplicate repeated recipient IDs automatically', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, recipient1.id, recipient2.id],
          type: 'text',
          content: 'Hello deduplicated recipients',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.totalCount).toBe(2);
      expect(res.body.data.successCount).toBe(2);
      expect(res.body.data.results).toHaveLength(2);
    });
  });

  describe('4. Partial Bulk-Send Failures & Permission Isolation', () => {
    it('should isolate failures: succeed for valid users and report failure for blocked/inactive users', async () => {
      const nonExistentId = '99999999-9999-9999-9999-999999999999';

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, blockedUser.id, inactiveUser.id, nonExistentId],
          type: 'text',
          content: 'Broadcast test with mixed recipients',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(4);
      expect(res.body.data.successCount).toBe(1); // recipient1 succeeded
      expect(res.body.data.failureCount).toBe(3); // blockedUser, inactiveUser, nonExistentId failed

      const results = res.body.data.results;

      // 1. Recipient 1: Success
      const r1 = results.find((r: any) => r.recipientId === recipient1.id);
      expect(r1.status).toBe('success');
      expect(r1.message).toBeDefined();

      // 2. Blocked User: Failed
      const rBlocked = results.find((r: any) => r.recipientId === blockedUser.id);
      expect(rBlocked.status).toBe('failed');
      expect(rBlocked.error).toMatch(/cannot chat with this user/i);
      expect(rBlocked.errorCode).toBe('USER_BLOCKED');

      // 3. Inactive User: Failed
      const rInactive = results.find((r: any) => r.recipientId === inactiveUser.id);
      expect(rInactive.status).toBe('failed');
      expect(rInactive.error).toMatch(/unavailable/i);
      expect(rInactive.errorCode).toBe('USER_NOT_FOUND');

      // 4. Non-existent User: Failed
      const rNonExistent = results.find((r: any) => r.recipientId === nonExistentId);
      expect(rNonExistent.status).toBe('failed');
      expect(rNonExistent.error).toMatch(/unavailable/i);
      expect(rNonExistent.errorCode).toBe('USER_NOT_FOUND');

      // Verify in DB that ONLY recipient1 got a message
      const messages = await ChatMessage.findAll();
      expect(messages).toHaveLength(1);
      expect(messages[0].recipientId).toBe(recipient1.id);
    });

    it('should fail single blocked recipient and report status in results', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [blockedUser.id],
          type: 'text',
          content: 'Hello blocked user',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.totalCount).toBe(1);
      expect(res.body.data.successCount).toBe(0);
      expect(res.body.data.failureCount).toBe(1);
      expect(res.body.data.results[0].status).toBe('failed');
      expect(res.body.data.results[0].errorCode).toBe('USER_BLOCKED');
    });

    it('should handle self-messaging in a bulk list by failing only self while delivering to others', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, senderUser.id],
          type: 'text',
          content: 'Hello to Alice and self',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.totalCount).toBe(2);
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.failureCount).toBe(1);

      const rSelf = res.body.data.results.find((r: any) => r.recipientId === senderUser.id);
      expect(rSelf.status).toBe('failed');
      expect(rSelf.errorCode).toBe('SELF_MESSAGING_PROHIBITED');

      const rAlice = res.body.data.results.find((r: any) => r.recipientId === recipient1.id);
      expect(rAlice.status).toBe('success');
    });
  });

  describe('5. Idempotency Protection (clientMessageId)', () => {
    it('should prevent duplicate message creation when retrying with clientMessageId', async () => {
      const clientMessageId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      // First attempt
      const res1 = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Idempotent hello!',
          clientMessageId,
        });

      expect(res1.status).toBe(201);
      const msgId1 = res1.body.data.results[0].message.id;

      // Second attempt with identical clientMessageId (retry)
      const res2 = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Idempotent hello!',
          clientMessageId,
        });

      expect(res2.status).toBe(201);
      const msgId2 = res2.body.data.results[0].message.id;

      // Message ID must match and no duplicate row created in database
      expect(msgId1).toBe(msgId2);
      const count = await ChatMessage.count();
      expect(count).toBe(1);
    });

    it('should support per-recipient clientMessageIds map', async () => {
      const clientMessageIds = {
        [recipient1.id]: '11111111-1111-1111-1111-111111111111',
        [recipient2.id]: '22222222-2222-2222-2222-222222222222',
      };

      const res1 = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, recipient2.id],
          type: 'text',
          content: 'Broadcast with client IDs',
          clientMessageIds,
        });

      expect(res1.status).toBe(201);
      expect(res1.body.data.successCount).toBe(2);

      // Retry
      const res2 = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, recipient2.id],
          type: 'text',
          content: 'Broadcast with client IDs',
          clientMessageIds,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.successCount).toBe(2);
      expect(await ChatMessage.count()).toBe(2); // no duplicates created
    });
  });

  describe('6. Media Types (Image, Location, Contact, Voice)', () => {
    it('should send location message with latitude & longitude metadata', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'location',
          metadata: {
            latitude: 19.076,
            longitude: 72.8777,
            name: 'Marine Drive',
            address: 'Mumbai, India',
          },
        });

      expect(res.status).toBe(201);
      const msg = res.body.data.results[0].message;
      expect(msg.messageType).toBe('location');
      expect(msg.content).toContain('Marine Drive');
      expect(msg.metadata.latitude).toBe(19.076);
      expect(msg.metadata.longitude).toBe(72.8777);
    });

    it('should send contact card message with name & phoneNumber metadata', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'contact',
          metadata: {
            name: 'Jane Doe',
            phoneNumber: '+15551234567',
          },
        });

      expect(res.status).toBe(201);
      const msg = res.body.data.results[0].message;
      expect(msg.messageType).toBe('contact');
      expect(msg.content).toContain('Jane Doe');
      expect(msg.metadata.phoneNumber).toBe('+15551234567');
    });

    it('should send voice message with audio URL', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'audio',
          content: 'uploads/voice/recording_123.mp3',
        });

      expect(res.status).toBe(201);
      const msg = res.body.data.results[0].message;
      expect(msg.messageType).toBe('audio');
      expect(msg.content).toBe('uploads/voice/recording_123.mp3');
    });

    it('should reject attaching media belonging to another user', async () => {
      const otherUserUuid = '77777777-7777-7777-7777-777777777777';
      const foreignMediaUrl = `uploads/${otherUserUuid}/photo.jpg`;

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'image',
          content: foreignMediaUrl,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot attach media belonging to another user/i);
    });
  });

  describe('7. Real-Time Socket.IO Integration', () => {
    let socketRecipient1: ClientSocket;
    let socketRecipient2: ClientSocket;
    let socketSender: ClientSocket;

    beforeEach(async () => {
      socketRecipient1 = createClientSocket({
        auth: { token: recipient1Token },
      });
      socketRecipient2 = createClientSocket({
        auth: { token: recipient2Token },
      });
      socketSender = createClientSocket({
        auth: { token: senderToken },
      });

      await Promise.all([
        new Promise<void>((resolve) => socketRecipient1.on('connect', () => resolve())),
        new Promise<void>((resolve) => socketRecipient2.on('connect', () => resolve())),
        new Promise<void>((resolve) => socketSender.on('connect', () => resolve())),
      ]);
    });

    it('should deliver real-time chat:message_received event to online recipients and chat:message_sent to sender', async () => {
      const receivedP1 = new Promise<any>((resolve) => {
        socketRecipient1.on('chat:message_received', (data) => resolve(data));
      });
      const receivedP2 = new Promise<any>((resolve) => {
        socketRecipient2.on('chat:message_received', (data) => resolve(data));
      });
      const senderSentP = new Promise<any>((resolve) => {
        socketSender.on('chat:message_sent', (data) => resolve(data));
      });

      // Send to recipient 1 and 2
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id, recipient2.id],
          type: 'text',
          content: 'Realtime socket test message!',
        });

      expect(res.status).toBe(201);

      const [p1Event, p2Event, senderEvent] = await Promise.all([
        receivedP1,
        receivedP2,
        senderSentP,
      ]);

      // Recipient 1 received event
      expect(p1Event.content).toBe('Realtime socket test message!');
      expect(p1Event.senderId).toBe(senderUser.id);
      expect(p1Event.recipientId).toBe(recipient1.id);
      expect(p1Event.isMine).toBe(false);

      // Recipient 2 received event
      expect(p2Event.content).toBe('Realtime socket test message!');
      expect(p2Event.senderId).toBe(senderUser.id);
      expect(p2Event.recipientId).toBe(recipient2.id);
      expect(p2Event.isMine).toBe(false);

      // Sender device synchronization event
      expect(senderEvent.content).toBe('Realtime socket test message!');
      expect(senderEvent.senderId).toBe(senderUser.id);
    });

    it('should support sending messages via Socket.IO client event chat:send_message', async () => {
      const recipientPromise = new Promise<any>((resolve) => {
        socketRecipient1.on('chat:message_received', (data) => resolve(data));
      });

      const ackResponse = await new Promise<any>((resolve) => {
        socketSender.emit(
          'chat:send_message',
          {
            recipientIds: [recipient1.id],
            type: 'text',
            content: 'Message sent over WebSocket!',
          },
          (res: any) => resolve(res)
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data.successCount).toBe(1);

      const received = await recipientPromise;
      expect(received.content).toBe('Message sent over WebSocket!');
    });

    it('should support sending multiple images via Socket.IO chat:send_message and deliver to recipient and sender consistently', async () => {
      const recipientPromise = new Promise<any[]>((resolve) => {
        const events: any[] = [];
        socketRecipient1.on('chat:message_received', (data) => {
          events.push(data);
          if (events.length === 3) resolve(events);
        });
      });

      const ackResponse = await new Promise<any>((resolve) => {
        socketSender.emit(
          'chat:send_message',
          {
            recipientIds: [recipient1.id],
            messageType: 'image',
            images: [
              { url: 'https://s3.flirttime.test/chat/photo1.jpg' },
              { url: 'https://s3.flirttime.test/chat/photo2.jpg' },
              { url: 'https://s3.flirttime.test/chat/photo3.jpg' },
            ],
          },
          (res: any) => resolve(res)
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(Array.isArray(ackResponse.data.images)).toBe(true);
      expect(ackResponse.data.images.length).toBe(3);
      expect(Array.isArray(ackResponse.data.messages)).toBe(true);
      expect(ackResponse.data.messages.length).toBe(3);

      const received = await recipientPromise;
      expect(received).toHaveLength(3);
      const receivedUrls = new Set(received.map((event) => event.imageUrl));
      expect(receivedUrls.size).toBe(3);
      for (const event of received) {
        expect(event.messageType).toBe('image');
        expect(event.isMine).toBe(false);
        expect(event.images.length).toBe(1);
        expect(event.medias.length).toBe(1);
        expect(String(event.imageUrl).startsWith('http')).toBe(true);
      }

      // Verify both sender and recipient see all 3 images in history
      const [histSender, histRecipient] = await Promise.all([
        request(app).get(`/api/v1/chat/messages/${recipient1.id}`).set('Authorization', `Bearer ${senderToken}`),
        request(app).get(`/api/v1/chat/messages/${senderUser.id}`).set('Authorization', `Bearer ${recipient1Token}`),
      ]);

      expect(histSender.status).toBe(200);
      expect(histRecipient.status).toBe(200);
      expect(histSender.body.data.messages.length).toBe(3);
      expect(histRecipient.body.data.messages.length).toBe(3);
      for (const m of histSender.body.data.messages) {
        expect(m.messageType).toBe('image');
        expect(m.images.length).toBe(1);
        expect(m.imageUrl).toBeDefined();
      }
      expect(new Set(histSender.body.data.messages.map((m: any) => m.imageUrl)).size).toBe(3);
      for (const m of histRecipient.body.data.messages) {
        expect(m.messageType).toBe('image');
        expect(m.images.length).toBe(1);
        expect(m.medias.length).toBe(1);
        expect(m.isMine).toBe(false);
      }
      expect(new Set(histRecipient.body.data.messages.map((m: any) => m.imageUrl)).size).toBe(3);
    });

    it('should deliver real-time conversation:updated event to both sender and recipient when a message is sent', async () => {
      const senderConvUpdateP = new Promise<any>((resolve) => {
        socketSender.on('conversation:updated', (data) => resolve(data));
      });
      const recipientConvUpdateP = new Promise<any>((resolve) => {
        socketRecipient1.on('conversation:updated', (data) => resolve(data));
      });

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Hello conversation list real-time update!',
        });

      expect(res.status).toBe(201);

      const [senderConv, recipientConv] = await Promise.all([
        senderConvUpdateP,
        recipientConvUpdateP,
      ]);

      // Sender conversation update validation
      expect(senderConv).toBeDefined();
      expect(senderConv.lastMessage.content).toBe('Hello conversation list real-time update!');
      expect(senderConv.participant.userId).toBe(recipient1.id);
      expect(senderConv.unreadCount).toBe(0);

      // Recipient conversation update validation
      expect(recipientConv).toBeDefined();
      expect(recipientConv.lastMessage.content).toBe('Hello conversation list real-time update!');
      expect(recipientConv.participant.userId).toBe(senderUser.id);
      expect(recipientConv.unreadCount).toBe(1);
    });

    it('should support fetching conversation list via socket event conversation:get_list', async () => {
      // Send a message first so a conversation exists
      await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Socket fetch test',
        });

      const listResponse = await new Promise<any>((resolve) => {
        socketSender.emit('conversation:get_list', {}, (res: any) => resolve(res));
      });

      expect(listResponse.success).toBe(true);
      expect(listResponse.data.conversations).toBeDefined();
      expect(listResponse.data.conversations.length).toBeGreaterThan(0);
      expect(listResponse.data.conversations[0].lastMessage.content).toBe('Socket fetch test');
    });

    it('should reject unauthorized socket connection attempts', async () => {
      const unauthorizedSocket = ioClient(serverUrl, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
        timeout: 3000,
        auth: { token: 'invalid_or_expired_jwt_token' },
      });

      const errorPromise = new Promise<any>((resolve) => {
        unauthorizedSocket.on('connect_error', (err) => resolve(err));
      });

      const err = await errorPromise;
      expect(err).toBeDefined();
      unauthorizedSocket.disconnect();
    });
  });

  describe('8. Chat History, List, and Unread Count Regressions', () => {
    it('should update unread counts and conversation list accurately after sending message', async () => {
      // Sender sends to recipient 1
      await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientIds: [recipient1.id],
          type: 'text',
          content: 'Unread tracking check',
        });

      // Recipient 1 fetches chat list
      const listRes = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${recipient1Token}`);

      expect(listRes.status).toBe(200);
      const conversationItem = listRes.body.data.conversations[0];
      expect(conversationItem).toBeDefined();
      expect(conversationItem.lastMessage.content).toBe('Unread tracking check');
      expect(conversationItem.unreadCount).toBe(1);

      // Recipient 1 fetches total unread count API
      const unreadRes = await request(app)
        .get('/api/v1/chats/unread-count')
        .set('Authorization', `Bearer ${recipient1Token}`);

      expect(unreadRes.status).toBe(200);
      expect(unreadRes.body.data.totalUnread).toBe(1);

      // Recipient 1 fetches conversation message history
      const historyRes = await request(app)
        .get(`/api/v1/chats/${conversationItem.conversationId}/messages`)
        .set('Authorization', `Bearer ${recipient1Token}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.messages).toHaveLength(1);
      expect(historyRes.body.data.messages[0].content).toBe('Unread tracking check');
      expect(historyRes.body.data.messages[0].status).toBe('sent');
      expect(historyRes.body.data.messages[0].isMine).toBe(false);
    });
  });

  describe('9. Profile-to-Chat Navigation & Outgoing Message Identification', () => {
    it('should return enriched conversation data with participant when starting conversation from profile (POST /api/v1/chats)', async () => {
      const res = await request(app)
        .post('/api/v1/chats')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientId: recipient2.id,
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBeDefined();
      expect(res.body.data.id).toBe(res.body.data.conversationId);
      expect(res.body.data.recipientId).toBe(recipient2.id);
      expect(res.body.data.participant).toBeDefined();
      expect(res.body.data.participant.id).toBe(recipient2.id);
      expect(res.body.data.participant.userId).toBe(recipient2.id);
      expect(res.body.data.participant.displayName).toBe('Bob Second');
      expect(res.body.data.participant.name).toBe('Bob Second');
      expect(res.body.data.targetUser.name).toBe('Bob Second');

      const [starterList, recipientList] = await Promise.all([
        request(app).get('/api/v1/chats').set('Authorization', `Bearer ${senderToken}`),
        request(app).get('/api/v1/chats').set('Authorization', `Bearer ${recipient2Token}`),
      ]);

      expect(starterList.status).toBe(200);
      const started = [
        ...starterList.body.data.pinned,
        ...starterList.body.data.conversations,
      ].find((item: any) => item.conversationId === res.body.data.conversationId);
      expect(started).toBeDefined();
      expect(started.participant.userId).toBe(recipient2.id);
      expect(started.participant.displayName).toBe('Bob Second');
      expect(started.participant.name).toBe('Bob Second');

      const visibleToRecipient = [
        ...recipientList.body.data.pinned,
        ...recipientList.body.data.conversations,
      ].some((item: any) => item.conversationId === res.body.data.conversationId);
      expect(visibleToRecipient).toBe(false);
    });

    it('should return top-level isMine: true and isSender: true when sending message with recipientId (POST /api/v1/chat/messages)', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientId: recipient2.id,
          content: 'Hello from profile message button!',
          type: 'text',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Top-level single message DTO fields
      expect(res.body.data.senderId).toBe(senderUser.id);
      expect(res.body.data.recipientId).toBe(recipient2.id);
      expect(res.body.data.isMine).toBe(true);
      expect(res.body.data.isSender).toBe(true);
      expect(res.body.data.content).toBe('Hello from profile message button!');
      expect(res.body.data.conversationId).toBeDefined();

      // Backward compatibility with multi-message envelope
      expect(res.body.data.results).toBeDefined();
      expect(res.body.data.results[0].status).toBe('success');
    });

    it('should return isMine: true and isSender: true when sender fetches history via GET /api/v1/chat/messages/:targetUserId', async () => {
      await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientId: recipient2.id,
          content: 'Hello from profile message button!',
          type: 'text',
        });

      const res = await request(app)
        .get(`/api/v1/chat/messages/${recipient2.id}`)
        .set('Authorization', `Bearer ${senderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(1);

      const latestMsg = res.body.data.messages.find(
        (m: any) => m.content === 'Hello from profile message button!'
      );
      expect(latestMsg).toBeDefined();
      expect(latestMsg.senderId).toBe(senderUser.id);
      expect(latestMsg.isMine).toBe(true);
      expect(latestMsg.isSender).toBe(true);
    });

    it('should return isMine: false and isSender: false when recipient fetches history via GET /api/v1/chat/messages/:targetUserId', async () => {
      await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          recipientId: recipient2.id,
          content: 'Hello from profile message button!',
          type: 'text',
        });

      const res = await request(app)
        .get(`/api/v1/chat/messages/${senderUser.id}`)
        .set('Authorization', `Bearer ${recipient2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const incomingMsg = res.body.data.messages.find(
        (m: any) => m.content === 'Hello from profile message button!'
      );
      expect(incomingMsg).toBeDefined();
      expect(incomingMsg.senderId).toBe(senderUser.id);
      expect(incomingMsg.isMine).toBe(false);
      expect(incomingMsg.isSender).toBe(false);
    });

    it('should support sending message using targetUserId as conversationId fallback parameter (POST /api/v1/chats/:targetUserId/messages)', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${recipient2.id}/messages`)
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          content: 'Direct send via target user param',
          messageType: 'text',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.senderId).toBe(senderUser.id);
      expect(res.body.data.isMine).toBe(true);
      expect(res.body.data.isSender).toBe(true);
      expect(res.body.data.content).toBe('Direct send via target user param');
    });
  });
});

