import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  UserPhoto,
  Interest,
  UserInterest,
  Moment,
  MomentMedia,
  MomentReaction,
  QuickMoment,
  UserBlock,
  Match,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';
import {
  calculateProfileCompletion,
  parseLocation,
} from '../src/services/user.service';
import { calculateAge } from '../src/services/discovery.service';

describe('Production-Ready Profile API (GET /api/v1/users/profile)', () => {
  let primaryUser: User;
  let secondaryUser: User;
  let blockedUser: User;
  let primaryToken: string;
  let secondaryToken: string;
  let blockedToken: string;

  let interestArt: Interest;
  let interestMusic: Interest;
  let interestTravel: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear relevant tables
    await ChatMessage.destroy({ where: {} });
    await MomentReaction.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await UserPhoto.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await Interest.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await User.destroy({ where: {} });

    // Mock S3 service formatting
    jest.spyOn(s3Service, 'getPublicUrl').mockImplementation((key?: string | null) => {
      return key ? `https://media.flirttime.app/${key}` : '';
    });
    jest.spyOn(s3Service, 'getThumbnailUrl').mockImplementation((key?: string | null) => {
      return key ? `https://thumbnails.flirttime.app/${key}` : '';
    });

    // Seed master interests
    interestArt = await Interest.create({
      name: 'Art & Design',
      icon: '🎨',
      category: 'Creativity',
      isActive: true,
    });
    interestMusic = await Interest.create({
      name: 'Indie Rock',
      icon: '🎸',
      category: 'Music',
      isActive: true,
    });
    interestTravel = await Interest.create({
      name: 'Backpacking',
      icon: '🎒',
      category: 'Travel',
      isActive: true,
    });

    // Create primary test user
    primaryUser = await User.create({
      username: 'alex_turner',
      email: 'alex@flirttime.app',
      fullName: 'Alex Turner',
      firstName: 'Alex',
      lastName: 'Turner',
      nickName: 'Al',
      dateOfBirth: '1998-05-15',
      gender: 'male',
      about: 'Lead singer, music lover, and weekend traveller.',
      city: 'Indore, Madhya Pradesh',
      profilePicture: 'photos/alex_primary.jpg',
      isFaceVerified: true,
      faceVerifiedAt: new Date(),
      voicePromptUrl: 'voice_prompts/alex_intro.mp3',
      voicePromptDuration: 24,
      lookingFor: 'Long-term relationship',
      genderPreference: 'female',
      isActive: true,
      role: 'user',
    });

    primaryToken = generateToken({
      id: primaryUser.id,
      email: primaryUser.email!,
      role: primaryUser.role,
    });

    // Create secondary test user
    secondaryUser = await User.create({
      username: 'sarah_connor',
      email: 'sarah@flirttime.app',
      fullName: 'Sarah Connor',
      firstName: 'Sarah',
      dateOfBirth: '2000-01-20',
      gender: 'female',
      city: 'Mumbai, Maharashtra',
      profilePicture: 'photos/sarah_dp.jpg',
      isActive: true,
      role: 'user',
    });

    secondaryToken = generateToken({
      id: secondaryUser.id,
      email: secondaryUser.email!,
      role: secondaryUser.role,
    });

    // Create blocked user
    blockedUser = await User.create({
      username: 'mallory_stalker',
      email: 'mallory@flirttime.app',
      fullName: 'Mallory Green',
      isActive: true,
      role: 'user',
    });

    blockedToken = generateToken({
      id: blockedUser.id,
      email: blockedUser.email!,
      role: blockedUser.role,
    });
  });

  describe('1. Successful Authenticated Profile Retrieval', () => {
    it('should return complete structured profile screen data for authenticated user', async () => {
      // Attach interests
      await UserInterest.create({ userId: primaryUser.id, interestId: interestArt.id });
      await UserInterest.create({ userId: primaryUser.id, interestId: interestMusic.id });

      // Attach photos (primary + cover)
      await UserPhoto.create({
        userId: primaryUser.id,
        imageUrl: 'photos/alex_primary.jpg',
        isPrimary: true,
        displayOrder: 1,
        status: 'approved',
      });
      await UserPhoto.create({
        userId: primaryUser.id,
        imageUrl: 'photos/alex_cover.jpg',
        isPrimary: false,
        displayOrder: 2,
        status: 'approved',
      });

      // Attach 2 moments
      const m1 = await Moment.create({
        userId: primaryUser.id,
        caption: 'Studio session',
        status: 'active',
        audience: 'everyone',
        publishedAt: new Date(Date.now() - 3600000),
      });
      await MomentMedia.create({
        momentId: m1.id,
        mediaUrl: 'moments/studio1.jpg',
        mediaType: 'image',
        displayOrder: 1,
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/profile fetched successfully/i);

      const data = res.body.data;
      expect(data).toBeDefined();

      // Profile sub-object
      expect(data.profile).toBeDefined();
      expect(data.profile.id).toBe(primaryUser.id);
      expect(data.profile.displayName).toBe('Al');
      expect(data.profile.firstName).toBe('Alex');
      expect(data.profile.lastName).toBe('Turner');
      expect(data.profile.gender).toBe('male');
      expect(data.profile.bio).toBe('Lead singer, music lover, and weekend traveller.');
      expect(data.profile.location).toEqual({
        city: 'Indore',
        state: 'Madhya Pradesh',
      });
      expect(data.profile.age).toBeGreaterThanOrEqual(25);
      expect(data.profile.isVerified).toBe(true);
      expect(data.profile.completionPercentage).toBeGreaterThanOrEqual(90);

      // Photos
      expect(data.profile.profilePhoto).toBeDefined();
      expect(data.profile.profilePhoto.url).toContain('alex_primary.jpg');
      expect(data.profile.profilePhoto.thumbnailUrl).toContain('alex_primary.jpg');
      expect(data.profile.coverPhoto).toBeDefined();
      expect(data.profile.coverPhoto.url).toContain('alex_cover.jpg');

      // Interests
      expect(Array.isArray(data.interests)).toBe(true);
      expect(data.interests.length).toBe(2);
      expect(data.interests[0].name).toBe('Art & Design');
      expect(data.interests[0].icon).toBe('🎨');
      expect(data.interests[0].displayOrder).toBe(1);

      // Moments (max 4 on profile)
      expect(Array.isArray(data.moments)).toBe(true);
      expect(data.moments.length).toBe(1);
      expect(data.moments[0].caption).toBe('Studio session');
      expect(data.moments[0].firstImageUrl).toContain('studio1.jpg');
      expect(data.moments[0].thumbnailUrl).toContain('studio1.jpg');
      expect(data.moments[0].imageCount).toBe(1);
      expect(data.moments[0].hasMultipleImages).toBe(false);

      // Voice Intro
      expect(data.voiceIntro).toBeDefined();
      expect(data.voiceIntro.playbackUrl).toContain('alex_intro.mp3');
      expect(data.voiceIntro.duration).toBe(24);
      expect(data.voiceIntro.status).toBe('ready');

      // Quick Moments
      expect(data.quickMoments).toBeDefined();
      expect(Array.isArray(data.quickMoments.items)).toBe(true);
      expect(data.quickMoments.canAdd).toBe(true);
    });
  });

  describe('2. Missing or Invalid Authentication Token', () => {
    it('should return 401 when no token is provided', async () => {
      const res = await request(app).get('/api/v1/users/profile');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 when invalid/expired token is provided', async () => {
      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', 'Bearer invalid.jwt.token');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Profile with No Photo, Interests, Moments or Voice Intro', () => {
    it('should return graceful nulls and empty arrays without throwing errors', async () => {
      const bareUser = await User.create({
        username: 'bare_user',
        email: 'bare@flirttime.app',
        city: null,
        isActive: true,
        role: 'user',
      });

      const bareToken = generateToken({
        id: bareUser.id,
        email: bareUser.email!,
        role: bareUser.role,
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${bareToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.profile.profilePhoto).toBeNull();
      expect(data.profile.coverPhoto).toBeNull();
      expect(data.profile.photos).toEqual([]);
      expect(data.interests).toEqual([]);
      expect(data.moments).toEqual([]);
      expect(data.voiceIntro).toBeNull();
      expect(data.profile.age).toBeNull();
      expect(data.profile.location).toEqual({ city: null, state: null });
      expect(data.profile.completionPercentage).toBe(0);
    });
  });

  describe('4. Profile with All Sections Populated', () => {
    it('should calculate 100% completion when all profile dimensions are filled', async () => {
      await UserInterest.create({ userId: primaryUser.id, interestId: interestArt.id });
      await UserPhoto.create({
        userId: primaryUser.id,
        imageUrl: 'photos/p1.jpg',
        isPrimary: true,
        displayOrder: 1,
        status: 'approved',
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.profile.completionPercentage).toBe(100);
      expect(res.body.data.profile.isVerified).toBe(true);
    });
  });

  describe('5. More than Four Permanent Moments — Maximum Four Returned', () => {
    it('should strictly return only the newest 4 permanent moments on the main profile endpoint', async () => {
      // Create 6 permanent moments
      for (let i = 1; i <= 6; i++) {
        const moment = await Moment.create({
          userId: primaryUser.id,
          caption: `Moment #${i}`,
          status: 'active',
          audience: 'everyone',
          publishedAt: new Date(Date.now() - (7 - i) * 100000),
        });
        await MomentMedia.create({
          momentId: moment.id,
          mediaUrl: `moments/pic_${i}.jpg`,
          mediaType: 'image',
          displayOrder: 1,
        });
      }

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.moments).toBeDefined();
      expect(res.body.data.moments.length).toBe(4);

      // Verify newest first ordering: #6, #5, #4, #3
      expect(res.body.data.moments[0].caption).toBe('Moment #6');
      expect(res.body.data.moments[1].caption).toBe('Moment #5');
      expect(res.body.data.moments[2].caption).toBe('Moment #4');
      expect(res.body.data.moments[3].caption).toBe('Moment #3');

      // Verify moments payload details
      const first = res.body.data.moments[0];
      expect(first.imageCount).toBe(1);
      expect(first.hasMultipleImages).toBe(false);
      expect(first.firstImageUrl).toContain('pic_6.jpg');
      expect(first.thumbnailUrl).toContain('pic_6.jpg');
      expect(first.likeCount).toBe(0);
      expect(first.commentCount).toBe(0);
      expect(first.isLiked).toBe(false);
    });
  });

  describe('6. Paginated "See all" Moments Endpoint', () => {
    it('should paginate all user moments accurately with page and limit parameters', async () => {
      // Create 5 moments
      for (let i = 1; i <= 5; i++) {
        const moment = await Moment.create({
          userId: primaryUser.id,
          caption: `Moment ${i}`,
          status: 'active',
          audience: 'everyone',
          publishedAt: new Date(Date.now() - (6 - i) * 100000),
        });
        await MomentMedia.create({
          momentId: moment.id,
          mediaUrl: `moments/photo_${i}.jpg`,
          mediaType: 'image',
          displayOrder: 1,
        });
      }

      // Page 1 with limit 3
      const page1Res = await request(app)
        .get(`/api/v1/users/${primaryUser.id}/moments?page=1&limit=3`)
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(page1Res.status).toBe(200);
      expect(page1Res.body.success).toBe(true);
      expect(page1Res.body.data.moments.length).toBe(3);
      expect(page1Res.body.data.totalCount).toBe(5);
      expect(page1Res.body.data.totalPages).toBe(2);
      expect(page1Res.body.data.page).toBe(1);
      expect(page1Res.body.data.limit).toBe(3);

      // Page 2 with limit 3
      const page2Res = await request(app)
        .get(`/api/v1/users/${primaryUser.id}/moments?page=2&limit=3`)
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(page2Res.status).toBe(200);
      expect(page2Res.body.data.moments.length).toBe(2);
      expect(page2Res.body.data.page).toBe(2);

      // Me alias
      const meRes = await request(app)
        .get('/api/v1/users/me/moments?page=1&limit=20')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.moments.length).toBe(5);
    });
  });

  describe('7. Expired Quick Moments Excluded', () => {
    it('should include only active, unexpired quick moments in profile tray summary', async () => {
      const now = new Date();

      // Active quick moment (expires in 12 hours)
      await QuickMoment.create({
        userId: primaryUser.id,
        mediaUrl: 'quick/active_story.jpg',
        type: 'image',
        status: 'active',
        createdAt: now,
        expiresAt: new Date(now.getTime() + 12 * 3600 * 1000),
      });

      // Expired quick moment (expired 2 hours ago)
      await QuickMoment.create({
        userId: primaryUser.id,
        mediaUrl: 'quick/expired_story.jpg',
        type: 'image',
        status: 'active',
        createdAt: new Date(now.getTime() - 26 * 3600 * 1000),
        expiresAt: new Date(now.getTime() - 2 * 3600 * 1000),
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      const qm = res.body.data.quickMoments;
      expect(qm.items.length).toBe(1);
      expect(qm.items[0].mediaThumbnail).toContain('active_story.jpg');
      expect(qm.items.some((i: any) => i.mediaThumbnail?.includes('expired_story.jpg'))).toBe(false);
      expect(qm.canAdd).toBe(true);
    });
  });

  describe('8. Private/Deleted Moments Excluded According to Visibility Rules', () => {
    it('should exclude deleted moments and enforce audience privacy', async () => {
      // Deleted moment
      await Moment.create({
        userId: secondaryUser.id,
        caption: 'Deleted moment',
        status: 'deleted',
        audience: 'everyone',
        publishedAt: new Date(),
      });

      // Matches only moment (not matched with primaryUser)
      await Moment.create({
        userId: secondaryUser.id,
        caption: 'Secret moment for matches',
        status: 'active',
        audience: 'matches_only',
        publishedAt: new Date(),
      });

      // Public active moment
      await Moment.create({
        userId: secondaryUser.id,
        caption: 'Public moment',
        status: 'active',
        audience: 'everyone',
        publishedAt: new Date(),
      });

      const res = await request(app)
        .get(`/api/v1/users/${secondaryUser.id}/moments`)
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.moments.length).toBe(1);
      expect(res.body.data.moments[0].caption).toBe('Public moment');
    });
  });

  describe('9. Correct Age and Profile Completion Calculation', () => {
    it('should calculate age correctly from dateOfBirth', () => {
      expect(calculateAge(null)).toBeNull();
      expect(calculateAge('invalid-date')).toBeNull();

      const birthDate = new Date();
      birthDate.setFullYear(birthDate.getFullYear() - 26);
      const dobStr = birthDate.toISOString().split('T')[0];
      expect(calculateAge(dobStr)).toBe(26);
    });

    it('should calculate profile completion dynamically and transparently', () => {
      // 0% for empty profile
      const emptyUser: any = {};
      expect(calculateProfileCompletion(emptyUser, 0, 0)).toBe(0);

      // Basic details only: 20%
      const basicUser: any = {
        fullName: 'John Doe',
        dateOfBirth: '1995-05-10',
        gender: 'male',
      };
      expect(calculateProfileCompletion(basicUser, 0, 0)).toBe(20);

      // + Primary photo: 40%
      basicUser.profilePicture = 'photos/dp.jpg';
      expect(calculateProfileCompletion(basicUser, 0, 0)).toBe(40);

      // + Bio: 55%
      basicUser.about = 'Hello world';
      expect(calculateProfileCompletion(basicUser, 0, 0)).toBe(55);

      // + 1 Interest: 70%
      expect(calculateProfileCompletion(basicUser, 1, 0)).toBe(70);

      // + Location: 80%
      basicUser.city = 'Indore';
      expect(calculateProfileCompletion(basicUser, 1, 0)).toBe(80);

      // + Preferences: 90%
      basicUser.lookingFor = 'Friendship';
      expect(calculateProfileCompletion(basicUser, 1, 0)).toBe(90);

      // + Voice Intro: 100%
      basicUser.voicePromptUrl = 'voice/intro.mp3';
      expect(calculateProfileCompletion(basicUser, 1, 0)).toBe(100);
    });

    it('should parse city and state accurately from string', () => {
      expect(parseLocation('Indore, Madhya Pradesh')).toEqual({
        city: 'Indore',
        state: 'Madhya Pradesh',
      });
      expect(parseLocation('London')).toEqual({
        city: 'London',
        state: null,
      });
      expect(parseLocation(null)).toEqual({
        city: null,
        state: null,
      });
    });
  });

  describe('10. S3 Thumbnail and Image URL Formatting', () => {
    it('should properly format mediaUrl and thumbnailUrl through s3Service', async () => {
      const mediaSpy = jest.spyOn(s3Service, 'getPublicUrl');
      const thumbSpy = jest.spyOn(s3Service, 'getThumbnailUrl');

      await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(mediaSpy).toHaveBeenCalled();
      expect(thumbSpy).toHaveBeenCalled();
    });
  });

  describe('11. Unauthorized Access to Another User\'s Private Resources', () => {
    it('should return 403 MOMENTS_BLOCKED if target user has blocked the viewer', async () => {
      await UserBlock.create({
        userId: secondaryUser.id,
        blockedUserId: blockedUser.id,
        reason: 'Harassment',
      });

      const res = await request(app)
        .get(`/api/v1/users/${secondaryUser.id}/moments`)
        .set('Authorization', `Bearer ${blockedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions|blocked/i);
    });
  });

  describe('12. Database Errors and Unavailable S3 Objects', () => {
    it('should handle missing user record gracefully if user is deleted after token generation', async () => {
      const ghostId = '00000000-0000-0000-0000-000000000000';
      const ghostToken = generateToken({
        id: ghostId,
        email: 'ghost@example.com',
        role: 'user',
      });

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${ghostToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/user not found/i);
    });
  });

  describe('13. Invalid Pagination and Request Parameters', () => {
    it('should clamp invalid limit to maximum 50 on moments pagination', async () => {
      const res = await request(app)
        .get(`/api/v1/users/${primaryUser.id}/moments?page=1&limit=999`)
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.limit).toBe(50);
    });
  });

  describe('14. Existing API Contract and Regression Tests', () => {
    it('should preserve root-level backward-compatible keys expected by existing apps and tests', async () => {
      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(primaryUser.id);
      expect(res.body.data.profile).toBeDefined();
    });

    it('should support updating profile via PATCH /api/v1/users/profile', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({
          fullName: 'Alex Turner',
          nickName: 'AlexT',
          dateOfBirth: '1998-05-15',
          gender: 'male',
          about: 'Updated bio description',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nickName).toBe('AlexT');
      expect(res.body.data.about).toBe('Updated bio description');
    });

    it('should support profile photo upload via POST /api/v1/users/profile-photo with pre-uploaded S3 key', async () => {
      const authorizedKey = `photos/${primaryUser.id}/new_dp_uploaded.jpg`;
      jest.spyOn(s3Service, 'checkObjectExists').mockResolvedValue({
        exists: true,
        contentType: 'image/jpeg',
        contentLength: 2048,
      });

      const res = await request(app)
        .post('/api/v1/users/profile-photo')
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({
          imageKey: authorizedKey,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.imageUrl).toContain('new_dp_uploaded.jpg');
    });

    it('should reject profile photo upload if user tries to attach another user\'s S3 key', async () => {
      const unauthorizedKey = `photos/other-user-uuid/stolen_photo.jpg`;
      const res = await request(app)
        .post('/api/v1/users/profile-photo')
        .set('Authorization', `Bearer ${primaryToken}`)
        .send({
          imageKey: unauthorizedKey,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized to use this image key/i);
    });
  });
});
