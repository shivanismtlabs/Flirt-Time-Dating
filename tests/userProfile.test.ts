import request from 'supertest';
import app from '../src/app';
import { sequelize, User, EmailVerification, PhoneVerification, UserPhoto, UserInterest } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { hashPassword } from '../src/utils/password';
import { s3Service } from '../src/services/s3.service';
import { emailProvider } from '../src/services/email.service';
import { smsProvider } from '../src/services/sms.service';

describe('User Profile Onboarding API (PATCH /api/v1/users/profile)', () => {
  let testUser: User;
  let authToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await EmailVerification.destroy({ where: {} });
    await PhoneVerification.destroy({ where: {} });
    await UserPhoto.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });
    jest.restoreAllMocks();

    const hashedPassword = await hashPassword('Password123');
    testUser = await User.create({
      username: 'mike_hussey',
      email: 'mike@example.com',
      password: hashedPassword,
      role: 'user',
      isActive: true,
      isProfileComplete: false,
    });

    authToken = generateToken({
      id: testUser.id,
      email: testUser.email,
      role: testUser.role,
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. Successful Profile Onboarding Flow', () => {
    it('should allow authenticated user to save profile and mark profile as complete', async () => {
      const payload = {
        fullName: 'Mike Hussey',
        nickName: 'Mikey',
        dateOfBirth: '1996-10-09',
        gender: 'male',
        about: 'Creative mind with a love for Design. Looking for someone who appreciates deep thinking and empathy:)',
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/profile updated successfully/i);
      expect(res.body.data).toBeDefined();

      expect(res.body.data.id).toBe(testUser.id);
      expect(res.body.data.fullName).toBe('Mike Hussey');
      expect(res.body.data.nickName).toBe('Mikey');
      expect(res.body.data.dateOfBirth).toBe('1996-10-09');
      expect(res.body.data.gender).toBe('male');
      expect(res.body.data.about).toBe(payload.about);
      expect(res.body.data.isProfileComplete).toBe(true);
      expect(res.body.data.location).toBeDefined();
      expect(res.body.data.age).toBeDefined();
      expect(res.body.data.password).toBeUndefined();

      // Verify in DB
      const updatedDbUser = await User.findByPk(testUser.id);
      expect(updatedDbUser?.fullName).toBe('Mike Hussey');
      expect(updatedDbUser?.nickName).toBe('Mikey');
      expect(updatedDbUser?.dateOfBirth).toBe('1996-10-09');
      expect(updatedDbUser?.gender).toBe('male');
      expect(updatedDbUser?.isProfileComplete).toBe(true);
    });

    it('should update profile with username, location, latitude, longitude and sync nickName', async () => {
      const payload = {
        about: 'Def a. SCD kasndklat and you will never get a chance for this one day you are not going anywhere with your life in it you will be a legend and you are',
        dateOfBirth: '2007-06-07',
        fullName: 'Madsudan Patel',
        gender: 'male',
        username: 'madupatel',
        location: 'Mumbai, Maharashtra',
        latitude: 19.076,
        longitude: 72.8777,
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('madupatel');
      expect(res.body.data.nickName).toBe('madupatel');
      expect(res.body.data.fullName).toBe('Madsudan Patel');
      expect(res.body.data.firstName).toBe('Madsudan');
      expect(res.body.data.lastName).toBe('Patel');
      expect(res.body.data.dateOfBirth).toBe('2007-06-07');
      expect(res.body.data.gender).toBe('male');
      expect(res.body.data.about).toBe(payload.about);
      expect(res.body.data.latitude).toBe(19.076);
      expect(res.body.data.longitude).toBe(72.8777);
      expect(res.body.data.location.latitude).toBe(19.076);
      expect(res.body.data.location.longitude).toBe(72.8777);

      // Verify in DB
      const userInDb = await User.findByPk(testUser.id);
      expect(userInDb?.username).toBe('madupatel');
      expect(userInDb?.nickName).toBe('madupatel');
      expect(userInDb?.latitude).toBe(19.076);
      expect(userInDb?.longitude).toBe(72.8777);
    });

    it('should support longitutute alias and string coordinates for latitude and longitude', async () => {
      const payload = {
        latitude: '23.0225',
        longitutute: '72.5714',
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBe(23.0225);
      expect(res.body.data.longitude).toBe(72.5714);
    });

    it('should reject username if already taken by another user', async () => {
      // Create another user with a specific username
      await User.create({
        username: 'existing_taken_user',
        email: 'other_user@example.com',
        role: 'user',
        isActive: true,
      });

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: 'existing_taken_user',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/username is already taken/i);
    });

    it('should accept location string along with dateOfBirth and return structured location and age', async () => {
      const payload = {
        dateOfBirth: '1996-10-09',
        location: 'Indore, Madhya Pradesh',
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dateOfBirth).toBe('1996-10-09');
      expect(res.body.data.age).toBeDefined();
      expect(typeof res.body.data.age).toBe('number');
      expect(res.body.data.location).toEqual({
        city: 'Indore',
        state: 'Madhya Pradesh',
        country: 'India',
        county: null,
        name: 'Indore, Madhya Pradesh',
        label: 'Indore, Madhya Pradesh, India',
        fullLocation: 'Indore, Madhya Pradesh, India',
        formattedLocation: 'Indore, Madhya Pradesh, India',
        latitude: null,
        longitude: null,
      });
      expect(res.body.data.city).toBe('Indore, Madhya Pradesh');
      expect(res.body.data.state).toBe('Madhya Pradesh');
      expect(res.body.data.country).toBe('India');
      expect(res.body.data.county).toBeNull();
      expect(res.body.data.fullLocation).toBe('Indore, Madhya Pradesh, India');

      // Verify in DB
      const userInDb = await User.findByPk(testUser.id);
      expect(userInDb?.city).toBe('Indore, Madhya Pradesh');
    });

    it('should accept location object with coordinates and return structured location', async () => {
      const payload = {
        location: {
          city: 'Mumbai',
          state: 'Maharashtra',
          latitude: 19.076,
          longitude: 72.8777,
        },
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.location.city).toBe('Mumbai');
      expect(res.body.data.location.state).toBe('Maharashtra');
      expect(res.body.data.location.country).toBe('India');
      expect(res.body.data.location.county).toBeNull();
      expect(res.body.data.location.fullLocation).toBe('Mumbai, Maharashtra, India');
      expect(res.body.data.location.latitude).toBe(19.076);
      expect(res.body.data.location.longitude).toBe(72.8777);
      expect(res.body.data.state).toBe('Maharashtra');
      expect(res.body.data.country).toBe('India');
      expect(res.body.data.county).toBeNull();
      expect(res.body.data.fullLocation).toBe('Mumbai, Maharashtra, India');
      expect(res.body.data.latitude).toBe(19.076);
      expect(res.body.data.longitude).toBe(72.8777);

      // Verify in GET /api/v1/users/profile
      const getRes = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.location.city).toBe('Mumbai');
      expect(getRes.body.data.location.state).toBe('Maharashtra');
      expect(getRes.body.data.location.country).toBe('India');
      expect(getRes.body.data.location.county).toBeNull();
      expect(getRes.body.data.location.fullLocation).toBe('Mumbai, Maharashtra, India');
      expect(getRes.body.data.profile.location.city).toBe('Mumbai');
      expect(getRes.body.data.profile.location.state).toBe('Maharashtra');
      expect(getRes.body.data.profile.location.country).toBe('India');
      expect(getRes.body.data.profile.location.county).toBeNull();
      expect(getRes.body.data.profile.location.fullLocation).toBe('Mumbai, Maharashtra, India');
      expect(getRes.body.data.profile.state).toBe('Maharashtra');
      expect(getRes.body.data.profile.country).toBe('India');
      expect(getRes.body.data.profile.county).toBeNull();
      expect(getRes.body.data.profile.fullLocation).toBe('Mumbai, Maharashtra, India');
      expect(getRes.body.data.location.latitude).toBe(19.076);
      expect(getRes.body.data.location.longitude).toBe(72.8777);
    });

    it('should accept full location object with county and country and return structured full location', async () => {
      const payload = {
        location: {
          city: 'Austin',
          county: 'Travis County',
          state: 'Texas',
          country: 'United States',
          latitude: 30.2672,
          longitude: -97.7431,
        },
      };

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.location.city).toBe('Austin');
      expect(res.body.data.location.county).toBe('Travis County');
      expect(res.body.data.location.state).toBe('Texas');
      expect(res.body.data.location.country).toBe('United States');
      expect(res.body.data.location.fullLocation).toBe('Austin, Travis County, Texas, United States');
      expect(res.body.data.state).toBe('Texas');
      expect(res.body.data.country).toBe('United States');
      expect(res.body.data.county).toBe('Travis County');
      expect(res.body.data.fullLocation).toBe('Austin, Travis County, Texas, United States');

      // Verify in GET /api/v1/users/profile
      const getRes = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.profile.location.city).toBe('Austin');
      expect(getRes.body.data.profile.location.county).toBe('Travis County');
      expect(getRes.body.data.profile.location.state).toBe('Texas');
      expect(getRes.body.data.profile.location.country).toBe('United States');
      expect(getRes.body.data.profile.location.fullLocation).toBe('Austin, Travis County, Texas, United States');
      expect(getRes.body.data.profile.state).toBe('Texas');
      expect(getRes.body.data.profile.country).toBe('United States');
      expect(getRes.body.data.profile.county).toBe('Travis County');
      expect(getRes.body.data.profile.fullLocation).toBe('Austin, Travis County, Texas, United States');
    });
  });

  describe('2. Authentication & Authorization Security Assertions', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).patch('/api/v1/users/profile').send({
        fullName: 'Mike Hussey',
        nickName: 'Mikey',
        dateOfBirth: '1996-10-09',
        gender: 'male',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid or malformed JWT token with 401', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', 'Bearer invalid_jwt_token_12345')
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should ignore body userId and update ONLY the authenticated user from JWT', async () => {
      const secondUser = await User.create({
        username: 'other_user',
        email: 'other@example.com',
        role: 'user',
        isActive: true,
      });

      // Pass secondUser's ID in body to attempt tampering
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: secondUser.id,
          id: secondUser.id,
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testUser.id);

      // Verify second user was NOT updated
      const secondDbUser = await User.findByPk(secondUser.id);
      expect(secondDbUser?.fullName).toBeNull();
    });

    it('should handle token for non-existent user with 404', async () => {
      const fakeToken = generateToken({
        id: '123e4567-e89b-12d3-a456-426614174999',
        email: 'fake@example.com',
        role: 'user',
      });

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${fakeToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Request Field Validation Assertions', () => {
    it('should allow partial updates without requiring dateOfBirth or gender', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          nickName: 'Mikey',
          about: 'Only updating about and children without dateOfBirth or gender',
          children: '1 Child',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.nickName).toBe('Mikey');
      expect(res.body.data.children).toBe('1 Child');
    });

    it('should reject empty or whitespace-only required fields', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: '   ',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject malformed or non-calendar Date of Birth', async () => {
      const invalidDates = ['09/10/1996', '1996/10/09', '1996-02-30', 'invalid-date'];

      for (const invalidDate of invalidDates) {
        const res = await request(app)
          .patch('/api/v1/users/profile')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            fullName: 'Mike Hussey',
            nickName: 'Mikey',
            dateOfBirth: invalidDate,
            gender: 'male',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });

    it('should reject Date of Birth in the future', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '2099-01-01',
          gender: 'male',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/future/i);
    });

    it('should reject underage user (< 18 years old)', async () => {
      const today = new Date();
      const underageYear = today.getFullYear() - 15;
      const underageDob = `${underageYear}-01-01`;

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: underageDob,
          gender: 'male',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/at least 18 years old/i);
    });

    it('should reject invalid gender value', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'alien',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should enforce maximum length of 500 characters on about field', async () => {
      const oversizedAbout = 'A'.repeat(501);

      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
          about: oversizedAbout,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Business Rules: Profile Updates for Date of Birth & Gender', () => {
    it('should allow updating an already-set Date of Birth and recalculate age', async () => {
      // 1. Initial save: sets DOB to 1996-10-09
      const res1 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });
      expect(res1.status).toBe(200);
      expect(res1.body.data.dateOfBirth).toBe('1996-10-09');

      // 2. Subsequent attempt to change DOB to 2005-07-08
      const res2 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '2005-07-08',
          gender: 'male',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.dateOfBirth).toBe('2005-07-08');
      expect(typeof res2.body.data.age).toBe('number');
    });

    it('should allow updating an already-set Gender', async () => {
      // 1. Initial save: sets Gender to male
      const res1 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });
      expect(res1.status).toBe(200);

      // 2. Subsequent attempt to change Gender to female
      const res2 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'female',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
      expect(res2.body.data.gender).toBe('female');
    });

    it('should allow subsequent updates to other fields (e.g. about, nickName) when DOB and Gender remain identical', async () => {
      // Initial save
      await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Mike Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
          about: 'Original about',
        });

      // Update about & nickName with same DOB & gender
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          fullName: 'Michael Hussey',
          nickName: 'Mikey10',
          dateOfBirth: '1996-10-09',
          gender: 'male',
          about: 'Updated about section',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('Michael Hussey');
      expect(res.body.data.nickName).toBe('Mikey10');
      expect(res.body.data.about).toBe('Updated about section');
    });
  });

  describe('5. Idempotency & System Compatibility Assertions', () => {
    it('should handle repeated Continue button requests safely without creating duplicates', async () => {
      const payload = {
        fullName: 'Mike Hussey',
        nickName: 'Mikey',
        dateOfBirth: '1996-10-09',
        gender: 'male',
      };

      const res1 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      const res2 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const count = await User.count({ where: { email: 'mike@example.com' } });
      expect(count).toBe(1);
    });

    it('should ensure existing auth APIs (register, login) continue working seamlessly', async () => {
      // Test registration
      const regRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: 'new_user_1',
          email: 'new1@example.com',
          password: 'Password123',
        });

      expect(regRes.status).toBe(201);
      expect(regRes.body.data.token).toBeDefined();

      // Test login
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'new1@example.com',
          password: 'Password123',
        });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.token).toBeDefined();
    });
  });

  describe('6. Cover Picture Upload API (POST /api/v1/users/cover-photo)', () => {
    const validJpegBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
      0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01,
      0xff, 0xd9,
    ]);

    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/users/cover-photo')
        .attach('coverPhoto', validJpegBuffer, 'cover.jpg');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject missing cover image file with 400', async () => {
      const res = await request(app)
        .post('/api/v1/users/cover-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should upload cover photo successfully and persist in user.coverPicture', async () => {
      jest.spyOn(s3Service, 'uploadMedia').mockImplementation(async (_buf, uid) => {
        return `covers/${uid}/cover_12345.jpg`;
      });
      jest.spyOn(s3Service, 'generateAndUploadThumbnail').mockResolvedValue('thumbnails/covers/mock.jpg');
      jest.spyOn(s3Service, 'deleteObject').mockResolvedValue();

      const res = await request(app)
        .post('/api/v1/users/cover-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('coverPhoto', validJpegBuffer, 'cover.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/cover picture uploaded successfully/i);
      expect(res.body.data.coverPicture).toBeDefined();
      expect(res.body.data.coverPhoto).toBeDefined();
      expect(res.body.data.key).toBe(`covers/${testUser.id}/cover_12345.jpg`);

      // Verify in DB
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.coverPicture).toBe(`covers/${testUser.id}/cover_12345.jpg`);
    });

    it('should also accept coverPicture multipart form field name on /users/cover-photo', async () => {
      jest.spyOn(s3Service, 'uploadMedia').mockImplementation(async (_buf, uid) => {
        return `covers/${uid}/cover_alias.jpg`;
      });
      jest.spyOn(s3Service, 'generateAndUploadThumbnail').mockResolvedValue('thumbnails/covers/mock.jpg');

      const res = await request(app)
        .post('/api/v1/users/cover-photo')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('coverPicture', validJpegBuffer, 'cover.jpg');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.key).toBe(`covers/${testUser.id}/cover_alias.jpg`);
    });

    it('should return coverPhoto, coverPicture, and coverPhotoUrl in GET /api/v1/users/profile', async () => {
      await User.update(
        { coverPicture: `covers/${testUser.id}/profile_cover.jpg` },
        { where: { id: testUser.id } }
      );

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.coverPhoto).toBeDefined();
      expect(res.body.data.coverPhoto.url).toContain('profile_cover.jpg');
      expect(res.body.data.coverPicture).toContain('profile_cover.jpg');
      expect(res.body.data.coverPhotoUrl).toContain('profile_cover.jpg');
      expect(res.body.data.profile.coverPhoto).toBeDefined();
      expect(res.body.data.profile.coverPicture).toContain('profile_cover.jpg');
    });
  });

  describe('7. Profile Email OTP Verification Flow', () => {
    let capturedOtp = '';

    beforeEach(() => {
      capturedOtp = '';
      jest.spyOn(emailProvider, 'sendOtp').mockImplementation(async (_email, otp) => {
        capturedOtp = otp;
        return true;
      });
    });

    it('should request an Email OTP for a new email address from profile and bind userId and purpose', async () => {
      const res = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'newemail@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationId).toBeDefined();
      expect(res.body.data.email).toBe('newemail@example.com');
      expect(capturedOtp).toMatch(/^\d{6}$/);

      // Verify DB record has userId and profile_email_change purpose
      const record = await EmailVerification.findByPk(res.body.data.verificationId);
      expect(record?.userId).toBe(testUser.id);
      expect(record?.purpose).toBe('profile_email_change');
    });

    it('should reject email OTP request if email is already taken by another account with 409', async () => {
      await User.create({
        username: 'other_user',
        email: 'other@example.com',
        role: 'user',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'other@example.com' });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already associated with another account/i);
    });

    it('should resend email OTP for profile change via verificationId and via email', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'resendtest@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      // Fast-forward lastResentAt to bypass 60s cooldown for test
      await EmailVerification.update(
        { lastResentAt: new Date(Date.now() - 70000) },
        { where: { id: verificationId } }
      );

      const resendRes = await request(app)
        .post('/api/v1/users/profile/email/resend-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ verificationId });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.success).toBe(true);
      expect(resendRes.body.data.verificationId).toBe(verificationId);
    });

    it('should reject resending email OTP before cooldown period elapses', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'cooldown.email@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      const resendRes = await request(app)
        .post('/api/v1/users/profile/email/resend-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ verificationId });

      expect(resendRes.status).toBe(429);
      expect(resendRes.body.success).toBe(false);
      expect(resendRes.body.message).toMatch(/please wait before requesting another/i);
    });

    it('should reject incorrect OTP with 401', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'verified@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      const res = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: '000000',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject expired email OTP with 400', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'expired.email@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      // Mark record as expired in past
      await EmailVerification.update(
        { expiresAt: new Date(Date.now() - 10000) },
        { where: { id: verificationId } }
      );

      const res = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should successfully verify email OTP and update user email in database', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'verified.user@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      const res = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('verified.user@example.com');

      // Verify user in DB
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.email).toBe('verified.user@example.com');
    });

    it('should reject already consumed OTP with 400', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'consume.test@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      // First verify: success
      await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      // Second verify: already used
      const res2 = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/already been used/i);
    });

    it('should reject cross-purpose email OTP (signup OTP cannot be used for profile email update)', async () => {
      // 1. Generate auth signup OTP (purpose: 'auth')
      let authOtp = '';
      jest.spyOn(emailProvider, 'sendOtp').mockImplementation(async (_email, otp) => {
        authOtp = otp;
        return true;
      });

      const authReqRes = await request(app)
        .post('/api/v1/auth/email/request-otp')
        .send({ email: 'cross.auth@example.com' });

      expect(authReqRes.status).toBe(200);
      const authVerificationId = authReqRes.body.data.verificationId;

      // 2. Try to verify this auth OTP in profile email verification endpoint
      const verifyRes = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId: authVerificationId,
          otp: authOtp,
        });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.success).toBe(false);
      expect(verifyRes.body.message).toMatch(/invalid verification session/i);

      // Verify user email did NOT change
      const refreshedUser = await User.findByPk(testUser.id);
      expect(refreshedUser?.email).toBe('mike@example.com');
    });

    it('should reject cross-purpose email OTP (profile OTP cannot be used for auth signup/login)', async () => {
      // 1. Generate profile email change OTP
      const profileReqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'profile.for.auth@example.com' });

      expect(profileReqRes.status).toBe(200);
      const profileVerificationId = profileReqRes.body.data.verificationId;

      // 2. Try to verify in public auth login endpoint
      const authVerifyRes = await request(app)
        .post('/api/v1/auth/email/verify-otp')
        .send({
          verificationId: profileVerificationId,
          otp: capturedOtp,
        });

      expect(authVerifyRes.status).toBe(400);
      expect(authVerifyRes.body.success).toBe(false);
      expect(authVerifyRes.body.message).toMatch(/invalid verification session for authentication/i);
    });

    it('should reject profile email OTP if verified by a different authenticated user', async () => {
      // User A requests profile change
      const reqRes = await request(app)
        .post('/api/v1/users/profile/email/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ email: 'user.a.target@example.com' });

      const verificationId = reqRes.body.data.verificationId;

      // User B logs in
      const userB = await User.create({
        username: 'user_b',
        email: 'userb@example.com',
        role: 'user',
        isActive: true,
      });
      const userBToken = generateToken({
        id: userB.id,
        email: userB.email,
        role: userB.role,
      });

      // User B attempts to verify User A's verification session
      const res = await request(app)
        .post('/api/v1/users/profile/email/verify-otp')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to this user/i);

      // Verify userB email did NOT change
      const refreshedUserB = await User.findByPk(userB.id);
      expect(refreshedUserB?.email).toBe('userb@example.com');
    });
  });

  describe('8. Profile Phone OTP Verification Flow', () => {
    let capturedOtp = '';

    beforeEach(() => {
      capturedOtp = '';
      jest.spyOn(smsProvider, 'sendOtp').mockImplementation(async (_phone, otp) => {
        capturedOtp = otp;
        return true;
      });
    });

    it('should request a Phone OTP for a new phone number from profile and bind userId and purpose', async () => {
      const res = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9876543210',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationId).toBeDefined();
      expect(res.body.data.phone).toBe('+919876543210');
      expect(capturedOtp).toMatch(/^\d{6}$/);

      // Verify DB record has userId and profile_phone_change purpose
      const record = await PhoneVerification.findByPk(res.body.data.verificationId);
      expect(record?.userId).toBe(testUser.id);
      expect(record?.purpose).toBe('profile_phone_change');
    });

    it('should reject phone OTP request if phone is already taken by another account with 409', async () => {
      await User.create({
        username: 'other_phone_user',
        phone: '+919876543210',
        role: 'user',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9876543210',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already associated with another account/i);
    });

    it('should resend phone OTP for profile change via verificationId and via phone', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9112233445',
        });

      const verificationId = reqRes.body.data.verificationId;

      // Fast-forward lastResentAt to bypass 60s cooldown for test
      await PhoneVerification.update(
        { lastResentAt: new Date(Date.now() - 70000) },
        { where: { id: verificationId } }
      );

      const resendRes = await request(app)
        .post('/api/v1/users/profile/phone/resend-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ verificationId });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body.success).toBe(true);
      expect(resendRes.body.data.verificationId).toBe(verificationId);
    });

    it('should reject resending phone OTP before cooldown period elapses', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9112233446',
        });

      const verificationId = reqRes.body.data.verificationId;

      const resendRes = await request(app)
        .post('/api/v1/users/profile/phone/resend-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ verificationId });

      expect(resendRes.status).toBe(429);
      expect(resendRes.body.success).toBe(false);
      expect(resendRes.body.message).toMatch(/please wait before requesting another/i);
    });

    it('should reject incorrect phone OTP with 401', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9988771122',
        });

      const verificationId = reqRes.body.data.verificationId;

      const res = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: '000000',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should reject expired phone OTP with 400', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9988771133',
        });

      const verificationId = reqRes.body.data.verificationId;

      // Mark record as expired in past
      await PhoneVerification.update(
        { expiresAt: new Date(Date.now() - 10000) },
        { where: { id: verificationId } }
      );

      const res = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });

    it('should successfully verify phone OTP and update user phone and isPhoneVerified in database', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9988776655',
        });

      const verificationId = reqRes.body.data.verificationId;

      const res = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe('+919988776655');
      expect(res.body.data.isPhoneVerified).toBe(true);

      // Verify user in DB
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.phone).toBe('+919988776655');
      expect(updatedUser?.isPhoneVerified).toBe(true);
    });

    it('should reject already consumed phone OTP with 400', async () => {
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          countryCode: '+91',
          phone: '9988776644',
        });

      const verificationId = reqRes.body.data.verificationId;

      // First verify: success
      await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      // Second verify: already used
      const res2 = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res2.status).toBe(400);
      expect(res2.body.message).toMatch(/already been used/i);
    });

    it('should reject cross-purpose phone OTP (signup OTP cannot be used for profile phone update)', async () => {
      // 1. Generate auth signup OTP (purpose: 'auth')
      let authPhoneOtp = '';
      jest.spyOn(smsProvider, 'sendOtp').mockImplementation(async (_phone, otp) => {
        authPhoneOtp = otp;
        return true;
      });

      const authReqRes = await request(app)
        .post('/api/v1/auth/phone/request-otp')
        .send({ countryCode: '+91', phone: '9123456789' });

      expect(authReqRes.status).toBe(200);
      const authVerificationId = authReqRes.body.data.verificationId;

      // 2. Try to verify this auth OTP in profile phone verification endpoint
      const verifyRes = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          verificationId: authVerificationId,
          otp: authPhoneOtp,
        });

      expect(verifyRes.status).toBe(400);
      expect(verifyRes.body.success).toBe(false);
      expect(verifyRes.body.message).toMatch(/invalid verification session/i);

      // Verify user phone did NOT change
      const refreshedUser = await User.findByPk(testUser.id);
      expect(refreshedUser?.phone).toBeNull();
    });

    it('should reject cross-purpose phone OTP (profile OTP cannot be used for auth signup/login)', async () => {
      // 1. Generate profile phone change OTP
      const profileReqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ countryCode: '+91', phone: '9123456780' });

      expect(profileReqRes.status).toBe(200);
      const profileVerificationId = profileReqRes.body.data.verificationId;

      // 2. Try to verify in public auth login endpoint
      const authVerifyRes = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .send({
          verificationId: profileVerificationId,
          otp: capturedOtp,
        });

      expect(authVerifyRes.status).toBe(400);
      expect(authVerifyRes.body.success).toBe(false);
      expect(authVerifyRes.body.message).toMatch(/invalid verification session for authentication/i);
    });

    it('should reject profile phone OTP if verified by a different authenticated user', async () => {
      // User A requests profile change
      const reqRes = await request(app)
        .post('/api/v1/users/profile/phone/request-otp')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ countryCode: '+91', phone: '9123456781' });

      const verificationId = reqRes.body.data.verificationId;

      // User B logs in
      const userB = await User.create({
        username: 'user_b_phone',
        email: 'userbphone@example.com',
        role: 'user',
        isActive: true,
      });
      const userBToken = generateToken({
        id: userB.id,
        email: userB.email,
        role: userB.role,
      });

      // User B attempts to verify User A's verification session
      const res = await request(app)
        .post('/api/v1/users/profile/phone/verify-otp')
        .set('Authorization', `Bearer ${userBToken}`)
        .send({
          verificationId,
          otp: capturedOtp,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to this user/i);

      // Verify userB phone did NOT change
      const refreshedUserB = await User.findByPk(userB.id);
      expect(refreshedUserB?.phone).toBeNull();
    });
  });

  describe('9. Complete Profile Fetch (GET /api/v1/users/profile)', () => {
    it('should include coverPicture, coverPhoto, email, phone, and isPhoneVerified in profile response', async () => {
      testUser.coverPicture = 'covers/test_cover.jpg';
      testUser.phone = '+919988776655';
      testUser.isPhoneVerified = true;
      await testUser.save();

      const res = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.coverPhoto).toBeDefined();
      expect(res.body.data.profile.coverPicture).toBeDefined();
      expect(res.body.data.profile.email).toBe(testUser.email);
      expect(res.body.data.profile.phone).toBe('+919988776655');
      expect(res.body.data.profile.isPhoneVerified).toBe(true);
      expect(res.body.data.profile.username).toBe(testUser.username);
      expect(res.body.data.username).toBe(testUser.username);
    });
  });

  describe('10. User Interests on Edit Profile (PUT /api/v1/users/interests)', () => {
    it('should update user interests using UUID string array and return interest id in profile', async () => {
      const { Interest } = await import('../src/models');
      const interest = await Interest.create({
        name: 'Photography_Test',
        icon: '📷',
        isActive: true,
      });

      const res = await request(app)
        .put('/api/v1/users/interests')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ interestIds: [interest.id] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const getRes = await request(app)
        .get('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.interests).toHaveLength(1);
      expect(getRes.body.data.interests[0].id).toBe(interest.id);
      expect(getRes.body.data.interests[0].interestId).toBe(interest.id);
      expect(getRes.body.data.interests[0].name).toBe('Photography_Test');
    });
  });

  describe('11. Set Gallery Photo as Primary (PATCH /api/v1/onboarding/photos/:photoId/primary)', () => {
    it('should update user profilePhoto and profilePicture when a gallery photo is set as primary', async () => {
      const { UserPhoto } = await import('../src/models');
      const photo = await UserPhoto.create({
        userId: testUser.id,
        imageUrl: 'photos/mike_gallery_1.jpg',
        isPrimary: false,
        status: 'approved',
      });

      const res = await request(app)
        .patch(`/api/v1/onboarding/photos/${photo.id}/primary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profilePhoto).toBeDefined();
      expect(res.body.data.profilePicture).toBe('photos/mike_gallery_1.jpg');

      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.profilePicture).toBe('photos/mike_gallery_1.jpg');
    });
  });

  describe('12. S3 Media & Verification URL Formatter Safeguards', () => {
    it('should not return double thumbnail prefix or 403-inducing thumbnails/verifications paths', async () => {
      const { formatMediaUrl, formatThumbnailUrl } = await import('../src/services/s3.service');

      const verificationKey = 'verifications/user123/selfie.jpg';
      const verUrl = formatMediaUrl(verificationKey);
      const verThumb = formatThumbnailUrl(verificationKey);

      expect(verUrl).toContain('verifications/user123/selfie.jpg');
      expect(verThumb).not.toContain('thumbnails/verifications');

      const doubleThumb = formatThumbnailUrl('thumbnails/photos/user1/pic.jpg');
      expect(doubleThumb).not.toContain('thumbnails/thumbnails');
    });
  });
});
