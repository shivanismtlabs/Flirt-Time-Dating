import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_NAME: process.env.DB_NAME || 'flirttime_db',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DB_LOGGING: process.env.DB_LOGGING === 'true',
  DB_SSL: process.env.DB_SSL === 'true',

  JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_flirttime_2026_change_in_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  OTP_EXPIRY_SECONDS: parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10),
  OTP_RESEND_COOLDOWN_SECONDS: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
  MAX_OTP_RESENDS: parseInt(process.env.MAX_OTP_RESENDS || '3', 10),
  OTP_RATE_LIMIT_MAX: parseInt(process.env.OTP_RATE_LIMIT_MAX || '5', 10),
  OTP_RATE_LIMIT_WINDOW_SECONDS: parseInt(process.env.OTP_RATE_LIMIT_WINDOW_SECONDS || '3600', 10),
  OTP_EXPIRY_MINUTES: parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10),

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '"FlirtTime" <noreply@flirttime.app>',
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',

  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || 'com.app.flirttime',
  APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID || 'com.flirttime.app',
  APPLE_TEAM_ID: process.env.APPLE_IAP_ISSUER_ID || process.env.APPLE_TEAM_ID || '',
  APPLE_KEY_ID: process.env.APPLE_IAP_KEY_ID || process.env.APPLE_KEY_ID || '',
  APPLE_PRIVATE_KEY: (process.env.APPLE_IAP_PRIVATE_KEY || process.env.APPLE_PRIVATE_KEY || '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n'),
  APPLE_IAP_ENVIRONMENT: process.env.APPLE_IAP_ENVIRONMENT || (process.env.NODE_ENV === 'production' ? 'Production' : 'Sandbox'),

  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',

  GOOGLE_PACKAGE_NAME: process.env.GOOGLE_PACKAGE_NAME || process.env.ANDROID_PACKAGE_NAME || 'com.app.flirttime',
  GOOGLE_SERVICE_ACCOUNT_EMAIL:
    process.env.GOOGLE_PLAY_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    '',
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: (
    process.env.GOOGLE_PLAY_PRIVATE_KEY ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.FIREBASE_PRIVATE_KEY ||
    ''
  )
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n'),

  // AWS S3, Rekognition & Lambda Configuration
  AWS_REGION: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'ap-south-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || process.env.AWS_BUCKET || 'flirttime',
  AWS_S3_THUMBNAIL_PREFIX: process.env.AWS_S3_THUMBNAIL_PREFIX || 'thumbnails',
  AWS_LAMBDA_THUMBNAIL_FUNCTION: process.env.AWS_LAMBDA_THUMBNAIL_FUNCTION || 'flirttime-thumbnail-resizer',
  AWS_CLOUDFRONT_URL: process.env.AWS_CLOUDFRONT_URL || '',
  FACE_SIMILARITY_THRESHOLD: parseFloat(process.env.FACE_SIMILARITY_THRESHOLD || '85.0'),
  FACE_UPLOAD_MAX_SIZE_BYTES: parseInt(process.env.FACE_UPLOAD_MAX_SIZE_BYTES || '5242880', 10), // 5MB

  // Real SMS Gateway Configuration (Fast2SMS / 2Factor / Twilio)
  FAST2SMS_API_KEY: process.env.FAST2SMS_API_KEY || '',
  TWO_FACTOR_API_KEY: process.env.TWO_FACTOR_API_KEY || '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',

  // Deep Linking & Content Sharing Configuration
  APP_DOMAIN: process.env.APP_DOMAIN || process.env.DEEP_LINK_DOMAIN || 'flirttimeapi.walit.in',
  DEEP_LINK_BASE_URL: process.env.DEEP_LINK_BASE_URL || (process.env.APP_DOMAIN ? `https://${process.env.APP_DOMAIN}` : 'https://flirttimeapi.walit.in'),
  IOS_APP_STORE_ID: process.env.IOS_APP_STORE_ID || 'id6741234567',
  ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME || 'com.app.flirttime',

  // Real-Time Socket.IO Infrastructure Configuration
  SOCKET_PATH: process.env.SOCKET_PATH || '/socket.io',
  SOCKET_CORS_ORIGIN: process.env.SOCKET_CORS_ORIGIN || process.env.CORS_ORIGIN || '*',
  SOCKET_PING_TIMEOUT_MS: parseInt(process.env.SOCKET_PING_TIMEOUT_MS || '20000', 10),
  SOCKET_PING_INTERVAL_MS: parseInt(process.env.SOCKET_PING_INTERVAL_MS || '25000', 10),
  SOCKET_CONNECT_TIMEOUT_MS: parseInt(process.env.SOCKET_CONNECT_TIMEOUT_MS || '10000', 10),
  SOCKET_MAX_HTTP_BUFFER_SIZE: parseInt(process.env.SOCKET_MAX_HTTP_BUFFER_SIZE || '1048576', 10), // 1MB
  SOCKET_MAX_CONNECTIONS_PER_USER: parseInt(process.env.SOCKET_MAX_CONNECTIONS_PER_USER || '5', 10),
  SOCKET_MAX_CONNECTIONS_PER_IP: parseInt(process.env.SOCKET_MAX_CONNECTIONS_PER_IP || '50', 10),
  SOCKET_PER_MESSAGE_DEFLATE: process.env.SOCKET_PER_MESSAGE_DEFLATE === 'true',

  // Agora RTC Video Calling Configuration
  AGORA_APP_ID: process.env.AGORA_APP_ID || '',
  AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE || '',
  AGORA_TOKEN_EXPIRATION_SECONDS: parseInt(process.env.AGORA_TOKEN_EXPIRATION_SECONDS || '3600', 10),
  AGORA_RINGING_EXPIRATION_SECONDS: parseInt(process.env.AGORA_RINGING_EXPIRATION_SECONDS || '60', 10),
};


