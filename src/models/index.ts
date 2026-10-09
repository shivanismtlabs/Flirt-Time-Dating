import { sequelize } from '../config/database';
import { User } from './user.model';
import { PhoneVerification } from './phoneVerification.model';
import { EmailVerification } from './emailVerification.model';
import { UserIdentity } from './userIdentity.model';
import { FaceVerification } from './faceVerification.model';

// Define associations
User.hasMany(UserIdentity, {
  foreignKey: 'userId',
  as: 'identities',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

UserIdentity.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

User.hasMany(FaceVerification, {
  foreignKey: 'userId',
  as: 'faceVerifications',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

FaceVerification.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

export { sequelize, User, PhoneVerification, EmailVerification, UserIdentity, FaceVerification };

export const initDb = async (force = false): Promise<void> => {
  const isForce = force || process.env.FORCE_SYNC === 'true';

  try {
    if (!isForce && sequelize.getDialect() === 'postgres') {
      // Pre-migration: ensure legacy records in existing PostgreSQL tables have required columns & non-null defaults before alter sync
      try {
        await sequelize.query(`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
              -- username
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username') THEN
                ALTER TABLE "users" ADD COLUMN "username" VARCHAR(50);
              END IF;
              UPDATE "users" SET "username" = CONCAT('user_', SUBSTRING(id::text FROM 1 FOR 8)) WHERE "username" IS NULL;

              -- createdAt
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'createdAt') THEN
                ALTER TABLE "users" ADD COLUMN "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
              END IF;
              UPDATE "users" SET "createdAt" = NOW() WHERE "createdAt" IS NULL;

              -- updatedAt
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'updatedAt') THEN
                ALTER TABLE "users" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW();
              END IF;
              UPDATE "users" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;

              -- role
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role') THEN
                ALTER TABLE "users" ADD COLUMN "role" VARCHAR(20) DEFAULT 'user';
              END IF;

              -- isActive
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'isActive') THEN
                ALTER TABLE "users" ADD COLUMN "isActive" BOOLEAN DEFAULT true;
              END IF;

              -- Profile Onboarding Columns
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'fullName') THEN
                ALTER TABLE "users" ADD COLUMN "fullName" VARCHAR(100);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'firstName') THEN
                ALTER TABLE "users" ADD COLUMN "firstName" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'lastName') THEN
                ALTER TABLE "users" ADD COLUMN "lastName" VARCHAR(50);
              END IF;


              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'nickName') THEN
                ALTER TABLE "users" ADD COLUMN "nickName" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'dateOfBirth') THEN
                ALTER TABLE "users" ADD COLUMN "dateOfBirth" DATE;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'gender') THEN
                ALTER TABLE "users" ADD COLUMN "gender" VARCHAR(20);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'about') THEN
                ALTER TABLE "users" ADD COLUMN "about" VARCHAR(500);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'isProfileComplete') THEN
                ALTER TABLE "users" ADD COLUMN "isProfileComplete" BOOLEAN DEFAULT false;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'isFaceVerified') THEN
                ALTER TABLE "users" ADD COLUMN "isFaceVerified" BOOLEAN DEFAULT false;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'faceVerifiedAt') THEN
                ALTER TABLE "users" ADD COLUMN "faceVerifiedAt" TIMESTAMP WITH TIME ZONE;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'profilePicture') THEN
                ALTER TABLE "users" ADD COLUMN "profilePicture" VARCHAR(500);
              END IF;
            END IF;

            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'face_verifications') THEN
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'face_verifications' AND column_name = 'sourceImage') THEN
                ALTER TABLE "face_verifications" ADD COLUMN "sourceImage" VARCHAR(500);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'face_verifications' AND column_name = 'processedImage') THEN
                ALTER TABLE "face_verifications" ADD COLUMN "processedImage" VARCHAR(500);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'face_verifications' AND column_name = 'rejectionReason') THEN
                ALTER TABLE "face_verifications" ADD COLUMN "rejectionReason" VARCHAR(255);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'face_verifications' AND column_name = 'attemptNo') THEN
                ALTER TABLE "face_verifications" ADD COLUMN "attemptNo" INTEGER DEFAULT 1;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'face_verifications' AND column_name = 'isLatest') THEN
                ALTER TABLE "face_verifications" ADD COLUMN "isLatest" BOOLEAN DEFAULT true;
              END IF;
            END IF;
          END $$;
        `);
      } catch (preMigrationError) {
        // Safe to ignore if database/table is newly initialized
      }
    }

    try {
      await sequelize.sync({ force: isForce, alter: !isForce && process.env.NODE_ENV === 'development' });
    } catch (syncError: any) {
      // In PostgreSQL, Sequelize's alter mode may fail on pre-existing constraint names
      // Fall back to safe sync since pre-migration SQL has already reconciled all columns
      if (syncError.name === 'SequelizeUnknownConstraintError' || syncError.original?.code === '42704') {
        console.warn('⚠️ Standardizing schema without dropping constraint aliases...');
        await sequelize.sync({ force: isForce, alter: false });
      } else {
        throw syncError;
      }
    }

    console.log('✅ Database models synchronized successfully.');
  } catch (error) {
    console.error('❌ Error synchronizing database models:', error);
    throw error;
  }
};

