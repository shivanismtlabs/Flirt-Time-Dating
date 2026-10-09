import request from 'supertest';
import app from '../src/app';
import { initDb, sequelize, User, UserIdentity } from '../src/models';
import { getFirebaseAuth } from '../src/config/firebase';
import { verifyToken } from '../src/utils/jwt';


// Mock getFirebaseAuth before it is required by the controllers/services
jest.mock('../src/config/firebase', () => {
  const mockVerifyIdToken = jest.fn();
  return {
    getFirebaseAuth: jest.fn(() => ({
      verifyIdToken: mockVerifyIdToken,
    })),
    getFirebaseApp: jest.fn(),
  };
});

describe('Firebase Authentication Controller (POST /api/v1/auth/firebase-phone & /api/v1/auth/firebase)', () => {
  let mockVerifyIdToken: jest.Mock;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  beforeEach(async () => {
    await UserIdentity.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
    jest.clearAllMocks();

    const auth = getFirebaseAuth();
    mockVerifyIdToken = auth.verifyIdToken as unknown as jest.Mock;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('1. New User Registration with Firebase Phone Auth', () => {
    it('should create new user with phone verified, link identity, and return valid FlirtTime JWT', async () => {
      const mockDecodedToken = {
        uid: 'firebase_phone_uid_12345',
        phone_number: '+919876543210',
        name: 'Firebase Test User',
        firebase: {
          sign_in_provider: 'phone',
        },
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

      const res = await request(app)
        .post('/api/v1/auth/firebase-phone')
        .send({
          idToken: 'valid_mock_firebase_id_token',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/firebase authentication successful/i);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.phone).toBe('+919876543210');
      expect(res.body.data.user.isPhoneVerified).toBe(true);
      expect(res.body.data.user.fullName).toBe('Firebase Test User');


      // Verify JWT is valid
      const decodedJwt = verifyToken(res.body.data.token);
      expect(decodedJwt.id).toBe(res.body.data.user.id);
      expect(decodedJwt.phone).toBe('+919876543210');

      // Verify User in Database
      const dbUser = await User.findByPk(res.body.data.user.id);
      expect(dbUser).not.toBeNull();
      expect(dbUser?.phone).toBe('+919876543210');
      expect(dbUser?.isPhoneVerified).toBe(true);

      // Verify UserIdentity in Database
      const dbIdentity = await UserIdentity.findOne({
        where: { provider: 'firebase', providerUserId: 'firebase_phone_uid_12345' },
      });
      expect(dbIdentity).not.toBeNull();
      expect(dbIdentity?.userId).toBe(dbUser?.id);
    });
  });

  describe('2. Existing User Login with Firebase Auth', () => {
    it('should authenticate existing user and not create duplicate user accounts', async () => {
      const mockDecodedToken = {
        uid: 'firebase_phone_uid_99999',
        phone_number: '+919999988888',
        firebase: {
          sign_in_provider: 'phone',
        },
      };

      mockVerifyIdToken.mockResolvedValue(mockDecodedToken);

      // 1st login (creates account)
      const res1 = await request(app)
        .post('/api/v1/auth/firebase')
        .send({ idToken: 'first_token' });
      expect(res1.status).toBe(200);
      const userId1 = res1.body.data.user.id;

      // 2nd login (existing user)
      const res2 = await request(app)
        .post('/api/v1/auth/firebase')
        .send({ idToken: 'second_token' });
      expect(res2.status).toBe(200);
      expect(res2.body.data.user.id).toBe(userId1);

      // Verify total users count in database is exactly 1
      const count = await User.count();
      expect(count).toBe(1);
    });
  });

  describe('3. Validation & Error Handling', () => {
    it('should reject missing or empty idToken', async () => {
      const res = await request(app)
        .post('/api/v1/auth/firebase-phone')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should handle invalid or expired Firebase idToken with 401 status', async () => {
      mockVerifyIdToken.mockRejectedValue({
        code: 'auth/id-token-expired',
        message: 'The provided Firebase ID token has expired.',
      });

      const res = await request(app)
        .post('/api/v1/auth/firebase-phone')
        .send({ idToken: 'expired_id_token' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/expired/i);
    });
  });
});
