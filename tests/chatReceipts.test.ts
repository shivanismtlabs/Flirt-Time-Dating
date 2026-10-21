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
  ConversationPin,
  ConversationUserState,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { chatService } from '../src/services/chat.service';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Chat Receipts & Unread Tracking (REST APIs + Socket.IO Delivery)', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User; // Sender
  let userB: User; // Recipient
  let userC: User; // Non-participant

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  let convAB: Conversation;
  let convAC: Conversation;

  let msg1: ChatMessage;
  let msg2: ChatMessage;
  let msg3: ChatMessage;

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
    await ConversationUserState.destroy({ where: {} });
    await ChatMessage.destroy({ where: {} });
    await ConversationPin.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_receipts',
      email: 'alice@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Alice Wonder',
      gender: 'female',
      dateOfBirth: '1998-05-12',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob_receipts',
      email: 'bob@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Bob Builder',
      gender: 'male',
      dateOfBirth: '1997-03-24',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'charlie_receipts',
      email: 'charlie@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Charlie Outsider',
      gender: 'male',
      dateOfBirth: '1995-11-04',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, role: 'user' });
    tokenB = generateToken({ id: userB.id, role: 'user' });
    tokenC = generateToken({ id: userC.id, role: 'user' });

    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: 'Message 3',
      lastMessageAt: new Date(Date.now()),
    });

    const [ac1, ac2] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: ac1,
      user2Id: ac2,
      lastMessage: 'Hey Charlie',
      lastMessageAt: new Date(Date.now()),
    });

    // Seed 3 messages from User A to User B with chronological createdAt
    msg1 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Message 1',
      messageType: 'text',
      isDelivered: false,
      deliveredAt: null,
      isRead: false,
      readAt: null,
      createdAt: new Date(Date.now() - 3000),
    });

    msg2 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Message 2',
      messageType: 'text',
      isDelivered: false,
      deliveredAt: null,
      isRead: false,
      readAt: null,
      createdAt: new Date(Date.now() - 2000),
    });

    msg3 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Message 3',
      messageType: 'text',
      isDelivered: false,
      deliveredAt: null,
      isRead: false,
      readAt: null,
      createdAt: new Date(Date.now() - 1000),
    });
  });

  describe('1. Authentication and Input Validation', () => {
    it('should reject unauthenticated delivery receipt requests with 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .send({ messageIds: [msg1.id] });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated read receipt requests with 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .send({ lastReadMessageId: msg1.id });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid conversationId UUID with 400', async () => {
      const res = await request(app)
        .patch('/api/v1/chats/not-a-uuid/delivery')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed messageIds payload with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: ['not-a-uuid'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty messageIds array with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid lastReadMessageId format with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant from acknowledging delivery with 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ messageIds: [msg1.id] });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant from marking messages read with 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ lastReadMessageId: msg1.id });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Delivery Receipts (REST APIs: PATCH & POST)', () => {
    it('should acknowledge delivery for recipient and transition status to delivered', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id, msg2.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBe(convAB.id);
      expect(res.body.data.deliveredCount).toBe(2);
      expect(res.body.data.messageIds).toEqual(expect.arrayContaining([msg1.id, msg2.id]));

      // Verify database persistence
      const updatedMsg1 = await ChatMessage.findByPk(msg1.id);
      expect(updatedMsg1?.isDelivered).toBe(true);
      expect(updatedMsg1?.deliveredAt).not.toBeNull();
      expect(updatedMsg1?.isRead).toBe(false);

      const updatedMsg3 = await ChatMessage.findByPk(msg3.id);
      expect(updatedMsg3?.isDelivered).toBe(false);
      expect(updatedMsg3?.deliveredAt).toBeNull();
    });

    it('should support canonical alias POST /api/v1/chat/conversations/:conversationId/delivery', async () => {
      const res = await request(app)
        .post(`/api/v1/chat/conversations/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg3.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deliveredCount).toBe(1);
    });

    it('should prevent sender from acknowledging delivery of their own messages', async () => {
      // User A sent the messages to User B
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ messageIds: [msg1.id, msg2.id] });

      expect(res.status).toBe(200);
      // deliveredCount is 0 because User A is the sender, not recipient
      expect(res.body.data.deliveredCount).toBe(0);
      expect(res.body.data.messageIds).toHaveLength(0);

      const msg = await ChatMessage.findByPk(msg1.id);
      expect(msg?.isDelivered).toBe(false);
    });

    it('should ignore messages belonging to a different conversation', async () => {
      // Create a message in convAC
      const foreignMsg = await ChatMessage.create({
        conversationId: convAC.id,
        senderId: userA.id,
        recipientId: userC.id,
        content: 'Foreign message',
        messageType: 'text',
        isDelivered: false,
        isRead: false,
      });

      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [foreignMsg.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.deliveredCount).toBe(0);
      expect(res.body.data.messageIds).toHaveLength(0);
    });

    it('should be idempotent on repeated delivery acknowledgements without extra writes', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(res1.body.data.deliveredCount).toBe(1);

      // Repeat request with same messageId
      const res2 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(res2.body.data.deliveredCount).toBe(0);
      expect(res2.body.data.messageIds).toEqual([msg1.id]);
    });
  });

  describe('2b. Sync Delivered Messages (/api/v1/chats/delivered/sync)', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .send({ messageIds: [msg1.id] });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid messageId UUID with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: ['not-a-uuid'] });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should sync delivered status for specified messageIds via POST /api/v1/chats/delivered/sync', async () => {
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id, msg2.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Delivery status synchronized successfully');
      expect(res.body.data.deliveredCount).toBe(2);
      expect(res.body.data.messageIds).toEqual(expect.arrayContaining([msg1.id, msg2.id]));
      expect(res.body.data.syncedAt).toBeDefined();

      const updated1 = await ChatMessage.findByPk(msg1.id);
      expect(updated1?.isDelivered).toBe(true);
      expect(updated1?.deliveredAt).not.toBeNull();

      const updated2 = await ChatMessage.findByPk(msg2.id);
      expect(updated2?.isDelivered).toBe(true);

      const unchanged3 = await ChatMessage.findByPk(msg3.id);
      expect(unchanged3?.isDelivered).toBe(false);
    });

    it('should sync all undelivered messages when body is empty via POST /api/v1/chats/delivered/sync', async () => {
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deliveredCount).toBe(3);
      expect(res.body.data.messageIds).toEqual(expect.arrayContaining([msg1.id, msg2.id, msg3.id]));

      const count = await ChatMessage.count({ where: { recipientId: userB.id, isDelivered: true } });
      expect(count).toBe(3);
    });

    it('should support GET /api/v1/chats/delivered/sync', async () => {
      const res = await request(app)
        .get('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deliveredCount).toBe(3);
    });

    it('should support PATCH & PUT /api/v1/chats/delivered/sync', async () => {
      const patchRes = await request(app)
        .patch('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data.deliveredCount).toBe(1);

      const putRes = await request(app)
        .put('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg2.id] });

      expect(putRes.status).toBe(200);
      expect(putRes.body.success).toBe(true);
      expect(putRes.body.data.deliveredCount).toBe(1);
    });

    it('should support aliases: /api/v1/chat/delivered/sync and /api/v1/chats/delivery/sync', async () => {
      const alias1 = await request(app)
        .post('/api/v1/chat/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(alias1.status).toBe(200);
      expect(alias1.body.success).toBe(true);
      expect(alias1.body.data.deliveredCount).toBe(1);

      const alias2 = await request(app)
        .post('/api/v1/chats/delivery/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg2.id] });

      expect(alias2.status).toBe(200);
      expect(alias2.body.success).toBe(true);
      expect(alias2.body.data.deliveredCount).toBe(1);
    });

    it('should scope sync to conversationId when provided', async () => {
      const foreignMsg = await ChatMessage.create({
        conversationId: convAC.id,
        senderId: userA.id,
        recipientId: userC.id,
        content: 'Hey Charlie foreign',
        messageType: 'text',
        isDelivered: false,
      });

      // User B tries to sync with convAB
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ conversationId: convAB.id, messageIds: [msg1.id] });

      expect(res.status).toBe(200);
      expect(res.body.data.deliveredCount).toBe(1);
      expect(res.body.data.conversationId).toBe(convAB.id);

      // Foreign message in convAC untouched
      const checkedForeign = await ChatMessage.findByPk(foreignMsg.id);
      expect(checkedForeign?.isDelivered).toBe(false);
    });

    it('should reject non-participant from syncing with a foreign conversationId with 404', async () => {
      const res = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ conversationId: convAB.id });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should be safe and idempotent on repeated calls', async () => {
      const res1 = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(res1.body.data.deliveredCount).toBe(1);

      const res2 = await request(app)
        .post('/api/v1/chats/delivered/sync')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg1.id] });

      expect(res2.body.data.deliveredCount).toBe(0);
      expect(res2.body.data.messageIds).toEqual([msg1.id]);
    });
  });

  describe('3. Read Receipts and Cursor Boundaries (REST APIs: PATCH & POST)', () => {
    it('should mark messages up to lastReadMessageId boundary as read', async () => {
      // Initial unread count for User B is 3
      const initialCount = await chatService.getConversationUnreadCount(userB.id, convAB.id);
      expect(initialCount).toBe(3);

      // User B acknowledges reading up to msg2
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: msg2.id });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBe(convAB.id);
      expect(res.body.data.lastReadMessageId).toBe(msg2.id);
      expect(res.body.data.markedCount).toBe(2);
      expect(res.body.data.unreadCount).toBe(1);

      // msg1 and msg2 should be read and delivered
      const m1 = await ChatMessage.findByPk(msg1.id);
      expect(m1?.isRead).toBe(true);
      expect(m1?.readAt).not.toBeNull();
      expect(m1?.isDelivered).toBe(true);
      expect(m1?.deliveredAt).not.toBeNull();

      const m2 = await ChatMessage.findByPk(msg2.id);
      expect(m2?.isRead).toBe(true);
      expect(m2?.readAt).not.toBeNull();

      // msg3 beyond the cursor boundary must remain unread and undelivered
      const m3 = await ChatMessage.findByPk(msg3.id);
      expect(m3?.isRead).toBe(false);
      expect(m3?.readAt).toBeNull();
    });

    it('should reject lastReadMessageId if it does not belong to the conversation', async () => {
      const foreignMsg = await ChatMessage.create({
        conversationId: convAC.id,
        senderId: userA.id,
        recipientId: userC.id,
        content: 'Another foreign msg',
        messageType: 'text',
      });

      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: foreignMsg.id });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to this conversation/i);
    });

    it('should mark all unread messages as read when lastReadMessageId is omitted (backward compatibility)', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.markedCount).toBe(3);
      expect(res.body.data.unreadCount).toBe(0);

      const unreadRemaining = await chatService.getConversationUnreadCount(userB.id, convAB.id);
      expect(unreadRemaining).toBe(0);
    });

    it('should be safe and idempotent on repeated markRead calls', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: msg3.id });

      expect(res1.body.data.markedCount).toBe(3);
      expect(res1.body.data.unreadCount).toBe(0);

      // Repeat request
      const res2 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: msg3.id });

      expect(res2.body.data.markedCount).toBe(0);
      expect(res2.body.data.unreadCount).toBe(0);
    });

    it('should prevent sender from marking their own outgoing messages as read', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ lastReadMessageId: msg3.id });

      expect(res.status).toBe(200);
      expect(res.body.data.markedCount).toBe(0);

      // Messages must remain unread by User B
      const m1 = await ChatMessage.findByPk(msg1.id);
      expect(m1?.isRead).toBe(false);
    });
  });

  describe('4. Unread Tracking & History Regressions', () => {
    it('should return accurate unread badge count in GET /api/v1/chats', async () => {
      const listBefore = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);

      const convItem = listBefore.body.data.conversations.find((c: any) => c.conversationId === convAB.id);
      expect(convItem.unreadCount).toBe(3);

      // Mark msg1 read
      await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: msg1.id });

      const listAfter = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);

      const convItemAfter = listAfter.body.data.conversations.find((c: any) => c.conversationId === convAB.id);
      expect(convItemAfter.unreadCount).toBe(2);
    });

    it('should retrieve conversation and total unread counts via GET /api/v1/chats/unread-count', async () => {
      // 1. By conversationId
      const convRes = await request(app)
        .get(`/api/v1/chats/unread-count?conversationId=${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(convRes.status).toBe(200);
      expect(convRes.body.data.conversationId).toBe(convAB.id);
      expect(convRes.body.data.unreadCount).toBe(3);

      // 2. Total across conversations
      const totalRes = await request(app)
        .get('/api/v1/chats/unread-count')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(totalRes.status).toBe(200);
      expect(totalRes.body.data.totalUnread).toBe(3);
    });

    it('should return status ("sent" | "delivered" | "read") and timestamps in message history', async () => {
      // Acknowledge delivery for msg2
      await request(app)
        .patch(`/api/v1/chats/${convAB.id}/delivery`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ messageIds: [msg2.id] });

      // Mark msg1 as read
      await request(app)
        .patch(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ lastReadMessageId: msg1.id });

      // User A (sender) queries message history
      const historyRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(historyRes.status).toBe(200);
      const messages = historyRes.body.data.messages;
      expect(messages).toHaveLength(3);

      const resM1 = messages.find((m: any) => m.id === msg1.id);
      expect(resM1.status).toBe('read');
      expect(resM1.isRead).toBe(true);
      expect(resM1.readAt).not.toBeNull();
      expect(resM1.isDelivered).toBe(true);

      const resM2 = messages.find((m: any) => m.id === msg2.id);
      expect(resM2.status).toBe('delivered');
      expect(resM2.isDelivered).toBe(true);
      expect(resM2.deliveredAt).not.toBeNull();
      expect(resM2.isRead).toBe(false);

      const resM3 = messages.find((m: any) => m.id === msg3.id);
      expect(resM3.status).toBe('sent');
      expect(resM3.isDelivered).toBe(false);
      expect(resM3.isRead).toBe(false);
    });
  });

  describe('5. Real-Time Socket.IO Receipt Delivery & Multi-Device Sync', () => {
    it('should dispatch delivery receipts to sender and handle socket acknowledgement', async () => {
      const socketSender = createClientSocket({ auth: { token: tokenA } });
      const socketRecipient = createClientSocket({ auth: { token: tokenB } });

      await Promise.all([
        new Promise<void>((resolve) => socketSender.on('connect', resolve)),
        new Promise<void>((resolve) => socketRecipient.on('connect', resolve)),
      ]);

      let receivedPayload: any = null;
      socketSender.on('chat:delivery_receipt' as any, (payload: any) => {
        receivedPayload = payload;
      });

      const ack: any = await new Promise((resolve) => {
        socketRecipient.emit(
          'chat:message_delivered' as any,
          {
            conversationId: convAB.id,
            messageIds: [msg1.id],
          },
          resolve
        );
      });

      expect(ack.success).toBe(true);
      expect(ack.data.deliveredCount).toBe(1);

      await new Promise((r) => setTimeout(r, 150));

      expect(receivedPayload).not.toBeNull();
      expect(receivedPayload.conversationId).toBe(convAB.id);
      expect(receivedPayload.recipientId).toBe(userB.id);
      expect(receivedPayload.messageIds).toEqual([msg1.id]);
      expect(receivedPayload.deliveredAt).toBeDefined();
    });

    it('should dispatch read receipts to sender and sync unread count to reader devices', async () => {
      const socketReaderDevice1 = createClientSocket({ auth: { token: tokenB } });
      const socketReaderDevice2 = createClientSocket({ auth: { token: tokenB } });
      const socketSender = createClientSocket({ auth: { token: tokenA } });

      await Promise.all([
        new Promise<void>((resolve) => socketReaderDevice1.on('connect', resolve)),
        new Promise<void>((resolve) => socketReaderDevice2.on('connect', resolve)),
        new Promise<void>((resolve) => socketSender.on('connect', resolve)),
      ]);

      let readReceiptReceived: any = null;
      let unreadSyncReceived: any = null;

      socketSender.on('message:read_receipt' as any, (payload: any) => {
        readReceiptReceived = payload;
      });

      socketReaderDevice2.on('conversation:unread_updated' as any, (payload: any) => {
        unreadSyncReceived = payload;
      });

      const ack: any = await new Promise((resolve) => {
        socketReaderDevice1.emit(
          'message:read' as any,
          {
            conversationId: convAB.id,
            lastReadMessageId: msg2.id,
          },
          resolve
        );
      });

      expect(ack.success).toBe(true);
      expect(ack.data.markedCount).toBe(2);
      expect(ack.data.unreadCount).toBe(1);

      await new Promise((r) => setTimeout(r, 150));

      expect(readReceiptReceived).not.toBeNull();
      expect(readReceiptReceived.conversationId).toBe(convAB.id);
      expect(readReceiptReceived.readerId).toBe(userB.id);
      expect(readReceiptReceived.lastReadMessageId).toBe(msg2.id);
      expect(readReceiptReceived.markedCount).toBe(2);

      expect(unreadSyncReceived).not.toBeNull();
      expect(unreadSyncReceived.conversationId).toBe(convAB.id);
      expect(unreadSyncReceived.unreadCount).toBe(1);
    });

    it('should reject invalid socket delivery payloads gracefully with error ack', async () => {
      const socket = createClientSocket({ auth: { token: tokenB } });
      await new Promise<void>((resolve) => socket.on('connect', resolve));

      const ack: any = await new Promise((resolve) => {
        socket.emit(
          'chat:message_delivered' as any,
          { conversationId: convAB.id },
          resolve
        );
      });

      expect(ack.success).toBe(false);
      expect(ack.error).toMatch(/conversationId and messageIds array are required/i);
    });

    it('should support chat:delivered_sync over socket and notify sender in real-time', async () => {
      const socketSender = createClientSocket({ auth: { token: tokenA } });
      const socketRecipient = createClientSocket({ auth: { token: tokenB } });

      await Promise.all([
        new Promise<void>((resolve) => socketSender.on('connect', resolve)),
        new Promise<void>((resolve) => socketRecipient.on('connect', resolve)),
      ]);

      let receivedPayload: any = null;
      socketSender.on('chat:delivery_receipt' as any, (payload: any) => {
        receivedPayload = payload;
      });

      const ack: any = await new Promise((resolve) => {
        socketRecipient.emit(
          'chat:delivered_sync' as any,
          {
            conversationId: convAB.id,
            messageIds: [msg1.id],
          },
          resolve
        );
      });

      expect(ack.success).toBe(true);
      expect(ack.data.deliveredCount).toBe(1);

      await new Promise((r) => setTimeout(r, 150));

      expect(receivedPayload).not.toBeNull();
      expect(receivedPayload.conversationId).toBe(convAB.id);
      expect(receivedPayload.recipientId).toBe(userB.id);
      expect(receivedPayload.messageIds).toEqual([msg1.id]);
    });
  });
});

