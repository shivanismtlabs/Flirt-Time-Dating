import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Match,
  SwipeAction,
  UserBlock,
  UserPhoto,
  Conversation,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Forward Message Recipient List API (GET /api/v1/chats/forward/recipients)', () => {
  let currentUser: User;
  let currentToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {}, force: true });
    await Conversation.destroy({ where: {}, force: true });
    await Match.destroy({ where: {}, force: true });
    await SwipeAction.destroy({ where: {}, force: true });
    await UserBlock.destroy({ where: {}, force: true });
    await UserPhoto.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    const runId = Math.random().toString(36).substring(2, 8);

    currentUser = await User.create({
      username: `current_${runId}`,
      email: `current_${runId}@flirttime.test`,
      fullName: 'Current User',
      firstName: 'Current',
      lastName: 'User',
      isActive: true,
      role: 'user',
    });

    currentToken = generateToken({ id: currentUser.id, role: 'user' });
  });

  describe('1. Authentication and Authorization', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/chats/forward/recipients');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject requests with invalid token with 401', async () => {
      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', 'Bearer invalid-token-xyz');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid pagination values with 400', async () => {
      const res = await request(app)
        .get('/api/v1/chats/forward/recipients?page=0&limit=abc')
        .set('Authorization', `Bearer ${currentToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Recipient Eligibility & Deduplication Rules', () => {
    it('should return a mutual match with relationshipType: "match"', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const matchedUser = await User.create({
        username: `matched_${runId}`,
        fullName: 'Matched User',
        firstName: 'Matched',
        lastName: 'User',
        profilePicture: 'photos/matched.jpg',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: matchedUser.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipients).toHaveLength(1);
      expect(res.body.data.recipients[0]).toEqual({
        userId: matchedUser.id,
        name: 'Matched User',
        profileImage: expect.stringContaining('matched.jpg'),
        relationshipType: 'match',
      });
    });

    it('should return a mutual match when authenticated user is user2Id', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const matchedUser = await User.create({
        username: `matched2_${runId}`,
        fullName: 'Second Match',
        firstName: 'Second',
        lastName: 'Match',
        profilePicture: 'photos/matched2.jpg',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: matchedUser.id,
        user2Id: currentUser.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipients).toHaveLength(1);
      expect(res.body.data.recipients[0].userId).toBe(matchedUser.id);
      expect(res.body.data.recipients[0].relationshipType).toBe('match');
    });

    it('should return an incoming super-like with relationshipType: "super_like_received"', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const superLiker = await User.create({
        username: `superliker_${runId}`,
        fullName: 'Super Liker',
        firstName: 'Super',
        lastName: 'Liker',
        profilePicture: 'photos/superliker.jpg',
        isActive: true,
        role: 'user',
      });

      // Recipient has sent super-like to current user
      await SwipeAction.create({
        userId: superLiker.id,
        targetUserId: currentUser.id,
        action: 'super_like',
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipients).toHaveLength(1);
      expect(res.body.data.recipients[0]).toEqual({
        userId: superLiker.id,
        name: 'Super Liker',
        profileImage: expect.stringContaining('superliker.jpg'),
        relationshipType: 'super_like_received',
      });
    });

    it('should return a user who has BOTH a match and incoming super-like once with relationshipType: "match"', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const dualUser = await User.create({
        username: `dual_${runId}`,
        fullName: 'Dual User',
        firstName: 'Dual',
        lastName: 'User',
        isActive: true,
        role: 'user',
      });

      // Mutual match
      await Match.create({
        user1Id: currentUser.id,
        user2Id: dualUser.id,
        matchedBy: 'super_like',
        isActive: true,
      });

      // Also incoming super-like
      await SwipeAction.create({
        userId: dualUser.id,
        targetUserId: currentUser.id,
        action: 'super_like',
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recipients).toHaveLength(1);
      expect(res.body.data.recipients[0].userId).toBe(dualUser.id);
      expect(res.body.data.recipients[0].relationshipType).toBe('match');
    });

    it('should NOT qualify an outgoing super-like alone', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const targetUser = await User.create({
        username: `target_${runId}`,
        fullName: 'Target User',
        isActive: true,
        role: 'user',
      });

      // Current user super-liked targetUser (outgoing only)
      await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: targetUser.id,
        action: 'super_like',
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });

    it('should NOT qualify an ordinary one-way like alone (incoming or outgoing)', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const incomingLiker = await User.create({
        username: `inliker_${runId}`,
        fullName: 'Incoming Liker',
        isActive: true,
        role: 'user',
      });
      const outgoingLiked = await User.create({
        username: `outliker_${runId}`,
        fullName: 'Outgoing Liked',
        isActive: true,
        role: 'user',
      });

      // Incoming normal like
      await SwipeAction.create({
        userId: incomingLiker.id,
        targetUserId: currentUser.id,
        action: 'like',
      });

      // Outgoing normal like
      await SwipeAction.create({
        userId: currentUser.id,
        targetUserId: outgoingLiked.id,
        action: 'like',
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });

    it('should exclude inactive matches (isActive: false)', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const unmatchedUser = await User.create({
        username: `unmatched_${runId}`,
        fullName: 'Unmatched User',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: unmatchedUser.id,
        matchedBy: 'like',
        isActive: false,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });

    it('should exclude blocked users (blocked by current user OR blocking current user)', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const blockedByMe = await User.create({
        username: `blockedbyme_${runId}`,
        fullName: 'Blocked By Me',
        isActive: true,
        role: 'user',
      });
      const blockingMe = await User.create({
        username: `blockingme_${runId}`,
        fullName: 'Blocking Me',
        isActive: true,
        role: 'user',
      });

      // Create mutual matches for both
      await Match.create({
        user1Id: currentUser.id,
        user2Id: blockedByMe.id,
        matchedBy: 'like',
        isActive: true,
      });
      await Match.create({
        user1Id: currentUser.id,
        user2Id: blockingMe.id,
        matchedBy: 'like',
        isActive: true,
      });

      // Blocked by current user
      await UserBlock.create({
        userId: currentUser.id,
        blockedUserId: blockedByMe.id,
        reason: 'Spam',
      });

      // Blocking current user
      await UserBlock.create({
        userId: blockingMe.id,
        blockedUserId: currentUser.id,
        reason: 'Harassment',
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });

    it('should exclude inactive / deactivated user accounts', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const inactiveUser = await User.create({
        username: `inactive_${runId}`,
        fullName: 'Inactive User',
        isActive: false,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: inactiveUser.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });

    it('should NEVER include current user themselves', async () => {
      // In case a buggy self-match or self-swipe existed
      await Match.create({
        user1Id: currentUser.id,
        user2Id: currentUser.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(0);
    });
  });

  describe('3. Pagination and Search Filtering', () => {
    it('should support pagination (page, limit, total, totalPages, hasMore)', async () => {
      const runId = Math.random().toString(36).substring(2, 8);

      for (let i = 1; i <= 5; i++) {
        const u = await User.create({
          username: `page_user_${i}_${runId}`,
          fullName: `Page User ${i}`,
          isActive: true,
          role: 'user',
        });
        await Match.create({
          user1Id: currentUser.id,
          user2Id: u.id,
          matchedBy: 'like',
          isActive: true,
        });
      }

      // Page 1 with limit 2
      const page1Res = await request(app)
        .get('/api/v1/chats/forward/recipients?page=1&limit=2')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.data.recipients).toHaveLength(2);
      expect(page1Res.body.data.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasMore: true,
      });

      // Page 3 with limit 2 (last item)
      const page3Res = await request(app)
        .get('/api/v1/chats/forward/recipients?page=3&limit=2')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(page3Res.status).toBe(200);
      expect(page3Res.body.data.recipients).toHaveLength(1);
      expect(page3Res.body.data.pagination).toEqual({
        page: 3,
        limit: 2,
        total: 5,
        totalPages: 3,
        hasMore: false,
      });
    });

    it('should filter recipients by search query case-insensitively', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const alice = await User.create({
        username: `alice_${runId}`,
        fullName: 'Alice Wonder',
        firstName: 'Alice',
        lastName: 'Wonder',
        isActive: true,
        role: 'user',
      });
      const bob = await User.create({
        username: `bob_${runId}`,
        fullName: 'Bob Builder',
        firstName: 'Bob',
        lastName: 'Builder',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: alice.id,
        matchedBy: 'like',
        isActive: true,
      });
      await Match.create({
        user1Id: currentUser.id,
        user2Id: bob.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients?search=alice')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.recipients).toHaveLength(1);
      expect(res.body.data.recipients[0].userId).toBe(alice.id);
      expect(res.body.data.recipients[0].name).toBe('Alice Wonder');

      const noMatchRes = await request(app)
        .get('/api/v1/chats/forward/recipients?search=charlie')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(noMatchRes.status).toBe(200);
      expect(noMatchRes.body.data.recipients).toHaveLength(0);
    });
  });

  describe('4. Contract & Response Shape Adherence (8-pillar standard)', () => {
    it('should strictly return only canonical DTO fields without leaks or duplicates', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const user = await User.create({
        username: `contract_${runId}`,
        fullName: 'Contract Test',
        firstName: 'Contract',
        lastName: 'Test',
        email: 'secret@flirttime.test',
        phone: '+1234567890',
        password: 'hashed-secret-password',
        profilePicture: 'photos/contract.jpg',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: user.id,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'Forward recipients fetched successfully');
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('recipients');
      expect(res.body.data).toHaveProperty('pagination');

      const recipient = res.body.data.recipients[0];
      expect(recipient).toHaveProperty('userId');
      expect(recipient).toHaveProperty('name');
      expect(recipient).toHaveProperty('profileImage');
      expect(recipient).toHaveProperty('relationshipType');

      // Crucial: no sensitive fields or internal model leakage
      expect(recipient).not.toHaveProperty('email');
      expect(recipient).not.toHaveProperty('phone');
      expect(recipient).not.toHaveProperty('password');
      expect(recipient).not.toHaveProperty('createdAt');
      expect(recipient).not.toHaveProperty('updatedAt');
      expect(recipient).not.toHaveProperty('created_at');
      expect(recipient).not.toHaveProperty('user_id');
      expect(recipient).not.toHaveProperty('id');
    });

    it('should allow selected recipient IDs to be passed to forward message API', async () => {
      const runId = Math.random().toString(36).substring(2, 8);
      const recipientUser = await User.create({
        username: `forward_dest_${runId}`,
        fullName: 'Forward Destination',
        isActive: true,
        role: 'user',
      });

      await Match.create({
        user1Id: currentUser.id,
        user2Id: recipientUser.id,
        matchedBy: 'like',
        isActive: true,
      });

      // 1. Fetch forward recipients
      const listRes = await request(app)
        .get('/api/v1/chats/forward/recipients')
        .set('Authorization', `Bearer ${currentToken}`);

      expect(listRes.status).toBe(200);
      const selectedId = listRes.body.data.recipients[0].userId;
      expect(selectedId).toBe(recipientUser.id);

      // 2. Create a source conversation and message
      const [u1, u2] = [currentUser.id, recipientUser.id].sort();
      const conv = await Conversation.create({
        user1Id: u1,
        user2Id: u2,
      });
      const sourceMsg = await ChatMessage.create({
        conversationId: conv.id,
        senderId: currentUser.id,
        recipientId: recipientUser.id,
        content: 'Hello to forward',
        messageType: 'text',
      });

      // 3. Forward the message to the recipient fetched from list
      const forwardRes = await request(app)
        .post('/api/v1/chats/messages/forward')
        .set('Authorization', `Bearer ${currentToken}`)
        .send({
          messageIds: [sourceMsg.id],
          recipientIds: [selectedId],
        });

      expect(forwardRes.status).toBe(201);
      expect(forwardRes.body.success).toBe(true);
      expect(forwardRes.body.data.successCount).toBe(1);
    });
  });
});
