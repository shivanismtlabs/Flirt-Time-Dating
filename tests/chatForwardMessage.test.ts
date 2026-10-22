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
  ConversationUserState,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';

describe('Production-Ready Message Forwarding API + Socket.IO Delivery', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let senderUser: User;
  let originalAuthor: User;
  let recipient1: User;
  let recipient2: User;
  let recipient3: User;
  let blockedUser: User;
  let inactiveUser: User;
  let uninvolvedUser: User;

  let senderToken: string;
  let originalAuthorToken: string;
  let recipient1Token: string;
  let recipient2Token: string;
  let recipient3Token: string;
  let blockedToken: string;
  let uninvolvedToken: string;

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
    await ChatMessage.destroy({ where: {} });
    await ConversationUserState.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    senderUser = await User.create({
      username: 'forwarder_sam',
      email: 'sam@flirttime.test',
      fullName: 'Sam Forwarder',
      firstName: 'Sam',
      lastName: 'Forwarder',
      dateOfBirth: '1998-01-01',
      profilePicture: 'photos/sam.jpg',
      isActive: true,
      role: 'user',
    });

    originalAuthor = await User.create({
      username: 'author_arthur',
      email: 'arthur@flirttime.test',
      fullName: 'Arthur Author',
      firstName: 'Arthur',
      dateOfBirth: '1997-05-05',
      profilePicture: 'photos/arthur.jpg',
      isActive: true,
      role: 'user',
    });

    recipient1 = await User.create({
      username: 'recipient_alice',
      email: 'alice@flirttime.test',
      fullName: 'Alice First',
      firstName: 'Alice',
      dateOfBirth: '1999-02-02',
      profilePicture: 'photos/alice.jpg',
      isActive: true,
      role: 'user',
    });

    recipient2 = await User.create({
      username: 'recipient_bob',
      email: 'bob@flirttime.test',
      fullName: 'Bob Second',
      firstName: 'Bob',
      dateOfBirth: '1996-03-03',
      profilePicture: 'photos/bob.jpg',
      isActive: true,
      role: 'user',
    });

    recipient3 = await User.create({
      username: 'recipient_carol',
      email: 'carol@flirttime.test',
      fullName: 'Carol Third',
      firstName: 'Carol',
      dateOfBirth: '1995-04-04',
      profilePicture: 'photos/carol.jpg',
      isActive: true,
      role: 'user',
    });

    blockedUser = await User.create({
      username: 'blocked_user',
      email: 'blocked@flirttime.test',
      fullName: 'Blocked User',
      firstName: 'Blocked',
      dateOfBirth: '1994-06-06',
      isActive: true,
      role: 'user',
    });

    inactiveUser = await User.create({
      username: 'inactive_user',
      email: 'inactive@flirttime.test',
      fullName: 'Inactive User',
      firstName: 'Inactive',
      dateOfBirth: '1993-07-07',
      isActive: false,
      role: 'user',
    });

    uninvolvedUser = await User.create({
      username: 'uninvolved_user',
      email: 'uninvolved@flirttime.test',
      fullName: 'Eve Uninvolved',
      firstName: 'Eve',
      dateOfBirth: '1992-08-08',
      isActive: true,
      role: 'user',
    });

    // Blocked relation: blockedUser has blocked senderUser
    await UserBlock.create({
      userId: blockedUser.id,
      blockedUserId: senderUser.id,
      reason: 'Spam',
    });

    senderToken = generateToken({ id: senderUser.id, role: 'user' });
    originalAuthorToken = generateToken({ id: originalAuthor.id, role: 'user' });
    recipient1Token = generateToken({ id: recipient1.id, role: 'user' });
    recipient2Token = generateToken({ id: recipient2.id, role: 'user' });
    recipient3Token = generateToken({ id: recipient3.id, role: 'user' });
    blockedToken = generateToken({ id: blockedUser.id, role: 'user' });
    uninvolvedToken = generateToken({ id: uninvolvedUser.id, role: 'user' });
  });

  // Helper to create a source conversation & message between sender and author
  const createSourceMessage = async (
    options: {
      content?: string;
      messageType?: 'text' | 'image' | 'audio' | 'location' | 'contact';
      metadata?: Record<string, any>;
      senderId?: string;
    } = {}
  ): Promise<{ conv: Conversation; message: ChatMessage }> => {
    const authorId = options.senderId || originalAuthor.id;
    const [u1, u2] = [senderUser.id, authorId].sort();
    let conv = await Conversation.findOne({ where: { user1Id: u1, user2Id: u2 } });
    if (!conv) {
      conv = await Conversation.create({
        user1Id: u1,
        user2Id: u2,
        isDeletedForEveryone: false,
      });
    }

    const message = await ChatMessage.create({
      conversationId: conv.id,
      senderId: authorId,
      recipientId: authorId === senderUser.id ? originalAuthor.id : senderUser.id,
      content: options.content || 'Original message content to forward',
      messageType: options.messageType || 'text',
      metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      isRead: true,
      isDelivered: true,
    });

    return { conv, message };
  };

  describe('1. Authentication and Input Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .send({
          messageIds: ['c7b2e831-2ea3-4cf1-8406-fcbb3b37a341'],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid UUIDs with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: ['invalid-uuid-123'],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty messageIds array with 400', async () => {
      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject duplicate messageIds with 400', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id, message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject duplicate recipientIds with 400', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id, recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject self-forwarding when single recipient is sender', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [senderUser.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot forward messages to yourself/i);
    });

    it('should reject batch exceeding maximum allowed limit (e.g. > 20 messages)', async () => {
      const { message } = await createSourceMessage();
      const tooManyUuids = Array.from(
        { length: 21 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
      );

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: tooManyUuids,
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Authorization and Source Message Access Rules', () => {
    it('should return 404 when source message does not exist', async () => {
      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: ['00000000-0000-4000-8000-000000000099'],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should return 403 when sender is NOT a participant in source conversation', async () => {
      // Create a message in a conversation between originalAuthor and uninvolvedUser
      const [u1, u2] = [originalAuthor.id, uninvolvedUser.id].sort();
      const privateConv = await Conversation.create({
        user1Id: u1,
        user2Id: u2,
        isDeletedForEveryone: false,
      });
      const privateMsg = await ChatMessage.create({
        conversationId: privateConv.id,
        senderId: originalAuthor.id,
        recipientId: uninvolvedUser.id,
        content: 'Secret conversation message',
        messageType: 'text',
      });

      // Sender (Sam) attempts to forward Arthur & Eve\'s private message
      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [privateMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized to access this message/i);
    });

    it('should return 400 when source message has been deleted for everyone', async () => {
      const { message } = await createSourceMessage({
        metadata: { isDeletedForEveryone: true, isDeleted: true },
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot forward a deleted/i);
    });

    it('should return 400 when source message was deleted for sender (delete for me)', async () => {
      const { message } = await createSourceMessage({
        metadata: { deletedForUserIds: [senderUser.id] },
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot forward a deleted/i);
    });

    it('should return 404 when conversation history was cleared before message creation', async () => {
      const { conv, message } = await createSourceMessage();

      // Clear conversation after message was created
      await ConversationUserState.create({
        conversationId: conv.id,
        userId: senderUser.id,
        clearedAt: new Date(Date.now() + 10000),
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Core Forwarding Combinations (1-to-1, 1-to-Many, Many-to-1, Many-to-Many)', () => {
    it('Combination A: Single message -> Single recipient (Existing & new conversation)', async () => {
      const { message: srcMsg } = await createSourceMessage({
        content: 'Hey, look at this cool news!',
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [srcMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('conversationId');
      expect(res.body.data).toHaveProperty('messageId');
      expect(res.body.data.isForwarded).toBe(true);
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.failureCount).toBe(0);

      const destMessage = await ChatMessage.findByPk(res.body.data.messageId);
      expect(destMessage).toBeDefined();
      expect(destMessage!.id).not.toBe(srcMsg.id); // Must NOT copy ID
      expect(destMessage!.senderId).toBe(senderUser.id); // Forwarder is the sender!
      expect(destMessage!.recipientId).toBe(recipient1.id);
      expect(destMessage!.content).toBe('Hey, look at this cool news!');

      const parsedMeta = JSON.parse(destMessage!.metadata || '{}');
      expect(parsedMeta.isForwarded).toBe(true);
      expect(parsedMeta.forwardedFromMessageId).toBe(srcMsg.id);
      expect(parsedMeta.originalSenderId).toBe(originalAuthor.id);
      expect(parsedMeta.originalSenderName).toBe('Arthur Author');

      // Forward a second message to existing conversation to verify reuse
      const { message: srcMsg2 } = await createSourceMessage({
        content: 'Another follow-up message',
      });
      const res2 = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [srcMsg2.id],
          recipientIds: [recipient1.id],
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.conversationId).toBe(res.body.data.conversationId); // Reused existing!
    });

    it('Combination B: Single message -> Multiple recipients', async () => {
      const { message: srcMsg } = await createSourceMessage({
        content: 'Broadcast announcement to multiple friends',
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [srcMsg.id],
          recipientIds: [recipient1.id, recipient2.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(2);
      expect(res.body.data.successCount).toBe(2);
      expect(res.body.data.failureCount).toBe(0);
      expect(res.body.data.results).toHaveLength(2);

      // Verify separate 1-to-1 conversations created (NOT a group conversation)
      const conv1Id = res.body.data.results[0].conversationId;
      const conv2Id = res.body.data.results[1].conversationId;
      expect(conv1Id).not.toBe(conv2Id);

      const conv1 = await Conversation.findByPk(conv1Id);
      const conv2 = await Conversation.findByPk(conv2Id);
      expect(conv1).toBeDefined();
      expect(conv2).toBeDefined();

      const conv1Participants = [conv1!.user1Id, conv1!.user2Id].sort();
      const conv2Participants = [conv2!.user1Id, conv2!.user2Id].sort();
      expect(conv1Participants).toEqual([senderUser.id, recipient1.id].sort());
      expect(conv2Participants).toEqual([senderUser.id, recipient2.id].sort());
    });

    it('Combination C: Multiple messages -> Single recipient', async () => {
      const { message: m1 } = await createSourceMessage({ content: 'First message in batch' });
      const { message: m2 } = await createSourceMessage({ content: 'Second message in batch' });
      const { message: m3 } = await createSourceMessage({ content: 'Third message in batch' });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [m1.id, m2.id, m3.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.results[0].messageIds).toHaveLength(3);
      expect(res.body.data.results[0].messages).toHaveLength(3);

      const createdIds = res.body.data.results[0].messageIds;
      const msgs = await ChatMessage.findAll({ where: { id: createdIds } });
      expect(msgs).toHaveLength(3);
      expect(msgs.map((m) => m.content)).toEqual([
        'First message in batch',
        'Second message in batch',
        'Third message in batch',
      ]);
      expect(msgs.every((m) => m.senderId === senderUser.id)).toBe(true);
      expect(msgs.every((m) => m.recipientId === recipient1.id)).toBe(true);
    });

    it('Combination D: Multiple messages -> Multiple recipients', async () => {
      const { message: m1 } = await createSourceMessage({ content: 'Batch message A' });
      const { message: m2 } = await createSourceMessage({ content: 'Batch message B' });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [m1.id, m2.id],
          recipientIds: [recipient1.id, recipient2.id, recipient3.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalCount).toBe(3);
      expect(res.body.data.successCount).toBe(3);

      for (const result of res.body.data.results) {
        expect(result.status).toBe('success');
        expect(result.messageIds).toHaveLength(2);
        expect(result.messages).toHaveLength(2);
      }
    });
  });

  describe('4. Supported Attachment Preservation (Text, Image, Audio, Location, Contact)', () => {
    it('should forward image message preserving S3 metadata and public urls', async () => {
      const { message: imgMsg } = await createSourceMessage({
        content: 'chat/uploads/sample-photo.jpg',
        messageType: 'image',
        metadata: {
          imageUrl: 'https://s3.amazonaws.com/flirttime/chat/uploads/sample-photo.jpg',
          thumbnailUrl: 'https://s3.amazonaws.com/flirttime/chat/uploads/sample-photo-thumb.jpg',
          caption: 'Sunset at the beach',
          fileSize: 1048576,
          mimeType: 'image/jpeg',
        },
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [imgMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      const destMsg = await ChatMessage.findByPk(res.body.data.messageId);
      expect(destMsg!.messageType).toBe('image');
      expect(destMsg!.content).toBe('chat/uploads/sample-photo.jpg');

      const meta = JSON.parse(destMsg!.metadata || '{}');
      expect(meta.isForwarded).toBe(true);
      expect(meta.caption).toBe('Sunset at the beach');
      expect(meta.imageUrl).toBeDefined();
      expect(meta.thumbnailUrl).toBeDefined();
      expect(meta.mimeType).toBe('image/jpeg');
    });

    it('should forward audio/voice message preserving audio url and duration', async () => {
      const { message: audioMsg } = await createSourceMessage({
        content: 'chat/voice/recording-123.mp3',
        messageType: 'audio',
        metadata: {
          audioUrl: 'https://s3.amazonaws.com/flirttime/chat/voice/recording-123.mp3',
          voiceUrl: 'https://s3.amazonaws.com/flirttime/chat/voice/recording-123.mp3',
          duration: 15,
          durationMs: 15000,
          mimeType: 'audio/mpeg',
        },
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [audioMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      const destMsg = await ChatMessage.findByPk(res.body.data.messageId);
      expect(destMsg!.messageType).toBe('audio');
      expect(destMsg!.content).toBe('chat/voice/recording-123.mp3');

      const meta = JSON.parse(destMsg!.metadata || '{}');
      expect(meta.isForwarded).toBe(true);
      expect(meta.duration).toBe(15);
      expect(meta.durationMs).toBe(15000);
      expect(meta.audioUrl).toBeDefined();
    });

    it('should forward location and contact messages preserving coordinates and phone details', async () => {
      const { message: locMsg } = await createSourceMessage({
        content: '📍 Central Park',
        messageType: 'location',
        metadata: {
          latitude: 40.785091,
          longitude: -73.968285,
          name: 'Central Park',
        },
      });

      const { message: contactMsg } = await createSourceMessage({
        content: '👤 John Doe',
        messageType: 'contact',
        metadata: {
          name: 'John Doe',
          phoneNumber: '+1234567890',
        },
      });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [locMsg.id, contactMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      const items = res.body.data.results[0].messages;
      expect(items[0].messageType).toBe('location');
      expect(items[0].metadata.latitude).toBe(40.785091);
      expect(items[1].messageType).toBe('contact');
      expect(items[1].metadata.phoneNumber).toBe('+1234567890');
    });
  });

  describe('5. Recipient Eligibility, Inactive/Blocked Checks, and Partial Failures', () => {
    it('should report failure for inactive recipient', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [inactiveUser.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.totalCount).toBe(1);
      expect(res.body.data.successCount).toBe(0);
      expect(res.body.data.failureCount).toBe(1);
      expect(res.body.data.results[0].status).toBe('failed');
      expect(res.body.data.results[0].errorCode).toBe('USER_NOT_FOUND');
    });

    it('should report failure for blocked recipient', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [blockedUser.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.successCount).toBe(0);
      expect(res.body.data.failureCount).toBe(1);
      expect(res.body.data.results[0].errorCode).toBe('USER_BLOCKED');
    });

    it('should handle partial failure in a multi-recipient batch consistently', async () => {
      const { message } = await createSourceMessage();

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id, blockedUser.id, inactiveUser.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/Messages forwarded with some delivery failures/i);
      expect(res.body.data.totalCount).toBe(3);
      expect(res.body.data.successCount).toBe(1);
      expect(res.body.data.failureCount).toBe(2);

      const r1 = res.body.data.results.find((r: any) => r.recipientId === recipient1.id);
      const rBlocked = res.body.data.results.find((r: any) => r.recipientId === blockedUser.id);
      const rInactive = res.body.data.results.find((r: any) => r.recipientId === inactiveUser.id);

      expect(r1.status).toBe('success');
      expect(rBlocked.status).toBe('failed');
      expect(rInactive.status).toBe('failed');
    });
  });

  describe('6. Idempotency and Retry Behavior', () => {
    it('should be idempotent when retrying with clientMessageId without creating duplicate messages', async () => {
      const { message } = await createSourceMessage({ content: 'Idempotency test payload' });
      const clientMessageId = 'client-fwd-idempotent-001';

      const res1 = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
          clientMessageId,
        });

      expect(res1.status).toBe(201);
      const msgId1 = res1.body.data.messageId;

      // Retry exact same forward call
      const res2 = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
          clientMessageId,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.messageId).toBe(msgId1);

      // Verify only 1 message exists in destination conversation
      const count = await ChatMessage.count({
        where: { conversationId: res1.body.data.conversationId },
      });
      expect(count).toBe(1);
    });
  });

  describe('7. Real-Time Socket.IO Delivery and Participant Scoping', () => {
    it('should emit chat:message_received and chat:message_forwarded to recipient, chat:message_sent to sender, and NOT to uninvolved user', async () => {
      const recipientSocket = createClientSocket({
        auth: { token: recipient1Token },
      });
      const senderSocket = createClientSocket({
        auth: { token: senderToken },
      });
      const uninvolvedSocket = createClientSocket({
        auth: { token: uninvolvedToken },
      });

      await new Promise<void>((resolve) => {
        let connectedCount = 0;
        const check = () => {
          connectedCount++;
          if (connectedCount === 3) resolve();
        };
        recipientSocket.on('connect', check);
        senderSocket.on('connect', check);
        uninvolvedSocket.on('connect', check);
      });

      const recipientEvents: any[] = [];
      const recipientForwardedEvents: any[] = [];
      const senderSentEvents: any[] = [];
      const uninvolvedEvents: any[] = [];

      recipientSocket.on('chat:message_received', (data) => recipientEvents.push(data));
      recipientSocket.on('chat:message_forwarded', (data) => recipientForwardedEvents.push(data));
      senderSocket.on('chat:message_sent', (data) => senderSentEvents.push(data));
      uninvolvedSocket.on('chat:message_received', (data) => uninvolvedEvents.push(data));
      uninvolvedSocket.on('chat:message_forwarded', (data) => uninvolvedEvents.push(data));

      const { message } = await createSourceMessage({ content: 'Real-time forwarded text' });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);

      // Wait for socket events to settle
      await new Promise((r) => setTimeout(r, 400));

      expect(recipientEvents.length).toBeGreaterThan(0);
      expect(recipientEvents[0].content).toBe('Real-time forwarded text');
      expect(recipientEvents[0].isMine).toBe(false);

      expect(recipientForwardedEvents.length).toBeGreaterThan(0);
      expect(recipientForwardedEvents[0].isForwarded).toBe(true);
      expect(recipientForwardedEvents[0].forwardedFromMessageId).toBe(message.id);

      expect(senderSentEvents.length).toBeGreaterThan(0);
      expect(senderSentEvents[0].content).toBe('Real-time forwarded text');
      expect(senderSentEvents[0].isMine).toBe(true);

      // Uninvolved user must receive ZERO events
      expect(uninvolvedEvents).toHaveLength(0);
    });

    it('should support forwarding via websocket event chat:forward_message', async () => {
      const senderSocket = createClientSocket({
        auth: { token: senderToken },
      });

      await new Promise<void>((resolve) => senderSocket.on('connect', resolve));

      const { message } = await createSourceMessage({ content: 'Socket forwarded content' });

      const ackResponse = await new Promise<any>((resolve) => {
        senderSocket.emit(
          'chat:forward_message',
          {
            messageIds: [message.id],
            recipientIds: [recipient1.id],
          },
          (response: any) => resolve(response)
        );
      });

      expect(ackResponse).toBeDefined();
      expect(ackResponse.success).toBe(true);
      expect(ackResponse.data.successCount).toBe(1);
      expect(ackResponse.data.results[0].isForwarded).toBe(true);
    });
  });

  describe('8. Chat History Integration & 8-Pillars Response Contract Verification', () => {
    it('should expose isForwarded and forwardedFromMessageId in GET /api/v1/chats/:conversationId/messages', async () => {
      const { message: srcMsg } = await createSourceMessage({ content: 'History visibility test' });

      const fwdRes = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [srcMsg.id],
          recipientIds: [recipient1.id],
        });

      expect(fwdRes.status).toBe(201);
      const convId = fwdRes.body.data.conversationId;

      // Query conversation messages history as recipient
      const histRes = await request(app)
        .get(`/api/v1/chats/${convId}/messages`)
        .set('Authorization', `Bearer ${recipient1Token}`);

      expect(histRes.status).toBe(200);
      expect(histRes.body.success).toBe(true);
      const messages = histRes.body.data.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].isForwarded).toBe(true);
      expect(messages[0].forwardedFromMessageId).toBe(srcMsg.id);
      expect(messages[0].originalSenderName).toBe('Arthur Author');
    });

    it('should adhere strictly to 8-pillar Global API Response Standard (no duplicate keys, camelCase, clean envelope)', async () => {
      const { message } = await createSourceMessage({ content: '8-pillar validation' });

      const res = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${senderToken}`)
        .send({
          messageIds: [message.id],
          recipientIds: [recipient1.id],
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('data');

      // Envelope must not duplicate data.data
      expect(res.body.data).not.toHaveProperty('data');

      // No snake_case properties
      const bodyKeys = Object.keys(res.body.data);
      for (const k of bodyKeys) {
        expect(k).not.toMatch(/_[a-z]/); // No snake_case
      }

      // No duplicate aliases like 'message' and 'text' or 'id' and 'messageId' at root
      expect(res.body.data).toHaveProperty('messageId');
      expect(res.body.data).not.toHaveProperty('id');
      expect(res.body.data).not.toHaveProperty('created_at');
      expect(res.body.data).not.toHaveProperty('conversation_id');
    });
  });
});
