import { sequelize } from '../config/database';
import { User } from './user.model';
import { PhoneVerification } from './phoneVerification.model';
import { EmailVerification } from './emailVerification.model';
import { UserIdentity } from './userIdentity.model';
import { FaceVerification } from './faceVerification.model';
import { Interest } from './interest.model';
import { UserInterest } from './userInterest.model';
import { UserPhoto } from './userPhoto.model';
import { SwipeAction } from './swipeAction.model';
import { Match } from './match.model';
import { UserBlock } from './userBlock.model';
import { UserReport } from './userReport.model';
import { Moment } from './moment.model';
import { MomentMedia } from './momentMedia.model';
import { MomentReaction } from './momentReaction.model';
import { Conversation } from './conversation.model';
import { ChatMessage } from './chatMessage.model';
import { ConnectionRequest } from './connectionRequest.model';
import { UserDevice } from './userDevice.model';
import { Notification } from './notification.model';
import { QuickMoment } from './quickMoment.model';
import { QuickMomentReaction } from './quickMomentReaction.model';
import { QuickMomentView } from './quickMomentView.model';

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

// User <-> Interest Many-to-Many
User.belongsToMany(Interest, {
  through: UserInterest,
  foreignKey: 'userId',
  otherKey: 'interestId',
  as: 'interests',
});

Interest.belongsToMany(User, {
  through: UserInterest,
  foreignKey: 'interestId',
  otherKey: 'userId',
  as: 'users',
});

User.hasMany(UserInterest, {
  foreignKey: 'userId',
  as: 'userInterests',
  onDelete: 'CASCADE',
});

UserInterest.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

Interest.hasMany(UserInterest, {
  foreignKey: 'interestId',
  as: 'userInterests',
  onDelete: 'CASCADE',
});

UserInterest.belongsTo(Interest, {
  foreignKey: 'interestId',
  as: 'interest',
});

// User <-> UserPhoto One-to-Many
User.hasMany(UserPhoto, {
  foreignKey: 'userId',
  as: 'photos',
  onDelete: 'CASCADE',
});

UserPhoto.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// User <-> SwipeAction associations
User.hasMany(SwipeAction, {
  foreignKey: 'userId',
  as: 'swipesGiven',
  onDelete: 'CASCADE',
});

SwipeAction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

User.hasMany(SwipeAction, {
  foreignKey: 'targetUserId',
  as: 'swipesReceived',
  onDelete: 'CASCADE',
});

SwipeAction.belongsTo(User, {
  foreignKey: 'targetUserId',
  as: 'targetUser',
});

// User <-> Match associations
User.hasMany(Match, {
  foreignKey: 'user1Id',
  as: 'matchesAsUser1',
  onDelete: 'CASCADE',
});

User.hasMany(Match, {
  foreignKey: 'user2Id',
  as: 'matchesAsUser2',
  onDelete: 'CASCADE',
});

Match.belongsTo(User, {
  foreignKey: 'user1Id',
  as: 'user1',
});

Match.belongsTo(User, {
  foreignKey: 'user2Id',
  as: 'user2',
});

// User <-> UserBlock associations
User.hasMany(UserBlock, {
  foreignKey: 'userId',
  as: 'blockedUsers',
  onDelete: 'CASCADE',
});

UserBlock.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

User.hasMany(UserBlock, {
  foreignKey: 'blockedUserId',
  as: 'blockedByUsers',
  onDelete: 'CASCADE',
});

UserBlock.belongsTo(User, {
  foreignKey: 'blockedUserId',
  as: 'blockedUser',
});

// User <-> UserReport associations
User.hasMany(UserReport, {
  foreignKey: 'reporterId',
  as: 'reportsFiled',
  onDelete: 'CASCADE',
});

UserReport.belongsTo(User, {
  foreignKey: 'reporterId',
  as: 'reporter',
});

User.hasMany(UserReport, {
  foreignKey: 'targetUserId',
  as: 'reportsReceived',
  onDelete: 'CASCADE',
});

UserReport.belongsTo(User, {
  foreignKey: 'targetUserId',
  as: 'targetUser',
});

// Moment <-> UserReport associations
Moment.hasMany(UserReport, {
  foreignKey: 'momentId',
  as: 'reports',
  onDelete: 'CASCADE',
});

UserReport.belongsTo(Moment, {
  foreignKey: 'momentId',
  as: 'moment',
});

// User <-> Moment
User.hasMany(Moment, {
  foreignKey: 'userId',
  as: 'moments',
  onDelete: 'CASCADE',
});

Moment.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// Moment <-> MomentMedia
Moment.hasMany(MomentMedia, {
  foreignKey: 'momentId',
  as: 'media',
  onDelete: 'CASCADE',
});

MomentMedia.belongsTo(Moment, {
  foreignKey: 'momentId',
  as: 'moment',
});

