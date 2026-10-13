import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  QuickMoment,
  UserBlock,
  Match,
  DeepLink,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';
import { env } from '../src/config/env';

describe('Deep Linking & Content Sharing System (Production-Ready)', () => {
  let alice: User;
  let bob: User;
  let charlie: User;
  let aliceToken: string;
  let bobToken: string;
  let charlieToken: string;

  let publicMoment: Moment;
  let matchesOnlyMoment: Moment;
  let activeQuickMoment: QuickMoment;
  let expiredQuickMoment: QuickMoment;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await DeepLink.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await User.destroy({ where: {} });

    jest.spyOn(s3Service, 'getThumbnailUrl').mockImplementation((url) => {
      return url ? `https://thumbnails.flirttime.app/${url}` : '';
    });

    // Create test users
    alice = await User.create({
      username: 'alice_adventures',
      email: 'alice@flirttime.app',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      city: 'Mumbai',
      profilePicture: 'photos/alice_dp.jpg',
      isActive: true,
      role: 'user',
    });

    bob = await User.create({
      username: 'bob_builder',
      email: 'bob@flirttime.app',
      fullName: 'Bob Smith',
      firstName: 'Bob',
      city: 'Delhi',
      profilePicture: 'photos/bob_dp.jpg',
      isActive: true,
      role: 'user',
    });

    charlie = await User.create({
      username: 'charlie_chaplin',
      email: 'charlie@flirttime.app',
      fullName: 'Charlie Chaplin',
      firstName: 'Charlie',
      city: 'Bangalore',
      isActive: true,
      role: 'user',
    });

    aliceToken = generateToken({ id: alice.id, email: alice.email!, role: alice.role });
    bobToken = generateToken({ id: bob.id, email: bob.email!, role: bob.role });
    charlieToken = generateToken({ id: charlie.id, email: charlie.email!, role: charlie.role });

    // 1. Create a public permanent moment by Alice
    publicMoment = await Moment.create({
      userId: alice.id,
      caption: 'Planning the next getaway ✈️🌴',
      audience: 'everyone',
      status: 'active',
      publishedAt: new Date(),
      expiresAt: null,
      locationLabel: 'Goa, India',
    });

    await MomentMedia.create({
      momentId: publicMoment.id,
      mediaUrl: 'moments/alice_goa_beach.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    // 2. Create a matches-only moment by Alice
    matchesOnlyMoment = await Moment.create({
      userId: alice.id,
      caption: 'Exclusive sunset dinner for matches only 🍷',
      audience: 'matches_only',
      status: 'active',
      publishedAt: new Date(),
      expiresAt: null,
    });

    await MomentMedia.create({
      momentId: matchesOnlyMoment.id,
      mediaUrl: 'moments/alice_sunset.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    // 3. Create active Quick Moment by Alice (expires in 24 hours)
    const now = new Date();
    const future24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    activeQuickMoment = await QuickMoment.create({
      userId: alice.id,
      type: 'image',
      mediaUrl: 'quick_moments/alice_story.jpg',
      caption: 'Coffee date vibes ☕',
      status: 'active',
      publishedAt: now,
      expiresAt: future24h,
    });

    // 4. Create an already expired Quick Moment by Alice
    const past24h = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expiredQuickMoment = await QuickMoment.create({
      userId: alice.id,
      type: 'text',
      text: 'Old morning workout thoughts',
      status: 'active',
      publishedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      expiresAt: past24h,
    });
  });

  describe('1. Generate a Shareable Deep Link (POST /api/v1/deep-links)', () => {
    it('should generate a share link for a permanent Moment by the owner', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contentType).toBe('moment');
      expect(res.body.data.code).toBeDefined();
      expect(res.body.data.code.length).toBe(10);
      expect(res.body.data.url).toContain(`/l/${res.body.data.code}`);
      expect(res.body.data.expiresAt).toBeNull();
    });

    it('should reuse an existing active link instead of creating duplicate links', async () => {
      // First call
      const res1 = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      // Second call by the same user for the same content
      const res2 = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.data.code).toBe(res1.body.data.code);
      expect(res2.body.data.url).toBe(res1.body.data.url);

      // Verify only 1 record exists in database
      const count = await DeepLink.count({
        where: { creatorId: alice.id, contentId: publicMoment.id },
      });
      expect(count).toBe(1);
    });

    it('should generate a Quick Moment link that inherits the 24-hour expiration', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'quick_moment',
          contentId: activeQuickMoment.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.contentType).toBe('quick_moment');
      expect(res.body.data.expiresAt).toBeDefined();
      expect(new Date(res.body.data.expiresAt).getTime()).toBe(
        new Date(activeQuickMoment.expiresAt).getTime()
      );
    });

    it('should generate a Profile share link', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'profile',
          contentId: alice.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.contentType).toBe('profile');
      expect(res.body.data.expiresAt).toBeNull();
    });

    it('should reject unauthenticated link creation with 401', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject unsupported content types with 400', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'unsupported_type',
          contentId: publicMoment.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid UUID contentId with 400', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: 'not-a-valid-uuid',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject non-existent contentId with 404', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: '12345678-1234-1234-1234-123456789abc',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should reject sharing an expired Quick Moment with 410', async () => {
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'quick_moment',
          contentId: expiredQuickMoment.id,
        });

      expect(res.status).toBe(410);
      expect(res.body.message).toContain('expired');
    });

    it('should reject sharing a matches-only moment if user is not matched with creator', async () => {
      // Bob tries to share Alice's matches-only moment without being matched
      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${bobToken}`)
        .send({
          contentType: 'moment',
          contentId: matchesOnlyMoment.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('mutual matches');
    });

    it('should reject sharing content when users are blocked', async () => {
      // Alice blocks Charlie
      await UserBlock.create({
        userId: alice.id,
        blockedUserId: charlie.id,
      });

      const res = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${charlieToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('privacy restrictions');
    });
  });

  describe('2. Resolve Deep Links (GET /api/v1/deep-links/:code)', () => {
    it('should resolve a valid permanent Moment link with safe metadata', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      const res = await request(app).get(`/api/v1/deep-links/${code}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.contentType).toBe('moment');
      expect(res.body.data.contentId).toBe(publicMoment.id);
      expect(res.body.data.status).toBe('available');
      expect(res.body.data.requiresAuthentication).toBe(false);
      expect(res.body.data.title).toContain('Planning the next getaway');
      expect(res.body.data.thumbnailUrl).toContain('moments/alice_goa_beach.jpg');
      expect(res.body.data.author.name).toBe('Alice');
      expect(res.body.data.author.avatar).toBeDefined();

      // Ensure private user fields (password, email, phone) are NOT returned
      expect(res.body.data.author.email).toBeUndefined();
      expect(res.body.data.author.phone).toBeUndefined();
    });

    it('should resolve a Quick Moment link before expiration', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'quick_moment',
          contentId: activeQuickMoment.id,
        });

      const code = createRes.body.data.code;

      const res = await request(app).get(`/api/v1/deep-links/${code}`);

      expect(res.status).toBe(200);
      expect(res.body.data.contentType).toBe('quick_moment');
      expect(res.body.data.status).toBe('available');
      expect(res.body.data.title).toBe('Coffee date vibes ☕');
    });

    it('should return expired status when a Quick Moment link expires', async () => {
      // Create a link with past expiresAt
      const link = await DeepLink.create({
        code: 'expiredCode1',
        contentType: 'quick_moment',
        contentId: activeQuickMoment.id,
        creatorId: alice.id,
        status: 'active',
        expiresAt: new Date(Date.now() - 1000 * 60), // 1 minute ago
      });

      const res = await request(app).get(`/api/v1/deep-links/${link.code}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('expired');
      expect(res.body.data.isExpired).toBe(true);
    });

    it('should return revoked status when link is revoked', async () => {
      const link = await DeepLink.create({
        code: 'revokedCode1',
        contentType: 'moment',
        contentId: publicMoment.id,
        creatorId: alice.id,
        status: 'revoked',
        expiresAt: null,
      });

      const res = await request(app).get(`/api/v1/deep-links/${link.code}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('revoked');
      expect(res.body.data.isRevoked).toBe(true);
    });

    it('should return deleted status when underlying Moment is deleted', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      // Soft delete the moment
      await publicMoment.update({ status: 'deleted' });

      const res = await request(app).get(`/api/v1/deep-links/${code}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('deleted');
    });

    it('should return 404 for unknown or invalid deep link code', async () => {
      const res = await request(app).get('/api/v1/deep-links/invalidNonExistentCode');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should require authentication for private matches-only moment when opened unauthenticated', async () => {
      // Alice creates a link for her matches-only moment
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: matchesOnlyMoment.id,
        });

      const code = createRes.body.data.code;

      // Unauthenticated recipient tries to resolve
      const unauthRes = await request(app).get(`/api/v1/deep-links/${code}`);

      expect(unauthRes.status).toBe(200);
      expect(unauthRes.body.data.requiresAuthentication).toBe(true);
      expect(unauthRes.body.data.status).toBe('restricted');

      // Authenticated recipient who is NOT matched
      const nonMatchRes = await request(app)
        .get(`/api/v1/deep-links/${code}`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(nonMatchRes.status).toBe(200);
      expect(nonMatchRes.body.data.status).toBe('restricted');

      // Now create mutual match between Alice and Bob
      const [u1, u2] = [alice.id, bob.id].sort();
      await Match.create({
        user1Id: u1,
        user2Id: u2,
        matchedBy: 'like',
        isActive: true,
      });

      // Authenticated recipient who IS matched resolves successfully!
      const matchedRes = await request(app)
        .get(`/api/v1/deep-links/${code}`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(matchedRes.status).toBe(200);
      expect(matchedRes.body.data.status).toBe('available');
    });

    it('should respect block rules when resolving a link', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      // Alice blocks Bob
      await UserBlock.create({
        userId: alice.id,
        blockedUserId: bob.id,
      });

      const res = await request(app)
        .get(`/api/v1/deep-links/${code}`)
        .set('Authorization', `Bearer ${bobToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('unavailable');
    });

    it('should atomically increment clicksCount on resolution', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      await request(app).get(`/api/v1/deep-links/${code}`);
      await request(app).get(`/api/v1/deep-links/${code}`);

      // Small delay for asynchronous increment
      await new Promise((r) => setTimeout(r, 100));

      const link = await DeepLink.findOne({ where: { code } });
      expect(link?.clicksCount).toBeGreaterThanOrEqual(2);
      expect(link?.lastAccessedAt).toBeDefined();
    });
  });

  describe('3. Share Preview (GET /api/v1/deep-links/:code/preview)', () => {
    it('should return safe Open Graph metadata for available content', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      const res = await request(app).get(`/api/v1/deep-links/${code}/preview`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toContain('Alice on FlirtTime');
      expect(res.body.data.description).toContain('Planning the next getaway');
      expect(res.body.data.canonicalUrl).toContain(`/l/${code}`);
      expect(res.body.data.siteName).toBe('FlirtTime');
    });
  });

  describe('4. Web Landing Page & Universal Links (/l/:code & .well-known)', () => {
    it('should serve HTML web landing page with Open Graph and Universal Link metadata', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      const res = await request(app).get(`/l/${code}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('<!DOCTYPE html>');
      expect(res.text).toContain('property="og:title"');
      expect(res.text).toContain('name="apple-itunes-app"');
      expect(res.text).toContain(`flirttime://l/${code}`);
      expect(res.text).toContain('Open in App');
      expect(res.text).toContain('FlirtTime');
    });

    it('should serve Apple App Site Association JSON at /.well-known/apple-app-site-association', async () => {
      const res = await request(app).get('/.well-known/apple-app-site-association');

      expect(res.status).toBe(200);
      expect(res.body.applinks).toBeDefined();
      expect(res.body.applinks.details[0].paths).toContain('/l/*');
    });

    it('should serve Android Digital Asset Links JSON at /.well-known/assetlinks.json', async () => {
      const res = await request(app).get('/.well-known/assetlinks.json');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].target.namespace).toBe('android_app');
    });
  });

  describe('5. Link Analytics (POST /api/v1/deep-links/:code/track)', () => {
    it('should track permitted interaction events', async () => {
      const createRes = await request(app)
        .post('/api/v1/deep-links')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({
          contentType: 'moment',
          contentId: publicMoment.id,
        });

      const code = createRes.body.data.code;

      const res = await request(app)
        .post(`/api/v1/deep-links/${code}/track`)
        .send({
          event: 'app_opened',
          platform: 'ios',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recorded).toBe(true);
      expect(res.body.data.event).toBe('app_opened');
    });
  });

  describe('6. Backward Compatibility', () => {
    it('should ensure existing Moments feed API remains fully functional', async () => {
      const res = await request(app)
        .get('/api/v1/moments/feed')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should ensure existing User profile API remains fully functional', async () => {
      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${aliceToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(alice.id);
    });
  });
});
