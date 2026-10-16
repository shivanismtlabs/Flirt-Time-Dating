import request from 'supertest';
import app from '../src/app';
import { sequelize, User, UserDevice, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Auth Logout API (POST /api/v1/auth/logout & /api/auth/logout)', () => {
  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await UserDevice.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'logout_user_a',
      email: 'usera_logout@example.com',
      fullName: 'Alice Walker',
      firstName: 'Alice',
      isActive: true,
      role: 'user',
    });

    userB = await User.create({
      username: 'logout_user_b',
      email: 'userb_logout@example.com',
      fullName: 'Bob Dylan',
      firstName: 'Bob',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({
      id: userA.id,
      email: userA.email,
      role: userA.role,
    });

    tokenB = generateToken({
      id: userB.id,
      email: userB.email,
      role: userB.role,
    });
  });

  describe('1. Authentication Guard', () => {
    it('should reject logout without Authorization header with 401', async () => {
      const res = await request(app).post('/api/v1/auth/logout').send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/token missing or malformed/i);
    });

    it('should reject logout with invalid token with 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer invalid_token_xyz')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or expired token/i);
    });
  });

  describe('2. Standard Response Contract & No Double Keys', () => {
    it('should successfully log out and return standard response contract with no double keys', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      expect(res.status).toBe(200);

      // Verify envelope structure
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('message', 'User logged out successfully');
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toEqual({});

      // Crucial: Verify NO double response keys
      expect(res.body.data.success).toBeUndefined();
      expect(res.body.data.message).toBeUndefined();
      expect(res.body.data.data).toBeUndefined();
      expect(res.body.data.isLoggedOut).toBeUndefined();
    });

    it('should work seamlessly via the /api/auth/logout route alias', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User logged out successfully');
      expect(res.body.data).toEqual({});
    });
  });

  describe('3. Device Token Cleanup on Logout', () => {
    it('should deactivate specific device token when provided in request body', async () => {
      // Create two devices for userA
      const device1 = await UserDevice.create({
        userId: userA.id,
        deviceToken: 'token_device_phone_1',
        platform: 'android',
        isActive: true,
      });

      const device2 = await UserDevice.create({
        userId: userA.id,
        deviceToken: 'token_device_tablet_2',
        platform: 'android',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          deviceToken: 'token_device_phone_1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('User logged out successfully');
      expect(res.body.data).toEqual({});

      // Check DB: device 1 should be deactivated, device 2 still active
      const refreshedDevice1 = await UserDevice.findByPk(device1.id);
      const refreshedDevice2 = await UserDevice.findByPk(device2.id);

      expect(refreshedDevice1?.isActive).toBe(false);
      expect(refreshedDevice2?.isActive).toBe(true);
    });

    it('should also accept fcmToken alias for device token cleanup', async () => {
      const device = await UserDevice.create({
        userId: userA.id,
        deviceToken: 'fcm_token_sample_999',
        platform: 'ios',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          fcmToken: 'fcm_token_sample_999',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const refreshed = await UserDevice.findByPk(device.id);
      expect(refreshed?.isActive).toBe(false);
    });

    it('should deactivate all devices for user when allDevices is true', async () => {
      // Create devices for userA
      const deviceA1 = await UserDevice.create({
        userId: userA.id,
        deviceToken: 'token_user_a_dev_1',
        platform: 'android',
        isActive: true,
      });
      const deviceA2 = await UserDevice.create({
        userId: userA.id,
        deviceToken: 'token_user_a_dev_2',
        platform: 'ios',
        isActive: true,
      });

      // Create device for userB
      const deviceB1 = await UserDevice.create({
        userId: userB.id,
        deviceToken: 'token_user_b_dev_1',
        platform: 'android',
        isActive: true,
      });

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          allDevices: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({});

      // User A's devices should all be deactivated
      const refreshedA1 = await UserDevice.findByPk(deviceA1.id);
      const refreshedA2 = await UserDevice.findByPk(deviceA2.id);
      expect(refreshedA1?.isActive).toBe(false);
      expect(refreshedA2?.isActive).toBe(false);

      // User B's device should remain untouched and active
      const refreshedB1 = await UserDevice.findByPk(deviceB1.id);
      expect(refreshedB1?.isActive).toBe(true);
    });
  });
});
