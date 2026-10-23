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

describe('Conversation Archive & Deletion (REST APIs + Socket.IO Delivery)', () => {
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
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_w',
      email: 'usera@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Alice Wonder',
      gender: 'female',
      dateOfBirth: '1998-05-12',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob_b',
      email: 'userb@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Bob Builder',
      gender: 'male',
      dateOfBirth: '1996-08-20',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'charlie_b',
      email: 'userc@flirttime.test',
      password: 'HashedPassword123!',
      fullName: 'Charlie Brown',
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
      lastMessage: 'Hey Bob!',
      lastMessageAt: new Date(Date.now() - 5000),
    });

    const [ac1, ac2] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: ac1,
      user2Id: ac2,
      lastMessage: 'Hey Charlie!',
      lastMessageAt: new Date(Date.now() - 2000),
    });

    // Seed messages
    await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Hey Bob!',
      messageType: 'text',
      isRead: false,
    });

    await ChatMessage.create({
      conversationId: convAC.id,
      senderId: userA.id,
      recipientId: userC.id,
      content: 'Hey Charlie!',
      messageType: 'text',
      isRead: false,
    });
  });

  describe('1. Authentication and Input Validation', () => {
    it('should reject unauthenticated archive request with 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .send({ isArchived: true });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated deletion request with 401', async () => {
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject archive request with invalid UUID with 400', async () => {
      const res = await request(app)
        .patch('/api/v1/chats/not-a-uuid/archive')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject archive request missing isArchived with 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject deletion request with invalid deleteType with 400', async () => {
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'invalid_type' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant from archiving a conversation with 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ isArchived: true });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant from deleting a conversation with 404', async () => {
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Conversation Archive & Unarchive API', () => {
    it('should archive conversation for requesting user and hide from default chat list', async () => {
      // User A archives convAB
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Conversation archived successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        isArchived: true,
      });

      // User A's default list should NOT include convAB
      const listA = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(listA.status).toBe(200);
      const convIdsA = listA.body.data.conversations.map((c: any) => c.conversationId);
      expect(convIdsA).not.toContain(convAB.id);
      expect(convIdsA).toContain(convAC.id);

      // User A's archived list (archived=true) SHOULD include convAB
      const archivedListA = await request(app)
        .get('/api/v1/chats?archived=true')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(archivedListA.status).toBe(200);
      const archivedIdsA = archivedListA.body.data.conversations.map((c: any) => c.conversationId);
      expect(archivedIdsA).toContain(convAB.id);
      expect(archivedIdsA).not.toContain(convAC.id);
      expect(archivedListA.body.data.conversations[0].isArchived).toBe(true);

      // Other participant (User B) default list is completely unaffected
      const listB = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);

      expect(listB.status).toBe(200);
      const convIdsB = listB.body.data.conversations.map((c: any) => c.conversationId);
      expect(convIdsB).toContain(convAB.id);
      expect(listB.body.data.conversations[0].isArchived).toBe(false);
    });

    it('should support canonical /chat/conversations/:id/archive alias endpoint', async () => {
      const res = await request(app)
        .patch(`/api/v1/chat/conversations/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isArchived).toBe(true);
    });

    it('should unpin a pinned conversation when archived', async () => {
      // Pin convAB first
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      // Archive convAB
      await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      // Verify pin was removed
      const pin = await ConversationPin.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(pin).toBeNull();
    });

    it('should unarchive conversation and restore to default chat list', async () => {
      // Archive first
      await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      // Now unarchive
      const res = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: false });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Conversation unarchived successfully');
      expect(res.body.data.isArchived).toBe(false);

      // Verify it appears in default list
      const listA = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      const convIdsA = listA.body.data.conversations.map((c: any) => c.conversationId);
      expect(convIdsA).toContain(convAB.id);
    });

    it('should be idempotent on repeated archive calls without duplicate writes', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/archive`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true });

      expect(res2.status).toBe(200);
      expect(res2.body.data.isArchived).toBe(true);

      const userStates = await ConversationUserState.findAll({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(userStates.length).toBe(1);
    });
  });

  describe('3. Delete for Me API', () => {
    it('should hide conversation for requesting user while keeping it intact for other participants', async () => {
      // User A deletes convAB for me
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Conversation deleted successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        deleteType: 'me',
      });

      // User A chat list should not have convAB
      const listA = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      const idsA = listA.body.data.conversations.map((c: any) => c.conversationId);
      expect(idsA).not.toContain(convAB.id);

      // User A conversation detail returns 404
      const detailA = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(detailA.status).toBe(404);

      // User A message history returns 404
      const historyA = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(historyA.status).toBe(404);

      // User B is UNCHANGED: chat list, detail, and messages are intact
      const listB = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);
      const idsB = listB.body.data.conversations.map((c: any) => c.conversationId);
      expect(idsB).toContain(convAB.id);

      const detailB = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(detailB.status).toBe(200);

      const historyB = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(historyB.status).toBe(200);
      expect(historyB.body.data.messages.length).toBeGreaterThan(0);
    });

    it('should support canonical /chat/conversations/:id endpoint for Delete for Me', async () => {
      const res = await request(app)
        .delete(`/api/v1/chat/conversations/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleteType).toBe('me');
    });

    it('should restore conversation for new messages but keep prior messages hidden for user who deleted', async () => {
      // User A deletes for me
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      // Wait a slight tick so timestamp is distinct
      await new Promise((r) => setTimeout(r, 50));

      // User B sends a NEW message to User A
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Are you there Alice?' });

      expect(sendRes.status).toBe(201);

      // Conversation should reappear in User A's chat list!
      const listA = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      const idsA = listA.body.data.conversations.map((c: any) => c.conversationId);
      expect(idsA).toContain(convAB.id);

      // User A's message history should ONLY show messages sent after deletion!
      const historyA = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(historyA.status).toBe(200);
      expect(historyA.body.data.messages.length).toBe(1);
      expect(historyA.body.data.messages[0].content).toBe('Are you there Alice?');

      // User B's history should show both the old and new messages
      const historyB = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(historyB.status).toBe(200);
      expect(historyB.body.data.messages.length).toBe(2);
    });

    it('should be safe and idempotent on repeated Delete for Me requests', async () => {
      const res1 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.deleteType).toBe('me');
    });
  });

  describe('4. Delete for Everyone API', () => {
    it('should mark conversation deleted for everyone and hide for all participants', async () => {
      // User A executes Delete for Everyone
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Conversation deleted for everyone successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        deleteType: 'everyone',
      });

      // Neither User A nor User B can see the conversation in chat list
      const listA = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(listA.body.data.conversations.map((c: any) => c.conversationId)).not.toContain(convAB.id);

      const listB = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`);
      expect(listB.body.data.conversations.map((c: any) => c.conversationId)).not.toContain(convAB.id);

      // Both users receive 404 when querying details or message history
      const detailA = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(detailA.status).toBe(404);

      const detailB = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(detailB.status).toBe(404);

      // A later send from a participant reopens the thread
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Testing send on deleted' });
      expect(sendRes.status).toBe(201);
      expect(sendRes.body.success).toBe(true);

      const convDb = await Conversation.findByPk(convAB.id);
      expect(convDb).not.toBeNull();
      expect(convDb!.isDeletedForEveryone).toBe(false);
      expect(convDb!.deletedForEveryoneBy).toBeNull();
    });

    it('should be safe and idempotent on repeated Delete for Everyone requests', async () => {
      const res1 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ deleteType: 'everyone' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.deleteType).toBe('everyone');
    });
  });

  describe('5. Service Layer Direct Invocations (Identical Logic for Socket.IO & REST)', () => {
    it('should archive and unarchive correctly via chatService', async () => {
      const result = await chatService.archiveConversation(userA.id, convAB.id, true);
      expect(result).toEqual({ conversationId: convAB.id, isArchived: true });

      const state = await ConversationUserState.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(state?.isArchived).toBe(true);
      expect(state?.archivedAt).not.toBeNull();

      const unarchiveResult = await chatService.archiveConversation(userA.id, convAB.id, false);
      expect(unarchiveResult).toEqual({ conversationId: convAB.id, isArchived: false });
    });

    it('should delete for me via chatService and set clearedAt threshold', async () => {
      const result = await chatService.deleteConversation(userA.id, convAB.id, 'me');
      expect(result).toEqual({ conversationId: convAB.id, deleteType: 'me' });

      const state = await ConversationUserState.findOne({
        where: { conversationId: convAB.id, userId: userA.id },
      });
      expect(state?.isDeleted).toBe(true);
      expect(state?.clearedAt).not.toBeNull();
    });

    it('should delete for everyone via chatService and update both participants', async () => {
      const result = await chatService.deleteConversation(userA.id, convAB.id, 'everyone');
      expect(result).toEqual({ conversationId: convAB.id, deleteType: 'everyone' });

      const conv = await Conversation.findByPk(convAB.id);
      expect(conv?.isDeletedForEveryone).toBe(true);

      const states = await ConversationUserState.findAll({
        where: { conversationId: convAB.id },
      });
      expect(states.length).toBe(2);
      expect(states.every((s) => s.isDeleted)).toBe(true);
    });
  });

  describe('6. Socket.IO Real-Time Events (Archive & Deletion)', () => {
    let clientA1: ClientSocket;
    let clientA2: ClientSocket;
    let clientB: ClientSocket;

    beforeEach(async () => {
      // Connect Device 1 for User A
      clientA1 = createClientSocket({ auth: { token: tokenA } });
      // Connect Device 2 for User A (multi-device)
      clientA2 = createClientSocket({ auth: { token: tokenA } });
      // Connect Device for User B
      clientB = createClientSocket({ auth: { token: tokenB } });

      await Promise.all([
        new Promise<void>((resolve) => clientA1.on('connect', resolve)),
        new Promise<void>((resolve) => clientA2.on('connect', resolve)),
        new Promise<void>((resolve) => clientB.on('connect', resolve)),
      ]);
    });

    afterEach(() => {
      if (clientA1.connected) clientA1.disconnect();
      if (clientA2.connected) clientA2.disconnect();
      if (clientB.connected) clientB.disconnect();
    });

    it('should handle conversation:archive via socket and synchronize across user devices only', async () => {
      let device2Received: any = null;
      let userBReceived: any = null;

      clientA2.on('conversation:archived' as any, (data: any) => {
        device2Received = data;
      });

      clientB.on('conversation:archived' as any, (data: any) => {
        userBReceived = data;
      });

      // User A device 1 emits conversation:archive
      const ackResponse: any = await new Promise((resolve) => {
        clientA1.emit(
          'conversation:archive' as any,
          { conversationId: convAB.id, isArchived: true },
          resolve
        );
      });

      expect(ackResponse).toEqual({
        success: true,
        data: { conversationId: convAB.id, isArchived: true },
      });

      // Wait a moment for socket propagation
      await new Promise((r) => setTimeout(r, 100));

      // User A device 2 received sync event
      expect(device2Received).toEqual({
        conversationId: convAB.id,
        isArchived: true,
      });

      // Participant User B did NOT receive private archive event
      expect(userBReceived).toBeNull();
    });

    it('should handle conversation:delete for me via socket and notify only requesting user devices', async () => {
      let device2Received: any = null;
      let userBReceived: any = null;

      clientA2.on('conversation:deleted' as any, (data: any) => {
        device2Received = data;
      });

      clientB.on('conversation:deleted' as any, (data: any) => {
        userBReceived = data;
      });

      // User A device 1 emits conversation:delete with deleteType: 'me'
      const ackResponse: any = await new Promise((resolve) => {
        clientA1.emit(
          'conversation:delete' as any,
          { conversationId: convAB.id, deleteType: 'me' },
          resolve
        );
      });

      expect(ackResponse).toEqual({
        success: true,
        data: { conversationId: convAB.id, deleteType: 'me' },
      });

      await new Promise((r) => setTimeout(r, 100));

      // User A device 2 received sync event
      expect(device2Received).toEqual({
        conversationId: convAB.id,
        deleteType: 'me',
      });

      // User B did NOT receive private deletion event
      expect(userBReceived).toBeNull();
    });

    it('should handle conversation:delete for everyone via socket and notify all participants', async () => {
      let device2Received: any = null;
      let userBReceived: any = null;

      clientA2.on('conversation:deleted' as any, (data: any) => {
        device2Received = data;
      });

      clientB.on('conversation:deleted' as any, (data: any) => {
        userBReceived = data;
      });

      // User A device 1 emits conversation:delete with deleteType: 'everyone'
      const ackResponse: any = await new Promise((resolve) => {
        clientA1.emit(
          'conversation:delete' as any,
          { conversationId: convAB.id, deleteType: 'everyone' },
          resolve
        );
      });

      expect(ackResponse).toEqual({
        success: true,
        data: { conversationId: convAB.id, deleteType: 'everyone' },
      });

      await new Promise((r) => setTimeout(r, 100));

      // Both User A (other devices) and User B received event
      expect(device2Received).toEqual({
        conversationId: convAB.id,
        deleteType: 'everyone',
      });

      expect(userBReceived).toEqual({
        conversationId: convAB.id,
        deleteType: 'everyone',
      });
    });

    it('should reject malformed socket payloads gracefully with error acknowledgement', async () => {
      // Missing isArchived
      const ackArchive: any = await new Promise((resolve) => {
        clientA1.emit(
          'conversation:archive' as any,
          { conversationId: convAB.id },
          resolve
        );
      });
      expect(ackArchive.success).toBe(false);
      expect(ackArchive.error).toBeDefined();

      // Invalid deleteType
      const ackDelete: any = await new Promise((resolve) => {
        clientA1.emit(
          'conversation:delete' as any,
          { conversationId: convAB.id, deleteType: 'invalid' },
          resolve
        );
      });
      expect(ackDelete.success).toBe(false);
      expect(ackDelete.error).toBeDefined();
    });
  });
});

