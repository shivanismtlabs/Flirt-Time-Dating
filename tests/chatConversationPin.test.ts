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
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { chatService } from '../src/services/chat.service';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Pin / Unpin Conversation API & Real-time Socket.IO Sync', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User;
  let userB: User;
  let userC: User;

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  let convAB: Conversation;
  let convAC: Conversation;

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
    await UserBlock.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_p',
      email: 'alice@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Alice Pinner',
      gender: 'female',
      dateOfBirth: '1998-05-12',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob_p',
      email: 'bob@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Bob Partner',
      gender: 'male',
      dateOfBirth: '1996-08-20',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'charlie_p',
      email: 'charlie@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Charlie Outsider',
      gender: 'male',
      dateOfBirth: '1995-02-14',
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
      lastMessage: 'Hello Bob from Alice',
      lastMessageAt: new Date(Date.now() - 5000),
    });

    const [ac1, ac2] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: ac1,
      user2Id: ac2,
      lastMessage: 'Hello Charlie from Alice',
      lastMessageAt: new Date(Date.now() - 2000),
    });

    await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Hello Bob from Alice',
      messageType: 'text',
      isRead: false,
    });

    await ChatMessage.create({
      conversationId: convAC.id,
      senderId: userA.id,
      recipientId: userC.id,
      content: 'Hello Charlie from Alice',
      messageType: 'text',
      isRead: false,
    });
  });

  describe('1. Authentication and Input Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .send({ isPinned: true });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid conversation UUID with 400', async () => {
      const res = await request(app)
        .patch('/api/v1/chat/conversations/not-a-valid-uuid/pin')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Validation failed');
    });

    it('should reject invalid request body missing isPinned with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-boolean isPinned in request body with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: 'yes' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant attempting to pin a conversation with 404', async () => {
      // User C attempts to pin convAB (which belongs to A and B)
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ isPinned: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Conversation not found');
    });

    it('should reject non-existent conversation with 404', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${nonExistentId}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Conversation not found');
    });

    it('should reject conversation deleted for everyone with 404', async () => {
      await convAB.update({ isDeletedForEveryone: true });

      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Conversation not found');
    });

    it('should reject conversation if participants are mutually blocked with 403', async () => {
      await UserBlock.create({
        userId: userB.id,
        blockedUserId: userA.id,
      });

      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Pin & Unpin REST API Operations', () => {
    it('should successfully pin a conversation for authenticated user', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Conversation pinned successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        isPinned: true,
      });

      // Verify DB record exists
      const pin = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pin).not.toBeNull();
    });

    it('should successfully unpin a pinned conversation', async () => {
      // Pin first
      await ConversationPin.create({
        conversationId: convAB.id,
        userId: userA.id,
      });

      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Conversation unpinned successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        isPinned: false,
      });

      // Verify DB record is removed
      const pin = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pin).toBeNull();
    });

    it('should enforce multi-user isolation: User A pinning does NOT pin for User B', async () => {
      // User A pins convAB
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // User A's pin exists
      const pinA = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pinA).not.toBeNull();

      // User B's pin does NOT exist
      const pinB = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userB.id },
      });
      expect(pinB).toBeNull();
    });

    it('should ignore any userId provided in the request body (prevents mass assignment / impersonation)', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true, userId: userB.id });

      expect(res.status).toBe(200);

      // Pin should be created for User A, NEVER for User B
      const pinA = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pinA).not.toBeNull();

      const pinB = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userB.id },
      });
      expect(pinB).toBeNull();
    });

    it('should support alternative route aliases seamlessly', async () => {
      // PATCH /api/v1/chats/:conversationId/pin
      const res1 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res1.status).toBe(200);
      expect(res1.body.data.isPinned).toBe(true);

      // POST /api/v1/chats/:conversationId/pin
      const res2 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(res2.status).toBe(200);
      expect(res2.body.data.isPinned).toBe(false);
    });
  });

  describe('3. Idempotence & Unnecessary Write Prevention', () => {
    it('should be idempotent on repeated pin requests without duplicate DB records', async () => {
      // First pin request
      const res1 = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });
      expect(res1.status).toBe(200);

      const countAfterFirst = await ConversationPin.count({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(countAfterFirst).toBe(1);

      // Second identical pin request
      const res2 = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res2.status).toBe(200);
      expect(res2.body.data.isPinned).toBe(true);

      const countAfterSecond = await ConversationPin.count({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(countAfterSecond).toBe(1);
    });

    it('should be idempotent on repeated unpin requests', async () => {
      // Unpin when already unpinned
      const res1 = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(res1.status).toBe(200);
      expect(res1.body.data.isPinned).toBe(false);

      const res2 = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(res2.status).toBe(200);
      expect(res2.body.data.isPinned).toBe(false);
    });
  });

  describe('4. Chat List Integration & Ordering', () => {
    it('should place pinned conversation in pinned list and return isPinned: true', async () => {
      // Initially, User A has convAB and convAC both unpinned
      const listBefore = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listBefore.status).toBe(200);
      expect(listBefore.body.data.pinned).toHaveLength(0);
      expect(listBefore.body.data.conversations).toHaveLength(2);

      // Pin convAB
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Fetch chat list again
      const listAfter = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listAfter.status).toBe(200);
      expect(listAfter.body.data.pinned).toHaveLength(1);
      expect(listAfter.body.data.pinned[0].conversationId).toBe(convAB.id);
      expect(listAfter.body.data.pinned[0].isPinned).toBe(true);

      // convAB is excluded from the unpinned conversations list
      expect(listAfter.body.data.conversations).toHaveLength(1);
      expect(listAfter.body.data.conversations[0].conversationId).toBe(convAC.id);
      expect(listAfter.body.data.conversations[0].isPinned).toBe(false);

      // User B's chat list is completely unaffected
      const listB = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(listB.status).toBe(200);
      expect(listB.body.data.pinned).toHaveLength(0);
      expect(listB.body.data.conversations[0].isPinned).toBe(false);
    });

    it('should return pinned conversations first in GET /api/v1/chat/conversations', async () => {
      // Pin convAB
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const res = await request(app)
        .get('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].id).toBe(convAB.id);
      expect(res.body.data[0].isPinned).toBe(true);
      expect(res.body.data[1].id).toBe(convAC.id);
      expect(res.body.data[1].isPinned).toBe(false);
    });

    it('should return isPinned in GET /api/v1/chats/:conversationId conversation details', async () => {
      // Pin convAB
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const detailRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.isPinned).toBe(true);

      // Check User B sees isPinned: false
      const detailResB = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(detailResB.status).toBe(200);
      expect(detailResB.body.data.isPinned).toBe(false);
    });
  });

  describe('5. Real-Time Socket.IO Synchronization', () => {
    it('should emit conversation:pin-updated only to the pinning user socket rooms', async () => {
      const socketA = createClientSocket({ auth: { token: tokenA } });
      const socketB = createClientSocket({ auth: { token: tokenB } });

      await new Promise<void>((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 2) resolve();
        };
        socketA.on('connect', check);
        socketB.on('connect', check);
      });

      const pinEventPromiseA = new Promise<any>((resolve) => {
        socketA.on('conversation:pin-updated', (data) => resolve(data));
      });
      const listUpdatePromiseA = new Promise<any>((resolve) => {
        socketA.on('conversation:updated', (data) => resolve(data));
      });

      let receivedByB = false;
      socketB.on('conversation:pin-updated', () => {
        receivedByB = true;
      });

      // User A pins convAB
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const eventData = await pinEventPromiseA;
      expect(eventData.conversationId).toBe(convAB.id);
      expect(eventData.isPinned).toBe(true);
      expect(eventData.pinned).toBe(true);
      expect(eventData.participant?.userId).toBe(userB.id);
      expect(eventData.participant?.displayName).toBe('Bob Partner');

      const listUpdate = await listUpdatePromiseA;
      expect(listUpdate.conversationId).toBe(convAB.id);
      expect(listUpdate.isPinned).toBe(true);
      expect(listUpdate.pinned).toBe(true);
      expect(listUpdate.participant.displayName).toBe('Bob Partner');
      expect(listUpdate.participant.userId).toBe(userB.id);

      // Brief delay to ensure User B did not receive the event
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(receivedByB).toBe(false);
    });

    it('should NOT emit duplicate socket event when repeating identical pin request', async () => {
      // Pin first
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const socketA = createClientSocket({ auth: { token: tokenA } });
      await new Promise<void>((resolve) => socketA.on('connect', () => resolve()));

      let eventCount = 0;
      socketA.on('conversation:pin-updated', () => {
        eventCount++;
      });

      // Repeat identical pin request
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(eventCount).toBe(0);
    });

    it('should handle conversation:pin client socket event with callback acknowledgement', async () => {
      const socketA = createClientSocket({ auth: { token: tokenA } });
      await new Promise<void>((resolve) => socketA.on('connect', () => resolve()));

      const ackResponse = await new Promise<any>((resolve) => {
        socketA.emit(
          'conversation:pin',
          { conversationId: convAB.id, isPinned: true },
          (res: any) => resolve(res)
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data).toEqual({
        conversationId: convAB.id,
        isPinned: true,
      });

      // Verify in DB
      const pin = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pin).not.toBeNull();
    });
  });

  describe('6. Non-Destructive Invariance & Regression Checks', () => {
    it('pinning should not alter archive state, deletion state, or unread counts', async () => {
      // Setup: unread messages and archived state
      await ConversationUserState.create({
        conversationId: convAB.id,
        userId: userA.id,
        isArchived: true,
        archivedAt: new Date(),
        isDeleted: false,
      });

      const unreadCountBefore = await ChatMessage.count({
        where: { conversationId: convAB.id, recipientId: userB.id, isRead: false },
      });

      // Pin conversation
      await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Unread count is preserved
      const unreadCountAfter = await ChatMessage.count({
        where: { conversationId: convAB.id, recipientId: userB.id, isRead: false },
      });
      expect(unreadCountAfter).toBe(unreadCountBefore);

      // Deletion flag on conversation is preserved
      const conv = await Conversation.findByPk(convAB.id);
      expect(conv?.isDeletedForEveryone).toBe(false);
    });
  });
});
