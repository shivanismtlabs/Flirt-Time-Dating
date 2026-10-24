import request from 'supertest';
import axios from 'axios';
import app from '../src/app';
import { sequelize, PhoneVerification, User, UserIdentity } from '../src/models';
import { smsProvider } from '../src/services/sms.service';
import { verifyToken } from '../src/utils/jwt';
import { getIosBundleIdentifier } from '../src/services/firebasePhone.service';

jest.mock('axios');

const mockedPost = axios.post as unknown as jest.Mock;

describe('Phone OTP through Firebase Auth', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FIREBASE_PHONE_OTP_ENABLED = 'true';
    process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    process.env.FIREBASE_PHONE_OTP_ENABLED = 'true';
    process.env.FIREBASE_WEB_API_KEY = 'test-web-api-key';
    await PhoneVerification.destroy({ where: {}, truncate: true });
    await UserIdentity.destroy({ where: {}, truncate: true });
    await User.destroy({ where: {}, truncate: true });
    mockedPost.mockReset();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    delete process.env.FIREBASE_PHONE_OTP_ENABLED;
    delete process.env.FIREBASE_WEB_API_KEY;
    await sequelize.close();
  });

  const mockSend = (sessionInfo = 'firebase-session-1') => {
    mockedPost.mockImplementation(async (url: string) => {
      if (String(url).includes('sendVerificationCode')) {
        return { data: { sessionInfo } };
      }
      throw new Error(`Unexpected Firebase call: ${url}`);
    });
  };

  it('sends the code through Firebase and returns verificationId with resendAfter', async () => {
    mockSend();
    const smsSpy = jest.spyOn(smsProvider, 'sendOtp');

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+91',
      phone: '8371537712',
      recaptchaToken: 'client-recaptcha',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationId).toEqual(expect.any(String));
    expect(res.body.data.expiresIn).toEqual(expect.any(Number));
    expect(res.body.data.resendAfter).toEqual(expect.any(Number));
    expect(res.body.data.otp).toBeUndefined();
    expect(res.body.data.sessionInfo).toBeUndefined();
    expect(res.body.data.providerSession).toBeUndefined();

    expect(smsSpy).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedPost.mock.calls[0];
    expect(String(url)).toContain('accounts:sendVerificationCode');
    expect(String(url)).toContain('key=test-web-api-key');
    expect(body).toEqual({
      phoneNumber: '+918371537712',
      recaptchaToken: 'client-recaptcha',
    });

    const row = await PhoneVerification.findByPk(res.body.data.verificationId);
    expect(row?.phone).toBe('+918371537712');
    expect(row?.providerSession).toBe('firebase-session-1');
    expect(row?.toJSON()).not.toHaveProperty('providerSession');
    expect(row?.otpHash).not.toBe('firebase-session-1');
  });

  it('sends an iOS request with the APNs receipt, secret, and iOS client type', async () => {
    mockSend('firebase-session-ios');

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+1',
      phone: '5551234567',
      platform: 'ios',
      iosReceipt: '<abc123receipt>',
      iosSecret: 'ios-secret-value',
    });

    expect(res.status).toBe(200);
    const [, body, config] = mockedPost.mock.calls[0];
    expect(body).toEqual({
      phoneNumber: '+15551234567',
      iosReceipt: 'abc123receipt',
      iosSecret: 'ios-secret-value',
      clientType: 'CLIENT_TYPE_IOS',
    });
    expect(config.headers['X-Ios-Bundle-Identifier']).toBe(getIosBundleIdentifier());
  });

  it('forwards the client iOS bundle id on the Firebase request', async () => {
    mockSend('firebase-session-ios-bundle');

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+1',
      phone: '5551234588',
      platform: 'ios',
      iosReceipt: 'abc123receipt',
      iosSecret: 'ios-secret-value',
      iosBundleId: 'com.client.bundle',
    });

    expect(res.status).toBe(200);
    const [, , config] = mockedPost.mock.calls[0];
    expect(config.headers['X-Ios-Bundle-Identifier']).toBe('com.client.bundle');
  });

  it('rejects an iOS request that sends only the APNs receipt', async () => {
    mockSend();

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+1',
      phone: '5551234599',
      iosReceipt: 'abc123receipt',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/iosReceipt and iosSecret/i);
    expect(await PhoneVerification.count()).toBe(0);
  });

  it('confirms the Firebase code, signs the user in, and links the Firebase uid', async () => {
    mockedPost.mockImplementation(async (url: string, body: { code?: string }) => {
      if (String(url).includes('sendVerificationCode')) {
        return { data: { sessionInfo: 'firebase-session-login' } };
      }
      if (String(url).includes('signInWithPhoneNumber')) {
        expect(body.code).toBe('123456');
        return {
          data: {
            localId: 'firebase-uid-phone-1',
            phoneNumber: '+918371537712',
            idToken: 'firebase-id-token',
          },
        };
      }
      throw new Error(`Unexpected Firebase call: ${url}`);
    });

    const requested = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+91',
      phone: '8371537712',
    });
    expect(requested.status).toBe(200);

    const res = await request(app).post('/api/v1/auth/phone/verify-otp').send({
      verificationId: requested.body.data.verificationId,
      otp: '123456',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.phone).toBe('+918371537712');
    expect(res.body.data.user.isPhoneVerified).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(verifyToken(res.body.data.token).phone).toBe('+918371537712');
    expect(JSON.stringify(res.body)).not.toContain('firebase-id-token');
    expect(JSON.stringify(res.body)).not.toContain('firebase-session-login');

    const identity = await UserIdentity.findOne({
      where: { provider: 'firebase', providerUserId: 'firebase-uid-phone-1' },
    });
    expect(identity?.userId).toBe(res.body.data.user.id);

    const row = await PhoneVerification.findByPk(requested.body.data.verificationId);
    expect(row?.isConsumed).toBe(true);
    expect(row?.isVerified).toBe(true);
    expect(row?.providerSession).toBeNull();
  });

  it('rejects an invalid Firebase code and keeps the session for another try', async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (String(url).includes('sendVerificationCode')) {
        return { data: { sessionInfo: 'firebase-session-bad' } };
      }
      const error = new Error('INVALID_CODE') as Error & {
        response: { status: number; data: { error: { message: string } } };
      };
      error.response = { status: 400, data: { error: { message: 'INVALID_CODE' } } };
      throw error;
    });

    const requested = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+91',
      phone: '9000000001',
    });

    const res = await request(app).post('/api/v1/auth/phone/verify-otp').send({
      verificationId: requested.body.data.verificationId,
      otp: '000000',
    });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/invalid verification code/i);

    const row = await PhoneVerification.findByPk(requested.body.data.verificationId);
    expect(row?.isConsumed).toBe(false);
    expect(row?.attempts).toBe(1);
    expect(row?.providerSession).toBe('firebase-session-bad');
  });

  it('does not create a verification row when Firebase refuses to send', async () => {
    const error = new Error('MISSING_CLIENT_IDENTIFIER') as Error & {
      response: { status: number; data: { error: { message: string } } };
    };
    error.response = {
      status: 400,
      data: { error: { message: 'MISSING_CLIENT_IDENTIFIER' } },
    };
    mockedPost.mockRejectedValue(error);

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+91',
      phone: '9000000002',
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/app verification is required/i);
    expect(await PhoneVerification.count()).toBe(0);
  });

  it('maps a missing iOS bundle id from Firebase to app verification, not a gateway error', async () => {
    const error = new Error('MISSING_IOS_BUNDLE_ID') as Error & {
      response: { status: number; data: { error: { message: string } } };
    };
    error.response = {
      status: 400,
      data: { error: { message: 'MISSING_IOS_BUNDLE_ID' } },
    };
    mockedPost.mockRejectedValue(error);

    const res = await request(app).post('/api/v1/auth/phone/request-otp').send({
      countryCode: '+91',
      phone: '9000000003',
      iosReceipt: 'receipt',
      iosSecret: 'secret',
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/app verification is required/i);
    expect(await PhoneVerification.count()).toBe(0);
  });
});
