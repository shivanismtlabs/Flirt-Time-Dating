import request from 'supertest';
import app from '../src/app';
import { sequelize, User, Interest, UserInterest, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Discovery People API (GET /api/v1/discovery/people)', () => {
  let currentUser: User;
  let meeraUser: User;
  let rahulUser: User;
  let authToken: string;

  let gamingInterest: Interest;
  let cookingInterest: Interest;
  let photographyInterest: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    // Find or create interests (already seeded by initDb)
    [gamingInterest] = await Interest.findOrCreate({
      where: { name: 'Gaming' },
      defaults: {
        name: 'Gaming',
        icon: '🎮',
        category: 'Entertainment',
        isActive: true,
      },
    });

    [cookingInterest] = await Interest.findOrCreate({
      where: { name: 'Cooking' },
      defaults: {
        name: 'Cooking',
        icon: '🍳',
        category: 'Lifestyle',
        isActive: true,
      },
    });

    [photographyInterest] = await Interest.findOrCreate({
      where: { name: 'Photography' },
      defaults: {
        name: 'Photography',
        icon: '📷',
        category: 'Creativity',
        isActive: true,
      },
    });
  });

  beforeEach(async () => {
    await UserInterest.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });

    // 1. Current Authenticated User (Male, likes Women, into Gaming & Photography)
    currentUser = await User.create({
      username: 'current_user_1',
      email: 'current@example.com',
      fullName: 'Current User',
      gender: 'male',
      genderPreference: 'women',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      isProfileComplete: true,
    });

    authToken = generateToken({
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    });

    // Current user has Gaming & Photography
    await UserInterest.create({ userId: currentUser.id, interestId: gamingInterest.id });
    await UserInterest.create({ userId: currentUser.id, interestId: photographyInterest.id });

    // 2. Meera (Female, 26, Verified, in Mumbai, into Cooking & Gaming -> Matches screenshot!)
    meeraUser = await User.create({
      username: 'meera_26',
      email: 'meera@example.com',
      firstName: 'Meera',
      fullName: 'Meera Sharma',
      dateOfBirth: '2000-01-15', // 26 years old
      gender: 'female',
      city: 'Mumbai',
      latitude: 19.12,
      longitude: 72.85,
      isFaceVerified: true,
      profilePicture: 'photos/meera/profile.jpg',
      isActive: true,
      isProfileComplete: true,
    });

    // Meera has Cooking & Gaming
    await UserInterest.create({ userId: meeraUser.id, interestId: cookingInterest.id });
    await UserInterest.create({ userId: meeraUser.id, interestId: gamingInterest.id });

    // 3. Rahul (Male user)
    rahulUser = await User.create({
      username: 'rahul_28',
      email: 'rahul@example.com',
      firstName: 'Rahul',
      dateOfBirth: '1998-05-20',
      gender: 'male',
      city: 'Delhi',
      isActive: true,
    });

    await UserInterest.create({ userId: rahulUser.id, interestId: photographyInterest.id });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Authentication Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/discovery/people');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Fetching People Feed without Filter', () => {
    it('should fetch eligible people matching gender preferences and exclude self', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toBeDefined();

      // Current user wants 'women', so only Meera is returned (Rahul is male, self is excluded)
      const users = res.body.data.users;
      expect(users.length).toBe(1);

      const meeraProfile = users[0];
      expect(meeraProfile.name).toBe('Meera');
      expect(meeraProfile.age).toBe(26);
      expect(meeraProfile.isVerified).toBe(true);
      expect(meeraProfile.city).toBe('Mumbai');
      expect(meeraProfile.distanceKm).toBeGreaterThan(0);
      expect(meeraProfile.profilePhoto).toBe('photos/meera/profile.jpg');

      // Shared interests comparison
      // Current user has [Gaming, Photography], Meera has [Cooking, Gaming] -> Shared is ['Gaming']
      expect(meeraProfile.sharedInterests).toContain('Gaming');
      expect(meeraProfile.sharedInterests).not.toContain('Cooking');

      // Interest tags on Meera's card
      expect(meeraProfile.interestTags).toContain('Cooking');
      expect(meeraProfile.interestTags).toContain('Gaming');

      // Vibe score percentage
      expect(meeraProfile.vibeScore).toBeGreaterThanOrEqual(70);
    });
  });

  describe('3. Filtering by Interest (e.g. Showing Gaming)', () => {
    it('should filter people by interestId correctly', async () => {
      const res = await request(app)
        .get(`/api/v1/discovery/people?interestId=${gamingInterest.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.filter).toBeDefined();
      expect(res.body.data.filter.name).toBe('Gaming');
      expect(res.body.data.filter.icon).toBe('🎮');

      const users = res.body.data.users;
      expect(users.length).toBe(1);
      expect(users[0].name).toBe('Meera');
      expect(users[0].interestTags).toContain('Gaming');
    });

    it('should return empty list if no eligible user has the filtered interest', async () => {
      // Find or create an interest no female user has
      const [tennisInterest] = await Interest.findOrCreate({
        where: { name: 'Tennis' },
        defaults: {
          name: 'Tennis',
          icon: '🎾',
          isActive: true,
        },
      });

      const res = await request(app)
        .get(`/api/v1/discovery/people?interestId=${tennisInterest.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBe(0);
    });

    it('should reject non-existent interestId with 404', async () => {
      const nonExistentId = '11111111-2222-3333-4444-555555555555';
      const res = await request(app)
        .get(`/api/v1/discovery/people?interestId=${nonExistentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not exist/i);
    });
  });

  describe('4. Pagination', () => {
    it('should support pagination parameters page and limit', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(5);
      expect(res.body.data.pagination.hasMore).toBe(false);
    });
  });
});
