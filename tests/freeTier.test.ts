import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  SwipeAction,
  Match,
  ConnectionRequest,
  CoinTransaction,
  Conversation,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Free Tier Rules & Limits Specification Tests', () => {
  let freeUser: User;
  let premiumUser: User;
  let targetUser1: User;
  let targetUser2: User;
  let freeToken: string;
  let premiumToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await ConnectionRequest.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await CoinTransaction.destroy({ where: {} });
    await User.destroy({ where: {} });

    freeUser = await User.create({
      username: 'free_user',
      email: 'free@example.com',
      fullName: 'Rahul Free',
      gender: 'male',
      isActive: true,
      role: 'user',
      isSubscribed: false,
      coins: 0,
    });

    premiumUser = await User.create({
      username: 'premium_user',
      email: 'premium@example.com',
      fullName: 'Priya VIP',
      gender: 'female',
      isActive: true,
      role: 'user',
      isSubscribed: true,
      coins: 50,
    });

    targetUser1 = await User.create({
      username: 'target_1',
      email: 'target1@example.com',
      fullName: 'Ananya Sharma',
      gender: 'female',
      isActive: true,
      role: 'user',
    });

    targetUser2 = await User.create({
      username: 'target_2',
      email: 'target2@example.com',
      fullName: 'Sneha Verma',
      gender: 'female',
      isActive: true,
      role: 'user',
    });

    freeToken = generateToken({ id: freeUser.id, role: 'user' });
    premiumToken = generateToken({ id: premiumUser.id, role: 'user' });
  });

  describe('1. GET /api/v1/users/limits', () => {
    it('returns free tier limits for free user (10 likes, 1 free super like, 20 coin cost)', async () => {
      const res = await request(app)
        .get('/api/v1/users/limits')
        .set('Authorization', `Bearer ${freeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSubscribed).toBe(false);
      expect(res.body.data.likes.limit).toBe(10);
      expect(res.body.data.likes.used).toBe(0);
      expect(res.body.data.likes.remaining).toBe(10);
      expect(res.body.data.nopes.isUnlimited).toBe(true);
      expect(res.body.data.superLikes.hasFree).toBe(true);
      expect(res.body.data.superLikes.costInCoins).toBe(20);
      expect(res.body.data.tabs.likesTabLocked).toBe(true);
      expect(res.body.data.tabs.complimentsTabLocked).toBe(true);
      expect(res.body.data.chat.canChatWithoutMatch).toBe(false);
    });

    it('returns unlimited limits for premium subscribed user', async () => {
      const res = await request(app)
        .get('/api/v1/users/limits')
        .set('Authorization', `Bearer ${premiumToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isSubscribed).toBe(true);
      expect(res.body.data.likes.limit).toBeNull();
      expect(res.body.data.likes.remaining).toBeNull();
      expect(res.body.data.tabs.likesTabLocked).toBe(false);
      expect(res.body.data.chat.canChatWithoutMatch).toBe(true);
    });

    it('works on discovery alias GET /api/v1/discovery/limits', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/limits')
        .set('Authorization', `Bearer ${freeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.likes.limit).toBe(10);
    });

    it('works on parameterized route GET /api/v1/users/:userId/limits', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${freeUser.id}/limits`)
        .set('Authorization', `Bearer ${freeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.likes.limit).toBe(10);
    });
  });

  describe('2. Like Quota: 10 / day & Nopes Unlimited', () => {
    it('allows free user to like up to 10 users and blocks the 11th like with 403', async () => {
      // Create 11 target users
      const targets: User[] = [];
      for (let i = 0; i < 11; i++) {
        const u = await User.create({
          username: `batch_target_${i}`,
          email: `batch_${i}@example.com`,
          fullName: `User ${i}`,
          isActive: true,
          role: 'user',
        });
        targets.push(u);
      }

      // First 10 likes should succeed
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${freeToken}`)
          .send({ targetUserId: targets[i].id, action: 'like' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Verify limits endpoint reflects 0 remaining likes
      const limitsRes = await request(app)
        .get('/api/v1/users/limits')
        .set('Authorization', `Bearer ${freeToken}`);
      expect(limitsRes.body.data.likes.used).toBe(10);
      expect(limitsRes.body.data.likes.remaining).toBe(0);

      // 11th like must be blocked
      const blockedRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targets[10].id, action: 'like' });

      expect([403, 429]).toContain(blockedRes.status);
      expect(blockedRes.body.success).toBe(false);
      expect(['DAILY_LIKE_LIMIT_REACHED', 'DAILY_SWIPE_LIMIT_REACHED']).toContain(blockedRes.body.error);
      expect(blockedRes.body.message).toContain('limit reached');
    });

    it('allows unlimited nopes for free user', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser1.id, action: 'nope' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action).toBe('nope');
    });

    it('allows subscribed user to like beyond 10 without restriction', async () => {
      // Pre-seed 10 likes for premium user
      for (let i = 0; i < 10; i++) {
        const u = await User.create({
          username: `prem_target_${i}`,
          email: `prem_${i}@example.com`,
          fullName: `Prem Target ${i}`,
          isActive: true,
          role: 'user',
        });
        await SwipeAction.create({
          userId: premiumUser.id,
          targetUserId: u.id,
          action: 'like',
        });
      }

      // 11th like should succeed for premium
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${premiumToken}`)
        .send({ targetUserId: targetUser1.id, action: 'like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('3. Super Like: 1 free, then 20 coins', () => {
    it('allows 1st Super Like for free without coins', async () => {
      expect(freeUser.coins).toBe(0);

      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser1.id, action: 'super_like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedUser = await User.findByPk(freeUser.id);
      expect(updatedUser?.coins).toBe(0);
    });

    it('rejects 2nd Super Like when user has insufficient coins (< 20)', async () => {
      // 1st free super like
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser1.id, action: 'super_like' });

      // 2nd super like with 0 coins
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser2.id, action: 'super_like' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('INSUFFICIENT_COINS');
      expect(res.body.message).toContain('Insufficient coins');
    });

    it('deducts 20 coins and creates CoinTransaction on 2nd Super Like when coins are available', async () => {
      // Give free user 30 coins
      await freeUser.update({ coins: 30 });

      // 1st free super like
      await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser1.id, action: 'super_like' });

      // 2nd super like: should deduct 20 coins
      const res = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({ targetUserId: targetUser2.id, action: 'super_like' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updatedUser = await User.findByPk(freeUser.id);
      expect(updatedUser?.coins).toBe(10);

      const tx = await CoinTransaction.findOne({
        where: { userId: freeUser.id, type: 'super_like' },
      });
      expect(tx).not.toBeNull();
      expect(tx?.amount).toBe(20);
      expect(tx?.balanceBefore).toBe(30);
      expect(tx?.balanceAfter).toBe(10);
    });
  });

  describe('4. Likes & Compliments Tabs (NO 403, returns isLocked + totalCount + masked items)', () => {
    beforeEach(async () => {
      // targetUser1 likes freeUser and premiumUser
      await SwipeAction.create({
        userId: targetUser1.id,
        targetUserId: freeUser.id,
        action: 'like',
      });
      await SwipeAction.create({
        userId: targetUser1.id,
        targetUserId: premiumUser.id,
        action: 'like',
      });

      // targetUser2 sends a connection request / compliment
      await ConnectionRequest.create({
        requesterId: targetUser2.id,
        targetUserId: freeUser.id,
        message: 'Love your smile!',
        reason: 'Great smile',
        status: 'pending',
      });
    });

    it('returns isLocked: true with masked/blurred items (NOT empty array) for free user on likes tab', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=likes')
        .set('Authorization', `Bearer ${freeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLocked).toBe(true);
      expect(res.body.data.totalCount).toBe(1);
      expect(res.body.data.items).toHaveLength(1);

      const item = res.body.data.items[0];
      expect(item.user.isBlurred).toBe(true);
      expect(item.user.name).toContain('***');
    });

    it('returns isLocked: false with unmasked items for premium user on likes tab', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=likes')
        .set('Authorization', `Bearer ${premiumToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLocked).toBe(false);
      expect(res.body.data.items[0].user.isBlurred).toBe(false);
      expect(res.body.data.items[0].user.name).toBe('Ananya');
    });

    it('returns isLocked: true with masked message for free user on compliments tab', async () => {
      const res = await request(app)
        .get('/api/v1/interactions?type=compliments')
        .set('Authorization', `Bearer ${freeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLocked).toBe(true);
      expect(res.body.data.totalCount).toBe(1);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].interaction.message).toContain('Hidden');
    });
  });

  describe('5. Chat: Free user 403 on send without match; Premium can chat without match', () => {
    it('returns 403 MATCH_REQUIRED_TO_CHAT when free user sends message without a mutual match', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({
          recipientId: targetUser1.id,
          content: 'Hey Ananya!',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('MATCH_REQUIRED_TO_CHAT');
      expect(res.body.message).toContain('mutual match');
    });

    it('allows free user to send message when mutual match exists', async () => {
      const [u1, u2] = [freeUser.id, targetUser1.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${freeToken}`)
        .send({
          recipientId: targetUser1.id,
          content: 'Hey matched friend!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hey matched friend!');
    });

    it('allows premium user to send message without a prior match', async () => {
      const res = await request(app)
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${premiumToken}`)
        .send({
          recipientId: targetUser1.id,
          content: 'Hi from VIP without match!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.content).toBe('Hi from VIP without match!');
    });
  });
});
