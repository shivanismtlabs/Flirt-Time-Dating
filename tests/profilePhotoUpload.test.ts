import request from 'supertest';
import app from '../src/app';
import { sequelize, User, UserPhoto, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Profile Photo Upload API (POST /api/v1/onboarding/profile-photo)', () => {
  let user: User;
  let authToken: string;

  // 1x1 valid sample image buffers with correct magic bytes
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
    0xff, 0xd9,
  ]);

  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  ]);

  const corruptImageBuffer = Buffer.from('this-is-plain-text-not-an-image-header');

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();

    await UserPhoto.destroy({ where: {} });
    await User.destroy({ where: {} });

    user = await User.create({
      username: 'meera_profile_test',
      email: 'meera.profile@example.com',
      fullName: 'Meera Patel',
      nickName: 'Meera',
      dateOfBirth: '1998-05-15',
      gender: 'female',
      about: 'Loving music and adventures!',
      isActive: true,
      role: 'user',
    });

    authToken = generateToken({ id: user.id, email: user.email!, role: user.role });

    // Mock S3 upload by default to avoid live AWS network calls
    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(async (_buf, uid) => {
      return `photos/${uid}/${Date.now()}_mocked.jpg`;
    });
    jest.spyOn(s3Service, 'deleteObject').mockResolvedValue();
  });

  describe('1. Authentication & Security', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .attach('profilePhoto', validJpegBuffer, 'camera_capture.jpg');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid JWT token with 401', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', 'Bearer invalid_token_123')
        .attach('profilePhoto', validJpegBuffer, 'camera_capture.jpg');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should ignore body userId and enforce authenticated user ownership', async () => {
      const otherUserId = '00000000-0000-0000-0000-000000000001';
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .field('userId', otherUserId)
        .attach('profilePhoto', validJpegBuffer, 'camera_capture.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const savedPhoto = await UserPhoto.findByPk(res.body.data.photoId);
      expect(savedPhoto?.userId).toBe(user.id);
      expect(savedPhoto?.userId).not.toBe(otherUserId);
    });
  });

  describe('2. Validation & Image Integrity', () => {
    it('should reject missing profilePhoto field with 400', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/profilePhoto is required/i);
    });

    it('should reject unsupported file MIME types (e.g. text/pdf) with 400', async () => {
      const textBuffer = Buffer.from('Sample plain text document');
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', textBuffer, { filename: 'test.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/unsupported/i);
    });

    it('should reject corrupted image whose magic bytes do not match JPEG/PNG/WebP with 400', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', corruptImageBuffer, {
          filename: 'fake_camera_photo.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/File signature does not match/i);
    });

    it('should reject file exceeding 5MB limit with 400', async () => {
      const oversizedBuffer = Buffer.alloc(5.5 * 1024 * 1024); // 5.5 MB
      oversizedBuffer[0] = 0xff;
      oversizedBuffer[1] = 0xd8;
      oversizedBuffer[2] = 0xff;

      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', oversizedBuffer, 'large_photo.jpg');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/5MB/i);
    });
  });

  describe('3. Successful Profile Photo Upload & Replacement', () => {
    it('should upload camera JPEG image and set as primary photo', async () => {
      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', validJpegBuffer, 'camera_selfie.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Profile photo uploaded successfully');
      expect(res.body.data.photoId).toBeDefined();
      expect(res.body.data.profilePhoto).toContain('photos/');
      expect(res.body.data.isPrimary).toBe(true);
      expect(res.body.data.currentStep).toBe('gesture');

      // Verify in DB
      const photoInDb = await UserPhoto.findByPk(res.body.data.photoId);
      expect(photoInDb).not.toBeNull();
      expect(photoInDb?.isPrimary).toBe(true);
      expect(photoInDb?.imageUrl).toBe(res.body.data.profilePhoto);

      // Verify User main profilePicture was updated
      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser?.profilePicture).toBe(res.body.data.profilePhoto);

      // Verify existing profile details remain untouched
      expect(updatedUser?.fullName).toBe('Meera Patel');
      expect(updatedUser?.dateOfBirth).toBe('1998-05-15');
      expect(updatedUser?.gender).toBe('female');
      expect(updatedUser?.onboardingStep).toBe('gesture');
      expect(updatedUser?.isProfileComplete).toBe(false);
    });

    it('should upload gallery PNG image and successfully replace existing primary photo', async () => {
      // First upload: initial primary photo
      const firstRes = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', validJpegBuffer, 'initial.jpg');

      expect(firstRes.status).toBe(201);
      const firstPhotoId = firstRes.body.data.photoId;

      // Second upload: new primary profile photo
      const secondRes = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', validPngBuffer, 'new_gallery_photo.png');

      expect(secondRes.status).toBe(201);
      expect(secondRes.body.data.isPrimary).toBe(true);
      const secondPhotoId = secondRes.body.data.photoId;

      // Verify previous photo was demoted to isPrimary = false and NOT deleted
      const oldPhoto = await UserPhoto.findByPk(firstPhotoId);
      expect(oldPhoto).not.toBeNull();
      expect(oldPhoto?.isPrimary).toBe(false);

      // Verify new photo is primary
      const newPhoto = await UserPhoto.findByPk(secondPhotoId);
      expect(newPhoto?.isPrimary).toBe(true);

      // Verify user's profilePicture points to the new photo
      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser?.profilePicture).toBe(secondRes.body.data.profilePhoto);

      // Both photos still exist in gallery
      const totalPhotos = await UserPhoto.count({ where: { userId: user.id } });
      expect(totalPhotos).toBe(2);
    });
  });

  describe('4. Storage & Database Failure Safety', () => {
    it('should return 500 when S3 storage fails and not create DB records', async () => {
      jest.spyOn(s3Service, 'uploadMedia').mockRejectedValueOnce(new Error('S3 Network Timeout'));

      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', validJpegBuffer, 'photo.jpg');

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);

      const photoCount = await UserPhoto.count({ where: { userId: user.id } });
      expect(photoCount).toBe(0);
    });

    it('should clean up orphaned S3 object when database persistence fails', async () => {
      const deleteSpy = jest.spyOn(s3Service, 'deleteObject').mockResolvedValue();

      // Force DB failure during transaction
      jest.spyOn(UserPhoto, 'create').mockRejectedValueOnce(new Error('Database Constraint Error'));

      const res = await request(app)
        .post('/api/v1/onboarding/profile-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profilePhoto', validJpegBuffer, 'photo.jpg');

      expect(res.status).toBe(500);
      expect(deleteSpy).toHaveBeenCalled();
    });
  });
});
