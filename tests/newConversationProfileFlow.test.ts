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
  ConversationUserState,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';
import { chatService } from '../src/services/chat.service';

describe('Critical Bug Fix: Profile-to-Chat Flow and Conversation Persistence', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

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
    for (const socket of clientSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await ConversationUserState.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice',
      email: 'alice@example.com',
      phone: '+919999900001',
      fullName: 'Alice Smith',
      gender: 'female',
      city: 'Delhi',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'bob',
      email: 'bob@example.com',
      phone: '+919999900002',
      fullName: 'Bob Jones',
      gender: 'male',
      city: 'Mumbai',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'charlie',
      email: 'charlie@example.com',
      phone: '+919999900003',
      fullName: 'Charlie Brown',
      gender: 'male',
      city: 'Bangalore',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
    tokenC = generateToken({ id: userC.id, email: userC.email, role: userC.role });
  });

  it('1. User A opens User B profile: returns a valid conversationId and creates conversation with user state records', async () => {
    const profileRes = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(profileRes.status).toBe(200);
    expect(profileRes.body.success).toBe(true);
    const convId = profileRes.body.data.conversationId;
    expect(convId).toBeDefined();
    expect(typeof convId).toBe('string');
    expect(convId).toMatch(/^[0-9a-fA-F-]{36}$/);

    // Verify conversation row in database
    const conv = await Conversation.findByPk(convId);
    expect(conv).not.toBeNull();
    const sorted = [userA.id, userB.id].sort();
    expect(conv!.user1Id).toBe(sorted[0]);
    expect(conv!.user2Id).toBe(sorted[1]);
    expect(conv!.isDeletedForEveryone).toBe(false);

    // Verify per-user state records
    const states = await ConversationUserState.findAll({ where: { conversationId: convId } });
    expect(states.length).toBe(2);
    for (const state of states) {
      expect(state.isDeleted).toBe(false);
      expect(state.isArchived).toBe(false);
    }
  });

  it('2. User A taps Message via POST /api/v1/chats: accepts recipientId, userId, or targetUserId and returns the same conversation', async () => {
    // Test with recipientId
    const res1 = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientId: userB.id });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    const convId1 = res1.body.data.id;
    expect(convId1).toBeDefined();

    // Test with userId alias (as sent by some mobile screens)
    const res2 = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ userId: userB.id });

    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(convId1);

    // Test with targetUserId alias
    const res3 = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ targetUserId: userB.id });

    expect(res3.status).toBe(200);
    expect(res3.body.data.id).toBe(convId1);
  });

  it('3. Conversation canonical resolution: both permutations (A,B) and (B,A) resolve to the exact same conversation', async () => {
    const { conversation: convAB } = await chatService.getOrCreateOneToOneConversation(userA.id, userB.id);
    const { conversation: convBA, isNew } = await chatService.getOrCreateOneToOneConversation(userB.id, userA.id);

    expect(convAB.id).toBe(convBA.id);
    expect(isNew).toBe(false);

    const totalConvs = await Conversation.count();
    expect(totalConvs).toBe(1);
  });

  it('4. User A sends first message: persisted to PostgreSQL and appears in chat history', async () => {
    // 1. Get profile
    const profileRes = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    const conversationId = profileRes.body.data.conversationId;

    // 2. Send first message via POST /api/v1/chats/:conversationId/messages
    const msgRes = await request(app)
      .post(`/api/v1/chats/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        content: 'Hi Bob, nice to meet you!',
        messageType: 'text',
      });

    expect(msgRes.status).toBe(201);
    expect(msgRes.body.success).toBe(true);
    expect(msgRes.body.data.content).toBe('Hi Bob, nice to meet you!');
    expect(msgRes.body.data.conversationId).toBe(conversationId);

    // 3. Verify in PostgreSQL
    const dbMsg = await ChatMessage.findByPk(msgRes.body.data.id);
    expect(dbMsg).not.toBeNull();
    expect(dbMsg!.content).toBe('Hi Bob, nice to meet you!');
    expect(dbMsg!.senderId).toBe(userA.id);

    // 4. Verify conversation lastMessage and lastMessageAt were updated
    const updatedConv = await Conversation.findByPk(conversationId);
    expect(updatedConv!.lastMessage).toBe('Hi Bob, nice to meet you!');
    expect(updatedConv!.lastMessageAt).not.toBeNull();

    // 5. Query message history
    const historyRes = await request(app)
      .get(`/api/v1/chats/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.messages).toHaveLength(1);
    expect(historyRes.body.data.messages[0].content).toBe('Hi Bob, nice to meet you!');
  });

  it('5. User A navigates back: conversation appears in chat list for both GET /api/v1/chats and GET /api/v1/chat/conversations', async () => {
    // Open profile and send message
    const profileRes = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    const conversationId = profileRes.body.data.conversationId;

    await request(app)
      .post(`/api/v1/chats/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Hello there!', messageType: 'text' });

    // Check GET /api/v1/chats for User A
    const listRes1 = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes1.status).toBe(200);
    expect(listRes1.body.success).toBe(true);
    const chatsA = listRes1.body.data.conversations || [];
    const foundA = chatsA.find((c: any) => c.conversationId === conversationId || c.id === conversationId);
    expect(foundA).toBeDefined();
    expect(foundA.lastMessage.content).toBe('Hello there!');
    expect(foundA.participant.userId).toBe(userB.id);

    // Check GET /api/v1/chat/conversations for User A
    const listRes2 = await request(app)
      .get('/api/v1/chat/conversations')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(listRes2.status).toBe(200);
    const convsA = listRes2.body.data.conversations || listRes2.body.data;
    const foundA2 = (Array.isArray(convsA) ? convsA : []).find((c: any) => c.id === conversationId || c.conversationId === conversationId);
    expect(foundA2).toBeDefined();
  });

  it('6. User A reopens User B profile: receives the exact same conversation ID', async () => {
    const profileRes1 = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    const convId1 = profileRes1.body.data.conversationId;

    const profileRes2 = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(profileRes2.body.data.conversationId).toBe(convId1);
  });

  it('7. User B retrieves the conversation and message with unread count = 1', async () => {
    // A creates conversation and sends message to B
    const profileRes = await request(app)
      .get(`/api/v1/users/${userB.id}/profile`)
      .set('Authorization', `Bearer ${tokenA}`);

    const conversationId = profileRes.body.data.conversationId;

    await request(app)
      .post(`/api/v1/chats/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Hey Bob, checking in!', messageType: 'text' });

    // User B fetches chat list
    const listResB = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(listResB.status).toBe(200);
    const chatsB = listResB.body.data.conversations || [];
    const foundB = chatsB.find((c: any) => c.conversationId === conversationId || c.id === conversationId);
    expect(foundB).toBeDefined();
    expect(foundB.unreadCount).toBe(1);
    expect(foundB.participant.userId).toBe(userA.id);

    // User B fetches messages
    const msgResB = await request(app)
      .get(`/api/v1/chats/${conversationId}/messages`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(msgResB.status).toBe(200);
    expect(msgResB.body.data.messages).toHaveLength(1);
    expect(msgResB.body.data.messages[0].content).toBe('Hey Bob, checking in!');
  });

  it('8. Concurrency safety: concurrent getOrCreateOneToOneConversation calls resolve without duplicate conversation errors', async () => {
    // Run 5 concurrent creations for the same pair
    const promises = Array.from({ length: 5 }).map(() =>
      chatService.getOrCreateOneToOneConversation(userA.id, userB.id)
    );

    const results = await Promise.all(promises);
    const firstId = results[0].conversation.id;

    for (const r of results) {
      expect(r.conversation.id).toBe(firstId);
    }

    const totalInDb = await Conversation.count({
      where: {
        user1Id: [userA.id, userB.id].sort()[0],
        user2Id: [userA.id, userB.id].sort()[1],
      },
    });
    expect(totalInDb).toBe(1);
  });

  it('9. Revival of deleted/archived conversation: sending a message revives and unarchives the conversation', async () => {
    // Create initial conversation
    const { conversation } = await chatService.getOrCreateOneToOneConversation(userA.id, userB.id);

    // Simulate User A archiving the conversation
    await ConversationUserState.update(
      { isArchived: true, archivedAt: new Date() },
      { where: { conversationId: conversation.id, userId: userA.id } }
    );

    // Verify it is archived
    const stateArchived = await ConversationUserState.findOne({
      where: { conversationId: conversation.id, userId: userA.id },
    });
    expect(stateArchived!.isArchived).toBe(true);

    // Send a new message from User A
    const sendRes = await request(app)
      .post(`/api/v1/chats/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ content: 'Bringing back the chat!', messageType: 'text' });

    expect(sendRes.status).toBe(201);

    // Verify unarchived in database
    const stateAfter = await ConversationUserState.findOne({
      where: { conversationId: conversation.id, userId: userA.id },
    });
    expect(stateAfter!.isArchived).toBe(false);

    // Verify conversation is visible in User A's active chat list
    const listRes = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`);

    const chats = listRes.body.data.conversations || [];
    const found = chats.find((c: any) => c.conversationId === conversation.id || c.id === conversation.id);
    expect(found).toBeDefined();
  });

  it('10. Blocked, inactive, and self-chat validations', async () => {
    // Self-chat prohibited
    const selfRes = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientId: userA.id });

    expect(selfRes.status).toBe(400);

    // Blocked user validation
    await UserBlock.create({ userId: userB.id, blockedUserId: userA.id });

    const blockedRes = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientId: userB.id });

    expect(blockedRes.status).toBe(403);

    // Inactive user validation
    await userC.update({ isActive: false });

    const inactiveRes = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipientId: userC.id });

    expect(inactiveRes.status).toBe(404);
  });

  it('11. Direct send message endpoint via POST /api/v1/chats/messages resolves conversation and persists message', async () => {
    // Send message using recipientId directly without pre-creating conversation
    const directRes = await request(app)
      .post('/api/v1/chats/messages')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        recipientId: userB.id,
        content: 'Direct send message test',
        messageType: 'text',
      });

    expect(directRes.status).toBe(201);
    expect(directRes.body.success).toBe(true);
    expect(directRes.body.data.content).toBe('Direct send message test');
    const convId = directRes.body.data.conversationId;
    expect(convId).toBeDefined();

    // Verify it is visible in chat list
    const listRes = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${tokenA}`);

    const chats = listRes.body.data.conversations || [];
    const found = chats.find((c: any) => c.conversationId === convId || c.id === convId);
    expect(found).toBeDefined();
    expect(found.lastMessage.content).toBe('Direct send message test');
  });
});
