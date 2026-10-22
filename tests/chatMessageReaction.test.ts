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
  ChatMessageReaction,
  ConversationUserState,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Message Reaction API & Real-Time Socket.IO Synchronization', () => {
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
  let msg1: ChatMessage;
  let msg2: ChatMessage;

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

    await ChatMessageReaction.destroy({ where: {}, force: true });
    await ChatMessage.destroy({ where: {}, force: true });
    await ConversationUserState.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await UserBlock.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    userA = await User.create({
      username: 'user_a_reaction',
      email: 'alice.reaction@test.com',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      lastName: 'Walker',
      profilePicture: 'photos/alice.jpg',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'user_b_reaction',
      email: 'bob.reaction@test.com',
      fullName: 'Bob Martinez',
      firstName: 'Bob',
      lastName: 'Martinez',
      profilePicture: 'photos/bob.jpg',
      isActive: true,
      role: 'user',
    });

    userC = await User.create({
      username: 'user_c_reaction',
      email: 'charlie.reaction@test.com',
      fullName: 'Charlie Outsider',
      firstName: 'Charlie',
      lastName: 'Outsider',
      profilePicture: null,
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
      lastMessage: 'Hello Bob',
      lastMessageAt: new Date(),
    });

    const [uA, uC] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: uA,
      user2Id: uC,
      lastMessage: 'Hello Charlie',
      lastMessageAt: new Date(),
    });

    msg1 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userA.id,
      recipientId: userB.id,
      content: 'Hey Bob, how are you doing?',
      messageType: 'text',
      isDelivered: true,
      isRead: false,
    });

    msg2 = await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userB.id,
      recipientId: userA.id,
      content: 'Doing awesome, Alice!',
      messageType: 'text',
      isDelivered: true,
      isRead: false,
    });
  });

  describe('1. Authentication & Authorization Security Guards', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid token with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', 'Bearer invalid.token.value')
        .send({ emoji: '❤️' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should prevent non-participant user from reacting with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not a participant/i);
    });

    it('should prevent cross-conversation access (message in convAB, url has convAC) with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAC.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to this conversation/i);
    });

    it('should prevent reacting if participants are mutually blocked with 403', async () => {
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: userB.id,
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Input Validation & Error Handling', () => {
    it('should reject empty emoji with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should allow any custom emoji without restricted list validation', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '🎉' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe('added');
      expect(res.body.data.reaction.emoji).toBe('🎉');
    });

    it('should reject non-uuid conversationId with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/not-a-uuid/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-uuid messageId with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/not-a-uuid/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when reacting to a non-existent conversation', async () => {
      const nonExistentConvId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .post(`/api/v1/chats/${nonExistentConvId}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 404 when reacting to a non-existent message', async () => {
      const nonExistentMsgId = '00000000-0000-0000-0000-000000000099';
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${nonExistentMsgId}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 when attempting to react to a message deleted for everyone', async () => {
      const deletedMsg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'This will be deleted',
        messageType: 'text',
        metadata: JSON.stringify({ isDeletedForEveryone: true }),
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${deletedMsg.id}/reactions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/deleted/i);
    });

    it('should return 400 when attempting to react to a message deleted for requesting user', async () => {
      const userDeletedMsg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Deleted for user A',
        messageType: 'text',
        metadata: JSON.stringify({ deletedForUserIds: [userA.id] }),
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${userDeletedMsg.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Core Reaction Behavior: Add, Change, Same-Emoji Toggle & Multi-User Reactions', () => {
    it('should add a new reaction successfully (action: added)', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Reaction added successfully');
      expect(res.body.data.action).toBe('added');
      expect(res.body.data.messageId).toBe(msg1.id);
      expect(res.body.data.conversationId).toBe(convAB.id);
      expect(res.body.data.emoji).toBe('❤️');
      expect(res.body.data.reaction).toBeDefined();
      expect(res.body.data.reaction.emoji).toBe('❤️');
      expect(res.body.data.reaction.userId).toBe(userA.id);
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.id).toBe(userA.id);
      expect(res.body.data.reactionCounts).toEqual({
        '❤️': 1,
        total: 1,
      });

      // Verify DB persistence
      const count = await ChatMessageReaction.count({
        where: { messageId: msg1.id, userId: userA.id },
      });
      expect(count).toBe(1);
    });

    it('should update an existing reaction to a different emoji (action: updated)', async () => {
      // First add ❤️
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      // Change to 🔥
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '🔥' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Reaction updated successfully');
      expect(res.body.data.action).toBe('updated');
      expect(res.body.data.emoji).toBe('🔥');
      expect(res.body.data.reaction.emoji).toBe('🔥');
      expect(res.body.data.reactionCounts).toEqual({
        '🔥': 1,
        total: 1,
      });

      // Only one active reaction per user per message
      const totalRows = await ChatMessageReaction.findAll({
        where: { messageId: msg1.id, userId: userA.id },
      });
      expect(totalRows.length).toBe(1);
      expect(totalRows[0].emoji).toBe('🔥');
    });

    it('should remove the reaction when selecting the same emoji again (same-emoji toggle, action: removed)', async () => {
      // Add ❤️
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      // Send ❤️ again to toggle off
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Reaction removed successfully');
      expect(res.body.data.action).toBe('removed');
      expect(res.body.data.emoji).toBeNull();
      expect(res.body.data.reaction).toBeNull();
      expect(res.body.data.reactionCounts).toEqual({
        total: 0,
      });

      // Verify removed from DB
      const count = await ChatMessageReaction.count({
        where: { messageId: msg1.id, userId: userA.id },
      });
      expect(count).toBe(0);
    });

    it('should support text emoji aliases like "heart" and "fire"', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: 'heart' });

      expect(res.status).toBe(200);
      expect(res.body.data.emoji).toBe('❤️');

      // Update with alias "like"
      const resUpdate = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: 'like' });

      expect(resUpdate.status).toBe(200);
      expect(resUpdate.body.data.action).toBe('updated');
      expect(resUpdate.body.data.emoji).toBe('👍');
    });

    it('should support both participants reacting independently and calculate aggregated counts', async () => {
      // User A reacts with ❤️
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      // User B reacts with ❤️
      const resB = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ emoji: '❤️' });

      expect(resB.body.data.reactionCounts).toEqual({
        '❤️': 2,
        total: 2,
      });

      // User B updates to 🔥
      const resBUpdate = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ emoji: '🔥' });

      expect(resBUpdate.body.data.reactionCounts).toEqual({
        '❤️': 1,
        '🔥': 1,
        total: 2,
      });

      // User A toggles off ❤️
      const resAToggle = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(resAToggle.body.data.action).toBe('removed');
      expect(resAToggle.body.data.reactionCounts).toEqual({
        '🔥': 1,
        total: 1,
      });
    });
  });

  describe('4. Concurrency Safety & DB Unique Constraint', () => {
    it('should safely handle concurrent simultaneous reaction requests without duplicates', async () => {
      // Send 2 concurrent reaction requests for User A on msg1 with different emojis
      const promises = [
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ emoji: '❤️' }),
        request(app)
          .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ emoji: '🔥' }),
      ];

      const results = await Promise.all(promises);
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      // Exact count for User A on msg1 in database must be exactly 1, never > 1
      const count = await ChatMessageReaction.count({
        where: { messageId: msg1.id, userId: userA.id },
      });
      expect(count).toBe(1);
    });
  });

  describe('5. Integration with Message History (GET /api/v1/chats/:conversationId/messages)', () => {
    it('should include reactions, aggregated counts, and myReaction in message list', async () => {
      // User A reacts with ❤️ on msg1
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      // User B reacts with 👍 on msg1
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ emoji: '👍' });

      // Fetch messages as User A
      const resA = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(resA.status).toBe(200);
      const foundMsg1A = resA.body.data.messages.find((m: any) => m.id === msg1.id);
      expect(foundMsg1A).toBeDefined();
      expect(foundMsg1A.myReaction).toBe('❤️');
      expect(foundMsg1A.reactionCounts).toEqual({
        '❤️': 1,
        '👍': 1,
        total: 2,
      });
      expect(foundMsg1A.reactions.length).toBe(2);

      // Fetch messages as User B
      const resB = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      const foundMsg1B = resB.body.data.messages.find((m: any) => m.id === msg1.id);
      expect(foundMsg1B).toBeDefined();
      expect(foundMsg1B.myReaction).toBe('👍');
      expect(foundMsg1B.reactionCounts).toEqual({
        '❤️': 1,
        '👍': 1,
        total: 2,
      });
    });
  });

  describe('6. Socket.IO Real-Time Synchronization', () => {
    let socketA: ClientSocket;
    let socketB: ClientSocket;

    beforeEach(async () => {
      socketA = createClientSocket({
        auth: { token: tokenA },
      });
      socketB = createClientSocket({
        auth: { token: tokenB },
      });

      await Promise.all([
        new Promise<void>((resolve) => socketA.on('connect', resolve)),
        new Promise<void>((resolve) => socketB.on('connect', resolve)),
      ]);
    });

    it('should broadcast message:reaction:updated to both conversation participants on HTTP reaction', async () => {
      const receivedByA = new Promise<any>((resolve) => {
        socketA.once('message:reaction:updated', (payload) => resolve(payload));
      });
      const receivedByB = new Promise<any>((resolve) => {
        socketB.once('message:reaction:updated', (payload) => resolve(payload));
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      expect(res.status).toBe(200);

      const [eventA, eventB] = await Promise.all([receivedByA, receivedByB]);

      expect(eventA).toMatchObject({
        action: 'added',
        messageId: msg1.id,
        conversationId: convAB.id,
        emoji: '❤️',
        reaction: {
          emoji: '❤️',
          userId: userA.id,
        },
        reactionCounts: {
          '❤️': 1,
          total: 1,
        },
      });

      expect(eventB).toMatchObject({
        action: 'added',
        messageId: msg1.id,
        conversationId: convAB.id,
        emoji: '❤️',
      });
    });

    it('should broadcast message:reaction:updated on reaction toggle-off', async () => {
      // First add ❤️
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      const removePromise = new Promise<any>((resolve) => {
        socketB.once('message:reaction:updated', (payload) => resolve(payload));
      });

      // Remove with same emoji
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '❤️' });

      const eventPayload = await removePromise;
      expect(eventPayload.action).toBe('removed');
      expect(eventPayload.messageId).toBe(msg1.id);
      expect(eventPayload.emoji).toBeNull();
      expect(eventPayload.reaction).toBeNull();
      expect(eventPayload.reactionCounts).toEqual({ total: 0 });
    });

    it('should support reacting directly over Socket.IO via message:reaction event', async () => {
      const updatedPromise = new Promise<any>((resolve) => {
        socketB.once('message:reaction:updated', (payload) => resolve(payload));
      });

      const socketAck = await new Promise<any>((resolve) => {
        socketA.emit(
          'message:reaction',
          {
            conversationId: convAB.id,
            messageId: msg2.id,
            emoji: '🔥',
          },
          (ackResponse: any) => resolve(ackResponse)
        );
      });

      expect(socketAck.success).toBe(true);
      expect(socketAck.data.action).toBe('added');
      expect(socketAck.data.emoji).toBe('🔥');

      const broadcastEvent = await updatedPromise;
      expect(broadcastEvent.action).toBe('added');
      expect(broadcastEvent.messageId).toBe(msg2.id);
      expect(broadcastEvent.emoji).toBe('🔥');
    });

    it('should return error over socket ack when reaction payload is invalid', async () => {
      const socketAck = await new Promise<any>((resolve) => {
        socketA.emit(
          'message:reaction',
          {
            conversationId: convAB.id,
            messageId: msg2.id,
            emoji: 'invalid_emoji_val',
          },
          (ackResponse: any) => resolve(ackResponse)
        );
      });

      expect(socketAck.success).toBe(false);
      expect(socketAck.error).toMatch(/Unsupported reaction emoji/i);
    });

    it('should broadcast chat:message_reaction event to the other user with otherUserReaction and active emoji', async () => {
      const receivedByB = new Promise<any>((resolve) => {
        socketB.once('chat:message_reaction', (payload) => resolve(payload));
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg1.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ reaction: '❤️' });

      expect(res.status).toBe(200);

      const eventB = await receivedByB;
      expect(eventB).toMatchObject({
        action: 'added',
        messageId: msg1.id,
        conversationId: convAB.id,
        emoji: '❤️',
        userId: userA.id,
        otherUserReaction: '❤️',
      });
      expect(Array.isArray(eventB.reactions)).toBe(true);
      expect(eventB.reactions.length).toBe(1);
    });

    it('should ensure the other user sees the reaction on the message when calling GET /messages API', async () => {
      // User A reacts to User B's message (msg2)
      await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg2.id}/reactions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ emoji: '🔥' });

      // User B (the other user / message sender) fetches messages
      const resB = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(resB.status).toBe(200);
      const foundMsg = resB.body.data.messages.find((m: any) => m.id === msg2.id);
      expect(foundMsg).toBeDefined();

      // Verify that User B sees the reaction clearly on other user's reaction / message
      expect(foundMsg.reaction).toBe('🔥');
      expect(foundMsg.emoji).toBe('🔥');
      expect(foundMsg.otherUserReaction).toBe('🔥');
      expect(foundMsg.myReaction).toBeNull();
      expect(foundMsg.reactionCounts).toMatchObject({ '🔥': 1, total: 1 });
      expect(foundMsg.reactions).toHaveLength(1);
      expect(foundMsg.reactions[0].userId).toBe(userA.id);
    });
  });
});
