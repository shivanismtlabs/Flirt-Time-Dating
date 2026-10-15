import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  UserBlock,
  SwipeAction,
  UserDiscoveryPreference,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Discovery Filters & Search APIs', () => {
  let currentUser: User;
  let authToken: string;

  let meera: User;
  let priya: User;
  let ananya: User;
  let alex: User;
  let rahul: User;
  let blockedFemale: User;
  let swipedFemale: User;
  let inactiveFemale: User;

  let cinemaInterest: Interest;
  let cookingInterest: Interest;
  let gamingInterest: Interest;
  let drawingInterest: Interest;
  let fitnessInterest: Interest;
  let yogaInterest: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    // Fetch canonical interests (already seeded by initDb)
    cinemaInterest = (await Interest.findOne({ where: { name: 'Cinema' } }))!;
    cookingInterest = (await Interest.findOne({ where: { name: 'Cooking' } }))!;
    gamingInterest = (await Interest.findOne({ where: { name: 'Gaming' } }))!;
    drawingInterest = (await Interest.findOne({ where: { name: 'Drawing' } }))!;
    fitnessInterest = (await Interest.findOne({ where: { name: 'Fitness' } }))!;
    yogaInterest = (await Interest.findOne({ where: { name: 'Yoga' } }))!;
  });

  beforeEach(async () => {
    await SwipeAction.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await UserDiscoveryPreference.destroy({ where: {} });
    await User.destroy({ where: {} });

    const now = new Date();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // 1. Current Authenticated User (Male, 25, Mumbai)
    currentUser = await User.create({
      username: 'filter_tester_user',
      email: 'filter.tester@example.com',
      fullName: 'Filter Tester',
      gender: 'male',
      dateOfBirth: '2001-05-15',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      isProfileComplete: true,
      lastActiveAt: now,
    });

    authToken = generateToken({
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    });

    await UserInterest.create({ userId: currentUser.id, interestId: gamingInterest.id });
    await UserInterest.create({ userId: currentUser.id, interestId: cookingInterest.id });

    // 2. Meera (Female, 26, Mumbai ~6km, Verified, Online, Long-term/relationship, Cooking + Drawing)
    meera = await User.create({
      username: 'meera_filter',
      email: 'meera.filter@example.com',
      firstName: 'Meera',
      fullName: 'Meera Sharma',
      gender: 'female',
      dateOfBirth: '2000-01-15', // 26 y/o
      city: 'Mumbai',
      latitude: 19.12,
      longitude: 72.85,
      isFaceVerified: true,
      lookingFor: 'relationship',
      profilePicture: 'photos/meera/profile.jpg',
      isActive: true,
      isProfileComplete: true,
      lastActiveAt: now,
    });
    await UserInterest.create({ userId: meera.id, interestId: cookingInterest.id });
    await UserInterest.create({ userId: meera.id, interestId: drawingInterest.id });

    // 3. Priya (Female, 22, Mumbai ~2km, NOT verified, Offline, Casual, Cinema + Fitness)
    priya = await User.create({
      username: 'priya_filter',
      email: 'priya.filter@example.com',
      firstName: 'Priya',
      gender: 'female',
      dateOfBirth: '2004-03-20', // 22 y/o
      city: 'Mumbai',
      latitude: 19.085,
      longitude: 72.88,
      isFaceVerified: false,
      lookingFor: 'something_casual',
      profilePicture: 'photos/priya/profile.jpg',
      isActive: true,
      isProfileComplete: true,
      lastActiveAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
    });
    await UserInterest.create({ userId: priya.id, interestId: cinemaInterest.id });
    await UserInterest.create({ userId: priya.id, interestId: fitnessInterest.id });

    // 4. Ananya (Female, 35, Delhi ~1150km, Verified, Online, Not sure yet, Yoga)
    ananya = await User.create({
      username: 'ananya_filter',
      email: 'ananya.filter@example.com',
      firstName: 'Ananya',
      gender: 'female',
      dateOfBirth: '1991-08-10', // 35 y/o
      city: 'Delhi',
      latitude: 28.6139,
      longitude: 77.209,
      isFaceVerified: true,
      lookingFor: 'figuring_out',
      profilePicture: 'photos/ananya/profile.jpg',
      isActive: true,
      isProfileComplete: true,
      lastActiveAt: now,
    });
    await UserInterest.create({ userId: ananya.id, interestId: yogaInterest.id });

    // 5. Alex (Non-binary, 24, Mumbai ~1km, Verified, Online, Long-term, Gaming)
    alex = await User.create({
      username: 'alex_filter',
      email: 'alex.filter@example.com',
      firstName: 'Alex',
      gender: 'non-binary',
      dateOfBirth: '2002-06-12', // 24 y/o
      city: 'Mumbai',
      latitude: 19.08,
      longitude: 72.87,
      isFaceVerified: true,
      lookingFor: 'relationship',
      profilePicture: 'photos/alex/profile.jpg',
      isActive: true,
      isProfileComplete: true,
      lastActiveAt: now,
    });
    await UserInterest.create({ userId: alex.id, interestId: gamingInterest.id });

    // 6. Rahul (Male, 28, Mumbai ~2km, Not verified, Offline, Long-term, Gaming)
    rahul = await User.create({
      username: 'rahul_filter',
      email: 'rahul.filter@example.com',
      firstName: 'Rahul',
      gender: 'male',
      dateOfBirth: '1998-04-05', // 28 y/o
      city: 'Mumbai',
      latitude: 19.09,
      longitude: 72.86,
      isFaceVerified: false,
      lookingFor: 'relationship',
      isActive: true,
      lastActiveAt: twoHoursAgo,
      updatedAt: twoHoursAgo,
    });
    await UserInterest.create({ userId: rahul.id, interestId: gamingInterest.id });

    // 7. Blocked Female User (Should be excluded)
    blockedFemale = await User.create({
      username: 'blocked_female',
      email: 'blocked@example.com',
      firstName: 'BlockedUser',
      gender: 'female',
      dateOfBirth: '2000-01-01',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
    });
    await UserBlock.create({
      userId: currentUser.id,
      blockedUserId: blockedFemale.id,
      reason: 'Harassment',
    });

    // 8. Swiped Female User (Should be excluded)
    swipedFemale = await User.create({
      username: 'swiped_female',
      email: 'swiped@example.com',
      firstName: 'SwipedUser',
      gender: 'female',
      dateOfBirth: '1999-05-05',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
    });
    await SwipeAction.create({
      userId: currentUser.id,
      targetUserId: swipedFemale.id,
      action: 'like',
    });

    // 9. Inactive Female User (Should be excluded)
    inactiveFemale = await User.create({
      username: 'inactive_female',
      email: 'inactive@example.com',
      firstName: 'InactiveUser',
      gender: 'female',
      dateOfBirth: '2000-02-02',
      city: 'Mumbai',
      isActive: false,
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  // =========================================================================
  // 1. GET /api/v1/discovery/filters/options
  // =========================================================================
  describe('1. GET /api/v1/discovery/filters/options', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/discovery/filters/options');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return authoritative options with 20 UI interests and limit constants', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/filters/options')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();

      const { genders, age, distance, lookingFor, interests, verification, online, defaults } =
        res.body.data;

      // Gender options
      expect(genders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'women', label: 'Women' }),
          expect.objectContaining({ id: 'men', label: 'Men' }),
          expect.objectContaining({ id: 'non_binary', label: 'Non-binary' }),
          expect.objectContaining({ id: 'everyone', label: 'Everyone' }),
        ])
      );

      // Age limits
      expect(age.min).toBe(18);
      expect(age.max).toBe(70);

      // Distance limits
      expect(distance.minKm).toBe(1);
      expect(distance.anywhereValue).toBeNull();

      // Looking For
      expect(lookingFor).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'long_term', label: 'Long-term' }),
          expect.objectContaining({ id: 'casual', label: 'Something casual' }),
          expect.objectContaining({ id: 'not_sure', label: 'Not sure yet' }),
        ])
      );

      // 20 UI Interests presence check
      const interestNames = interests.map((i: any) => i.name);
      const expectedInterests = [
        'Cinema',
        'Cooking',
        'Dance',
        'Drawing',
        'Extreme',
        'Fitness',
        'Gaming',
        'Handcraft',
        'Lyrics Music',
        'Party',
        'Pets',
        'Photography',
        'Planting',
        'Reading',
        'Shopping',
        'Sports',
        'Television',
        'Travelling',
        'Writing',
        'Yoga',
      ];
      for (const name of expectedInterests) {
        expect(interestNames).toContain(name);
      }

      // Verification & Online configuration
      expect(verification.field).toBe('verifiedOnly');
      expect(online.field).toBe('onlineOnly');
      expect(online.freshnessMinutes).toBe(15);

      // Defaults
      expect(defaults.ageMin).toBe(18);
      expect(defaults.ageMax).toBe(70);
      expect(defaults.maxDistanceKm).toBeNull();
    });
  });

  // =========================================================================
  // 2. GET /api/v1/discovery/filters
  // =========================================================================
  describe('2. GET /api/v1/discovery/filters', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/discovery/filters');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return documented defaults without creating duplicate DB records for new user', async () => {
      // Ensure no record exists in DB initially
      const countBefore = await UserDiscoveryPreference.count({
        where: { userId: currentUser.id },
      });
      expect(countBefore).toBe(0);

      const res = await request(app)
        .get('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe(currentUser.id);
      expect(res.body.data.isDefault).toBe(true);
      expect(res.body.data.ageMin).toBe(18);
      expect(res.body.data.ageMax).toBe(70);
      expect(res.body.data.maxDistanceKm).toBeNull(); // Anywhere
      expect(res.body.data.genders).toEqual(['everyone']);
      expect(res.body.data.lookingFor).toEqual([]);
      expect(res.body.data.interestIds).toEqual([]);
      expect(res.body.data.verifiedOnly).toBe(false);
      expect(res.body.data.onlineOnly).toBe(false);

      // Ensure GET did not persist empty preference row
      const countAfter = await UserDiscoveryPreference.count({
        where: { userId: currentUser.id },
      });
      expect(countAfter).toBe(0);
    });
  });

  // =========================================================================
  // 3. PUT /api/v1/discovery/filters (Validation & Persistence)
  // =========================================================================
  describe('3. PUT /api/v1/discovery/filters', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .send({ ageMin: 20 });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should save valid preferences and return updated DTO', async () => {
      const payload = {
        genders: ['women', 'non_binary'],
        ageMin: 21,
        ageMax: 30,
        maxDistanceKm: 50,
        lookingFor: ['long_term', 'casual'],
        interestIds: [cookingInterest.id, gamingInterest.id],
        verifiedOnly: true,
        onlineOnly: true,
      };

      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userId).toBe(currentUser.id);
      expect(res.body.data.genders).toEqual(['women', 'non_binary']);
      expect(res.body.data.ageMin).toBe(21);
      expect(res.body.data.ageMax).toBe(30);
      expect(res.body.data.maxDistanceKm).toBe(50);
      expect(res.body.data.lookingFor).toEqual(['long_term', 'casual']);
      expect(res.body.data.interestIds).toContain(cookingInterest.id);
      expect(res.body.data.interestIds).toContain(gamingInterest.id);
      expect(res.body.data.verifiedOnly).toBe(true);
      expect(res.body.data.onlineOnly).toBe(true);

      // Verify persisted row in DB
      const persisted = await UserDiscoveryPreference.findOne({
        where: { userId: currentUser.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted?.ageMin).toBe(21);
      expect(persisted?.ageMax).toBe(30);
      expect(persisted?.maxDistanceKm).toBe(50);
    });

    it('should distinguish explicitly supplied null distance (Anywhere) from numeric distance', async () => {
      // First save with 40km
      await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ maxDistanceKm: 40 });

      // Then update explicitly to null (Anywhere)
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ maxDistanceKm: null });

      expect(res.status).toBe(200);
      expect(res.body.data.maxDistanceKm).toBeNull();

      const pref = await UserDiscoveryPreference.findOne({ where: { userId: currentUser.id } });
      expect(pref?.maxDistanceKm).toBeNull();
    });

    it('should reject ageMin greater than ageMax with 400', async () => {
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ageMin: 35,
          ageMax: 25,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(
        res.body.message.includes('ageMin cannot be greater than ageMax') ||
          res.body.message.includes('Validation failed')
      ).toBe(true);
    });

    it('should reject invalid or unsupported interest UUIDs with 400', async () => {
      const nonExistentId = '99999999-9999-4999-8999-999999999999';
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          interestIds: [nonExistentId],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or inactive interest/i);
    });

    it('should reject unknown fields strictly with 400', async () => {
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          ageMin: 20,
          unknownField: 'malicious',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should deduplicate interest IDs and gender selections', async () => {
      const res = await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women', 'women', 'men'],
          interestIds: [cookingInterest.id, cookingInterest.id],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.genders).toEqual(['women', 'men']);
      expect(res.body.data.interestIds).toEqual([cookingInterest.id]);
    });

    it('should handle repeated preference updates safely without duplicate records', async () => {
      await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ageMin: 20, ageMax: 40 });

      await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ageMin: 22, ageMax: 45 });

      const count = await UserDiscoveryPreference.count({
        where: { userId: currentUser.id },
      });
      expect(count).toBe(1);

      const pref = await UserDiscoveryPreference.findOne({
        where: { userId: currentUser.id },
      });
      expect(pref?.ageMin).toBe(22);
      expect(pref?.ageMax).toBe(45);
    });
  });

  // =========================================================================
  // 4. POST /api/v1/discovery/filters/reset
  // =========================================================================
  describe('4. POST /api/v1/discovery/filters/reset', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).post('/api/v1/discovery/filters/reset');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reset custom preferences to documented defaults atomically without deleting other data', async () => {
      // First save custom filters
      await request(app)
        .put('/api/v1/discovery/filters')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['men'],
          ageMin: 30,
          ageMax: 50,
          maxDistanceKm: 25,
          verifiedOnly: true,
          onlineOnly: true,
        });

      // Call reset
      const res = await request(app)
        .post('/api/v1/discovery/filters/reset')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.genders).toEqual(['everyone']);
      expect(res.body.data.ageMin).toBe(18);
      expect(res.body.data.ageMax).toBe(70);
      expect(res.body.data.maxDistanceKm).toBeNull();
      expect(res.body.data.lookingFor).toEqual([]);
      expect(res.body.data.interestIds).toEqual([]);
      expect(res.body.data.verifiedOnly).toBe(false);
      expect(res.body.data.onlineOnly).toBe(false);

      // Verify user profile and interests still exist intact
      const refreshedUser = await User.findByPk(currentUser.id);
      expect(refreshedUser).not.toBeNull();
      expect(refreshedUser?.fullName).toBe('Filter Tester');
    });
  });

  // =========================================================================
  // 5. POST /api/v1/discovery/search (Filtering, Matching & Count Accuracy)
  // =========================================================================
  describe('5. POST /api/v1/discovery/search', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).post('/api/v1/discovery/search').send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should exclude self, blocked users, swiped users, and inactive users', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['everyone'],
          maxDistanceKm: null, // Anywhere
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);

      // Exclude self
      expect(returnedIds).not.toContain(currentUser.id);
      // Exclude blocked user
      expect(returnedIds).not.toContain(blockedFemale.id);
      // Exclude swiped user
      expect(returnedIds).not.toContain(swipedFemale.id);
      // Exclude inactive user
      expect(returnedIds).not.toContain(inactiveFemale.id);

      // Should contain eligible users
      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).toContain(priya.id);
      expect(returnedIds).toContain(ananya.id);
      expect(returnedIds).toContain(alex.id);
      expect(returnedIds).toContain(rahul.id);
    });

    it('should filter by Gender correctly (e.g. Women only)', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const profiles = res.body.data.profiles;
      const returnedIds = profiles.map((p: any) => p.id);

      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).toContain(priya.id);
      expect(returnedIds).toContain(ananya.id);

      // Alex is non-binary, Rahul is male -> Excluded
      expect(returnedIds).not.toContain(alex.id);
      expect(returnedIds).not.toContain(rahul.id);

      expect(res.body.data.totalCount).toBe(profiles.length);
    });

    it('should filter by Non-binary gender correctly', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['non_binary'],
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);

      expect(returnedIds).toContain(alex.id);
      expect(returnedIds).not.toContain(meera.id);
      expect(returnedIds).not.toContain(rahul.id);
    });

    it('should filter by Age Range correctly', async () => {
      // Filter 25 to 30 years old -> Meera (26) & Rahul (28)
      // Priya is 22 (too young), Ananya is 35 (too old)
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['everyone'],
          ageMin: 25,
          ageMax: 30,
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);

      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).toContain(rahul.id);
      expect(returnedIds).not.toContain(priya.id);
      expect(returnedIds).not.toContain(ananya.id);
    });

    it('should filter by Distance (maxDistanceKm) and support Anywhere (null)', async () => {
      // 10km limit in Mumbai -> Meera (~6km), Priya (~2km), Alex (~1km), Rahul (~2km)
      // Ananya is in Delhi (~1150km) -> Excluded
      const resNearby = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          maxDistanceKm: 10,
        });

      expect(resNearby.status).toBe(200);
      const nearbyIds = resNearby.body.data.profiles.map((p: any) => p.id);
      expect(nearbyIds).toContain(meera.id);
      expect(nearbyIds).toContain(priya.id);
      expect(nearbyIds).not.toContain(ananya.id);

      // Anywhere (null) -> Ananya in Delhi is included
      const resAnywhere = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          maxDistanceKm: null,
        });

      expect(resAnywhere.status).toBe(200);
      const anywhereIds = resAnywhere.body.data.profiles.map((p: any) => p.id);
      expect(anywhereIds).toContain(ananya.id);
    });

    it('should filter by Looking For compatibility correctly', async () => {
      // Filter 'long_term' -> Meera (relationship) & Alex (relationship) & Rahul (relationship)
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          lookingFor: ['long_term'],
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);
      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).not.toContain(priya.id); // casual
      expect(returnedIds).not.toContain(ananya.id); // not_sure
    });

    it('should filter by Interests using the documented OR rule (at least one shared)', async () => {
      // Search with [Drawing, Yoga] -> Meera has Drawing, Ananya has Yoga
      // Priya has Cinema + Fitness -> Excluded
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          interestIds: [drawingInterest.id, yogaInterest.id],
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);
      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).toContain(ananya.id);
      expect(returnedIds).not.toContain(priya.id);
    });

    it('should filter by Verified Only correctly (isFaceVerified: true)', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          verifiedOnly: true,
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);
      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).toContain(ananya.id);
      expect(returnedIds).not.toContain(priya.id); // unverified
    });

    it('should filter by Online Only correctly (active within freshness threshold)', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          onlineOnly: true,
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.profiles.map((p: any) => p.id);
      expect(returnedIds).toContain(meera.id); // online
      expect(returnedIds).toContain(ananya.id); // online
      expect(returnedIds).not.toContain(priya.id); // inactive 2h ago
    });

    it('should support match count query (countOnly: true) returning accurate totalCount and empty profiles', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          verifiedOnly: true,
          countOnly: true,
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profiles).toEqual([]);
      // Meera & Ananya match
      expect(res.body.data.totalCount).toBe(2);
      expect(res.body.data.pagination.total).toBe(2);
    });

    it('should return empty list and zero count when no profile matches strict filters', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          ageMin: 60,
          ageMax: 70, // No female users in this age bracket
          maxDistanceKm: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profiles).toEqual([]);
      expect(res.body.data.totalCount).toBe(0);
      expect(res.body.data.pagination.hasMore).toBe(false);
    });

    it('should support pagination (page, limit) and compute hasMore accurately', async () => {
      // 3 eligible women: Meera, Priya, Ananya
      const resPage1 = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          maxDistanceKm: null,
          page: 1,
          limit: 2,
        });

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.profiles.length).toBe(2);
      expect(resPage1.body.data.pagination.total).toBe(3);
      expect(resPage1.body.data.pagination.hasMore).toBe(true);
      expect(resPage1.body.data.pagination.nextCursor).not.toBeNull();

      const resPage2 = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          maxDistanceKm: null,
          page: 2,
          limit: 2,
        });

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.profiles.length).toBe(1);
      expect(resPage2.body.data.pagination.hasMore).toBe(false);
    });

    it('should enforce public DTO hygiene: never expose passwords, tokens, or raw models', async () => {
      const res = await request(app)
        .post('/api/v1/discovery/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          genders: ['women'],
          limit: 1,
        });

      expect(res.status).toBe(200);
      const profile = res.body.data.profiles[0];

      expect(profile).toBeDefined();
      expect(profile.id).toBeDefined();
      expect(profile.name).toBeDefined();
      expect(profile.username).toBeDefined();
      expect(profile.age).toBeDefined();
      expect(profile.isVerified).toBeDefined();

      // Ensure no private or raw fields exposed
      expect(profile.password).toBeUndefined();
      expect(profile.token).toBeUndefined();
      expect(profile.role).toBeUndefined();
      expect(profile.coins).toBeUndefined();
      expect(profile.latitude).toBeUndefined(); // precise coordinate protected
      expect(profile.longitude).toBeUndefined(); // precise coordinate protected
      expect(profile._previousDataValues).toBeUndefined();
    });
  });
});
