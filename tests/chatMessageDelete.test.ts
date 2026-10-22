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
import { chatService } from '../src/services/chat.service';

describe('Conversation Message Delete API (Delete for Me & Delete for Everyone)', () => {
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
      username: 'alice_deleter',
      email: 'alice_deleter@flirttime.test',
      fullName: 'Alice Deleter',
      firstName: 'Alice',
      lastName: 'Deleter',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    userB = await User.create({
      username: 'bob_receiver',
      email: 'bob_receiver@flirttime.test',
      fullName: 'Bob Receiver',
      firstName: 'Bob',
      lastName: 'Receiver',
      isActive: true,
      role: 'user',
      isSubscribed: true,
    });

    userC = await User.create({
      username: 'charlie_stranger',
      email: 'charlie_stranger@flirttime.test',
      fullName: 'Charlie Stranger',
      firstName: 'Charlie',
      lastName: 'Stranger',
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

  describe('1. Delete for Me', () => {
    it('should hide message only for requesting user, keeping it visible for the other participant', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Secret message for Alice only',
        messageType: 'text',
        isRead: false,
      });

      // Alice deletes for me
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Message deleted successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'me',
      });

      // Verify Alice does not see the message in message history
      const aliceHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(aliceHistory.status).toBe(200);
      const aliceMsgIds = aliceHistory.body.data.messages.map((m: any) => m.id);
      expect(aliceMsgIds).not.toContain(msg.id);

      // Verify Bob DOES still see the message
      const bobHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(bobHistory.status).toBe(200);
      const bobMsgIds = bobHistory.body.data.messages.map((m: any) => m.id);
      expect(bobMsgIds).toContain(msg.id);
    });

    it('should allow recipient to delete for me, hiding it from recipient while sender still sees it', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Hi Bob, please read',
        messageType: 'text',
        isRead: false,
      });

      // Bob deletes for me
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}?deleteType=me`)
        .set('Authorization', `Bearer ${tokenB}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.deleteType).toBe('me');

      // Bob no longer sees it
      const bobHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(bobHistory.body.data.messages.map((m: any) => m.id)).not.toContain(msg.id);

      // Alice still sees it
      const aliceHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(aliceHistory.body.data.messages.map((m: any) => m.id)).toContain(msg.id);
    });

    it('should unpin the message only for the user when deleting for me', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Important note',
        messageType: 'text',
        isRead: false,
      });

      // Both Alice and Bob pin it
      await ChatMessagePin.create({
        conversationId: convAB.id,
        messageId: msg.id,
        userId: userA.id,
        pinnedBy: userA.id,
      });
      await ChatMessagePin.create({
        conversationId: convAB.id,
        messageId: msg.id,
        userId: userB.id,
        pinnedBy: userB.id,
      });

      // Alice deletes for me
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      // Alice pinned messages should NOT contain it
      const alicePins = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(alicePins.body.data.messages.map((m: any) => m.id)).not.toContain(msg.id);

      // Bob pinned messages should STILL contain it
      const bobPins = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages/pinned`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(bobPins.body.data.messages.map((m: any) => m.id)).toContain(msg.id);
    });

    it('should handle repeated delete for me requests idempotently', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Repeat test',
        messageType: 'text',
        isRead: false,
      });

      const res1 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.deleteType).toBe('me');
    });
  });

  describe('2. Delete for Everyone', () => {
    it('should allow authorized sender to delete for everyone and synchronize across both participants', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Accidental message sent to Bob',
        messageType: 'text',
        metadata: JSON.stringify({
          imageUrl: 'https://example.com/pic.jpg',
          images: [{ url: 'https://example.com/pic.jpg' }],
        }),
        isRead: false,
      });

      // Pin the message to verify pin cleanup
      await ChatMessagePin.create({
        conversationId: convAB.id,
        messageId: msg.id,
        userId: userB.id,
        pinnedBy: userB.id,
      });

      convAB.lastMessage = 'Accidental message sent to Bob';
      convAB.lastMessageAt = msg.createdAt;
      await convAB.save();

      // Alice deletes for everyone
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Message deleted for everyone successfully');
      expect(res.body.data).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'everyone',
      });

      // Neither Alice nor Bob should see the message in getMessages
      const aliceHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(aliceHistory.body.data.messages.map((m: any) => m.id)).not.toContain(msg.id);

      const bobHistory = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(bobHistory.body.data.messages.map((m: any) => m.id)).not.toContain(msg.id);

      // Pins should be wiped
      const pinCount = await ChatMessagePin.count({ where: { messageId: msg.id } });
      expect(pinCount).toBe(0);

      // Raw DB record check: content sanitized, attachments purged
      const dbMsg = await ChatMessage.findByPk(msg.id);
      expect(dbMsg?.content).toBe('This message was deleted');
      const meta = JSON.parse(dbMsg?.metadata || '{}');
      expect(meta.isDeletedForEveryone).toBe(true);
      expect(meta.deletedForEveryoneBy).toBe(userA.id);
      expect(meta.imageUrl).toBeUndefined();
      expect(meta.images).toBeUndefined();
    });

    it('should reject non-sender attempting Delete for Everyone with 403 Forbidden', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Alice message that Bob tries to recall',
        messageType: 'text',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ deleteType: 'everyone' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('You can only delete your own messages for everyone');
    });

    it('should handle repeated Delete for Everyone requests idempotently', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Idempotency test',
        messageType: 'text',
        isRead: false,
      });

      const res1 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.deleteType).toBe('everyone');
    });

    it('should reject Delete for Everyone if the 24-hour deletion window has expired', async () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const oldMsg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Very old message from 2 days ago',
        messageType: 'text',
        isRead: false,
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });

      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${oldMsg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Message deletion window for everyone has expired');

      // But Delete for Me SHOULD still work for older messages
      const resMe = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${oldMsg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(resMe.status).toBe(200);
      expect(resMe.body.success).toBe(true);
    });
  });

  describe('3. Validation & Access Control Rejections', () => {
    it('should reject unauthorized requests without JWT with 401', async () => {
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/11111111-1111-1111-1111-111111111111`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(401);
    });

    it('should reject non-participant user with 403 Forbidden', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Private conversation',
        messageType: 'text',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-existent conversation with 404', async () => {
      const randomConvId = '00000000-0000-0000-0000-000000000000';
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Valid message',
        messageType: 'text',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/chats/${randomConvId}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-existent message with 404', async () => {
      const randomMsgId = '00000000-0000-0000-0000-000000000000';

      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${randomMsgId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject cross-conversation message ID with 400', async () => {
      const otherConv = await Conversation.create({
        user1Id: userA.id,
        user2Id: userC.id,
        lastMessage: null,
        lastMessageAt: null,
      });

      const msgInOtherConv = await ChatMessage.create({
        conversationId: otherConv.id,
        senderId: userA.id,
        recipientId: userC.id,
        content: 'Belongs to other conv',
        messageType: 'text',
        isRead: false,
      });

      // Try deleting message from otherConv using convAB URL
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msgInOtherConv.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Message does not belong to this conversation');
    });

    it('should reject invalid UUID format with 400 validation error', async () => {
      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/not-a-valid-uuid`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject unsupported deleteType with 400 validation error', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Type test',
        messageType: 'text',
        isRead: false,
      });

      const res = await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'unsupported_mode' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error[0].message).toContain('deleteType must be either "me" or "everyone"');
    });
  });

  describe('4. Business Integrity: Replies, Edits, Pins, Unread Counts', () => {
    it('should prevent replying to a deleted message', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Message to be deleted',
        messageType: 'text',
        isRead: false,
      });

      // Alice deletes for everyone
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      // Bob attempts to reply to the deleted message
      const replyRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg.id}/reply`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ content: 'Replying to your deleted message' });

      expect(replyRes.status).toBe(400);
      expect(replyRes.body.success).toBe(false);
      expect(replyRes.body.message).toContain('Cannot reply to a deleted or recalled message');
    });

    it('should prevent editing a message that has been deleted', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Original text',
        messageType: 'text',
        isRead: false,
      });

      // Alice deletes for everyone
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      // Alice attempts to edit the deleted message
      const editRes = await request(app)
        .patch(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ content: 'Attempt to revive message' });

      expect(editRes.status).toBe(400);
      expect(editRes.body.success).toBe(false);
      expect(editRes.body.message).toContain('Cannot edit a deleted or recalled message');
    });

    it('should prevent pinning a deleted message', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Deleted note',
        messageType: 'text',
        isRead: false,
      });

      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      // Bob attempts to pin it
      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages/${msg.id}/pin`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ isPinned: true });

      expect(pinRes.status).toBe(404);
      expect(pinRes.body.success).toBe(false);
    });

    it('should exclude deleted messages from conversation unread counts', async () => {
      // Alice sends Bob 2 unread messages
      const msg1 = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Unread message 1',
        messageType: 'text',
        isRead: false,
      });

      const msg2 = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Unread message 2',
        messageType: 'text',
        isRead: false,
      });

      // Initial unread count should be 2
      let unreadRes = await request(app)
        .get(`/api/v1/chats/unread-count?conversationId=${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(unreadRes.status).toBe(200);
      expect(unreadRes.body.data.unreadCount).toBe(2);

      // Alice deletes msg1 for everyone
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg1.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      // Bob deletes msg2 for me
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg2.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ deleteType: 'me' });

      // Unread count should now be 0!
      unreadRes = await request(app)
        .get(`/api/v1/chats/unread-count?conversationId=${convAB.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(unreadRes.status).toBe(200);
      expect(unreadRes.body.data.unreadCount).toBe(0);
    });
  });

  describe('5. Real-Time Socket.IO Synchronization', () => {
    it('should emit chat:message_deleted to both participants when Delete for Everyone is triggered', async () => {
      const socketA = createClientSocket(tokenA);
      const socketB = createClientSocket(tokenB);

      await Promise.all([
        new Promise<void>((resolve) => socketA.on('connect', resolve)),
        new Promise<void>((resolve) => socketB.on('connect', resolve)),
      ]);

      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Socket sync test for everyone',
        messageType: 'text',
        isRead: false,
      });

      const eventAPromise = new Promise<any>((resolve) => {
        socketA.once('chat:message_deleted', resolve);
      });
      const eventBPromise = new Promise<any>((resolve) => {
        socketB.once('chat:message_deleted', resolve);
      });

      // Trigger deletion via HTTP
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'everyone' });

      const [payloadA, payloadB] = await Promise.all([eventAPromise, eventBPromise]);

      expect(payloadA).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'everyone',
      });
      expect(payloadB).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'everyone',
      });
    });

    it('should emit chat:message_deleted ONLY to requester when Delete for Me is triggered', async () => {
      const socketA = createClientSocket(tokenA);
      const socketB = createClientSocket(tokenB);

      await Promise.all([
        new Promise<void>((resolve) => socketA.on('connect', resolve)),
        new Promise<void>((resolve) => socketB.on('connect', resolve)),
      ]);

      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Socket sync test for me only',
        messageType: 'text',
        isRead: false,
      });

      let bobReceived = false;
      socketB.once('chat:message_deleted', () => {
        bobReceived = true;
      });

      const eventAPromise = new Promise<any>((resolve) => {
        socketA.once('chat:message_deleted', resolve);
      });

      // Alice deletes for me
      await request(app)
        .delete(`/api/v1/chats/${convAB.id}/messages/${msg.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ deleteType: 'me' });

      const payloadA = await eventAPromise;
      expect(payloadA).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'me',
      });

      // Wait a short window and verify Bob never received it
      await new Promise((r) => setTimeout(r, 200));
      expect(bobReceived).toBe(false);
    });

    it('should support deleting message directly through client-to-server socket event chat:delete_message', async () => {
      const socketA = createClientSocket(tokenA);
      await new Promise<void>((resolve) => socketA.on('connect', resolve));

      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Socket inbound deletion',
        messageType: 'text',
        isRead: false,
      });

      const socketAck = await new Promise<any>((resolve) => {
        socketA.emit(
          'chat:delete_message',
          {
            conversationId: convAB.id,
            messageId: msg.id,
            deleteType: 'everyone',
          },
          (res: any) => resolve(res)
        );
      });

      expect(socketAck.success).toBe(true);
      expect(socketAck.data).toEqual({
        conversationId: convAB.id,
        messageId: msg.id,
        deleteType: 'everyone',
      });
    });
  });

  describe('6. Concurrency Safety', () => {
    it('should handle simultaneous concurrent delete requests without race conditions', async () => {
      const msg = await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Concurrent delete message',
        messageType: 'text',
        isRead: false,
      });

      // Launch 5 concurrent Delete for Me and Delete for Everyone requests
      const promises = [
        chatService.deleteMessage(userA.id, convAB.id, msg.id, 'everyone'),
        chatService.deleteMessage(userA.id, convAB.id, msg.id, 'everyone'),
        chatService.deleteMessage(userB.id, convAB.id, msg.id, 'me'),
        chatService.deleteMessage(userA.id, convAB.id, msg.id, 'everyone'),
      ];

      const results = await Promise.allSettled(promises);
      for (const res of results) {
        expect(res.status).toBe('fulfilled');
      }

      // Verify final DB state
      const dbMsg = await ChatMessage.findByPk(msg.id);
      expect(dbMsg?.content).toBe('This message was deleted');
      const meta = JSON.parse(dbMsg?.metadata || '{}');
      expect(meta.isDeletedForEveryone).toBe(true);
    });
  });
});
