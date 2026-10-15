import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  Moment,
  MomentMedia,
  UserReport,
  Match,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Moments Feed, User Moments & Moment Detail — momentCount & compatibility', () => {
  let viewer: User;
  let viewerToken: string;

  let creator80Percent: User;
  let creator100Percent: User;
  let creatorZeroPercent: User;

  let intGaming: Interest;
  let intCooking: Interest;
  let intMusic: Interest;
  let intTravel: Interest;
  let intPhotography: Interest;
  let intArt: Interest;

  let moment80A: Moment;
  let moment80B: Moment;
  let moment100: Moment;
  let momentZero: Moment;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    intGaming = await Interest.create({
      name: 'Gaming_Moments_Test',
      icon: '🎮',
      isActive: true,
    });
    intCooking = await Interest.create({
      name: 'Cooking_Moments_Test',
      icon: '🍳',
      isActive: true,
    });
    intMusic = await Interest.create({
      name: 'Music_Moments_Test',
      icon: '🎵',
      isActive: true,
    });
    intTravel = await Interest.create({
      name: 'Travel_Moments_Test',
      icon: '✈️',
      isActive: true,
    });
    intPhotography = await Interest.create({
      name: 'Photography_Moments_Test',
      icon: '📷',
      isActive: true,
    });
    intArt = await Interest.create({
      name: 'Art_Moments_Test',
      icon: '🎨',
      isActive: true,
    });

    // 1. Viewer User with 5 interests: Gaming, Cooking, Music, Travel, Photography
    viewer = await User.create({
      username: 'viewer_moment_user',
      email: 'viewer_moment@example.com',
      gender: 'male',
      isActive: true,
      city: 'Mumbai',
    });

    viewerToken = generateToken({
      id: viewer.id,
      email: viewer.email,
      role: viewer.role,
    });

    await UserInterest.create({ userId: viewer.id, interestId: intGaming.id });
    await UserInterest.create({ userId: viewer.id, interestId: intCooking.id });
    await UserInterest.create({ userId: viewer.id, interestId: intMusic.id });
    await UserInterest.create({ userId: viewer.id, interestId: intTravel.id });
    await UserInterest.create({ userId: viewer.id, interestId: intPhotography.id });

    // Viewer's own moment
    await Moment.create({
      userId: viewer.id,
      caption: 'Viewer own moment',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(),
    });

    // 2. Creator with 80% compatibility (4 out of 5 shared: Gaming, Cooking, Music, Travel)
    creator80Percent = await User.create({
      username: 'creator_80_percent',
      email: 'creator80@example.com',
      firstName: 'Alice',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: creator80Percent.id, interestId: intGaming.id });
    await UserInterest.create({ userId: creator80Percent.id, interestId: intCooking.id });
    await UserInterest.create({ userId: creator80Percent.id, interestId: intMusic.id });
    await UserInterest.create({ userId: creator80Percent.id, interestId: intTravel.id });
    await UserInterest.create({ userId: creator80Percent.id, interestId: intArt.id });

    // Creator 80 has 2 active eligible moments
    const now = new Date();
    moment80A = await Moment.create({
      userId: creator80Percent.id,
      caption: 'Alice moment 1',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 2000),
      expiresAt: null,
    });
    await MomentMedia.create({
      momentId: moment80A.id,
      mediaUrl: 'https://example.com/alice1.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    moment80B = await Moment.create({
      userId: creator80Percent.id,
      caption: 'Alice moment 2',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 10 * 60 * 60 * 1000), // future 10h
    });
    await MomentMedia.create({
      momentId: moment80B.id,
      mediaUrl: 'https://example.com/alice2.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    // Plus 1 expired moment (must NOT be counted)
    await Moment.create({
      userId: creator80Percent.id,
      caption: 'Alice expired moment',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
    });

    // 3. Creator with 100% compatibility (all 5 identical interests)
    creator100Percent = await User.create({
      username: 'creator_100_percent',
      email: 'creator100@example.com',
      firstName: 'Bella',
      gender: 'female',
      isActive: true,
      city: 'Delhi',
    });
    await UserInterest.create({ userId: creator100Percent.id, interestId: intGaming.id });
    await UserInterest.create({ userId: creator100Percent.id, interestId: intCooking.id });
    await UserInterest.create({ userId: creator100Percent.id, interestId: intMusic.id });
    await UserInterest.create({ userId: creator100Percent.id, interestId: intTravel.id });
    await UserInterest.create({ userId: creator100Percent.id, interestId: intPhotography.id });

    moment100 = await Moment.create({
      userId: creator100Percent.id,
      caption: 'Bella 100 moment',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 500),
      expiresAt: null,
    });
    await MomentMedia.create({
      momentId: moment100.id,
      mediaUrl: 'https://example.com/bella1.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    // 4. Creator with 0% compatibility (0 interests saved)
    creatorZeroPercent = await User.create({
      username: 'creator_0_percent',
      email: 'creator0@example.com',
      firstName: 'Chloe',
      gender: 'female',
      isActive: true,
      city: 'Bangalore',
    });
    momentZero = await Moment.create({
      userId: creatorZeroPercent.id,
      caption: 'Chloe zero moment',
      status: 'active',
      audience: 'everyone',
      publishedAt: now,
      expiresAt: null,
    });
    await MomentMedia.create({
      momentId: momentZero.id,
      mediaUrl: 'https://example.com/chloe1.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Moments Feed (GET /api/v1/moments)', () => {
    it('should return momentCount and compatibility on each moment and inside creator object', async () => {
      const res = await request(app)
        .get('/api/v1/moments?scope=others')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.moments).toBeDefined();

      const moments = res.body.data.moments;
      expect(moments.length).toBeGreaterThan(0);

      for (const m of moments) {
        // Root level keys on moment item
        expect(m).toHaveProperty('momentCount');
        expect(typeof m.momentCount).toBe('number');
        expect(m).toHaveProperty('compatibility');
        expect(typeof m.compatibility.interestMatchPercentage).toBe('number');

        // Creator object keys
        expect(m.creator).toBeDefined();
        expect(m.creator).toHaveProperty('momentCount');
        expect(typeof m.creator.momentCount).toBe('number');
        expect(m.creator).toHaveProperty('compatibility');
        expect(typeof m.creator.compatibility.interestMatchPercentage).toBe('number');
      }

      // Check specific values for Alice (80% match, 2 eligible moments)
      const aliceMoment = moments.find((m: any) => m.creator.id === creator80Percent.id);
      expect(aliceMoment).toBeDefined();
      expect(aliceMoment.momentCount).toBe(2);
      expect(aliceMoment.compatibility.interestMatchPercentage).toBe(80);
      expect(aliceMoment.creator.momentCount).toBe(2);
      expect(aliceMoment.creator.compatibility.interestMatchPercentage).toBe(80);

      // Check specific values for Bella (100% match, 1 eligible moment)
      const bellaMoment = moments.find((m: any) => m.creator.id === creator100Percent.id);
      expect(bellaMoment).toBeDefined();
      expect(bellaMoment.momentCount).toBe(1);
      expect(bellaMoment.compatibility.interestMatchPercentage).toBe(100);
      expect(bellaMoment.creator.momentCount).toBe(1);
      expect(bellaMoment.creator.compatibility.interestMatchPercentage).toBe(100);

      // Check specific values for Chloe (0% match, 1 eligible moment)
      const chloeMoment = moments.find((m: any) => m.creator.id === creatorZeroPercent.id);
      expect(chloeMoment).toBeDefined();
      expect(chloeMoment.momentCount).toBe(1);
      expect(chloeMoment.compatibility.interestMatchPercentage).toBe(0);
      expect(chloeMoment.creator.momentCount).toBe(1);
      expect(chloeMoment.creator.compatibility.interestMatchPercentage).toBe(0);
    });

    it('should return momentCount and compatibility in stories tray mode', async () => {
      const res = await request(app)
        .get('/api/v1/moments?type=stories&scope=others')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stories).toBeDefined();

      const stories = res.body.data.stories;
      const aliceStory = stories.find((s: any) => s.creatorId === creator80Percent.id);
      expect(aliceStory).toBeDefined();
      expect(aliceStory.momentCount).toBe(2);
      expect(aliceStory.compatibility.interestMatchPercentage).toBe(80);
      expect(aliceStory.moments[0].momentCount).toBe(2);
      expect(aliceStory.moments[0].compatibility.interestMatchPercentage).toBe(80);
    });
  });

  describe('2. User Moments (GET /api/v1/moments/user/:userId and /moments/me)', () => {
    it('should return momentCount and compatibility at root, in creator, and on moments array for target user', async () => {
      const res = await request(app)
        .get(`/api/v1/moments/user/${creator80Percent.id}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Root level
      expect(res.body.data.momentCount).toBe(2);
      expect(res.body.data.compatibility).toBeDefined();
      expect(res.body.data.compatibility.interestMatchPercentage).toBe(80);

      // Moments list
      const moments = res.body.data.moments;
      expect(moments.length).toBe(2);
      for (const m of moments) {
        expect(m.momentCount).toBe(2);
        expect(m.compatibility.interestMatchPercentage).toBe(80);
        expect(m.creator.momentCount).toBe(2);
        expect(m.creator.compatibility.interestMatchPercentage).toBe(80);
      }
    });

    it('should return momentCount and 100% compatibility for authenticated user self moments (GET /api/v1/moments/me)', async () => {
      const res = await request(app)
        .get('/api/v1/moments/me')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.momentCount).toBe(1);
      expect(res.body.data.compatibility.interestMatchPercentage).toBe(100);
      expect(res.body.data.moments[0].momentCount).toBe(1);
      expect(res.body.data.moments[0].compatibility.interestMatchPercentage).toBe(100);
      expect(res.body.data.moments[0].creator.momentCount).toBe(1);
      expect(res.body.data.moments[0].creator.compatibility.interestMatchPercentage).toBe(100);
    });
  });

  describe('3. Single Moment Detail (GET /api/v1/moments/:momentId)', () => {
    it('should return momentCount and compatibility at moment root and in creator object', async () => {
      const res = await request(app)
        .get(`/api/v1/moments/${moment80A.id}`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const moment = res.body.data;
      expect(moment.momentCount).toBe(2);
      expect(moment.compatibility).toBeDefined();
      expect(moment.compatibility.interestMatchPercentage).toBe(80);

      expect(moment.creator).toBeDefined();
      expect(moment.creator.momentCount).toBe(2);
      expect(moment.creator.compatibility).toBeDefined();
      expect(moment.creator.compatibility.interestMatchPercentage).toBe(80);
    });
  });
});