// Moment <-> MomentReaction
Moment.hasMany(MomentReaction, {
  foreignKey: 'momentId',
  as: 'reactions',
  onDelete: 'CASCADE',
});

MomentReaction.belongsTo(Moment, {
  foreignKey: 'momentId',
  as: 'moment',
});

User.hasMany(MomentReaction, {
  foreignKey: 'userId',
  as: 'momentReactions',
  onDelete: 'CASCADE',
});

MomentReaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// User <-> Conversation
User.hasMany(Conversation, {
  foreignKey: 'user1Id',
  as: 'conversationsAsUser1',
  onDelete: 'CASCADE',
});

User.hasMany(Conversation, {
  foreignKey: 'user2Id',
  as: 'conversationsAsUser2',
  onDelete: 'CASCADE',
});

Conversation.belongsTo(User, {
  foreignKey: 'user1Id',
  as: 'user1',
});

Conversation.belongsTo(User, {
  foreignKey: 'user2Id',
  as: 'user2',
});

// Conversation <-> ChatMessage
Conversation.hasMany(ChatMessage, {
  foreignKey: 'conversationId',
  as: 'messages',
  onDelete: 'CASCADE',
});

ChatMessage.belongsTo(Conversation, {
  foreignKey: 'conversationId',
  as: 'conversation',
});

User.hasMany(ChatMessage, {
  foreignKey: 'senderId',
  as: 'sentMessages',
  onDelete: 'CASCADE',
});

ChatMessage.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender',
});

User.hasMany(ChatMessage, {
  foreignKey: 'recipientId',
  as: 'receivedMessages',
  onDelete: 'CASCADE',
});

ChatMessage.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient',
});

// User <-> ConnectionRequest
User.hasMany(ConnectionRequest, {
  foreignKey: 'requesterId',
  as: 'sentConnectionRequests',
  onDelete: 'CASCADE',
});

ConnectionRequest.belongsTo(User, {
  foreignKey: 'requesterId',
  as: 'requester',
});

User.hasMany(ConnectionRequest, {
  foreignKey: 'targetUserId',
  as: 'receivedConnectionRequests',
  onDelete: 'CASCADE',
});

ConnectionRequest.belongsTo(User, {
  foreignKey: 'targetUserId',
  as: 'targetUser',
});

// User <-> UserDevice
User.hasMany(UserDevice, {
  foreignKey: 'userId',
  as: 'devices',
  onDelete: 'CASCADE',
});

UserDevice.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// User <-> Notification
User.hasMany(Notification, {
  foreignKey: 'recipientId',
  as: 'notifications',
  onDelete: 'CASCADE',
});

Notification.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient',
});

Notification.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender',
});

// User <-> QuickMoment associations
User.hasMany(QuickMoment, {
  foreignKey: 'userId',
  as: 'quickMoments',
  onDelete: 'CASCADE',
});

QuickMoment.belongsTo(User, {
  foreignKey: 'userId',
  as: 'author',
});

// QuickMoment <-> QuickMomentReaction associations
QuickMoment.hasMany(QuickMomentReaction, {
  foreignKey: 'quickMomentId',
  as: 'reactions',
  onDelete: 'CASCADE',
});

QuickMomentReaction.belongsTo(QuickMoment, {
  foreignKey: 'quickMomentId',
  as: 'quickMoment',
});

QuickMomentReaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// QuickMoment <-> QuickMomentView associations
QuickMoment.hasMany(QuickMomentView, {
  foreignKey: 'quickMomentId',
  as: 'views',
  onDelete: 'CASCADE',
});

QuickMomentView.belongsTo(QuickMoment, {
  foreignKey: 'quickMomentId',
  as: 'quickMoment',
});

QuickMomentView.belongsTo(User, {
  foreignKey: 'userId',
  as: 'viewer',
});

