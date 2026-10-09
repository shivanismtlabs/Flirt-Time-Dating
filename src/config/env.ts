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

  APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID || 'com.flirttime.app',
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID || '',
  APPLE_KEY_ID: process.env.APPLE_KEY_ID || '',
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY || '',

  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : '',
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',

  // AWS S3 & Rekognition Configuration
  AWS_REGION: process.env.AWS_REGION || 'ap-south-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || 'flirttime-private-media',
  FACE_SIMILARITY_THRESHOLD: parseFloat(process.env.FACE_SIMILARITY_THRESHOLD || '85.0'),
  FACE_UPLOAD_MAX_SIZE_BYTES: parseInt(process.env.FACE_UPLOAD_MAX_SIZE_BYTES || '5242880', 10), // 5MB
};

