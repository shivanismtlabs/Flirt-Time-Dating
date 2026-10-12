import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  QuickMoment,
  QuickMomentReaction,
  QuickMomentView,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Quick Moments (24-Hour Stories) Feature APIs', () => {
  let alexUser: User;
  let cindyUser: User;
  let thirdUser: User;
  let alexToken: string;
  let cindyToken: string;
  let thirdToken: string;

  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0xff, 0xd9,
  ]);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await QuickMomentView.destroy({ where: {} });
    await QuickMomentReaction.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await User.destroy({ where: {} });

    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(
      async (_buf, userId, _mime, folder) => `${folder}/${userId}/${Date.now()}_story.jpg`
    );

    alexUser = await User.create({
      username: 'alex_test',
      email: 'alex@flirttime.app',
      fullName: 'Alex Rivers',
      firstName: 'Alex',
      city: 'Indore',
      profilePicture: 'https://example.com/alex.jpg',
      isActive: true,
      role: 'user',
    });

    cindyUser = await User.create({
      username: 'cindy_test',
      email: 'cindy@flirttime.app',
      fullName: 'Cindy Crawford',
      firstName: 'Cindy',
      city: 'Indore, Madhya Pradesh',
      profilePicture: 'https://example.com/cindy.jpg',
      isActive: true,
      role: 'user',
    });

    thirdUser = await User.create({
      username: 'sam_test',
      email: 'sam@flirttime.app',
      fullName: 'Sam Taylor',
      firstName: 'Sam',
      city: 'Indore',
      profilePicture: 'https://example.com/sam.jpg',
      isActive: true,
      role: 'user',
    });

    alexToken = generateToken({
      id: alexUser.id,
      email: alexUser.email,
      role: alexUser.role,
    });

    cindyToken = generateToken({
      id: cindyUser.id,
      email: cindyUser.email,
      role: cindyUser.role,
    });

    thirdToken = generateToken({
      id: thirdUser.id,
      email: thirdUser.email,
      role: thirdUser.role,
    });
  });

  describe('1. Create Quick Moments (POST /api/v1/quick-moments)', () => {
    it('should create a text story (Image 2 Alex)', async () => {
      const res = await request(app)
        .post('/api/v1/quick-moments')
        .set('Authorization', `Bearer ${alexToken}`)
        .send({
          type: 'text',
          text: "Who's up for coffee this evening? ☕",
          backgroundColor: '#2d0b1e',
          textColor: '#ffffff',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('text');
      expect(res.body.data.text).toBe("Who's up for coffee this evening? ☕");
      expect(res.body.data.backgroundColor).toBe('#2d0b1e');
      expect(res.body.data.expiresAt).toBeDefined();
    });

    it('should create an image story with upload (Image 3 Cindy)', async () => {
      const res = await request(app)
        .post('/api/v1/quick-moments')
        .set('Authorization', `Bearer ${cindyToken}`)
        .field('caption', 'Coffee date with myself ☕')
        .field('locationLabel', '📍 Indore, Madhya Pradesh')
        .attach('image', validJpegBuffer, 'coffee.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('image');
      expect(res.body.data.caption).toBe('Coffee date with myself ☕');
      expect(res.body.data.locationLabel).toBe('📍 Indore, Madhya Pradesh');
      expect(res.body.data.mediaUrl).toBeDefined();
    });
  });

  describe('2. Story Tray Bar (Screen 1 Image 1)', () => {
    beforeEach(async () => {
      // Alex creates a text story
      await QuickMoment.create({
        userId: alexUser.id,
        type: 'text',
        text: "Who's up for coffee this evening? ☕",
        backgroundColor: '#2d0b1e',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });

      // Cindy creates an image story
      const cindyStory = await QuickMoment.create({
        userId: cindyUser.id,
        type: 'image',
        mediaUrl: 'https://example.com/latte.jpg',
        thumbnailUrl: 'https://example.com/latte.jpg',
        caption: 'Coffee date with myself ☕',
        locationLabel: '📍 Indore, Madhya Pradesh',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });

      // Third user reacts with 😍 to Cindy's story
      await QuickMomentReaction.create({
        quickMomentId: cindyStory.id,
        userId: thirdUser.id,
        emoji: '😍',
      });
    });

    it('should return own avatar status and other users active stories with badges', async () => {
      const res = await request(app)
        .get('/api/v1/quick-moments/tray')
        .set('Authorization', `Bearer ${alexToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.myStatus.hasActive).toBe(true);
      expect(res.body.data.myStatus.totalActive).toBe(1);
      expect(res.body.data.myStatus.avatar).toBe('https://example.com/alex.jpg');

      // Cindy is in otherUsers with unread indicator and reaction badge
      const cindyEntry = res.body.data.otherUsers.find((u: any) => u.userId === cindyUser.id);
      expect(cindyEntry).toBeDefined();
      expect(cindyEntry.hasUnread).toBe(true);
      expect(cindyEntry.totalStories).toBe(1);
      expect(cindyEntry.badge).toBeDefined();
      expect(cindyEntry.badge.text).toBe('😍 1');
    });
  });

  describe('3. View Own Quick Moments (Screen 2 Image 2)', () => {
    let alexStoryId: string;

    beforeEach(async () => {
      const story = await QuickMoment.create({
        userId: alexUser.id,
        type: 'text',
        text: "Who's up for coffee this evening? ☕",
        backgroundColor: '#2d0b1e',
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
        expiresAt: new Date(Date.now() + 22 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 14,
        repliesCount: 2,
      });
      alexStoryId = story.id;

      // Add reactions: 2x 😍, 1x 🔥
      await QuickMomentReaction.create({
        quickMomentId: alexStoryId,
        userId: cindyUser.id,
        emoji: '😍',
      });
      await QuickMomentReaction.create({
        quickMomentId: alexStoryId,
        userId: thirdUser.id,
        emoji: '🔥',
      });
    });

    it('should return slides with progress bar data, badgeText "😍🔥 2 · 💬 2 replies"', async () => {
      const res = await request(app)
        .get('/api/v1/quick-moments/me')
        .set('Authorization', `Bearer ${alexToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.author.name).toBe('Alex Rivers');
      expect(res.body.data.totalStories).toBe(1);

      const slide = res.body.data.stories[0];
      expect(slide.id).toBe(alexStoryId);
      expect(slide.type).toBe('text');
      expect(slide.text).toBe("Who's up for coffee this evening? ☕");
      expect(slide.reactionsCount).toBe(2);
      expect(slide.topEmojis).toEqual(['😍', '🔥']);
      expect(slide.badgeText).toContain('😍🔥 2 · 💬 2 replies');
      expect(slide.repliesCount).toBe(2);
      expect(slide.reactors).toHaveLength(2);
    });
  });

  describe('4. View Other User Quick Moments (Screen 3 Image 3)', () => {
    let cindyStoryId: string;

    beforeEach(async () => {
      const story = await QuickMoment.create({
        userId: cindyUser.id,
        type: 'image',
        mediaUrl: 'https://example.com/latte.jpg',
        thumbnailUrl: 'https://example.com/latte.jpg',
        caption: 'Coffee date with myself ☕',
        locationLabel: '📍 Indore, Madhya Pradesh',
        publishedAt: new Date(Date.now() - 48 * 60 * 1000),
        expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 28,
        repliesCount: 4,
      });
      cindyStoryId = story.id;
    });

    it('should return Cindy story slides with location, caption, available emojis, and reply placeholder', async () => {
      const res = await request(app)
        .get(`/api/v1/quick-moments/user/${cindyUser.id}`)
        .set('Authorization', `Bearer ${alexToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.author.name).toBe('Cindy');
      expect(res.body.data.totalStories).toBe(1);

      const slide = res.body.data.stories[0];
      expect(slide.caption).toBe('Coffee date with myself ☕');
      expect(slide.locationLabel).toBe('📍 Indore, Madhya Pradesh');
      expect(slide.availableEmojis).toEqual(['😍', '🔥', '😂', '😮', '👏', '❤️']);
      expect(slide.replyPlaceholder).toBe('Reply to Cindy...');
      expect(slide.myReaction).toBeNull();
    });
  });

  describe('5. Reaction List Popup (Screen 1 badge click)', () => {
    let storyId: string;

    beforeEach(async () => {
      const story = await QuickMoment.create({
        userId: alexUser.id,
        type: 'text',
        text: 'Hello world',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });
      storyId = story.id;

      await QuickMomentReaction.create({
        quickMomentId: storyId,
        userId: cindyUser.id,
        emoji: '😍',
      });
      await QuickMomentReaction.create({
        quickMomentId: storyId,
        userId: thirdUser.id,
        emoji: '🔥',
      });
    });

    it('should return reactors list with user info, timestamps, and breakdown', async () => {
      const res = await request(app)
        .get(`/api/v1/quick-moments/${storyId}/reactions`)
        .set('Authorization', `Bearer ${alexToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalReactions).toBe(2);
      expect(res.body.data.reactors).toHaveLength(2);
      expect(res.body.data.reactors[0].user.name).toBeDefined();
      expect(res.body.data.reactors[0].emoji).toBeDefined();
      expect(res.body.data.reactors[0].timeAgo).toBeDefined();
    });
  });

  describe('6. Interactions: React, Reply, and View', () => {
    let storyId: string;

    beforeEach(async () => {
      const story = await QuickMoment.create({
        userId: cindyUser.id,
        type: 'image',
        mediaUrl: 'https://example.com/cindy.jpg',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });
      storyId = story.id;
    });

    it('should add reaction and toggle off if same emoji sent again', async () => {
      // Add reaction
      const res1 = await request(app)
        .post(`/api/v1/quick-moments/${storyId}/react`)
        .set('Authorization', `Bearer ${alexToken}`)
        .send({ emoji: '😍' });

      expect(res1.status).toBe(200);
      expect(res1.body.data.action).toBe('added');
      expect(res1.body.data.myReaction).toBe('😍');

      // Toggle off
      const res2 = await request(app)
        .post(`/api/v1/quick-moments/${storyId}/react`)
        .set('Authorization', `Bearer ${alexToken}`)
        .send({ emoji: '😍' });

      expect(res2.status).toBe(200);
      expect(res2.body.data.action).toBe('removed');
      expect(res2.body.data.myReaction).toBeNull();
    });

    it('should reply to quick moment and increment repliesCount', async () => {
      const res = await request(app)
        .post(`/api/v1/quick-moments/${storyId}/reply`)
        .set('Authorization', `Bearer ${alexToken}`)
        .send({ message: 'Looks amazing Cindy!' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Looks amazing Cindy!');

      const updated = await QuickMoment.findByPk(storyId);
      expect(updated?.repliesCount).toBe(1);
    });

    it('should mark story as viewed and return viewers list', async () => {
      // Mark viewed
      const resView = await request(app)
        .post(`/api/v1/quick-moments/${storyId}/view`)
        .set('Authorization', `Bearer ${alexToken}`);

      expect(resView.status).toBe(200);
      expect(resView.body.data.isViewed).toBe(true);

      // Cindy gets viewers list
      const resList = await request(app)
        .get(`/api/v1/quick-moments/${storyId}/viewers`)
        .set('Authorization', `Bearer ${cindyToken}`);

      expect(resList.status).toBe(200);
      expect(resList.body.data.totalViews).toBe(1);
      expect(resList.body.data.viewers[0].userId).toBe(alexUser.id);
    });
  });

  describe('7. S3 Presigned URL & Delete Story', () => {
    it('should generate a presigned upload URL for direct mobile story upload', async () => {
      const res = await request(app)
        .post('/api/v1/quick-moments/upload-url')
        .set('Authorization', `Bearer ${alexToken}`)
        .send({ mimeType: 'image/jpeg', folder: 'quick_moments' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.key).toBeDefined();
      expect(res.body.data.publicUrl).toBeDefined();
    });

    it('should allow author to delete their own quick moment', async () => {
      const story = await QuickMoment.create({
        userId: alexUser.id,
        type: 'text',
        text: 'Temporary text',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'active',
        viewsCount: 0,
        repliesCount: 0,
      });

      const res = await request(app)
        .delete(`/api/v1/quick-moments/${story.id}`)
        .set('Authorization', `Bearer ${alexToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const deleted = await QuickMoment.findByPk(story.id);
      expect(deleted?.status).toBe('deleted');
    });
  });
});
