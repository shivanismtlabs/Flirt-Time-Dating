import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  ConversationPin,
  UserBlock,
  Interest,
  UserInterest,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('FlirtTime Chat APIs (Screen 1: Chat List & Screen 2: One-to-One Chat)', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let blockedUser: User;

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  let interestArt: Interest;
  let interestTravel: Interest;
  let interestMusic: Interest;

  let convAB: Conversation;
  let convAC: Conversation;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await ConversationPin.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Seed test interests
    [interestArt] = await Interest.findOrCreate({
      where: { name: 'Art' },
      defaults: { name: 'Art', icon: '🎨', category: 'Creative' },
    });
    [interestTravel] = await Interest.findOrCreate({
      where: { name: 'Travel' },
      defaults: { name: 'Travel', icon: '✈️', category: 'Lifestyle' },
    });
    [interestMusic] = await Interest.findOrCreate({
      where: { name: 'Music' },
      defaults: { name: 'Music', icon: '🎵', category: 'Entertainment' },
    });

    // Create User A (Viewer / Current User)
    userA = await User.create({
      username: 'alex_chat',
      email: 'alex@example.com',
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      dateOfBirth: '1998-05-15',
      profilePicture: 'photos/alex.jpg',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      role: 'user',
    });

    // Create User B (Participant 1 - Jessica)
    userB = await User.create({
      username: 'jessica_p',
      email: 'jessica@example.com',
      fullName: 'Jessica Parker',
      firstName: 'Jessica',
      lastName: 'Parker',
      dateOfBirth: '2000-08-20',
      profilePicture: 'photos/jessica.jpg',
      latitude: 19.082,
      longitude: 72.881,
      isActive: true,
      role: 'user',
    });

    // Create User C (Participant 2 - Amanda)
    userC = await User.create({
      username: 'amanda_r',
      email: 'amanda@example.com',
      fullName: 'Amanda Ross',
      firstName: 'Amanda',
      lastName: 'Ross',
      dateOfBirth: '1999-03-10',
      profilePicture: 'photos/amanda.jpg',
      latitude: 19.11,
      longitude: 72.9,
      isActive: true,
      role: 'user',
    });

    // Create Blocked User
    blockedUser = await User.create({
      username: 'blocked_user',
      email: 'blocked@example.com',
      fullName: 'Blocked User',
      isActive: true,
      role: 'user',
    });

    // Attach interests
    // User A loves Art & Travel
    await UserInterest.create({ userId: userA.id, interestId: interestArt.id });
    await UserInterest.create({ userId: userA.id, interestId: interestTravel.id });

    // User B loves Travel & Music (Shared: Travel)
    await UserInterest.create({ userId: userB.id, interestId: interestTravel.id });
    await UserInterest.create({ userId: userB.id, interestId: interestMusic.id });

    // Generate JWT tokens
    tokenA = generateToken({ id: userA.id, role: 'user' });
    tokenB = generateToken({ id: userB.id, role: 'user' });
    tokenC = generateToken({ id: userC.id, role: 'user' });

    // Create conversations
    const [u1, u2] = [userA.id, userB.id].sort();
    convAB = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: 'Hey Jessica, excited to meet!',
      lastMessageAt: new Date(Date.now() - 3600000), // 1 hour ago
    });

    const [uA, uC] = [userA.id, userC.id].sort();
    convAC = await Conversation.create({
      user1Id: uA,
      user2Id: uC,
      lastMessage: 'See you tomorrow!',
      lastMessageAt: new Date(Date.now() - 7200000), // 2 hours ago
    });

    // Create messages for convAB
    // User B sent a message to User A (unread by A)
    await ChatMessage.create({
      conversationId: convAB.id,
      senderId: userB.id,
      recipientId: userA.id,
      content: 'Hey Jessica, excited to meet!',
      messageType: 'text',
      isRead: false,
    });
  });

  describe('1. Authentication & Security Guard', () => {
    it('should reject unauthenticated requests to GET /api/v1/chats with 401', async () => {
      const res = await request(app).get('/api/v1/chats');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated requests to GET /api/v1/chats/:conversationId with 401', async () => {
      const res = await request(app).get(`/api/v1/chats/${convAB.id}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-participant from accessing conversation with 404', async () => {
      // User C tries to view conversation between A and B
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenC}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  describe('2. Screen 1 — Chat List Screen (GET /api/v1/chats)', () => {
    it('should return chat list with canonical envelope, pinned/conversations partition, and unread counts', async () => {
      const res = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { pinned, conversations, pagination } = res.body.data;
      expect(Array.isArray(pinned)).toBe(true);
      expect(Array.isArray(conversations)).toBe(true);
      expect(pagination).toBeDefined();

      // Initially neither conversation is pinned
      expect(pinned.length).toBe(0);
      expect(conversations.length).toBe(2);

      // Verify conversation item structure and exact canonical keys
      const firstChat = conversations[0];
      expect(firstChat).toHaveProperty('conversationId');
      expect(firstChat).toHaveProperty('participant');
      expect(firstChat).toHaveProperty('lastMessage');
      expect(firstChat).toHaveProperty('unreadCount');
      expect(firstChat).toHaveProperty('isPinned');

      // Verify participant keys
      expect(firstChat.participant).toHaveProperty('userId');
      expect(firstChat.participant).toHaveProperty('displayName');
      expect(firstChat.participant).toHaveProperty('profileImageUrl');
      expect(firstChat.participant).toHaveProperty('isOnline');

      // Verify absence of forbidden duplicate aliases
      expect(firstChat).not.toHaveProperty('chatId');
      expect(firstChat).not.toHaveProperty('id');
      expect(firstChat.participant).not.toHaveProperty('user_id');
      expect(firstChat.participant).not.toHaveProperty('avatarUrl');
      expect(firstChat.participant).not.toHaveProperty('avatar');

      // Check unread count for convAB (userB sent 1 unread message to userA)
      const convABItem = conversations.find((c: any) => c.conversationId === convAB.id);
      expect(convABItem).toBeDefined();
      expect(convABItem.unreadCount).toBe(1);
    });

    it('should separate pinned conversations into pinned section without duplication', async () => {
      // Pin convAB for User A
      await ConversationPin.create({
        conversationId: convAB.id,
        userId: userA.id,
      });

      const res = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const { pinned, conversations } = res.body.data;

      expect(pinned.length).toBe(1);
      expect(pinned[0].conversationId).toBe(convAB.id);
      expect(pinned[0].isPinned).toBe(true);

      // Unpinned list must contain only convAC and NOT convAB (no duplication)
      expect(conversations.length).toBe(1);
      expect(conversations[0].conversationId).toBe(convAC.id);
      expect(conversations[0].isPinned).toBe(false);
    });

    it('should filter chat list by search query case-insensitively', async () => {
      // Search for "jessica"
      const res = await request(app)
        .get('/api/v1/chats?search=jessica')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const { conversations } = res.body.data;
      expect(conversations.length).toBe(1);
      expect(conversations[0].conversationId).toBe(convAB.id);
      expect(conversations[0].participant.displayName).toBe('Jessica Parker');
    });

    it('should exclude conversations involving blocked users', async () => {
      // Create conversation with blocked user
      const [uA, uBlocked] = [userA.id, blockedUser.id].sort();
      const blockedConv = await Conversation.create({
        user1Id: uA,
        user2Id: uBlocked,
        lastMessage: 'Spam',
      });

      // Block the user
      await UserBlock.create({
        userId: userA.id,
        blockedUserId: blockedUser.id,
      });

      const res = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      const allReturnedIds = [
        ...res.body.data.pinned.map((c: any) => c.conversationId),
        ...res.body.data.conversations.map((c: any) => c.conversationId),
      ];
      expect(allReturnedIds).not.toContain(blockedConv.id);
    });
  });

  describe('3. Screen 2 — Conversation Detail Screen (GET /api/v1/chats/:conversationId)', () => {
    it('should return conversation header details, age, distance, and common interests', async () => {
      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { conversationId, participant, isPinned } = res.body.data;
      expect(conversationId).toBe(convAB.id);
      expect(isPinned).toBe(false);

      expect(participant.userId).toBe(userB.id);
      expect(participant.displayName).toBe('Jessica Parker');
      expect(participant.age).toBeDefined();
      expect(typeof participant.age).toBe('number');
      expect(participant.isOnline).toBe(false); // socket client not connected in this unit test

      // Common interests: Both User A and User B have 'Travel'
      expect(Array.isArray(participant.commonInterests)).toBe(true);
      expect(participant.commonInterests.length).toBe(1);
      expect(participant.commonInterests[0].name).toBe('Travel');

      // Verify no duplicate keys
      expect(res.body.data).not.toHaveProperty('chatId');
      expect(participant).not.toHaveProperty('user_id');
    });
  });

  describe('4. Message History (GET /api/v1/chats/:conversationId/messages)', () => {
    it('should fetch messages with chronological ordering and pagination', async () => {
      // Add second message
      await ChatMessage.create({
        conversationId: convAB.id,
        senderId: userA.id,
        recipientId: userB.id,
        content: 'Sounds great! What time works for you?',
        messageType: 'text',
        isRead: false,
      });

      const res = await request(app)
        .get(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { messages, pagination } = res.body.data;
      expect(messages.length).toBe(2);
      expect(pagination.total).toBe(2);

      // Verify chronological order (oldest first)
      expect(messages[0].content).toBe('Hey Jessica, excited to meet!');
      expect(messages[0].isMine).toBe(false);

      expect(messages[1].content).toBe('Sounds great! What time works for you?');
      expect(messages[1].isMine).toBe(true);

      // Verify canonical message keys
      expect(messages[0]).toHaveProperty('id');
      expect(messages[0]).toHaveProperty('conversationId');
      expect(messages[0]).toHaveProperty('senderId');
      expect(messages[0]).toHaveProperty('recipientId');
      expect(messages[0]).toHaveProperty('content');
      expect(messages[0]).toHaveProperty('messageType');
      expect(messages[0]).toHaveProperty('sentAt');
      expect(messages[0]).toHaveProperty('isMine');
    });
  });

  describe('5. Sending Messages & Idempotency (POST /api/v1/chats/:conversationId/messages)', () => {
    it('should send a text message and update conversation lastMessage', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Looking forward to it!',
          messageType: 'text',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Looking forward to it!');
      expect(res.body.data.senderId).toBe(userA.id);
      expect(res.body.data.recipientId).toBe(userB.id);

      // Verify conversation preview was updated
      const updatedConv = await Conversation.findByPk(convAB.id);
      expect(updatedConv?.lastMessage).toBe('Looking forward to it!');
    });

    it('should support audio voice messages with media URL', async () => {
      const audioUrl = 'https://s3.ap-south-1.amazonaws.com/flirttime/audio/voice_123.m4a';
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: audioUrl,
          messageType: 'audio',
          metadata: { duration: 15 },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.messageType).toBe('audio');
      expect(res.body.data.content).toBe(audioUrl);
      expect(res.body.data.metadata.duration).toBe(15);
    });

    it('should be idempotent when clientMessageId is retried', async () => {
      const clientMessageId = '11111111-2222-3333-4444-555555555555';

      // First attempt
      const res1 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Network retry message',
          clientMessageId,
        });

      expect(res1.status).toBe(201);
      const originalMessageId = res1.body.data.id;

      // Second attempt with identical clientMessageId
      const res2 = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Network retry message',
          clientMessageId,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe(originalMessageId);

      // Verify only 1 record exists in database
      const count = await ChatMessage.count({
        where: { conversationId: convAB.id, content: 'Network retry message' },
      });
      expect(count).toBe(1);
    });

    it('should reject sending message if user has been blocked with 403', async () => {
      // User B blocks User A
      await UserBlock.create({
        userId: userB.id,
        blockedUserId: userA.id,
      });

      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          content: 'Are you there?',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot send messages/i);
    });
  });

  describe('6. Read Receipts (POST /api/v1/chats/:conversationId/read)', () => {
    it('should mark all received unread messages as read', async () => {
      const res = await request(app)
        .post(`/api/v1/chats/${convAB.id}/read`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.markedCount).toBe(1);

      // Verify unread count is now 0
      const listRes = await request(app)
        .get('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`);

      const convItem = listRes.body.data.conversations.find((c: any) => c.conversationId === convAB.id);
      expect(convItem.unreadCount).toBe(0);
    });
  });

  describe('7. Pinning / Unpinning (POST /api/v1/chats/:conversationId/pin)', () => {
    it('should pin and unpin conversation successfully', async () => {
      // 1. Pin
      const pinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: true });

      expect(pinRes.status).toBe(200);
      expect(pinRes.body.data.isPinned).toBe(true);

      // 2. Unpin
      const unpinRes = await request(app)
        .post(`/api/v1/chats/${convAB.id}/pin`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isPinned: false });

      expect(unpinRes.status).toBe(200);
      expect(unpinRes.body.data.isPinned).toBe(false);
    });
  });

  describe('8. Start or Get Conversation (POST /api/v1/chats)', () => {
    it('should retrieve existing conversation if one already exists', async () => {
      const res = await request(app)
        .post('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ recipientId: userB.id });

      expect(res.status).toBe(200);
      expect(res.body.data.conversationId).toBe(convAB.id);
      expect(res.body.data.isNew).toBe(false);
    });

    it('should create new conversation if none exists', async () => {
      // User B and User C have no conversation
      const res = await request(app)
        .post('/api/v1/chats')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ recipientId: userC.id });

      expect(res.status).toBe(201);
      expect(res.body.data.conversationId).toBeDefined();
      expect(res.body.data.isNew).toBe(true);
    });
  });

  describe('9. Chat Screen Action Menu: View Profile, Report, Block', () => {
    describe('View Profile Action (GET /api/v1/users/:userId/profile)', () => {
      it('should allow viewing conversation participant profile via canonical profile API', async () => {
        const res = await request(app)
          .get(`/api/v1/users/${userB.id}/profile`)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        // Canonical profile contract verification
        expect(res.body.data.id || res.body.data.userId).toBeDefined();
        expect(res.body.data.fullName).toBe('Jessica Parker');
      });

      it('should reject unauthenticated profile view requests with 401', async () => {
        const res = await request(app).get(`/api/v1/users/${userB.id}/profile`);
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
      });
    });

    describe('Report Action (POST /api/v1/users/:userId/report)', () => {
      it('should submit report for conversation participant using canonical report API', async () => {
        const res = await request(app)
          .post(`/api/v1/users/${userB.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            reason: 'harassment',
            description: 'Inappropriate messages in chat',
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toBe('Report submitted successfully');
        expect(res.body.data.reportId).toBeDefined();
        expect(res.body.data.status).toBe('pending');
      });

      it('should prevent self-reporting with 400', async () => {
        const res = await request(app)
          .post(`/api/v1/users/${userA.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            reason: 'other',
            description: 'Self test',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/cannot report yourself/i);
      });

      it('should reject invalid report reason with 400', async () => {
        const res = await request(app)
          .post(`/api/v1/users/${userB.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            reason: 'invalid_reason_string',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      });
    });

    describe('Block Action (POST /api/v1/users/:userId/block)', () => {
      it('should block conversation participant and enforce restrictions across all chat paths', async () => {
        // 1. Block participant via canonical API
        const blockRes = await request(app)
          .post(`/api/v1/users/${userB.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ reason: 'Harassment in chat' });

        expect(blockRes.status).toBe(200);
        expect(blockRes.body.success).toBe(true);
        expect(blockRes.body.message).toBe('User blocked successfully');
        expect(blockRes.body.data.userId).toBe(userB.id);
        expect(blockRes.body.data.isBlocked).toBe(true);

        // 2. Repeated block request is idempotent
        const repeatRes = await request(app)
          .post(`/api/v1/users/${userB.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send();

        expect(repeatRes.status).toBe(200);
        expect(repeatRes.body.data.isBlocked).toBe(true);

        // 3. Conversation is immediately excluded from Chat List (Screen 1)
        const listRes = await request(app)
          .get('/api/v1/chats')
          .set('Authorization', `Bearer ${tokenA}`);

        expect(listRes.status).toBe(200);
        const convIds = [
          ...listRes.body.data.pinned.map((c: any) => c.conversationId),
          ...listRes.body.data.conversations.map((c: any) => c.conversationId),
        ];
        expect(convIds).not.toContain(convAB.id);

        // 4. Conversation Detail returns 403 Forbidden
        const detailRes = await request(app)
          .get(`/api/v1/chats/${convAB.id}`)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(detailRes.status).toBe(403);
        expect(detailRes.body.success).toBe(false);

        // 5. Message History returns 403 Forbidden
        const msgRes = await request(app)
          .get(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`);

        expect(msgRes.status).toBe(403);
        expect(msgRes.body.success).toBe(false);

        // 6. Sending Message returns 403 Forbidden
        const sendRes = await request(app)
          .post(`/api/v1/chats/${convAB.id}/messages`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ content: 'Blocked message attempt' });

        expect(sendRes.status).toBe(403);
        expect(sendRes.body.success).toBe(false);
      });

      it('should prevent user from blocking themselves with 400', async () => {
        const res = await request(app)
          .post(`/api/v1/users/${userA.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send();

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/cannot block yourself/i);
      });
    });

    describe('Anti-Duplication Verification for Action Menu', () => {
      it('should verify that duplicate chat-specific endpoints do not exist', async () => {
        // Verification that redundant paths return 404 Not Found
        const duplicateProfile = await request(app)
          .get(`/api/v1/chats/${convAB.id}/profile`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(duplicateProfile.status).toBe(404);

        const duplicateReport = await request(app)
          .post(`/api/v1/chats/${convAB.id}/report`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(duplicateReport.status).toBe(404);

        const duplicateBlock = await request(app)
          .post(`/api/v1/chats/${convAB.id}/block`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(duplicateBlock.status).toBe(404);
      });
    });
  });
});
