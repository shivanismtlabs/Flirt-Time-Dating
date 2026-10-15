import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  UserPhoto,
  SwipeAction,
  Match,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Other User Profile Detail API (GET /api/v1/users/:userId/profile)', () => {
  let viewerUser: User;
  let targetUser: User;
  let viewerToken: string;
  let cookingInterest: Interest;
  let gamingInterest: Interest;
  let travelInterest: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear all related tables
    await Match.destroy({ where: {} });
    await SwipeAction.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await UserPhoto.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await Interest.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Create Interests
    cookingInterest = await Interest.create({
      name: 'Cooking',
      category: 'Lifestyle',
      icon: '🍳',
      isActive: true,
    });

    gamingInterest = await Interest.create({
      name: 'Gaming',
      category: 'Entertainment',
      icon: '🎮',
      isActive: true,
    });

    travelInterest = await Interest.create({
      name: 'Traveling',
      category: 'Lifestyle',
      icon: '✈️',
      isActive: true,
    });

    // Create Authenticated Viewer
    viewerUser = await User.create({
      username: 'viewer_john',
      email: 'viewer@example.com',
      phone: '+919876543210',
      fullName: 'John Doe',
      gender: 'male',
      city: 'Mumbai',
      latitude: 19.076,
      longitude: 72.8777,
      isActive: true,
      role: 'user',
    });

    viewerToken = generateToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    });

    // Associate viewer with Cooking and Traveling
    await UserInterest.create({
      userId: viewerUser.id,
      interestId: cookingInterest.id,
    });
    await UserInterest.create({
      userId: viewerUser.id,
      interestId: travelInterest.id,
    });

    // Create Target User (Meera)
    targetUser = await User.create({
      username: 'meera_patel',
      email: 'meera@example.com',
      phone: '+919876543211',
      fullName: 'Meera Patel',
      firstName: 'Meera',
      nickName: 'Meeru',
      dateOfBirth: '1998-05-15',
      gender: 'female',
      about: 'Plant mom. Amateur chef. Professional overthinker.',
      city: 'Mumbai',
      latitude: 19.1136,
      longitude: 72.8697,
      isFaceVerified: true,
      isProfileComplete: true,
      profilePicture: 'https://flirttime-media.s3.amazonaws.com/profiles/meera_main.jpg',
      voicePromptUrl: 'https://flirttime-media.s3.amazonaws.com/audio/meera_voice.mp3',
      voicePromptDuration: 4,
      isActive: true,
      role: 'user',
    });

    // Associate target with Cooking and Gaming
    await UserInterest.create({
      userId: targetUser.id,
      interestId: cookingInterest.id,
    });
    await UserInterest.create({
      userId: targetUser.id,
      interestId: gamingInterest.id,
    });

    // Create Photos / Moments for Target User
    // 1 primary photo (matching profilePicture)
    await UserPhoto.create({
      userId: targetUser.id,
      imageUrl: 'https://flirttime-media.s3.amazonaws.com/profiles/meera_main.jpg',
      isPrimary: true,
      displayOrder: 0,
      status: 'approved',
    });

    // 2 approved moments gallery photos
    await UserPhoto.create({
      userId: targetUser.id,
      imageUrl: 'https://flirttime-media.s3.amazonaws.com/moments/meera_food.jpg',
      isPrimary: false,
      displayOrder: 1,
      status: 'approved',
    });

    await UserPhoto.create({
      userId: targetUser.id,
      imageUrl: 'https://flirttime-media.s3.amazonaws.com/moments/meera_plant.jpg',
      isPrimary: false,
      displayOrder: 2,
      status: 'approved',
    });

    // 1 rejected photo (should NOT be visible in moments)
    await UserPhoto.create({
      userId: targetUser.id,
      imageUrl: 'https://flirttime-media.s3.amazonaws.com/moments/meera_rejected.jpg',
      isPrimary: false,
      displayOrder: 3,
      status: 'rejected',
    });
  });

  describe('1. Successful Authenticated Profile Retrieval', () => {
    it('should retrieve full other user profile detail with 200 OK', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Profile fetched successfully');
      expect(res.body.data).toBeDefined();

      const data = res.body.data;
      expect(data.userId).toBe(targetUser.id);
      expect(data.name).toBe('Meera');
      expect(typeof data.age).toBe('number');
      expect(data.isVerified).toBe(true);
      expect(data.profilePhoto).toBe('https://flirttime-media.s3.amazonaws.com/profiles/meera_main.jpg');
      expect(data.city).toBe('Mumbai');
      expect(typeof data.distanceKm).toBe('number');
      expect(data.bio).toBe('Plant mom. Amateur chef. Professional overthinker.');
      expect(typeof data.vibeScore).toBe('number');
      expect(data.vibeExplanation).toBeDefined();
      expect(data.vibeExplanation.text).toMatch(/you both love cooking/i);
      expect(data.vibeExplanation.sharedInterests).toEqual(['Cooking']);
      expect(data.voiceIntro).toEqual({
        url: 'https://flirttime-media.s3.amazonaws.com/audio/meera_voice.mp3',
        durationSeconds: 4,
        duration: 4,
      });
      expect(Array.isArray(data.moments)).toBe(true);
      expect(data.moments.length).toBe(2);
      expect(Array.isArray(data.interests)).toBe(true);
      expect(data.interests.length).toBe(2);
      expect(data.sharedInterests).toEqual(['Cooking']);
      expect(data.myAction).toBeNull();
      expect(data.isMatched).toBe(false);
      expect(data.canConnect).toBe(true);
    });
  });

  describe('2. Invalid and Nonexistent User IDs', () => {
    it('should return 400 Bad Request for malformed UUID format', async () => {
      const res = await request(app)
        .get('/api/v1/users/not-a-valid-uuid/profile')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/validation failed/i);
    });

    it('should return 404 Not Found for nonexistent user UUID', async () => {
      const nonexistentId = 'a0000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .get(`/api/v1/users/${nonexistentId}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found or unavailable/i);
    });
  });

  describe('3. Unauthenticated Requests', () => {
    it('should return 401 Unauthorized if no JWT token is supplied', async () => {
      const res = await request(app).get(`/api/v1/users/${targetUser.id}/profile`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 Unauthorized for invalid JWT token', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', 'Bearer invalid.token.value');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Blocked and Inactive Profiles', () => {
    it('should return 403 Forbidden if target user blocked the viewer', async () => {
      await UserBlock.create({
        userId: targetUser.id,
        blockedUserId: viewerUser.id,
        reason: 'Harassment',
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });

    it('should return 403 Forbidden if viewer blocked the target user', async () => {
      await UserBlock.create({
        userId: viewerUser.id,
        blockedUserId: targetUser.id,
        reason: 'Spam',
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });

    it('should return 404 Not Found if target user account is deactivated/inactive', async () => {
      targetUser.isActive = false;
      await targetUser.save();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not found or unavailable/i);
    });
  });

  describe('5. Correct Primary Profile Photo', () => {
    it('should fallback to isPrimary photo from user_photos if profilePicture is not directly on user', async () => {
      targetUser.profilePicture = null;
      await targetUser.save();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.profilePhoto).toBe('https://flirttime-media.s3.amazonaws.com/profiles/meera_main.jpg');
    });
  });

  describe('6. Correct Verification Status', () => {
    it('should return isVerified as false when target is not face verified', async () => {
      targetUser.isFaceVerified = false;
      await targetUser.save();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isVerified).toBe(false);
    });
  });

  describe('7. Age and Distance Handling', () => {
    it('should accurately calculate distance using coordinates', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      // Distance between (19.076, 72.8777) and (19.1136, 72.8697) is ~4 km
      expect(res.body.data.distanceKm).toBeGreaterThan(0);
      expect(res.body.data.distanceKm).toBeLessThan(15);
    });

    it('should fallback to 7 km if coordinates are missing but same city is specified', async () => {
      targetUser.latitude = null;
      targetUser.longitude = null;
      await targetUser.save();

      viewerUser.latitude = null;
      viewerUser.longitude = null;
      await viewerUser.save();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.distanceKm).toBe(7);
    });
  });

  describe('8. Shared Interests from Saved Onboarding Data', () => {
    it('should return target interests and shared interests accurately', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.interests).toHaveLength(2);
      expect(res.body.data.interests.map((i: any) => i.name)).toEqual(
        expect.arrayContaining(['Cooking', 'Gaming'])
      );
      expect(res.body.data.sharedInterests).toEqual(['Cooking']);
    });
  });

  describe('9. Vibe Score and Explanation', () => {
    it('should return null vibeScore and null vibeExplanation if 0 shared interests', async () => {
      // Remove all user interests for viewer
      await UserInterest.destroy({ where: { userId: viewerUser.id } });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.sharedInterests).toEqual([]);
      expect(res.body.data.vibeScore).toBeNull();
      expect(res.body.data.vibeExplanation).toBeNull();
    });

    it('should pluralize explanation when 2 shared interests match', async () => {
      // Add Gaming to viewer as well
      await UserInterest.create({
        userId: viewerUser.id,
        interestId: gamingInterest.id,
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.sharedInterests).toHaveLength(2);
      expect(res.body.data.vibeExplanation.text).toMatch(/you both love cooking and gaming/i);
    });
  });

  describe('10. Missing Bio or Voice Intro', () => {
    it('should return null for bio and null for voiceIntro when they are absent', async () => {
      targetUser.about = null;
      targetUser.voicePromptUrl = null;
      targetUser.voicePromptDuration = null;
      await targetUser.save();

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.bio).toBeNull();
      expect(res.body.data.voiceIntro).toBeNull();
    });
  });

  describe('11. Moments Visibility and Ordering', () => {
    it('should exclude rejected, pending, and primary duplicate photos from moments', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      const moments = res.body.data.moments;
      expect(moments).toHaveLength(2);

      const urls = moments.map((m: any) => m.mediaUrl);
      expect(urls).toContain('https://flirttime-media.s3.amazonaws.com/moments/meera_food.jpg');
      expect(urls).toContain('https://flirttime-media.s3.amazonaws.com/moments/meera_plant.jpg');
      expect(urls).not.toContain('https://flirttime-media.s3.amazonaws.com/moments/meera_rejected.jpg');
      expect(urls).not.toContain('https://flirttime-media.s3.amazonaws.com/profiles/meera_main.jpg');
    });
  });

  describe('12. Privacy and Sensitive-Field Protection', () => {
    it('should never expose sensitive fields in response payload', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.password).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.phone).toBeUndefined();
      expect(data.latitude).toBeUndefined();
      expect(data.longitude).toBeUndefined();
      expect(data.role).toBeUndefined();
      expect(data.identities).toBeUndefined();
    });
  });

  describe('13. Existing Action and Match State', () => {
    it('should return myAction as like and canConnect as false when already liked', async () => {
      await SwipeAction.create({
        userId: viewerUser.id,
        targetUserId: targetUser.id,
        action: 'like',
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myAction).toBe('like');
      expect(res.body.data.isMatched).toBe(false);
      expect(res.body.data.canConnect).toBe(false);
    });

    it('should return isMatched as true when reciprocal match exists', async () => {
      await SwipeAction.create({
        userId: viewerUser.id,
        targetUserId: targetUser.id,
        action: 'like',
      });

      const [u1, u2] = [viewerUser.id, targetUser.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myAction).toBe('like');
      expect(res.body.data.isMatched).toBe(true);
      expect(res.body.data.canConnect).toBe(false);
    });

    it('should return myAction as nope and canConnect as false when swiped nope', async () => {
      await SwipeAction.create({
        userId: viewerUser.id,
        targetUserId: targetUser.id,
        action: 'nope',
      });

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.myAction).toBe('nope');
      expect(res.body.data.canConnect).toBe(false);
    });
  });

  describe('14. Missing Optional Data', () => {
    it('should handle target with no nickname, no city, no photos, and no interests gracefully', async () => {
      const minimalUser = await User.create({
        username: 'minimal_user',
        email: 'minimal@example.com',
        fullName: 'Minimal User',
        isActive: true,
        role: 'user',
      });

      const res = await request(app)
        .get(`/api/v1/users/${minimalUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe(minimalUser.id);
      expect(res.body.data.name).toBe('Minimal');
      expect(res.body.data.age).toBeNull();
      expect(res.body.data.bio).toBeNull();
      expect(res.body.data.voiceIntro).toBeNull();
      expect(res.body.data.moments).toEqual([]);
      expect(res.body.data.interests).toEqual([]);
      expect(res.body.data.sharedInterests).toEqual([]);
      expect(res.body.data.vibeScore).toBeNull();
      expect(res.body.data.vibeExplanation).toBeNull();
    });
  });

  describe('15. Database Failure Handling', () => {
    it('should return 500 without leaking stack traces when database throws an error', async () => {
      const findByPkSpy = jest
        .spyOn(User, 'findByPk')
        .mockRejectedValueOnce(new Error('Connection failure'));

      const res = await request(app)
        .get(`/api/v1/users/${targetUser.id}/profile`)
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/error fetching profile/i);
      expect(res.body.stack).toBeUndefined();

      findByPkSpy.mockRestore();
    });
  });
});
