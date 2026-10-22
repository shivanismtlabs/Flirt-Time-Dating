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
  ChatMessagePin,
  ConversationPin,
  ConversationUserState,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Fetch Messages & Pinned Messages — REST API + Socket.IO', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User;
  let userB: User;
  let userC: User;
  let blockedUser: User;

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenBlocked: string;

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
    for (const socket of clientSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    await closeSocketServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await sequelize.close();
  });

  beforeEach(async () => {
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) {
        socket.disconnect();
      }
    }

    await ChatMessagePin.destroy({ where: {}, force: true });
    await ChatMessage.destroy({ where: {}, force: true });
    await ConversationUserState.destroy({ where: {}, force: true });
    await ConversationPin.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await UserBlock.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    userA = await User.create({
      username: 'user_a',
      email: 'a@example.com',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      lastName: 'Walker',
      profilePicture: 'photos/alice.jpg',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'user_b',
      email: 'b@example.com',
      fullName: 'Bob Smith',
      firstName: 'Bob',
      lastName: 'Smith',
      profilePicture: 'photos/bob.jpg',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_c',
      email: 'c@example.com',
      fullName: 'Charlie Davis',
      firstName: 'Charlie',
      lastName: 'Davis',
      profilePicture: null,
      isActive: true,
      role: 'user',
    });

    blockedUser = await User.create({
      username: 'user_blocked',
      email: 'blocked@example.com',
      fullName: 'Blocked User',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, role: 'user' });
    tokenB = generateToken({ id: userB.id, role: 'user' });
    tokenC = generateToken({ id: userC.id, role: 'user' });
    tokenBlocked = generateToken({ id: blockedUser.id, role: 'user' });

    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: 'Message 3',
      lastMessageAt: new Date(),
    });

    const [uA, uC] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: uA,
      user2Id: uC,
      lastMessage: 'Hello Charlie',
      lastMessageAt: new Date(),
    });

    // Seed 3 messages in convAB with distinct timestamps
    const now = Date.now();
    msg1 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Hey Bob, let us catch up!',
      messageType: 'text',
      isRead: true,
      readAt: new Date(now - 120000),
      isDelivered: true,
      deliveredAt: new Date(now - 120000),
      createdAt: new Date(now - 120000),
    });

    msg2 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userB.id,
      recipientId: userA.id,
      content: 'Sure, how about 6pm at Central Perk?',
      messageType: 'text',
      isRead: true,
      readAt: new Date(now - 60000),
      isDelivered: true,
      deliveredAt: new Date(now - 60000),
      createdAt: new Date(now - 60000),
    });

    msg3 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Sounds perfect, see you there!',
      messageType: 'text',
      isRead: false,
      isDelivered: true,
      deliveredAt: new Date(now - 10000),
      createdAt: new Date(now - 10000),
    });
  });

  describe('1. Authentication & Authorization Security Guards', () => {
    it('should reject unauthenticated requests to fetch messages with 401', async () => {
      const res = await request(app).get(`/api/v1/chats/${convAB.id}/messages`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated requests to fetch pinned messages with 401', async () => {
      const res = await request(app).get(`/api/v1/chats/${convAB.id}/messages/pinned`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated requests to pin a message with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .send({ isPinned: true });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should prevent non-participant from fetching another conversation messages with 404', async () => {
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenC}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('should prevent non-participant from fetching pinned messages with 404', async () => {
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenC}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('should prevent non-participant from pinning a message with 404', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ isPinned: true });
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });

    it('should block message operations if participants are mutually blocked with 403', async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
      });

      const fetchRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(fetchRes.status).toBe(403);
      expect(fetchRes.body.success).toBe(false);

      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });
      expect(pinRes.status).toBe(403);
      expect(pinRes.body.success).toBe(false);
    });
  });

  describe('2. Fetch Messages — Cursor Pagination, Ordering, Receipts & Sender Details', () => {
    it('should fetch messages with canonical envelope, chronological ordering, delivery receipts, and sender details', async () => {
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { conversationId, messages, pagination } = res.body.data;
      expect(conversationId).toBe(convAB.id);
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(3);
      expect(pagination.total).toBe(3);

      // Verify chronological ordering (oldest first: msg1 -> msg2 -> msg3)
      expect(messages[0].id).toBe(msg1.id);
      expect(messages[1].id).toBe(msg2.id);
      expect(messages[2].id).toBe(msg3.id);

      // Verify canonical message fields
      const first = messages[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('conversationId');
      expect(first).toHaveProperty('senderId');
      expect(first).toHaveProperty('recipientId');
      expect(first).toHaveProperty('content');
      expect(first).toHaveProperty('messageType');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('isDelivered');
      expect(first).toHaveProperty('deliveredAt');
      expect(first).toHaveProperty('isRead');
      expect(first).toHaveProperty('readAt');
      expect(first).toHaveProperty('sentAt');
      expect(first).toHaveProperty('isMine');
      expect(first).toHaveProperty('isPinned');

      // Verify sender object
      expect(first.sender).toBeDefined();
      expect(first.sender.id).toBe(userA.id);
      expect(first.sender.displayName).toBe('Alice Walker');
      expect(first.sender.profileImageUrl).toBeDefined();

      // Verify receipt statuses
      expect(messages[0].status).toBe('read');
      expect(messages[1].status).toBe('read');
      expect(messages[2].status).toBe('delivered');
      expect(messages[2].isRead).toBe(false);
      expect(messages[2].isDelivered).toBe(true);

      // Verify absence of forbidden duplicate aliases
      expect(first).not.toHaveProperty('chatId');
      expect(first).not.toHaveProperty('message_id');
      expect(first).not.toHaveProperty('created_at');
    });

    it('should support cursor-based pagination using ISO timestamp in before query', async () => {
      // Fetch messages before msg3 timestamp
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages?before=${msg3.createdAt.toISOString()}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const { messages } = res.body.data;
      expect(messages.length).toBe(2);
      expect(messages.map((m: any) => m.id)).toEqual([msg1.id, msg2.id]);
    });

    it('should support cursor-based pagination using message UUID in before query', async () => {
      // Fetch messages before msg2
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages?before=${msg2.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const { messages } = res.body.data;
      expect(messages.length).toBe(1);
      expect(messages[0].id).toBe(msg1.id);
    });

    it('should respect Delete for Me history clearing cutoff', async () => {
      // User A executes Delete for Me
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      // Before new message arrives, history returns 404 for User A
      const resBefore = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resBefore.status).toBe(404);

      // Wait 10ms and User B sends a new message via API
      await new Promise((r) => setTimeout(r, 20));
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'New message after clearing' });
      const newMsgId = sendRes.body.data.id || sendRes.body.data.message?.id;

      // User A only sees the new message!
      const resAfter = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(resAfter.status).toBe(200);
      expect(resAfter.body.data.messages.length).toBe(1);
      expect(resAfter.body.data.messages[0].id).toBe(newMsgId);
    });
  });

  describe('3. Pinned Messages — Pinning, Unpinning, and Fetching Pinned Messages', () => {
    it('should pin a message and retrieve it via GET /api/v1/chats/:conversationId/messages/pinned', async () => {
      // 1. Pin msg2
      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg2.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body.success).toBe(true);
      expect(pinRes.body.data.conversationId).toBe(convAB.id);
      expect(pinRes.body.data.messageId).toBe(msg2.id);
      expect(pinRes.body.data.isPinned).toBe(true);
      expect(pinRes.body.data.pinnedAt).toBeDefined();
      expect(pinRes.body.data.pinnedBy).toBe(userA.id);

      // 2. Fetch pinned messages
      const getRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.messages.length).toBe(1);

      const pinnedMsg = getRes.body.data.messages[0];
      expect(pinnedMsg.id).toBe(msg2.id);
      expect(pinnedMsg.isPinned).toBe(true);
      expect(pinnedMsg.content).toBe('Sure, how about 6pm at Central Perk?');
      expect(pinnedMsg.pinnedBy).toBe(userA.id);
      expect(pinnedMsg.sender.displayName).toBe('Bob Smith');

      // 3. Verify normal message history reflects isPinned: true for msg2
      const historyRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      const msg2InHistory = historyRes.body.data.messages.find((m: any) => m.id === msg2.id);
      expect(msg2InHistory.isPinned).toBe(true);
      const msg1InHistory = historyRes.body.data.messages.find((m: any) => m.id === msg1.id);
      expect(msg1InHistory.isPinned).toBe(false);
    });

    it('should unpin a pinned message successfully and idempotently', async () => {
      // Pin msg1 first
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Unpin msg1
      const unpinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(unpinRes.status).toBe(200);
      expect(unpinRes.body.data.isPinned).toBe(false);

      // Repeat unpinning (idempotent)
      const repeatRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.data.isPinned).toBe(false);

      // Pinned list is now empty
      const listRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listRes.body.data.messages.length).toBe(0);
    });

    it('should support pinned messages fetch via alias /pinned-messages route and ?pinned=true query', async () => {
      // Pin msg3
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg3.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Test alias endpoint: GET /api/v1/chats/:conversationId/pinned-messages
      const aliasRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/pinned-messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.data.messages.length).toBe(1);
      expect(aliasRes.body.data.messages[0].id).toBe(msg3.id);

      // Test query parameter: GET /api/v1/chats/:conversationId/messages?pinned=true
      const queryRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages?pinned=true`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(queryRes.status).toBe(200);
      expect(queryRes.body.data.messages.length).toBe(1);
      expect(queryRes.body.data.messages[0].id).toBe(msg3.id);
    });

    it('should support message pinning via POST /api/v1/chats/:conversationId/pin with messageId', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ messageId: msg1.id, isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.data.messageId).toBe(msg1.id);
      expect(res.body.data.isPinned).toBe(true);

      const checkRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(checkRes.body.data.messages[0].id).toBe(msg1.id);
    });
  });

  describe('4. Error Handling, Validation, and Pin Limits', () => {
    it('should return 404 when pinning a nonexistent message ID', async () => {
      const nonExistentUuid = '00000000-0000-4000-a000-000000000000';
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${nonExistentUuid}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/message not found/i);
    });

    it('should return 404 when pinning a message belonging to a different conversation', async () => {
      // Create message in convAC
      const msgInConvAC = await ChatMessage.create({
        conversationId: convAC.id,
        senderId: userA.id,
        recipientId: userC.id,
        content: 'Different conversation message',
        messageType: 'text',
      });

      // Attempt to pin msgInConvAC under convAB
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msgInConvAC.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/message not found in this conversation/i);
    });

    it('should reject pinning when pin limit is exceeded with 400 PIN_LIMIT_EXCEEDED', async () => {
      // Seed 50 pins for userA in convAB
      const now = new Date();
      const dummyMessagesData = Array.from({ length: 50 }, (_, i) => ({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: `Bulk message ${i}`,
        messageType: 'text' as const,
      }));
      const createdMessages = await ChatMessage.bulkCreate(dummyMessagesData);

      const bulkPins = createdMessages.map((msg) => ({
        conversationId: convAB.id,
        messageId: msg.id,
        userId: userA.id,
        pinnedBy: userA.id,
        createdAt: now,
        updatedAt: now,
      }));
      await ChatMessagePin.bulkCreate(bulkPins);

      // Attempt to pin 51st message (msg1)
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/maximum pinned messages limit reached/i);
    });

    it('should handle concurrent pin/unpin requests safely', async () => {
      const results = await Promise.all([
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ isPinned: true }),
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ isPinned: true }),
      ]);

      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      const count = await ChatMessagePin.count({
        where: { conversationId: convAB.id, messageId: msg1.id, userId: userA.id },
      });
      expect(count).toBe(1);
    });
  });

  describe('5. Socket.IO Real-Time Synchronization', () => {
    it('should emit chat:message_pinned and chat:message_unpinned to authorized user room on pin/unpin', async () => {
      const clientSocketA = createClientSocket({
        auth: { token: tokenA },
      });

      await new Promise<void>((resolve, reject) => {
        clientSocketA.on('connect', () => resolve());
        clientSocketA.on('connect_error', reject);
      });

      const pinnedPromise = new Promise<any>((resolve) => {
        clientSocketA.on('chat:message_pinned', (data) => resolve(data));
      });

      // Pin msg1 via REST API
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const pinEventData = await pinnedPromise;
      expect(pinEventData.conversationId).toBe(convAB.id);
      expect(pinEventData.messageId).toBe(msg1.id);
      expect(pinEventData.isPinned).toBe(true);
      expect(pinEventData.pinned).toBe(true);
      expect(pinEventData.pinnedBy).toBe(userA.id);
      expect(pinEventData.message.id).toBe(msg1.id);
      expect(pinEventData.message.content).toBe('Hey Bob, let us catch up!');
      expect(pinEventData.message.isPinned).toBe(true);

      const unpinnedPromise = new Promise<any>((resolve) => {
        clientSocketA.on('chat:message_unpinned', (data) => resolve(data));
      });

      // Unpin msg1 via REST API
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      const unpinEventData = await unpinnedPromise;
      expect(unpinEventData.conversationId).toBe(convAB.id);
      expect(unpinEventData.messageId).toBe(msg1.id);
      expect(unpinEventData.isPinned).toBe(false);
      expect(unpinEventData.pinned).toBe(false);
    });

    it('should push chat:message:pin:updated to both participants while the chat stays open', async () => {
      const clientSocketA = createClientSocket({ auth: { token: tokenA } });
      const clientSocketB = createClientSocket({ auth: { token: tokenB } });

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          clientSocketA.on('connect', () => resolve());
          clientSocketA.on('connect_error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          clientSocketB.on('connect', () => resolve());
          clientSocketB.on('connect_error', reject);
        }),
      ]);

      await new Promise<void>((resolve) => {
        clientSocketA.emit('conversation:join', { conversationId: convAB.id }, () => resolve());
      });
      await new Promise<void>((resolve) => {
        clientSocketB.emit('conversation:join', { conversationId: convAB.id }, () => resolve());
      });

      const waitForPinState = (socket: ClientSocket, pinned: boolean) =>
        new Promise<any>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for chat:message:pin:updated pinned=${pinned}`)),
            8000
          );
          const handler = (data: any) => {
            if (!data || data.pinned !== pinned || data.messageId !== msg2.id) return;
            clearTimeout(timer);
            socket.off('chat:message:pin:updated', handler);
            resolve(data);
          };
          socket.on('chat:message:pin:updated', handler);
        });

      const pinA = waitForPinState(clientSocketA, true);
      const pinB = waitForPinState(clientSocketB, true);

      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg2.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body.data.message.id).toBe(msg2.id);
      expect(pinRes.body.data.message.content).toBe('Sure, how about 6pm at Central Perk?');

      const [eventA, eventB] = await Promise.all([pinA, pinB]);

      for (const event of [eventA, eventB]) {
        expect(event.conversationId).toBe(convAB.id);
        expect(event.messageId).toBe(msg2.id);
        expect(event.pinned).toBe(true);
        expect(event.isPinned).toBe(true);
        expect(event.pinnedBy).toBe(userA.id);
        expect(event.message.id).toBe(msg2.id);
        expect(event.message.content).toBe('Sure, how about 6pm at Central Perk?');
        expect(event.message.isPinned).toBe(true);
      }

      const historyB = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);
      const msg2ForB = historyB.body.data.messages.find((m: any) => m.id === msg2.id);
      expect(msg2ForB.isPinned).toBe(true);

      const unpinA = waitForPinState(clientSocketA, false);
      const unpinB = waitForPinState(clientSocketB, false);

      const unpinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg2.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });
      expect(unpinRes.status).toBe(200);

      const [unpinEventA, unpinEventB] = await Promise.all([unpinA, unpinB]);
      expect(unpinEventA.pinned).toBe(false);
      expect(unpinEventA.messageId).toBe(msg2.id);
      expect(unpinEventB.pinned).toBe(false);
      expect(unpinEventB.message).toBeNull();
    });

    it('should support pin action over Socket.IO via chat:pin_message event', async () => {
      const clientSocketA = createClientSocket({
        auth: { token: tokenA },
      });

      await new Promise<void>((resolve, reject) => {
        clientSocketA.on('connect', () => resolve());
        clientSocketA.on('connect_error', reject);
      });

      const ackResponse = await new Promise<any>((resolve) => {
        clientSocketA.emit(
          'chat:pin_message',
          {
            conversationId: convAB.id,
            messageId: msg2.id,
            isPinned: true,
          },
          (res: any) => resolve(res)
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data.isPinned).toBe(true);
      expect(ackResponse.data.messageId).toBe(msg2.id);

      // Verify persistence in database
      const pinRecord = await ChatMessagePin.findOne({
        where: { conversationId: convAB.id, messageId: msg2.id, userId: userA.id },
      });
      expect(pinRecord).not.toBeNull();
    });
  });
});
