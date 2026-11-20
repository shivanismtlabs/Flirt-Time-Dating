import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
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
import {
  initSocketServer,
  closeSocketServer,
} from '../src/realtime';

describe('Chat Edit Message & Reply Message APIs', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  let userA: User;
  let userB: User;
  let userC: User; // Non-participant
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let convAB: Conversation;
  const clientSockets: ClientSocket[] = [];

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
    initSocketServer(httpServer, {
      pingTimeout: 5000,
      pingInterval: 5000,
    });

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
    await ChatMessagePin.destroy({ where: {} });
    await ChatMessage.destroy({ where: {} });
    await ConversationUserState.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'alice_editor',
      email: 'alice_editor@flirttime.test',
      fullName: 'Alice Editor',
      firstName: 'Alice',
      lastName: 'Editor',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    userB = await User.create({
      username: 'bob_replier',
      email: 'bob_replier@flirttime.test',
      fullName: 'Bob Replier',
      firstName: 'Bob',
      lastName: 'Replier',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    userC = await User.create({
      username: 'charlie_intruder',
      email: 'charlie_intruder@flirttime.test',
      fullName: 'Charlie Intruder',
      firstName: 'Charlie',
      lastName: 'Intruder',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: userA.role });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: userB.role });
    tokenC = generateToken({ id: userC.id, email: userC.email, role: userC.role });

    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: null,
      lastMessageAt: null,
      isDeletedForEveryone: false,
    });
  });

  afterEach(() => {
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) {
        socket.disconnect();
      }
    }
  });

  // ==========================================
  // 1. EDIT MESSAGE REST API TESTS
  // ==========================================
  describe('1. Edit Message REST API (PATCH & PUT /api/v1/chats/:conversationId/messages/:messageId)', () => {
    it('should allow original sender to edit their text message within 15 min window', async () => {
      // 1. Send initial message
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Original message text',
          messageType: 'text',
        });

      expect(sendRes.status).toBe(201);
      const messageId = sendRes.body.data.id;

      // 2. Edit message via PATCH
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Updated edited message text',
        });

      expect(editRes.status).toBe(200);
      expect(editRes.body.success).toBe(true);
      expect(editRes.body.message).toBe('Message edited successfully');
      expect(editRes.body.data.id).toBe(messageId);
      expect(editRes.body.data.content).toBe('Updated edited message text');
      expect(editRes.body.data.isEdited).toBe(true);
      expect(editRes.body.data.editedAt).toBeDefined();

      // 3. Verify message history reflects edit
      const historyRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(historyRes.status).toBe(200);
      const editedMsg = historyRes.body.data.messages.find((m: any) => m.id === messageId);
      expect(editedMsg).toBeDefined();
      expect(editedMsg.content).toBe('Updated edited message text');
      expect(editedMsg.isEdited).toBe(true);
      expect(editedMsg.editedAt).toBeDefined();
    });

    it('should support PUT method for editing message', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Original for PUT test' });

      const messageId = sendRes.body.data.id;

      const editRes = await request(app)
        .put(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Edited with PUT' });

      expect(editRes.status).toBe(200);
      expect(editRes.body.data.content).toBe('Edited with PUT');
      expect(editRes.body.data.isEdited).toBe(true);
    });

    it('should reject editing another user’s message with 403 Forbidden', async () => {
      // User A sends message
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Alice message' });

      const messageId = sendRes.body.data.id;

      // User B attempts to edit User A's message
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Hacked by Bob' });

      expect(editRes.status).toBe(403);
      expect(editRes.body.success).toBe(false);
      expect(editRes.body.message).toMatch(/only edit your own messages/i);
    });

    it('should reject non-participant in conversation with 403 Forbidden', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Alice message' });

      const messageId = sendRes.body.data.id;

      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ content: 'Charlie trying to edit' });

      expect(editRes.status).toBe(403);
      expect(editRes.body.success).toBe(false);
    });

    it('should reject empty or whitespace-only content with 400 Bad Request', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Valid message' });

      const messageId = sendRes.body.data.id;

      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: '   ' });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
    });

    it('should reject oversized content (> 5000 characters) with 400 Bad Request', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Valid message' });

      const messageId = sendRes.body.data.id;

      const hugeContent = 'a'.repeat(5001);
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: hugeContent });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
    });

    it('should reject non-existent message ID with 404 Not Found', async () => {
      const randomUuid = '00000000-0000-4000-8000-000000000001';
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${randomUuid}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'New text' });

      expect(editRes.status).toBe(404);
      expect(editRes.body.success).toBe(false);
    });

    it('should reject editing message that belongs to a different conversation with 400 Bad Request', async () => {
      // Create another conversation for Alice & Charlie
      const [uA, uC] = [userA.id, userC.id].sort();
      const convAC = await Conversation.create({
        user1Id: uA,
        user2Id: uC,
        lastMessage: null,
        lastMessageAt: null,
      });

      // Alice sends message in convAB
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Message in convAB' });

      const messageId = sendRes.body.data.id;

      // Alice tries to edit messageId targeting convAC
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAC.id}/messages/${messageId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Wrong conversation' });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
      expect(editRes.body.message).toMatch(/does not belong to this conversation/i);
    });

    it('should reject editing unsupported message types (e.g. audio or image) with 400 Bad Request', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'https://s3.amazonaws.com/flirttime/audio.mp3',
        messageType: 'audio',
        isRead: false,
      });

      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Trying to edit audio' });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
      expect(editRes.body.message).toMatch(/only text messages can be edited/i);
    });

    it('should reject editing message after 15-minute edit window has expired', async () => {
      // Create message with createdAt 20 minutes ago
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      const oldMsg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Old message from 20 mins ago',
        messageType: 'text',
        isRead: false,
        createdAt: twentyMinsAgo,
        updatedAt: twentyMinsAgo,
      });

      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${oldMsg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Too late to edit' });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
      expect(editRes.body.message).toMatch(/edit window has expired/i);
    });

    it('should handle concurrent edits safely without race conditions', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Concurrent base message' });

      const messageId = sendRes.body.data.id;

      // Fire 3 simultaneous edit requests
      const results = await Promise.all([
        request(app)
          .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ content: 'Concurrent Edit 1' }),
        request(app)
          .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ content: 'Concurrent Edit 2' }),
        request(app)
          .patch(`/api/v1/chats/${convAB.id}/messages/${messageId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ content: 'Concurrent Edit 3' }),
      ]);

      // All requests should succeed with 200
      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Check DB: content must match one of the edits, isEdited must be true
      const finalMsg = await ChatMessage.findByPk(messageId);
      expect(finalMsg).toBeDefined();
      expect(['Concurrent Edit 1', 'Concurrent Edit 2', 'Concurrent Edit 3']).toContain(finalMsg!.content);
      const parsed = JSON.parse(finalMsg!.metadata || '{}');
      expect(parsed.isEdited).toBe(true);
      expect(parsed.editedAt).toBeDefined();
    });
  });

  // ==========================================
  // 2. REPLY MESSAGE REST API TESTS
  // ==========================================
  describe('2. Reply Message REST API (POST /api/v1/chats/:conversationId/messages/:messageId/reply)', () => {
    it('should allow conversation member to reply to an existing message', async () => {
      // User A sends parent message
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'What time are we meeting today?' });

      const parentMsgId = sendRes.body.data.id;

      // User B replies via dedicated reply endpoint
      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${parentMsgId}/reply`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          content: 'How about 7:00 PM at Central Park?',
          messageType: 'text',
        });

      expect(replyRes.status).toBe(201);
      expect(replyRes.body.success).toBe(true);
      expect(replyRes.body.message).toBe('Reply sent successfully');
      expect(replyRes.body.data.content).toBe('How about 7:00 PM at Central Park?');
      expect(replyRes.body.data.replyToMessageId).toBe(parentMsgId);
      expect(replyRes.body.data.replyTo).toBeDefined();
      expect(replyRes.body.data.replyTo.id).toBe(parentMsgId);
      expect(replyRes.body.data.replyTo.senderId).toBe(userA.id);
      expect(replyRes.body.data.replyTo.senderName).toBe('Alice Editor');
      expect(replyRes.body.data.replyTo.content).toBe('What time are we meeting today?');
      expect(replyRes.body.data.replyTo.messageType).toBe('text');

      // Verify message history includes reply reference
      const historyRes = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(historyRes.status).toBe(200);
      const historyReply = historyRes.body.data.messages.find((m: any) => m.id === replyRes.body.data.id);
      expect(historyReply).toBeDefined();
      expect(historyReply.replyToMessageId).toBe(parentMsgId);
      expect(historyReply.replyTo.content).toBe('What time are we meeting today?');
    });

    it('should support replying via standard POST /api/v1/chats/:conversationId/messages with replyToMessageId in body', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Hey Alice!' });

      const parentId = sendRes.body.data.id;

      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Hey Bob, got your message!',
          replyToMessageId: parentId,
        });

      expect(replyRes.status).toBe(201);
      expect(replyRes.body.data.replyToMessageId).toBe(parentId);
      expect(replyRes.body.data.replyTo.senderName).toBe('Bob Replier');
    });

    it('should support nested reply (replying to a reply)', async () => {
      // 1. Initial message
      const res1 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Step 1: Original' });

      // 2. Reply to initial message
      const res2 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${res1.body.data.id}/reply`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Step 2: First reply' });

      // 3. Reply to the reply
      const res3 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${res2.body.data.id}/reply`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Step 3: Nested reply' });

      expect(res3.status).toBe(201);
      expect(res3.body.data.replyToMessageId).toBe(res2.body.data.id);
      expect(res3.body.data.replyTo.content).toBe('Step 2: First reply');
      expect(res3.body.data.replyTo.senderName).toBe('Bob Replier');
    });

    it('should reject replying to non-existent message with 404 Not Found', async () => {
      const randomUuid = '00000000-0000-4000-8000-000000000002';
      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${randomUuid}/reply`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Replying to nothing' });

      expect(replyRes.status).toBe(404);
      expect(replyRes.body.success).toBe(false);
      expect(replyRes.body.message).toMatch(/original message not found/i);
    });

    it('should reject replying to message from a different conversation with 400 Bad Request', async () => {
      const [uA, uC] = [userA.id, userC.id].sort();
      const convAC = await Conversation.create({
        user1Id: uA,
        user2Id: uC,
        lastMessage: null,
        lastMessageAt: null,
      });

      // Charlie sends message in convAC
      const msgInAC = await ChatMessage.create({
        conversationId: convAC.id,
        senderId: userC.id,
        recipientId: userA.id,
        content: 'Secret message in AC',
        messageType: 'text',
        isRead: false,
      });

      // Alice tries to reply to msgInAC inside convAB
      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msgInAC.id}/reply`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Replying cross-conversation' });

      expect(replyRes.status).toBe(400);
      expect(replyRes.body.success).toBe(false);
      expect(replyRes.body.message).toMatch(/does not belong to this conversation/i);
    });

    it('should reject non-participant from replying with 403 Forbidden', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Alice message' });

      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${sendRes.body.data.id}/reply`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ content: 'Charlie trying to reply' });

      expect(replyRes.status).toBe(403);
      expect(replyRes.body.success).toBe(false);
    });

    it('should safely deduplicate retries using clientMessageId without duplicate records', async () => {
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Parent message' });

      const parentId = sendRes.body.data.id;
      const clientMessageId = 'client-uuid-retry-12345';

      // First attempt
      const attempt1 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${parentId}/reply`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          content: 'Idempotent reply text',
          clientMessageId,
        });

      expect(attempt1.status).toBe(201);
      const replyId1 = attempt1.body.data.id;

      // Second attempt (retry with exact same clientMessageId)
      const attempt2 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${parentId}/reply`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          content: 'Idempotent reply text',
          clientMessageId,
        });

      expect(attempt2.status).toBe(201);
      expect(attempt2.body.data.id).toBe(replyId1);

      // Verify DB count: only 2 messages total (parent + 1 reply)
      const totalMessages = await ChatMessage.count({ where: { conversationId: convAB.id } });
      expect(totalMessages).toBe(2);
    });
  });

  // ==========================================
  // 3. SOCKET.IO REAL-TIME EVENT TESTS
  // ==========================================
  describe('3. Socket.IO Real-Time Messaging (chat:edit_message and chat:reply_message)', () => {
    it('should edit message via socket and broadcast chat:message_edited to recipient and sender', async () => {
      const socketA = createClientSocket(tokenA);
      const socketB = createClientSocket(tokenB);

      await Promise.all([
        new Promise<void>((resolve) => socketA.on('connect', resolve)),
        new Promise<void>((resolve) => socketB.on('connect', resolve)),
      ]);

      // User A sends message via REST
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Socket edit test initial' });

      const messageId = sendRes.body.data.id;

      // Setup listeners on socketB (recipient)
      const recipientPromise = new Promise<any>((resolve) => {
        socketB.once('chat:message_edited', (data: any) => {
          resolve(data);
        });
      });

      // User A edits via socket
      const ackResponse = await new Promise<any>((resolve) => {
        socketA.emit(
          'chat:edit_message',
          {
            conversationId: convAB.id,
            messageId,
            content: 'Edited via socket event!',
          },
          (response: any) => {
            resolve(response);
          }
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data.content).toBe('Edited via socket event!');
      expect(ackResponse.data.isEdited).toBe(true);

      // Verify recipient received real-time broadcast
      const recipientEvent = await recipientPromise;
      expect(recipientEvent.id).toBe(messageId);
      expect(recipientEvent.content).toBe('Edited via socket event!');
      expect(recipientEvent.isEdited).toBe(true);
      expect(recipientEvent.isMine).toBe(false);
    });

    it('should reply to message via socket and broadcast chat:message_received with replyTo to recipient', async () => {
      const socketA = createClientSocket(tokenA);
      const socketB = createClientSocket(tokenB);

      await Promise.all([
        new Promise<void>((resolve) => socketA.on('connect', resolve)),
        new Promise<void>((resolve) => socketB.on('connect', resolve)),
      ]);

      // Initial message
      const sendRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Initial message for socket reply' });

      const parentMsgId = sendRes.body.data.id;

      // Recipient (socketA) waits for reply event
      const replyReceivedPromise = new Promise<any>((resolve) => {
        socketA.once('chat:message_received', (data: any) => {
          resolve(data);
        });
      });

      // User B replies via socket
      const ackResponse = await new Promise<any>((resolve) => {
        socketB.emit(
          'chat:reply_message',
          {
            conversationId: convAB.id,
            replyToMessageId: parentMsgId,
            content: 'Reply delivered over socket!',
          },
          (response: any) => {
            resolve(response);
          }
        );
      });

      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data.replyToMessageId).toBe(parentMsgId);
      expect(ackResponse.data.replyTo.content).toBe('Initial message for socket reply');

      const receivedMsg = await replyReceivedPromise;
      expect(receivedMsg.content).toBe('Reply delivered over socket!');
      expect(receivedMsg.replyToMessageId).toBe(parentMsgId);
      expect(receivedMsg.replyTo.senderName).toBe('Alice Editor');
    });
  });
});
