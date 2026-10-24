import axios from 'axios';
import { Transaction } from 'sequelize';
import { env } from '../config/env';
import { UserIdentity } from '../models/userIdentity.model';
import { comparePassword } from '../utils/password';
import { normalizePhone } from '../utils/phone';

const IDENTITY_TOOLKIT_BASE = 'https://identitytoolkit.googleapis.com/v1/accounts';

export class FirebasePhoneError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'FirebasePhoneError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, FirebasePhoneError.prototype);
  }
}

export interface FirebasePhoneClientProof {
  recaptchaToken?: string;
  playIntegrityToken?: string;
  iosReceipt?: string;
  iosSecret?: string;
  iosBundleId?: string;
  clientType?: 'CLIENT_TYPE_IOS' | 'CLIENT_TYPE_ANDROID' | 'CLIENT_TYPE_WEB';
}

export interface PhoneCodeCheck {
  ok: boolean;
  statusCode?: number;
  error?: string;
  invalidateSession?: boolean;
  firebaseUid?: string;
}

interface PhoneCodeRecord {
  otpHash: string;
  phone: string;
  providerSession?: string | null;
}

/**
 * Firebase sends the SMS when a Web API key is configured.
 * Tests stay on the local SMS path unless FIREBASE_PHONE_OTP_ENABLED=true.
 */
export const isFirebasePhoneOtpEnabled = (): boolean => {
  if (process.env.FIREBASE_PHONE_OTP_ENABLED === 'false') return false;
  if (process.env.NODE_ENV === 'test' && process.env.FIREBASE_PHONE_OTP_ENABLED !== 'true') {
    return false;
  }
  return getFirebaseWebApiKey().length > 0;
};

export const getFirebaseWebApiKey = (): string => {
  return (
    process.env.FIREBASE_WEB_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    env.FIREBASE_WEB_API_KEY ||
    ''
  ).trim();
};

export const clientProofFromBody = (body: unknown): FirebasePhoneClientProof | undefined => {
  if (!body || typeof body !== 'object') return undefined;
  const source = body as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  const iosReceipt = normalizeIosReceipt(
    pick('iosReceipt', 'ios_receipt', 'apnsToken', 'apns_token', 'deviceToken')
  );
  const proof: FirebasePhoneClientProof = {
    recaptchaToken: pick('recaptchaToken', 'recaptcha_token'),
    playIntegrityToken: pick('playIntegrityToken', 'play_integrity_token'),
    iosReceipt,
    iosSecret: pick('iosSecret', 'ios_secret', 'apnsSecret', 'apns_secret'),
    iosBundleId: normalizeBundleId(
      pick('iosBundleId', 'ios_bundle_id', 'bundleId', 'bundle_id')
    ),
    clientType: clientTypeFromBody(source, Boolean(iosReceipt)),
  };

  if (
    !proof.recaptchaToken &&
    !proof.playIntegrityToken &&
    !proof.iosReceipt &&
    !proof.iosSecret
  ) {
    return undefined;
  }
  return proof;
};

const normalizeIosReceipt = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^<|>$/g, '').replace(/\s+/g, '');
  return cleaned || undefined;
};

const normalizeBundleId = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,200}$/.test(cleaned)) return undefined;
  return cleaned;
};

/**
 * Bundle ID registered for the iOS app in Firebase. sendVerificationCode
 * rejects an iOS receipt when this is missing from X-Ios-Bundle-Identifier.
 */
export const getIosBundleIdentifier = (): string => {
  return normalizeBundleId(process.env.APPLE_BUNDLE_ID || env.APPLE_BUNDLE_ID || '') || '';
};

const isApnsDeviceToken = (value: string): boolean => /^[a-f0-9]{64}$/i.test(value);

const isGeneratedUuid = (value: string): boolean =>
  /^[a-f0-9]{12}4[a-f0-9]{3}[89ab][a-f0-9]{15}$/i.test(value);

const iosHeaders = (bundleId: string): Record<string, string> => ({
  'X-Ios-Bundle-Identifier': bundleId,
});

const clientTypeFromBody = (
  source: Record<string, unknown>,
  hasIosReceipt: boolean
): FirebasePhoneClientProof['clientType'] => {
  const raw = source.platform ?? source.clientType ?? source.deviceType ?? source.device_type;
  const platform = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (hasIosReceipt || platform === 'ios' || platform === 'iphone' || platform === 'client_type_ios') {
    return 'CLIENT_TYPE_IOS';
  }
  if (platform === 'android' || platform === 'client_type_android') return 'CLIENT_TYPE_ANDROID';
  if (platform === 'web' || platform === 'client_type_web') return 'CLIENT_TYPE_WEB';
  return undefined;
};

const firebaseErrorCode = (message: string): string => message.split(':')[0].trim();

