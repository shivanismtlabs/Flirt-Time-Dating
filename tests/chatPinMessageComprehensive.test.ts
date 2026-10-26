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
  ConversationUserState,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Comprehensive Pin & Unpin Chat Message — API & Socket', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;
  let convAB: Conversation;
  let msg1: ChatMessage;
  let msg2: ChatMessage;

  const createClientSocket = (options: Parameters<typeof ioClient>[1] = {}): ClientSocket => {
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
      if (socket.connected) socket.disconnect();
    }
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  afterEach(async () => {
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) socket.disconnect();
    }
    await new Promise((r) => setTimeout(r, 100));
  });

  beforeEach(async () => {
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) socket.disconnect();
    }
    await new Promise((r) => setTimeout(r, 100));

    await ChatMessagePin.destroy({ where: {}, force: true });
    await ChatMessage.destroy({ where: {}, force: true });
    await ConversationUserState.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    userA = await User.create({
      username: 'alice',
      email: 'alice@example.com',
      fullName: 'Alice Wonder',
      firstName: 'Alice',
      lastName: 'Wonder',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob',
      email: 'bob@example.com',
      fullName: 'Bob Builder',
      firstName: 'Bob',
      lastName: 'Builder',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, role: 'user' });
    tokenB = generateToken({ id: userB.id, role: 'user' });

    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: 'Hello Bob',
      lastMessageAt: new Date(),
    });

    msg1 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Important meeting at 10 AM',
      messageType: 'text',
      metadata: JSON.stringify({ clientMessageId: 'client-msg-12345' }),
    });

    msg2 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userB.id,
      recipientId: userA.id,
      content: 'Sure, I will be there',
      messageType: 'text',
    });
  });

  describe('1. REST API Pin / Unpin Tests & Response Shape', () => {
    it('pins message via POST /chats/:convId/messages/:msgId/pin and checks response envelope', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/pinned/i);
      expect(res.body.data).toBeDefined();

      const data = res.body.data;
      expect(data.conversationId).toBe(convAB.id);
      expect(data.messageId).toBe(msg1.id);
      expect(data.isPinned).toBe(true);
      expect(data.pinned).toBe(true);
      expect(data.pinnedAt).toBeDefined();
      expect(data.pinnedBy).toBe(userA.id);
      expect(data.message).toBeDefined();
      expect(data.message.id).toBe(msg1.id);
      expect(data.message.isPinned).toBe(true);
      expect(data.message.pinned).toBe(true);
      expect(data.pinnedMessage).toBeDefined();
      expect(data.pinnedMessage.id).toBe(msg1.id);
    });

    it('unpins message when client sends { pinned: false } instead of { isPinned: false }', async () => {
      // First pin it
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Unpin with { pinned: false }
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ pinned: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isPinned).toBe(false);
      expect(res.body.data.pinned).toBe(false);

      const check = await ChatMessagePin.findOne({
        where: { conversationId: convAB.id, messageId: msg1.id, userId: userA.id },
      });
      expect(check).toBeNull();
    });

    it('unpins message when client sends { is_pinned: false }', async () => {
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ is_pinned: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isPinned).toBe(false);
      expect(res.body.data.pinned).toBe(false);
    });

    it('handles string booleans like "false" and "true" gracefully', async () => {
      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: 'true' });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body.data.isPinned).toBe(true);

      const unpinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: 'false' });

      expect(unpinRes.status).toBe(200);
      expect(unpinRes.body.data.isPinned).toBe(false);
    });

    it('supports PUT, DELETE, and /unpin endpoint aliases', async () => {
      // PUT to pin
      const putRes = await request(app)
        .put(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });
      expect(putRes.status).toBe(200);
      expect(putRes.body.data.isPinned).toBe(true);

      // DELETE to unpin
      const delRes = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.data.isPinned).toBe(false);

      // POST to /unpin
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const unpinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/unpin`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(unpinRes.status).toBe(200);
      expect(unpinRes.body.data.isPinned).toBe(false);
    });

    it('supports pinning by clientMessageId', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/client-msg-12345/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.data.messageId).toBe(msg1.id);
      expect(res.body.data.isPinned).toBe(true);
    });

    it('supports /conversations/:convId/messages/:msgId/pin route variation', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/conversations/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(res.status).toBe(200);
      expect(res.body.data.isPinned).toBe(true);
    });

    it('verifies GET /api/v1/chats/:convId/messages and GET /messages/pinned return pinned data', async () => {
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const getRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.pinnedMessage).toBeDefined();
      expect(getRes.body.data.pinnedMessage.id).toBe(msg1.id);
      expect(getRes.body.data.pinnedMessages.length).toBe(1);

      const pinnedRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(pinnedRes.status).toBe(200);
      expect(pinnedRes.body.data.pinnedMessage).toBeDefined();
      expect(pinnedRes.body.data.pinnedMessage.id).toBe(msg1.id);
      expect(pinnedRes.body.data.messages.length).toBe(1);
    });
  });

  describe('2. Socket.IO Pin / Unpin Tests & Response Acks', () => {
    it('supports chat:pin_message with callback returning standard response', async () => {
      const client = createClientSocket({ auth: { token: tokenA } });
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });

      const cbResult: any = await new Promise((resolve) => {
        client.emit(
          'chat:pin_message',
          { conversationId: convAB.id, messageId: msg1.id, isPinned: true },
          (response: any) => resolve(response)
        );
      });

      expect(cbResult.success).toBe(true);
      expect(cbResult.data).toBeDefined();
      expect(cbResult.data.isPinned).toBe(true);
      expect(cbResult.data.pinned).toBe(true);
      expect(cbResult.data.messageId).toBe(msg1.id);
      expect(cbResult.data.pinnedMessage).toBeDefined();
    });

    it('emits chat:pin_message:ack and chat:message:pin:ack when emitted without callback', async () => {
      const client = createClientSocket({ auth: { token: tokenA } });
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });

      const ackPromise = new Promise<any>((resolve) => {
        client.on('chat:pin_message:ack', (ack: any) => resolve(ack));
      });

      client.emit('chat:pin_message', {
        conversationId: convAB.id,
        messageId: msg1.id,
        isPinned: true,
        requestId: 'req-pin-101',
      });

      const ack = await ackPromise;
      expect(ack.success).toBe(true);
      expect(ack.requestId).toBe('req-pin-101');
      expect(ack.data.isPinned).toBe(true);
    });

    it('supports unpin via chat:unpin_message socket event', async () => {
      // First pin via REST
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      const client = createClientSocket({ auth: { token: tokenA } });
      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', reject);
      });

      const cbResult: any = await new Promise((resolve) => {
        client.emit(
          'chat:unpin_message',
          { conversationId: convAB.id, messageId: msg1.id },
          (response: any) => resolve(response)
        );
      });

      expect(cbResult.success).toBe(true);
      expect(cbResult.data.isPinned).toBe(false);
      expect(cbResult.data.pinned).toBe(false);

      const check = await ChatMessagePin.findOne({
        where: { conversationId: convAB.id, messageId: msg1.id, userId: userA.id },
      });
      expect(check).toBeNull();
    });

    it('broadcasts real-time events to other participant with correct response shape', async () => {
      const clientA = createClientSocket({ auth: { token: tokenA } });
      const clientB = createClientSocket({ auth: { token: tokenB } });

      await Promise.all([
        new Promise<void>((res) => clientA.on('connect', () => res())),
        new Promise<void>((res) => clientB.on('connect', () => res())),
      ]);

      const pinEventPromise = new Promise<any>((resolve) => {
        clientB.on('chat:message:pin:updated', (data) => resolve(data));
      });

      // Pin via socket
      clientA.emit('chat:pin_message', {
        conversationId: convAB.id,
        messageId: msg2.id,
        isPinned: true,
      });

      const pinEvent = await pinEventPromise;
      expect(pinEvent.conversationId).toBe(convAB.id);
      expect(pinEvent.messageId).toBe(msg2.id);
      expect(pinEvent.isPinned).toBe(true);
      expect(pinEvent.pinned).toBe(true);
      expect(pinEvent.pinnedBy).toBe(userA.id);
      expect(pinEvent.pinnedAt).toBeDefined();
      expect(pinEvent.message).toBeDefined();
      expect(pinEvent.pinnedMessage).toBeDefined();
      expect(pinEvent.pinnedMessage.id).toBe(msg2.id);
    });
  });
});
