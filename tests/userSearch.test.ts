import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  UserBlock,
  UserReport,
  SwipeAction,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('User Search API (Name, City, and Pagination)', () => {
  let currentUser: User;
  let authToken: string;

  let cindy: User;
  let ally: User;
  let riya: User;
  let meera: User;
  let tara: User;
  let inactiveUser: User;
  let blockedUser: User;
  let reportedUser: User;
  let swipedUser: User;

  let interestCooking: Interest;
  let interestMusic: Interest;
  let interestFitness: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(false);

    [interestCooking] = await Interest.findOrCreate({
      where: { name: 'Cooking_SearchTest' },
      defaults: { name: 'Cooking_SearchTest', icon: '🍳', isActive: true },
    });
    [interestMusic] = await Interest.findOrCreate({
      where: { name: 'Music_SearchTest' },
      defaults: { name: 'Music_SearchTest', icon: '🎵', isActive: true },
    });
    [interestFitness] = await Interest.findOrCreate({
      where: { name: 'Fitness_SearchTest' },
      defaults: { name: 'Fitness_SearchTest', icon: '🏋️', isActive: true },
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await UserBlock.destroy({ where: {} });
    await UserReport.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });

    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 120 * 60 * 1000);

    // 1. Current Authenticated User (located in Indore)
    currentUser = await User.create({
      username: 'current_search_user',
      email: 'searcher@example.com',
      fullName: 'Alex Searcher',
      firstName: 'Alex',
      dateOfBirth: '1998-01-01',
      gender: 'male',
      city: 'Indore, Madhya Pradesh',
      latitude: 22.7196,
      longitude: 75.8577,
      isActive: true,
      lastActiveAt: now,
    });
    authToken = generateToken({
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role,
    });

    await UserInterest.create({
      userId: currentUser.id,
      interestId: interestCooking.id,
    });

    // 2. Cindy, 24, Indore, Madhya Pradesh (Online, Verified, 3 km away)
    cindy = await User.create({
      username: 'dummy_cindy',
      email: 'cindy@example.com',
      fullName: 'Cindy Crawford',
      firstName: 'Cindy',
      nickName: 'Cindy',
      dateOfBirth: '2000-04-12',
      gender: 'female',
      city: 'Indore, Madhya Pradesh',
      latitude: 22.74,
      longitude: 75.88,
      profilePicture: 'https://images.unsplash.com/cindy.jpg',
      isFaceVerified: true,
      isActive: true,
      lastActiveAt: tenMinutesAgo, // online (< 15 mins)
    });
    await UserInterest.create({
      userId: cindy.id,
      interestId: interestCooking.id,
    });

    // 3. Ally, 25, Bhopal, Madhya Pradesh (Offline, Not verified, 12 km)
    ally = await User.create({
      username: 'dummy_ally',
      email: 'ally@example.com',
      fullName: 'Ally Brooke',
      firstName: 'Ally',
      nickName: 'Ally',
      dateOfBirth: '1999-02-10',
      gender: 'female',
      city: 'Bhopal, Madhya Pradesh',
      latitude: 23.2599,
      longitude: 77.4126,
      profilePicture: 'https://images.unsplash.com/ally.jpg',
      isFaceVerified: false,
      isActive: true,
      lastActiveAt: twoHoursAgo,
    });

    // 4. Riya, 26, Pune, Maharashtra (Online, Verified)
    riya = await User.create({
      username: 'dummy_riya',
      email: 'riya@example.com',
      fullName: 'Riya Sen',
      firstName: 'Riya',
      dateOfBirth: '1998-08-20',
      gender: 'female',
      city: 'Pune, Maharashtra',
      latitude: 18.5204,
      longitude: 73.8567,
      profilePicture: 'https://images.unsplash.com/riya.jpg',
      isFaceVerified: true,
      isActive: true,
      lastActiveAt: tenMinutesAgo, // online
    });

    // 5. Meera, 26, Mumbai, Maharashtra (Offline, Verified)
    meera = await User.create({
      username: 'dummy_meera',
      email: 'meera@example.com',
      fullName: 'Meera Sharma',
      firstName: 'Meera',
      dateOfBirth: '1998-05-15',
      gender: 'female',
      city: 'Mumbai, Maharashtra',
      latitude: 19.076,
      longitude: 72.8777,
      profilePicture: 'https://images.unsplash.com/meera.jpg',
      isFaceVerified: true,
      isActive: true,
      lastActiveAt: twoHoursAgo,
    });

    // 6. Tara, Indore, Madhya Pradesh
    tara = await User.create({
      username: 'dummy_tara',
      email: 'tara@example.com',
      fullName: 'Tara Deshmukh',
      firstName: 'Tara',
      dateOfBirth: '1997-03-30',
      gender: 'female',
      city: 'Indore, Madhya Pradesh',
      latitude: 22.72,
      longitude: 75.86,
      isFaceVerified: true,
      isActive: true,
      lastActiveAt: twoHoursAgo,
    });

    // 7. Inactive User
    inactiveUser = await User.create({
      username: 'dummy_inactive',
      email: 'inactive@example.com',
      fullName: 'Cindy Inactive',
      firstName: 'Cindy',
      dateOfBirth: '1998-01-01',
      city: 'Indore, Madhya Pradesh',
      isActive: false, // inactive
    });

    // 8. Blocked User
    blockedUser = await User.create({
      username: 'dummy_blocked',
      email: 'blocked@example.com',
      fullName: 'Cindy Blocked',
      firstName: 'Cindy',
      dateOfBirth: '1998-01-01',
      city: 'Indore, Madhya Pradesh',
      isActive: true,
    });
    await UserBlock.create({
      userId: currentUser.id,
      blockedUserId: blockedUser.id,
    });

    // 9. Reported User
    reportedUser = await User.create({
      username: 'dummy_reported',
      email: 'reported@example.com',
      fullName: 'Cindy Reported',
      firstName: 'Cindy',
      dateOfBirth: '1998-01-01',
      city: 'Indore, Madhya Pradesh',
      isActive: true,
    });
    await UserReport.create({
      reporterId: currentUser.id,
      targetUserId: reportedUser.id,
      reason: 'fake_profile',
      status: 'pending',
    });

    // 10. Swiped User
    swipedUser = await User.create({
      username: 'dummy_swiped',
      email: 'swiped@example.com',
      fullName: 'Swiped User',
      firstName: 'Swiped',
      dateOfBirth: '1998-01-01',
      city: 'Indore, Madhya Pradesh',
      isActive: true,
    });
    await SwipeAction.create({
      userId: currentUser.id,
      targetUserId: swipedUser.id,
      action: 'like',
    });
  });

  describe('Authentication & Validation', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/users/search');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid page parameter with 400', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?page=0')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject minAge > maxAge with 400', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?minAge=30&maxAge=20')
        .set('Authorization', `Bearer ${authToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Search by Name', () => {
    it('should search by name case-insensitively using query param', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?query=cindy')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toBeInstanceOf(Array);
      expect(res.body.data.users.length).toBe(1);

      const found = res.body.data.users[0];
      expect(found.id).toBe(cindy.id);
      expect(found.name).toBe('Cindy');
      expect(found.city).toBe('Indore, Madhya Pradesh');
      expect(found.isVerified).toBe(true);
      expect(found.isOnline).toBe(true);
      expect(found.distanceKm).not.toBeNull();
      expect(found.distanceText).toContain('km away');
      expect(found.profilePhotoUrl).not.toBeNull();
    });

    it('should search by explicit name filter', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?name=Ally')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].id).toBe(ally.id);
      expect(res.body.data.users[0].name).toBe('Ally');
      expect(res.body.data.users[0].isOnline).toBe(false);
      expect(res.body.data.users[0].isVerified).toBe(false);
    });
  });

  describe('Search by City', () => {
    it('should search by city case-insensitively using query param', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?query=Bhopal')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].id).toBe(ally.id);
      expect(res.body.data.users[0].city).toBe('Bhopal, Madhya Pradesh');
    });

    it('should search by explicit city filter returning multiple users', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?city=Indore')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.users.map((u: any) => u.id);
      expect(returnedIds).toContain(cindy.id);
      expect(returnedIds).toContain(tara.id);
      expect(returnedIds).not.toContain(ally.id);
      expect(returnedIds).not.toContain(meera.id);
    });

    it('should search state name in city string (e.g. Maharashtra)', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?query=Maharashtra')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.users.map((u: any) => u.id);
      expect(returnedIds).toContain(riya.id);
      expect(returnedIds).toContain(meera.id);
      expect(returnedIds).not.toContain(cindy.id);
    });
  });

  describe('Pagination & Limits', () => {
    it('should support pagination properly with page and limit', async () => {
      // First page with limit 2
      const res1 = await request(app)
        .get('/api/v1/users/search?limit=2&page=1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.users.length).toBe(2);
      expect(res1.body.data.pagination.page).toBe(1);
      expect(res1.body.data.pagination.limit).toBe(2);
      expect(res1.body.data.pagination.hasMore).toBe(true);
      expect(res1.body.data.pagination.total).toBeGreaterThanOrEqual(4);
      expect(res1.body.data.total).toBe(res1.body.data.pagination.total);

      const firstPageIds = res1.body.data.users.map((u: any) => u.id);

      // Second page with limit 2
      const res2 = await request(app)
        .get('/api/v1/users/search?limit=2&page=2')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.users.length).toBe(2);
      expect(res2.body.data.pagination.page).toBe(2);

      const secondPageIds = res2.body.data.users.map((u: any) => u.id);

      // Verify no overlap between page 1 and page 2
      for (const id of firstPageIds) {
        expect(secondPageIds).not.toContain(id);
      }
    });

    it('should accurately return hasMore: false on the last page', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?limit=50&page=1')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pagination.hasMore).toBe(false);
      expect(res.body.data.pagination.page).toBe(1);
    });
  });

  describe('Filters: Online Only, Verified Only, and Gender', () => {
    it('should filter by onlineOnly correctly', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?onlineOnly=true')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const users = res.body.data.users;
      expect(users.length).toBeGreaterThan(0);
      for (const u of users) {
        expect(u.isOnline).toBe(true);
      }
      const returnedIds = users.map((u: any) => u.id);
      expect(returnedIds).toContain(cindy.id);
      expect(returnedIds).toContain(riya.id);
      expect(returnedIds).not.toContain(ally.id);
      expect(returnedIds).not.toContain(meera.id);
    });

    it('should filter by verifiedOnly correctly', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?verifiedOnly=true')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const users = res.body.data.users;
      for (const u of users) {
        expect(u.isVerified).toBe(true);
      }
      const returnedIds = users.map((u: any) => u.id);
      expect(returnedIds).not.toContain(ally.id);
    });
  });

  describe('Exclusions (Self, Blocked, Reported, Inactive)', () => {
    it('should strictly exclude current user, inactive users, blocked users, and reported users', async () => {
      const res = await request(app)
        .get('/api/v1/users/search')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.data.users.map((u: any) => u.id);

      expect(returnedIds).not.toContain(currentUser.id);
      expect(returnedIds).not.toContain(inactiveUser.id);
      expect(returnedIds).not.toContain(blockedUser.id);
      expect(returnedIds).not.toContain(reportedUser.id);
    });
  });

  describe('Empty Query & Non-matching Scenarios', () => {
    it('should return eligible discovery users and total when query is empty', async () => {
      const res = await request(app)
        .get('/api/v1/users/search')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBeGreaterThan(0);
      expect(res.body.data.total).toBe(res.body.data.users.length);
    });

    it('should return empty list and zero count when no user matches query', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?query=NonExistentPersonCity12345')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.pagination.total).toBe(0);
      expect(res.body.data.pagination.hasMore).toBe(false);
    });
  });

  describe('POST Method & Route Aliases', () => {
    it('should support POST /api/v1/users/search with JSON body', async () => {
      const res = await request(app)
        .post('/api/v1/users/search')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          query: 'cindy',
          page: 1,
          limit: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].name).toBe('Cindy');
    });

    it('should support direct root alias GET /api/v1/search', async () => {
      const res = await request(app)
        .get('/api/v1/search?query=cindy')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].name).toBe('Cindy');
    });

    it('should support GET /api/v1/discovery/search?query=cindy', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/search?query=cindy')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users.length).toBe(1);
      expect(res.body.data.users[0].name).toBe('Cindy');
    });
  });

  describe('Response Contract & Public Hygiene', () => {
    it('should conform to mandatory envelope and never leak sensitive fields', async () => {
      const res = await request(app)
        .get('/api/v1/users/search?query=cindy')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('users');
      expect(res.body.data).toHaveProperty('pagination');
      expect(res.body.data).toHaveProperty('total');

      const user = res.body.data.users[0];
      // Required fields
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('name');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('age');
      expect(user).toHaveProperty('profilePhoto');
      expect(user).toHaveProperty('profilePhotoUrl');
      expect(user).toHaveProperty('isVerified');
      expect(user).toHaveProperty('isOnline');
      expect(user).toHaveProperty('city');
      expect(user).toHaveProperty('distanceKm');
      expect(user).toHaveProperty('distanceText');
      expect(user).toHaveProperty('sharedInterests');
      expect(user).toHaveProperty('interests');

      // Sensitive fields must NOT exist
      expect(user).not.toHaveProperty('password');
      expect(user).not.toHaveProperty('email');
      expect(user).not.toHaveProperty('phone');
      expect(user).not.toHaveProperty('otp');
    });
  });
});
