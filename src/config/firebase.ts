import path from 'path';
import fs from 'fs';
import { initializeApp, getApps, getApp, cert, App } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';
import { env } from './env';

let firebaseApp: App | null = null;
let firebaseAuthInstance: Auth | null = null;

/**
 * Initializes and returns the Firebase Admin App singleton instance.
 * Supports:
 * 1. FIREBASE_SERVICE_ACCOUNT_PATH (JSON file)
 * 2. FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (.env variables)
 * 3. Default application fallback
 */
export const getFirebaseApp = (): App => {
  if (firebaseApp) {
    return firebaseApp;
  }

  const existingApps = getApps();
  if (existingApps.length > 0 && existingApps[0]) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  // 1. Service Account JSON file path
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const fullPath = path.isAbsolute(env.FIREBASE_SERVICE_ACCOUNT_PATH)
      ? env.FIREBASE_SERVICE_ACCOUNT_PATH
      : path.resolve(process.cwd(), env.FIREBASE_SERVICE_ACCOUNT_PATH);

    if (fs.existsSync(fullPath)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        firebaseApp = initializeApp({
          credential: cert(serviceAccount),
        });
        return firebaseApp;
      } catch (err: any) {
        console.error(`[Firebase] Failed to load service account file at ${fullPath}:`, err.message);
      }
    }
  }

  // 2. Individual Environment Variables
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    firebaseApp = initializeApp({
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey: env.FIREBASE_PRIVATE_KEY,
      }),
    });
    return firebaseApp;
  }

  // 3. Fallback to default project configuration
  try {
    firebaseApp = initializeApp({
      projectId: env.FIREBASE_PROJECT_ID || 'flirttime-app',
    });
    return firebaseApp;
  } catch (err: any) {
    return getApp();
  }
};

/**
 * Returns the Firebase Auth instance lazily
 */
export const getFirebaseAuth = (): Auth => {
  if (firebaseAuthInstance) {
    return firebaseAuthInstance;
  }
  const app = getFirebaseApp();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getAuth } = require('firebase-admin/auth');
  firebaseAuthInstance = getAuth(app) as Auth;
  return firebaseAuthInstance;
};

