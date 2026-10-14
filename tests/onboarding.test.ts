import request from 'supertest';
import app from '../src/app';
import { sequelize, User, Interest, UserInterest, UserPhoto, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';
import { createBlankImage } from './helpers/imageFixtures';

describe('Onboarding Preference & Media APIs', () => {
  let user: User;
  let authToken: string;
  let interest1: Interest;
  let interest2: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    interest1 = await Interest.create({ name: 'Test Music', icon: '🎵', isActive: true });
    interest2 = await Interest.create({ name: 'Test Art', icon: '🎨', isActive: true });

    // Mock S3 storage
    jest.spyOn(s3Service, 'uploadMedia').mockResolvedValue('mock_s3_key_123.jpg');
    jest.spyOn(s3Service, 'deleteObject').mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    await UserInterest.destroy({ where: {}, truncate: true });
    await UserPhoto.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });

    user = await User.create({
      username: 'onboarding_user',
      email: 'onboard@example.com',
      fullName: 'Onboarding Tester',
      dateOfBirth: '1998-01-01',
      gender: 'male',
      isActive: true,
      isProfileComplete: false,
    });

    authToken = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await sequelize.close();
  });

  describe('1. Screen 21: Dating Preferences (lookingFor)', () => {
    it('should save and retrieve valid dating preference', async () => {
      // Save
      const putRes = await request(app)
        .put('/api/v1/onboarding/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ lookingFor: 'something_casual' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.lookingFor).toBe('something_casual');

      // Retrieve
      const getRes = await request(app)
        .get('/api/v1/onboarding/preferences')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.lookingFor).toBe('something_casual');
    });

    it('should reject invalid lookingFor option with 400', async () => {
      const res = await request(app)
        .put('/api/v1/onboarding/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ lookingFor: 'invalid_choice' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Screen 22: Gender Preference', () => {
    it('should save and retrieve gender preference', async () => {
      const putRes = await request(app)
        .put('/api/v1/onboarding/gender-preference')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ genderPreference: 'women' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.genderPreference).toBe('women');

      const getRes = await request(app)
        .get('/api/v1/onboarding/gender-preference')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.genderPreference).toBe('women');
    });

    it('should reject invalid gender preference with 400', async () => {
      const res = await request(app)
        .put('/api/v1/onboarding/gender-preference')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ genderPreference: 'animals' });

      expect(res.status).toBe(400);
    });
  });

  describe('3. Screen 23: Religious Belief (Supports Skip)', () => {
    it('should save and retrieve religion', async () => {
      const putRes = await request(app)
        .put('/api/v1/onboarding/religion')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ religion: 'hindu' });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.religion).toBe('hindu');
    });

    it('should allow skipping by sending null', async () => {
      const putRes = await request(app)
        .put('/api/v1/onboarding/religion')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ religion: null });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.religion).toBeNull();
    });
  });

  describe('4. Screen 24: Matching Interests', () => {
    it('should save selected interests and return updated list', async () => {
      const putRes = await request(app)
        .put('/api/v1/onboarding/interests')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ interestIds: [interest1.id, interest2.id] });

      expect(putRes.status).toBe(200);
      expect(putRes.body.data.interests.length).toBe(2);

      const getRes = await request(app)
        .get('/api/v1/onboarding/interests')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.interests.length).toBe(2);
    });

    it('should reject invalid interest ID with 400', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .put('/api/v1/onboarding/interests')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ interestIds: [fakeId] });

      expect(res.status).toBe(400);
    });
  });

  describe('5. Screen 25: Profile Photos Gallery', () => {
    it('should upload a photo and mark the first photo as primary', async () => {
      const fakePhoto = await createBlankImage(200, 200);

      const res = await request(app)
        .post('/api/v1/onboarding/photos')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('photo', fakePhoto, 'profile.jpg');

      expect(res.status).toBe(201);
      expect(res.body.data.photo).toBeDefined();
      expect(res.body.data.photo.isPrimary).toBe(true);

      const updatedUser = await User.findByPk(user.id);
      expect(updatedUser?.profilePicture).toBe('mock_s3_key_123.jpg');
    });

    it('should allow setting a photo as primary and deleting photos', async () => {
      const p1 = await UserPhoto.create({
        userId: user.id,
        imageUrl: 'photo1.jpg',
        isPrimary: true,
        displayOrder: 0,
      });

      const p2 = await UserPhoto.create({
        userId: user.id,
        imageUrl: 'photo2.jpg',
        isPrimary: false,
        displayOrder: 1,
      });

      // Set p2 as primary
      const patchRes = await request(app)
        .patch(`/api/v1/onboarding/photos/${p2.id}/primary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.photo.isPrimary).toBe(true);

      // Delete p1
      const delRes = await request(app)
        .delete(`/api/v1/onboarding/photos/${p1.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(delRes.status).toBe(200);
    });
  });

  describe('6. Voice Prompt Audio & Onboarding Progress', () => {
    it('should save duration: 5 when client sends duration: "5"', async () => {
      const audioBuffer = Buffer.from('fake-audio-recording-bytes');

      const res = await request(app)
        .post('/api/v1/onboarding/audio')
        .set('Authorization', `Bearer ${authToken}`)
        .field('duration', '5')
        .attach('audio', audioBuffer, 'voice_intro.m4a');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.voicePromptUrl).toBeDefined();
      expect(res.body.data.durationSeconds).toBe(5);
      expect(res.body.data.duration).toBe(5);

      // Verify GET /api/v1/onboarding/audio also returns 5
      const getRes = await request(app)
        .get('/api/v1/onboarding/audio')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.durationSeconds).toBe(5);
      expect(getRes.body.data.duration).toBe(5);
    });

    it('should upload voice prompt recording and enforce duration limits', async () => {
      const audioBuffer = Buffer.from('fake-audio-recording-bytes');

      const res = await request(app)
        .post('/api/v1/onboarding/audio')
        .set('Authorization', `Bearer ${authToken}`)
        .field('durationSeconds', '30')
        .attach('audio', audioBuffer, 'voice.mp3');

      expect(res.status).toBe(201);
      expect(res.body.data.voicePromptUrl).toBeDefined();
      expect(res.body.data.durationSeconds).toBe(30);
      expect(res.body.data.duration).toBe(30);
    });

    it('should calculate duration directly from M4A audio file when duration parameter is not sent', async () => {
      // Construct a valid minimal ISO Media (M4A) buffer with mvhd atom indicating 8 seconds
      const m4aBuf = Buffer.alloc(120);
      m4aBuf.writeUInt32BE(120, 0); // boxSize
      m4aBuf.write('moov', 4);
      m4aBuf.writeUInt32BE(60, 8); // mvhd size
      m4aBuf.write('mvhd', 12);
      m4aBuf.writeUInt8(0, 16); // version 0
      m4aBuf.writeUInt32BE(1000, 28); // timescale = 1000 Hz
      m4aBuf.writeUInt32BE(8000, 32); // duration = 8000 -> 8 seconds

      const res = await request(app)
        .post('/api/v1/onboarding/audio')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('audio', m4aBuf, 'voice_intro.m4a');

      expect(res.status).toBe(201);
      expect(res.body.data.durationSeconds).toBe(8);
      expect(res.body.data.duration).toBe(8);
    });

    it('should compute onboarding progress accurately', async () => {
      const res = await request(app)
        .get('/api/v1/onboarding/progress')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.steps).toBeDefined();
      expect(res.body.data.completionPercentage).toBeDefined();
    });
  });
});
