import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  SwipeAction,
  Moment,
  UserSubscription,
  SubscriptionPlan,
  SubscriptionFeature,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import moment from 'moment-timezone';

describe('Discovery Search & Authoritative Daily Swipe Limits', () => {
  let viewer: User;
  let viewerToken: string;

  let intCoding: Interest;
  let intMusic: Interest;
  let intGaming: Interest;
  let intHiking: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await SwipeAction.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await UserSubscription.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await Interest.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Seed Interests
    intCoding = await Interest.create({
      name: 'Coding',
      icon: '💻',
      category: 'Tech',
      isActive: true,
    });
    intMusic = await Interest.create({
      name: 'Music',
      icon: '🎵',
      category: 'Arts',
      isActive: true,
    });
    intGaming = await Interest.create({
      name: 'Gaming',
      icon: '🎮',
      category: 'Entertainment',
      isActive: true,
    });
    intHiking = await Interest.create({
      name: 'Hiking',
      icon: '🏔️',
      category: 'Outdoors',
      isActive: true,
    });

    // Create Viewer: looking for long_term, interests: Coding + Music, city: Mumbai
    viewer = await User.create({
      username: 'viewer_user',
      email: 'viewer@example.com',
      fullName: 'Viewer Sharma',
      gender: 'male',
      genderPreference: 'everyone',
      lookingFor: 'long_term',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      role: 'user',
      isSubscribed: false,
    });

    await UserInterest.create({ userId: viewer.id, interestId: intCoding.id });
    await UserInterest.create({ userId: viewer.id, interestId: intMusic.id });

    viewerToken = generateToken({
      id: viewer.id,
      email: viewer.email!,
      role: viewer.role,
    });
  });

  // =========================================================================
  // 1. Clean Response & Profile Card Fields
  // =========================================================================
  describe('1. Clean Response & Profile Card Fields', () => {
    let candidateMatch: User;
    let candidatePartial: User;
    let candidateNone: User;

    beforeEach(async () => {
      // Candidate 1: Coding + Music (shared 2), lookingFor: long_term, 2 active moments, 1 expired moment
      candidateMatch = await User.create({
        username: 'candidate_match',
        email: 'match@example.com',
        fullName: 'Aanya Sen',
        gender: 'female',
        lookingFor: 'long_term',
        city: 'Mumbai',
        latitude: 19.08,
        longitude: 72.88,
        about: 'Passionate coder and music listener.',
        dateOfBirth: '1998-05-15',
        isFaceVerified: true,
        lastActiveAt: new Date(),
        isActive: true,
        role: 'user',
      });
      await UserInterest.create({ userId: candidateMatch.id, interestId: intCoding.id });
      await UserInterest.create({ userId: candidateMatch.id, interestId: intMusic.id });

      // Moments for candidate 1
      await Moment.create({
        userId: candidateMatch.id,
        mediaType: 'image',
        mediaUrl: 'https://flirttime.s3.ap-south-1.amazonaws.com/moments/m1.jpg',
        caption: 'First active moment',
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000), // unexpired
      });
      await Moment.create({
        userId: candidateMatch.id,
        mediaType: 'image',
        mediaUrl: 'https://flirttime.s3.ap-south-1.amazonaws.com/moments/m2.jpg',
        caption: 'Second active moment',
        status: 'active',
        expiresAt: null, // persistent
      });
      await Moment.create({
        userId: candidateMatch.id,
        mediaType: 'image',
        mediaUrl: 'https://flirttime.s3.ap-south-1.amazonaws.com/moments/m_exp.jpg',
        caption: 'Expired moment',
        status: 'active',
        expiresAt: new Date(Date.now() - 3600000), // expired -> should not count
      });

      // Candidate 2: Music + Gaming (shared 1: Music), lookingFor: casual, 0 moments
      candidatePartial = await User.create({
        username: 'candidate_partial',
        email: 'partial@example.com',
        fullName: 'Kavya Verma',
        gender: 'female',
        lookingFor: 'casual',
        city: 'Indore, Madhya Pradesh',
        dateOfBirth: '2000-01-01',
        isFaceVerified: false,
        lastActiveAt: new Date(Date.now() - 5 * 60 * 1000),
        isActive: true,
        role: 'user',
      });
      await UserInterest.create({ userId: candidatePartial.id, interestId: intMusic.id });
      await UserInterest.create({ userId: candidatePartial.id, interestId: intGaming.id });

      // Candidate 3: Hiking (0 shared), no lookingFor, 1 active moment
      candidateNone = await User.create({
        username: 'candidate_none',
        email: 'none@example.com',
        fullName: 'Zara Khan',
        gender: 'female',
        lookingFor: null,
        city: 'Austin, Travis County, Texas, United States',
        dateOfBirth: '1995-10-10',
        isFaceVerified: true,
        lastActiveAt: new Date(Date.now() - 60 * 60 * 1000), // offline
        isActive: true,
        role: 'user',
      });
      await UserInterest.create({ userId: candidateNone.id, interestId: intHiking.id });
      await Moment.create({
        userId: candidateNone.id,
        mediaType: 'image',
        mediaUrl: 'https://flirttime.s3.ap-south-1.amazonaws.com/moments/m3.jpg',
        status: 'active',
        expiresAt: null,
      });
    });

    it('should return clean profile card fields without duplicate aliases or redundant totalCount', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify envelope has no data.data wrapping
      expect(res.body.data).toBeDefined();
      expect(res.body.data.profiles).toBeDefined();
      expect(res.body.data.pagination).toBeDefined();

      // Verify single canonical pagination total: totalCount must NOT exist at root
      expect(res.body.data.totalCount).toBeUndefined();
      expect(res.body.data.pagination.total).toBe(3);

      const matchCard = res.body.data.profiles.find((p: any) => p.id === candidateMatch.id);
      expect(matchCard).toBeDefined();

      // Required fields inspection
      expect(matchCard.id).toBe(candidateMatch.id);
      expect(matchCard.name).toBe('Aanya');
      expect(matchCard.username).toBe('candidate_match');
      expect(matchCard.age).toBeDefined();
      expect(matchCard.about).toBe('Passionate coder and music listener.');
      expect(matchCard.isVerified).toBe(true);
      expect(matchCard.isOnline).toBe(true);

      // Single complete location field (not duplicate city, state, country)
      expect(matchCard.location).toBe('Mumbai, Maharashtra, India');
      expect(matchCard.city).toBeUndefined();
      expect(matchCard.state).toBeUndefined();
      expect(matchCard.country).toBeUndefined();

      // Canonical interest matching
      expect(matchCard.interests.map((i: any) => i.name).sort()).toEqual(['Coding', 'Music']);
      expect(matchCard.sharedInterests.sort()).toEqual(['Coding', 'Music']);
      expect(matchCard.commonInterestsCount).toBe(2);
      expect(matchCard.commonInterestsCount).toBe(matchCard.sharedInterests.length);

      // Profile match percentage: 100% interests + 100% lookingFor -> 100%
      expect(matchCard.profileMatchPercentage).toBe(100);

      // Total moments: exactly 2 active unexpired moments (expired moment excluded)
      expect(matchCard.totalMoments).toBe(2);

      // No duplicate or raw ORM fields leaked
      expect(matchCard.password).toBeUndefined();
      expect(matchCard.token).toBeUndefined();
      expect(matchCard.coins).toBeUndefined();
      expect(matchCard.vibeScore).toBeUndefined();
      expect(matchCard.photos).toBeUndefined();
      expect(matchCard.profilePicture).toBeUndefined();
    });

    it('should compute partial interest match and preference compatibility accurately', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);

      const partialCard = res.body.data.profiles.find((p: any) => p.id === candidatePartial.id);
      expect(partialCard).toBeDefined();

      // Candidate 2 has Music (shared) + Gaming (not shared). Viewer has Coding + Music.
      // Canonical shared: Music only
      expect(partialCard.sharedInterests).toEqual(['Music']);
      expect(partialCard.commonInterestsCount).toBe(1);
      expect(partialCard.commonInterestsCount).toBe(partialCard.sharedInterests.length);

      // Interest match: 1 common / max(2, 2) = 50%
      // Preference match: viewer is 'long_term', candidate is 'casual' -> 0%
      // Combined match: round(0.7 * 50 + 0.3 * 0) = 35%
      expect(partialCard.profileMatchPercentage).toBe(35);

      // Total moments: 0
      expect(partialCard.totalMoments).toBe(0);

      // Location formatted correctly
      expect(partialCard.location).toBe('Indore, Madhya Pradesh, India');
    });

    it('should compute zero shared interests and handle missing preferences gracefully', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);

      const noneCard = res.body.data.profiles.find((p: any) => p.id === candidateNone.id);
      expect(noneCard).toBeDefined();

      expect(noneCard.sharedInterests).toEqual([]);
      expect(noneCard.commonInterestsCount).toBe(0);
      expect(noneCard.profileMatchPercentage).toBe(0);
      expect(noneCard.totalMoments).toBe(1);
      expect(noneCard.location).toBe('Austin, Travis County, Texas, United States');
    });
  });

  // =========================================================================
  // 2. Authoritative Daily Swipe Limits (Server-Side)
  // =========================================================================
  describe('2. Authoritative Daily Swipe Limits', () => {
    let targets: User[];

    beforeEach(async () => {
      targets = [];
      for (let i = 1; i <= 15; i++) {
        const u = await User.create({
          username: `target_swipe_${i}`,
          email: `target_${i}@example.com`,
          fullName: `Target User ${i}`,
          gender: 'female',
          isActive: true,
          role: 'user',
        });
        targets.push(u);
      }
    });

    it('should allow non-subscribed user to perform exactly 10 swipes, and reject the 11th with 429 DAILY_SWIPE_LIMIT_REACHED', async () => {
      // First 10 swipes on 10 different target users
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[i].id, action: 'like' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Verify 10 swipes are recorded
      const totalSwipesInDb = await SwipeAction.count({ where: { userId: viewer.id } });
      expect(totalSwipesInDb).toBe(10);

      // 11th swipe must be blocked with HTTP 429
      const eleventhRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: targets[10].id, action: 'like' });

      expect(eleventhRes.status).toBe(429);
      expect(eleventhRes.body.success).toBe(false);
      expect(eleventhRes.body.error).toBe('DAILY_SWIPE_LIMIT_REACHED');
      expect(eleventhRes.body.message).toMatch(/limit/i);

      // Verify 11th swipe was rolled back and NOT persisted
      const finalCountInDb = await SwipeAction.count({ where: { userId: viewer.id } });
      expect(finalCountInDb).toBe(10);
    });

    it('should not consume additional quota on repeated / idempotent swipe retry', async () => {
      // 9 distinct swipes
      for (let i = 0; i < 9; i++) {
        await request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[i].id, action: 'like' });
      }

      // Repeated identical swipe on target 0 (retry)
      const retryRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: targets[0].id, action: 'like' });

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.success).toBe(true);

      // Still 9 swipes in DB
      const countAfterRetry = await SwipeAction.count({ where: { userId: viewer.id } });
      expect(countAfterRetry).toBe(9);

      // 10th distinct swipe still succeeds
      const tenthRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: targets[9].id, action: 'like' });

      expect(tenthRes.status).toBe(200);
      expect(tenthRes.body.success).toBe(true);
    });

    it('should allow subscribed users with active subscription to swipe without a daily cap', async () => {
      // Grant active subscription
      const plan = await SubscriptionPlan.create({
        name: 'Weekly Premium',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        description: 'Unlimited swipes',
        bonus_coins: 50,
        is_recurring: true,
        billing_cycle: 'weekly',
        google_product_id: 'weekly_premium',
        apple_product_id: 'com.flirttime.weekly_prem',
        sort_order: 1,
      });

      await UserSubscription.create({
        userId: viewer.id,
        planId: plan.id,
        productId: plan.apple_product_id,
        platform: 'ios',
        status: 'active',
        isEntitled: true,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000), // 7 days in future
      });

      // Subscribed user performs 12 swipes (exceeding free cap of 10)
      for (let i = 0; i < 12; i++) {
        const res = await request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[i].id, action: 'like' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      const totalSwipes = await SwipeAction.count({ where: { userId: viewer.id } });
      expect(totalSwipes).toBe(12);
    });

    it('should enforce 10-swipe limit when a subscription has expired', async () => {
      // Create EXPIRED subscription in the past
      await UserSubscription.create({
        userId: viewer.id,
        productId: 'expired_plan',
        platform: 'ios',
        status: 'expired',
        isEntitled: false,
        startsAt: new Date(Date.now() - 30 * 86400000),
        expiresAt: new Date(Date.now() - 1 * 86400000), // expired yesterday
      });

      viewer.isSubscribed = false;
      viewer.subscriptionExpiresAt = new Date(Date.now() - 1 * 86400000);
      await viewer.save();

      // Free quota limit should be enforced
      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[i].id, action: 'like' });
        expect(res.status).toBe(200);
      }

      // 11th swipe rejected with 429
      const rejectedRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: targets[10].id, action: 'like' });

      expect(rejectedRes.status).toBe(429);
      expect(rejectedRes.body.error).toBe('DAILY_SWIPE_LIMIT_REACHED');
    });

    it('should respect timezone boundaries (swipes from yesterday in configured timezone do not count towards today)', async () => {
      const tz = process.env.APP_TIMEZONE || process.env.TIMEZONE || 'UTC';
      // Create 10 swipes dated yesterday in configured timezone
      const yesterdayDate = moment.tz(tz).subtract(1, 'day').hour(12).minute(0).toDate();

      for (let i = 0; i < 10; i++) {
        await SwipeAction.create({
          userId: viewer.id,
          targetUserId: targets[i].id,
          action: 'like',
          createdAt: yesterdayDate,
          updatedAt: yesterdayDate,
        });
      }

      // Yesterday had 10 swipes, but today has 0 swipes!
      // Today's new swipe on target 10 must succeed
      const todaySwipeRes = await request(app)
        .post('/api/v1/discovery/actions')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ targetUserId: targets[10].id, action: 'like' });

      expect(todaySwipeRes.status).toBe(200);
      expect(todaySwipeRes.body.success).toBe(true);
    });

    it('should atomically serialize concurrent swipes under row-level locking', async () => {
      // Seed 9 swipes so quota remaining is exactly 1
      for (let i = 0; i < 9; i++) {
        await SwipeAction.create({
          userId: viewer.id,
          targetUserId: targets[i].id,
          action: 'like',
        });
      }

      // Launch 2 concurrent swipe requests simultaneously for targets[9] and targets[10]
      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[9].id, action: 'like' }),
        request(app)
          .post('/api/v1/discovery/actions')
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ targetUserId: targets[10].id, action: 'like' }),
      ]);

      const statuses = [resA.status, resB.status].sort();
      // Exactly one must succeed (200), and exactly one must fail (429)
      expect(statuses).toEqual([200, 429]);

      // Total swipes in DB must be exactly 10
      const totalSwipes = await SwipeAction.count({ where: { userId: viewer.id } });
      expect(totalSwipes).toBe(10);
    });
  });
});