const mapFirebasePhoneError = (
  rawMessage: string,
  httpStatus?: number,
  fallback = 'Phone verification failed. Please try again.'
): FirebasePhoneError => {
  const code = firebaseErrorCode(rawMessage || '');

  switch (code) {
    case 'INVALID_PHONE_NUMBER':
    case 'MISSING_PHONE_NUMBER':
      return new FirebasePhoneError('Invalid phone number format', 400);
    case 'MISSING_CLIENT_IDENTIFIER':
    case 'CAPTCHA_CHECK_FAILED':
    case 'MISSING_CLIENT_TYPE':
      return new FirebasePhoneError(
        'App verification is required before a code can be sent. Android sends playIntegrityToken. iOS sends iosReceipt and iosSecret, or a recaptchaToken.',
        400
      );
    case 'MISSING_IOS_BUNDLE_ID':
      return new FirebasePhoneError(
        'iOS bundle id was missing or does not match the Firebase iOS app.',
        400
      );
    case 'INVALID_APP_CREDENTIAL':
    case 'MISSING_APP_CREDENTIAL':
    case 'MISSING_IOS_APP_TOKEN':
    case 'APP_NOT_VERIFIED':
      return new FirebasePhoneError(
        'App verification was rejected. iOS must send the receipt from verifyIosClient and the secret from the Firebase silent push. The APNs device token is not a valid iosReceipt.',
        400
      );
    case 'TOO_MANY_ATTEMPTS_TRY_LATER':
    case 'QUOTA_EXCEEDED':
      return new FirebasePhoneError(
        'Too many OTP requests for this phone number. Please try again later.',
        429
      );
    case 'INVALID_CODE':
      return new FirebasePhoneError('Invalid verification code', 401);
    case 'INVALID_SESSION_INFO':
    case 'SESSION_EXPIRED':
      return new FirebasePhoneError('OTP has expired. Please request a new OTP.', 400);
    case 'OPERATION_NOT_ALLOWED':
      return new FirebasePhoneError('Phone sign-in is not enabled for this project', 503);
    case 'BILLING_NOT_ENABLED':
      return new FirebasePhoneError('Phone verification is temporarily unavailable', 503);
    default:
      if (httpStatus === 429) {
        return new FirebasePhoneError(
          'Too many OTP requests for this phone number. Please try again later.',
          429
        );
      }
      return new FirebasePhoneError(fallback, 502);
  }
};

const postIdentityToolkit = async (
  method: 'sendVerificationCode' | 'signInWithPhoneNumber' | 'verifyIosClient',
  payload: Record<string, unknown>,
  extraHeaders?: Record<string, string>
): Promise<Record<string, unknown>> => {
  const fallback =
    method === 'sendVerificationCode'
      ? 'Could not send the verification code. Please try again.'
      : method === 'verifyIosClient'
        ? 'Could not verify the iOS app. Please try again.'
        : 'Could not verify the code. Please try again.';
  const apiKey = getFirebaseWebApiKey();
  if (!apiKey) {
    throw new FirebasePhoneError('Phone verification is temporarily unavailable', 503);
  }

  try {
    const response = await axios.post(
      `${IDENTITY_TOOLKIT_BASE}:${method}?key=${encodeURIComponent(apiKey)}`,
      payload,
      {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
      }
    );
    return (response.data || {}) as Record<string, unknown>;
  } catch (error: unknown) {
    const responseData = (error as { response?: { status?: number; data?: { error?: { message?: string } } } })
      ?.response;
    const rawMessage = responseData?.data?.error?.message || '';
    const upstreamCode = rawMessage
      ? firebaseErrorCode(rawMessage)
      : (error as { code?: string }).code || 'UNKNOWN';
    console.error('[FirebasePhone] Identity Toolkit request failed', {
      method,
      httpStatus: responseData?.status,
      code: upstreamCode,
    });
    if (rawMessage) {
      throw mapFirebasePhoneError(rawMessage, responseData?.status, fallback);
    }
    throw new FirebasePhoneError(fallback, 502);
  }
};

/**
 * Asks Firebase Auth to text a one-time code. Returns the server-only session
 * handle used later to check the code. The code itself stays with Firebase.
 */
export const sendFirebasePhoneCode = async (
  phoneNumber: string,
  proof?: FirebasePhoneClientProof
): Promise<string> => {
  const hasIosReceipt = Boolean(proof?.iosReceipt);
  const hasIosSecret = Boolean(proof?.iosSecret);
  if (hasIosReceipt !== hasIosSecret) {
    throw new FirebasePhoneError(
      'iOS phone verification needs both iosReceipt and iosSecret.',
      400
    );
  }

  if (
    proof?.iosReceipt &&
    proof.iosSecret &&
    isApnsDeviceToken(proof.iosReceipt) &&
    isGeneratedUuid(proof.iosSecret)
  ) {
    throw new FirebasePhoneError(
      'iosReceipt is the APNs device token, and iosSecret was generated in the app. Exchange the device token with POST /api/v1/auth/phone/ios/verify-client, then send the returned receipt and the secret from the Firebase silent push.',
      400
    );
  }

  const payload: Record<string, string> = { phoneNumber };
  const headers: Record<string, string> = {};
  if (proof?.recaptchaToken) payload.recaptchaToken = proof.recaptchaToken;
  if (proof?.playIntegrityToken) payload.playIntegrityToken = proof.playIntegrityToken;
  if (proof?.iosReceipt) payload.iosReceipt = proof.iosReceipt;
  if (proof?.iosSecret) payload.iosSecret = proof.iosSecret;
  if (proof?.iosReceipt) payload.clientType = 'CLIENT_TYPE_IOS';
  else if (proof?.playIntegrityToken) payload.clientType = 'CLIENT_TYPE_ANDROID';
  else if (proof?.clientType) payload.clientType = proof.clientType;

  if (payload.clientType === 'CLIENT_TYPE_IOS' || proof?.iosReceipt) {
    const bundleId = proof?.iosBundleId || getIosBundleIdentifier();
    if (!bundleId) {
      throw new FirebasePhoneError('iOS phone verification is not configured', 503);
    }
    Object.assign(headers, iosHeaders(bundleId));
  }

  const data = await postIdentityToolkit('sendVerificationCode', payload, headers);
  const sessionInfo = typeof data.sessionInfo === 'string' ? data.sessionInfo : '';
  if (!sessionInfo) {
    throw new FirebasePhoneError('Could not send the verification code. Please try again.', 502);
  }
  return sessionInfo;
};

