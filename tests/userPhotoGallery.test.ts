import request from 'supertest';
import app from '../src/app';
import { sequelize, User, UserPhoto, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';
import { createBlankImage } from './helpers/imageFixtures';

describe('User Profile & Gallery Photos Upload & Edit API', () => {
  let user: User;
  let authToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await UserPhoto.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });

    // Mock S3
    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(async (_buf, uid) => {
      return `photos/${uid}/${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    });
    jest.spyOn(s3Service as any, 'deleteObject').mockResolvedValue(undefined as any);
    jest.spyOn(s3Service, 'checkObjectExists').mockResolvedValue({ exists: true, contentLength: 1024, contentType: 'image/jpeg' });

    user = await User.create({
      username: 'gallery_tester',
      email: 'gallery@example.com',
      fullName: 'Gallery Tester',
      dateOfBirth: '1996-06-15',
      gender: 'female',
      isActive: true,
      isProfileComplete: false,
    });

    authToken = generateToken({
      id: user.id,
      email: user.email!,
      role: user.role,
    });
  });

  describe('1. Photo upload count', () => {
    it('should reject request with 400 when no photos are provided', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/at least one photo/i);
    });

    it('should succeed when only 1 photo is provided', async () => {
      const p1 = await createBlankImage(100, 100);

      const res = await request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('photos', p1, 'photo1.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(1);
    });

    it('should succeed when only 2 photos are provided', async () => {
      const p1 = await createBlankImage(100, 100);
      const p2 = await createBlankImage(100, 100);

      const res = await request(app)
        .post('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('photos', p1, 'photo1.jpg')
        .attach('photos', p2, 'photo2.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(2);
    });

    it('should succeed when 6 photos are provided', async () => {
      const images = await Promise.all(Array.from({ length: 6 }, () => createBlankImage(100, 100)));

      const req = request(app)
        .post('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`);

      for (let i = 0; i < 6; i++) {
        req.attach('photos', images[i], `photo${i + 1}.jpg`);
      }

      const res = await req;
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(6);
    });

    it('should succeed with 201 when exactly 3 photos are uploaded', async () => {
      const images = await Promise.all(Array.from({ length: 3 }, () => createBlankImage(100, 100)));

      const res = await request(app)
        .post('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('photos', images[0], 'p1.jpg')
        .attach('photos', images[1], 'p2.jpg')
        .attach('photos', images[2], 'p3.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(3);
      expect(res.body.data.totalPhotos).toBe(3);
      expect(res.body.data.photo.isPrimary).toBe(true);

      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser?.profilePicture).toBeDefined();
    });

    it('should succeed with 201 when 5 photos are uploaded', async () => {
      const images = await Promise.all(Array.from({ length: 5 }, () => createBlankImage(100, 100)));

      const req = request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`);

      for (let i = 0; i < 5; i++) {
        req.attach('photos', images[i], `photo${i + 1}.jpg`);
      }

      const res = await req;
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(5);
      expect(res.body.data.totalPhotos).toBe(5);
    });
  });

  describe('2. Pre-uploaded S3 Keys Support', () => {
    it('should succeed when valid pre-uploaded imageKeys are passed in body', async () => {
      const preKeys = [
        `photos/${user.id}/p1_direct.jpg`,
        `photos/${user.id}/p2_direct.jpg`,
        `photos/${user.id}/p3_direct.jpg`,
      ];

      const res = await request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ imageKeys: preKeys });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(3);
    });

    it('should reject pre-uploaded key belonging to another user with 403', async () => {
      const invalidKeys = [
        `photos/${user.id}/p1.jpg`,
        `photos/${user.id}/p2.jpg`,
        `photos/another-user-uuid/stolen.jpg`,
      ];

      const res = await request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ imageKeys: invalidKeys });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/not authorized/i);
    });
  });

  describe('3. Edit Profile Photos (PUT / PATCH)', () => {
    beforeEach(async () => {
      // Seed 3 existing photos
      for (let i = 1; i <= 3; i++) {
        await UserPhoto.create({
          userId: user.id,
          imageUrl: `photos/${user.id}/existing_${i}.jpg`,
          isPrimary: i === 1,
          displayOrder: i - 1,
          status: 'approved',
        });
      }
    });

    it('should allow replacing photos via PUT with 4 new photos', async () => {
      const images = await Promise.all(Array.from({ length: 4 }, () => createBlankImage(100, 100)));

      const req = request(app)
        .put('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`);

      for (let i = 0; i < 4; i++) {
        req.attach('photos', images[i], `new_${i + 1}.jpg`);
      }

      const res = await req;
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(4);
      expect(res.body.data.totalPhotos).toBe(4);
    });

    it('should allow editing photos down to fewer than 3 photos', async () => {
      const images = await Promise.all(Array.from({ length: 2 }, () => createBlankImage(100, 100)));

      const res = await request(app)
        .put('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('photos', images[0], 'n1.jpg')
        .attach('photos', images[1], 'n2.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(2);
    });
  });

  describe('4. Delete Photo Restrictions (Min 3 Enforced)', () => {
    it('should block deleting a photo when user has only 3 photos', async () => {
      const p1 = await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p1.jpg`,
        isPrimary: true,
        displayOrder: 0,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p2.jpg`,
        isPrimary: false,
        displayOrder: 1,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p3.jpg`,
        isPrimary: false,
        displayOrder: 2,
      });

      const res = await request(app)
        .delete(`/api/v1/users/photos/${p1.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/minimum 3 profile photos required/i);
    });

    it('should allow deleting a photo when user has 4 photos', async () => {
      const p1 = await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p1.jpg`,
        isPrimary: true,
        displayOrder: 0,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p2.jpg`,
        isPrimary: false,
        displayOrder: 1,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p3.jpg`,
        isPrimary: false,
        displayOrder: 2,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p4.jpg`,
        isPrimary: false,
        displayOrder: 3,
      });

      const res = await request(app)
        .delete(`/api/v1/users/photos/${p1.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const count = await UserPhoto.count({ where: { userId: user.id } });
      expect(count).toBe(3);
    });
  });

  describe('5. Primary Photo Selection and Profile Retrieval', () => {
    it('should update primary photo and user.profilePicture', async () => {
      const p1 = await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p1.jpg`,
        isPrimary: true,
        displayOrder: 0,
      });
      const p2 = await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p2.jpg`,
        isPrimary: false,
        displayOrder: 1,
      });
      await UserPhoto.create({
        userId: user.id,
        imageUrl: `photos/${user.id}/p3.jpg`,
        isPrimary: false,
        displayOrder: 2,
      });

      const patchRes = await request(app)
        .patch(`/api/v1/users/photos/${p2.id}/primary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.success).toBe(true);
      expect(patchRes.body.data.photo.isPrimary).toBe(true);

      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser?.profilePicture).toBe(`photos/${user.id}/p2.jpg`);
    });

    it('should list all user photos via GET /api/v1/users/photos', async () => {
      for (let i = 1; i <= 3; i++) {
        await UserPhoto.create({
          userId: user.id,
          imageUrl: `photos/${user.id}/photo_${i}.jpg`,
          isPrimary: i === 1,
          displayOrder: i - 1,
        });
      }

      const res = await request(app)
        .get('/api/v1/users/photos')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.photos).toHaveLength(3);
      expect(res.body.data.photos[0].imageUrl).toContain('photo_1.jpg');
    });
  });
});