export {
  sequelize,
  User,
  PhoneVerification,
  EmailVerification,
  UserIdentity,
  FaceVerification,
  Interest,
  UserInterest,
  UserPhoto,
  SwipeAction,
  Match,
  UserBlock,
  UserReport,
  Moment,
  MomentMedia,
  MomentReaction,
  Conversation,
  ChatMessage,
  ConnectionRequest,
  UserDevice,
  Notification,
  QuickMoment,
  QuickMomentReaction,
  QuickMomentView,
};

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

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'lookingFor') THEN
                ALTER TABLE "users" ADD COLUMN "lookingFor" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'genderPreference') THEN
                ALTER TABLE "users" ADD COLUMN "genderPreference" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'religion') THEN
                ALTER TABLE "users" ADD COLUMN "religion" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'city') THEN
                ALTER TABLE "users" ADD COLUMN "city" VARCHAR(100) DEFAULT 'Mumbai';
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'latitude') THEN
                ALTER TABLE "users" ADD COLUMN "latitude" FLOAT;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'longitude') THEN
                ALTER TABLE "users" ADD COLUMN "longitude" FLOAT;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'voicePromptUrl') THEN
                ALTER TABLE "users" ADD COLUMN "voicePromptUrl" VARCHAR(500);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'voicePromptDuration') THEN
                ALTER TABLE "users" ADD COLUMN "voicePromptDuration" INTEGER;
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

            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'moments') THEN
              IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'moments' AND column_name = 'expiresAt' AND is_nullable = 'NO'
              ) THEN
                ALTER TABLE "moments" ALTER COLUMN "expiresAt" DROP NOT NULL;
              END IF;
            END IF;
          END $$;
        `);

        // Explicit direct DDL for maximum reliability on all PostgreSQL environments
        try {
          await sequelize.query('ALTER TABLE "moments" ALTER COLUMN "expiresAt" DROP NOT NULL;');
        } catch (_dropErr) {
          // Safe to ignore if moments table does not exist yet or is already nullable
        }

        // Ensure quick_moments tables exist immediately on all environments
        try {
          await QuickMoment.sync();
          await QuickMomentReaction.sync();
          await QuickMomentView.sync();
        } catch (_qmSyncErr: any) {
          console.warn('⚠️ Could not sync quick_moments tables:', _qmSyncErr.message);
        }
      } catch (preMigrationError) {
        // Safe to ignore if database/table is newly initialized
      }
    }

    try {
      if (sequelize.getDialect() === 'sqlite') {
        await sequelize.sync({ force: isForce });
      } else {
        await sequelize.sync({ force: isForce, alter: !isForce && process.env.NODE_ENV === 'development' });
      }
    } catch (syncError: any) {
      // In PostgreSQL/SQLite, Sequelize's alter mode may fail on pre-existing constraint names or index duplicates
      if (
        syncError.name === 'SequelizeUnknownConstraintError' ||
        syncError.original?.code === '42704' ||
        syncError.original?.code === 'SQLITE_ERROR' ||
        syncError.message?.includes('already exists')
      ) {
        console.warn('⚠️ Standardizing schema without dropping constraint aliases...');
        await sequelize.sync({ force: isForce, alter: false });
      } else {
        throw syncError;
      }
    }

    // Seed initial interests catalog
    await seedDefaultInterests();

    // Seed 50 dummy discovery people profiles
    try {
      const { seed50DiscoveryUsers } = await import('../services/seedDiscovery.service');
      await seed50DiscoveryUsers();
    } catch (seedErr: any) {
      console.warn('⚠️ Could not seed default discovery users:', seedErr.message);
    }

    console.log('✅ Database models synchronized successfully.');
  } catch (error) {
    console.error('❌ Error synchronizing database models:', error);
    throw error;
  }
};

/**
 * Seeds default interests into the database if not already present
 */
export const seedDefaultInterests = async (): Promise<void> => {
  try {
    const defaultInterests = [
      { name: 'Cooking', icon: '🍳', category: 'Lifestyle' },
      { name: 'Lyrics Music', icon: '🎵', category: 'Entertainment' },
      { name: 'Dance', icon: '💃', category: 'Arts' },
      { name: 'Fitness', icon: '💪', category: 'Fitness' },
      { name: 'Gaming', icon: '🎮', category: 'Entertainment' },
      { name: 'Party', icon: '🎉', category: 'Social' },
      { name: 'Pets', icon: '🐶', category: 'Lifestyle' },
      { name: 'Photography', icon: '📷', category: 'Creativity' },
      { name: 'Reading', icon: '📚', category: 'Lifestyle' },
      { name: 'Shopping', icon: '🛍️', category: 'Lifestyle' },
      { name: 'Sports', icon: '⚽', category: 'Sports' },
      { name: 'Travelling', icon: '✈️', category: 'Travel' },
      { name: 'Karaoke', icon: '🎤', category: 'Entertainment' },
      { name: 'Yoga', icon: '🧘', category: 'Fitness' },
      { name: 'Tennis', icon: '🎾', category: 'Sports' },
      { name: 'Running', icon: '🏃', category: 'Sports' },
      { name: 'Swimming', icon: '🏊', category: 'Sports' },
      { name: 'Art', icon: '🎨', category: 'Creativity' },
      { name: 'Exercise', icon: '🏋️', category: 'Fitness' },
      { name: 'Music', icon: '🎵', category: 'Entertainment' },
      { name: 'Drinks', icon: '🍹', category: 'Social' },
      { name: 'Video games', icon: '🕹️', category: 'Entertainment' },
    ];

    for (const item of defaultInterests) {
      await Interest.findOrCreate({
        where: { name: item.name },
        defaults: { ...item, isActive: true },
      });
    }
  } catch (err: any) {
    console.warn('Could not seed default interests:', err.message);
  }
};