/**
 * Exchanges an APNs device token for the receipt Firebase expects.
 * The matching secret arrives on the device in a silent push, not in this response.
 */
export const verifyFirebaseIosClient = async (input: {
  appToken: string;
  isSandbox?: boolean;
  iosBundleId?: string;
}): Promise<{ receipt: string; suggestedTimeout: number }> => {
  const appToken = normalizeIosReceipt(input.appToken);
  if (!appToken) {
    throw new FirebasePhoneError('APNs device token is required', 400);
  }

  const bundleId = normalizeBundleId(input.iosBundleId) || getIosBundleIdentifier();
  if (!bundleId) {
    throw new FirebasePhoneError('iOS phone verification is not configured', 503);
  }

  const data = await postIdentityToolkit(
    'verifyIosClient',
    {
      appToken,
      isSandbox: input.isSandbox ?? !env.APNS_PRODUCTION,
    },
    iosHeaders(bundleId)
  );

  const receipt = typeof data.receipt === 'string' ? data.receipt.trim() : '';
  if (!receipt) {
    throw new FirebasePhoneError('Could not verify the iOS app. Please try again.', 502);
  }

  const timeout = Number(data.suggestedTimeout);
  return {
    receipt,
    suggestedTimeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 5,
  };
};

const confirmFirebasePhoneCode = async (
  sessionInfo: string,
  code: string
): Promise<{ firebaseUid?: string; phoneNumber?: string }> => {
  const data = await postIdentityToolkit('signInWithPhoneNumber', {
    sessionInfo,
    code,
  });

  const firebaseUid = typeof data.localId === 'string' ? data.localId : undefined;
  const phoneNumber = typeof data.phoneNumber === 'string' ? data.phoneNumber : undefined;
  return { firebaseUid, phoneNumber };
};

/**
 * Checks a submitted code. Firebase sessions are confirmed with Identity Toolkit.
 * Older SMS rows still use the stored hash.
 */
export const matchStoredPhoneCode = async (
  record: PhoneCodeRecord,
  otp: string
): Promise<PhoneCodeCheck> => {
  if (record.providerSession) {
    try {
      const confirmed = await confirmFirebasePhoneCode(record.providerSession, otp);
      if (confirmed.phoneNumber) {
        const confirmedPhone = normalizePhone(confirmed.phoneNumber);
        const expectedPhone = normalizePhone(record.phone);
        if (confirmedPhone && expectedPhone && confirmedPhone !== expectedPhone) {
          return {
            ok: false,
            statusCode: 400,
            error: 'Phone number does not match verification session',
            invalidateSession: true,
          };
        }
      }
      return { ok: true, firebaseUid: confirmed.firebaseUid };
    } catch (error: unknown) {
      if (error instanceof FirebasePhoneError) {
        const invalidateSession =
          error.statusCode === 400 && /expired|session/i.test(error.message);
        return {
          ok: false,
          statusCode: error.statusCode,
          error: error.message,
          invalidateSession,
        };
      }
      return {
        ok: false,
        statusCode: 502,
        error: 'Could not verify the code. Please try again.',
      };
    }
  }

  const isMatch = await comparePassword(otp, record.otpHash);
  if (!isMatch) {
    return { ok: false, statusCode: 401, error: 'Invalid verification code' };
  }
  return { ok: true };
};

/**
 * Remembers the Firebase user id so a later Firebase sign-in lands on the same account.
 */
export const linkFirebasePhoneIdentity = async (
  userId: string,
  firebaseUid: string,
  transaction?: Transaction
): Promise<void> => {
  const existing = await UserIdentity.findOne({
    where: { provider: 'firebase', providerUserId: firebaseUid },
    transaction,
  });

  if (existing) return;

  await UserIdentity.create(
    {
      userId,
      provider: 'firebase',
      providerUserId: firebaseUid,
      email: null,
      isPrivateEmail: false,
    },
    { transaction }
  );
};
