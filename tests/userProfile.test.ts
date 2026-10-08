import request from 'supertest';
import app from '../src/app';
import { sequelize, User } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { hashPassword } from '../src/utils/password';

describe('User Profile Onboarding API (PATCH /api/v1/users/profile)', () => {
  let testUser: User;
  let authToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await User.destroy({ where: {}, truncate: true });
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
        firstName: 'Mike',
        lastName: 'Hussey',
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
      expect(res.body.data.firstName).toBe('Mike');
      expect(res.body.data.lastName).toBe('Hussey');
      expect(res.body.data.nickName).toBe('Mikey');
      expect(res.body.data.dateOfBirth).toBe('1996-10-09');
      expect(res.body.data.gender).toBe('male');
      expect(res.body.data.about).toBe(payload.about);
      expect(res.body.data.isProfileComplete).toBe(true);
      expect(res.body.data.password).toBeUndefined();

      // Verify in DB
      const updatedDbUser = await User.findByPk(testUser.id);
      expect(updatedDbUser?.firstName).toBe('Mike');
      expect(updatedDbUser?.lastName).toBe('Hussey');
      expect(updatedDbUser?.nickName).toBe('Mikey');
      expect(updatedDbUser?.dateOfBirth).toBe('1996-10-09');
      expect(updatedDbUser?.gender).toBe('male');
      expect(updatedDbUser?.isProfileComplete).toBe(true);
    });
  });

  describe('2. Authentication & Authorization Security Assertions', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).patch('/api/v1/users/profile').send({
        firstName: 'Mike',
        lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testUser.id);

      // Verify second user was NOT updated
      const secondDbUser = await User.findByPk(secondUser.id);
      expect(secondDbUser?.firstName).toBeNull();
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
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Request Field Validation Assertions', () => {
    it('should reject missing required fields (firstName, lastName, nickName, dateOfBirth, gender)', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Mike',
          // lastName missing
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject empty or whitespace-only required fields', async () => {
      const res = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: '   ',
          lastName: 'Hussey',
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
            firstName: 'Mike',
            lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
          about: oversizedAbout,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Business Rules: Immutability of Date of Birth & Gender', () => {
    it('should reject attempting to change an already-set Date of Birth', async () => {
      // 1. Initial save: sets DOB to 1996-10-09
      const res1 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'male',
        });
      expect(res1.status).toBe(200);

      // 2. Subsequent attempt to change DOB to 1995-05-05
      const res2 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1995-05-05',
          gender: 'male',
        });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toMatch(/date of birth cannot be changed once set/i);
    });

    it('should reject attempting to change an already-set Gender', async () => {
      // 1. Initial save: sets Gender to male
      const res1 = await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Mike',
          lastName: 'Hussey',
          nickName: 'Mikey',
          dateOfBirth: '1996-10-09',
          gender: 'female',
        });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.message).toMatch(/gender cannot be changed once set/i);
    });

    it('should allow subsequent updates to other fields (e.g. about, nickName) when DOB and Gender remain identical', async () => {
      // Initial save
      await request(app)
        .patch('/api/v1/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Mike',
          lastName: 'Hussey',
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
          firstName: 'Michael',
          lastName: 'Hussey',
          nickName: 'Mikey10',
          dateOfBirth: '1996-10-09',
          gender: 'male',
          about: 'Updated about section',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Michael');
      expect(res.body.data.nickName).toBe('Mikey10');
      expect(res.body.data.about).toBe('Updated about section');
    });
  });

  describe('5. Idempotency & System Compatibility Assertions', () => {
    it('should handle repeated Continue button requests safely without creating duplicates', async () => {
      const payload = {
        firstName: 'Mike',
        lastName: 'Hussey',
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
});
