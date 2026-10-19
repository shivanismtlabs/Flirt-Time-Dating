import { sequelize } from '../config/database';
import { User, DEFAULT_NOTIFY_SETTINGS, NotificationSettings } from './user.model';
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
import { MomentCommentLike } from './momentCommentLike.model';
import { Conversation } from './conversation.model';
import { ChatMessage } from './chatMessage.model';
import { ConversationPin } from './conversationPin.model';
import { ConnectionRequest } from './connectionRequest.model';
import { UserDevice } from './userDevice.model';
import { Notification } from './notification.model';
import { QuickMoment } from './quickMoment.model';
import { QuickMomentReaction } from './quickMomentReaction.model';
import { QuickMomentView } from './quickMomentView.model';
import {
  MomentGift,
  MOMENT_GIFTS_CATALOG,
  GiftCatalogItem,
} from './momentGift.model';
import { DeepLink } from './deepLink.model';
import { CoinPackage } from './coinPackage.model';
import { SubscriptionPlan } from './subscriptionPlan.model';
import { SubscriptionFeature } from './subscriptionFeature.model';
import { PlanFeature } from './planFeature.model';
import { CoinPurchase } from './coinPurchase.model';
import { CoinTransaction } from './coinTransaction.model';
import { UserSubscription } from './userSubscription.model';
import { SubscriptionEventLog } from './subscriptionEventLog.model';
import { UserDiscoveryPreference } from './userDiscoveryPreference.model';
import { NotificationOutbox } from './notificationOutbox.model';
import { NotificationSetting } from './notificationSetting.model';

// Define associations
User.hasOne(UserDiscoveryPreference, {
  foreignKey: 'userId',
  as: 'discoveryPreference',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

UserDiscoveryPreference.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

User.hasOne(NotificationSetting, {
  foreignKey: 'userId',
  as: 'notificationSetting',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

NotificationSetting.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});

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

// Conversation <-> UserReport associations
Conversation.hasMany(UserReport, {
  foreignKey: 'conversationId',
  as: 'reports',
  onDelete: 'SET NULL',
});

UserReport.belongsTo(Conversation, {
  foreignKey: 'conversationId',
  as: 'conversation',
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

// Moment <-> MomentGift associations
Moment.hasMany(MomentGift, {
  foreignKey: 'momentId',
  as: 'gifts',
  onDelete: 'CASCADE',
});

MomentGift.belongsTo(Moment, {
  foreignKey: 'momentId',
  as: 'moment',
});

User.hasMany(MomentGift, {
  foreignKey: 'senderId',
  as: 'sentMomentGifts',
  onDelete: 'CASCADE',
});

MomentGift.belongsTo(User, {
  foreignKey: 'senderId',
  as: 'sender',
});

User.hasMany(MomentGift, {
  foreignKey: 'recipientId',
  as: 'receivedMomentGifts',
  onDelete: 'CASCADE',
});

MomentGift.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient',
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

// ConversationPin associations
User.hasMany(ConversationPin, {
  foreignKey: 'userId',
  as: 'pinnedConversations',
  onDelete: 'CASCADE',
});

ConversationPin.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

Conversation.hasMany(ConversationPin, {
  foreignKey: 'conversationId',
  as: 'pins',
  onDelete: 'CASCADE',
});

ConversationPin.belongsTo(Conversation, {
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

// ChatMessage (Comment) <-> MomentCommentLike associations
ChatMessage.hasMany(MomentCommentLike, {
  foreignKey: 'commentId',
  as: 'commentLikes',
  onDelete: 'CASCADE',
});

MomentCommentLike.belongsTo(ChatMessage, {
  foreignKey: 'commentId',
  as: 'comment',
});

User.hasMany(MomentCommentLike, {
  foreignKey: 'userId',
  as: 'momentCommentLikes',
  onDelete: 'CASCADE',
});

MomentCommentLike.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
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

// User <-> DeepLink associations
User.hasMany(DeepLink, {
  foreignKey: 'creatorId',
  as: 'deepLinks',
  onDelete: 'CASCADE',
});

DeepLink.belongsTo(User, {
  foreignKey: 'creatorId',
  as: 'creator',
});

// SubscriptionPlan <-> SubscriptionFeature Many-to-Many associations
SubscriptionPlan.belongsToMany(SubscriptionFeature, {
  through: PlanFeature,
  as: 'features',
  foreignKey: 'subscription_plan_id',
  otherKey: 'subscription_feature_id',
});

SubscriptionFeature.belongsToMany(SubscriptionPlan, {
  through: PlanFeature,
  as: 'plans',
  foreignKey: 'subscription_feature_id',
  otherKey: 'subscription_plan_id',
});

SubscriptionPlan.hasMany(PlanFeature, {
  foreignKey: 'subscription_plan_id',
  as: 'planFeatures',
  onDelete: 'CASCADE',
});

PlanFeature.belongsTo(SubscriptionPlan, {
  foreignKey: 'subscription_plan_id',
  as: 'plan',
});

SubscriptionFeature.hasMany(PlanFeature, {
  foreignKey: 'subscription_feature_id',
  as: 'planFeatures',
  onDelete: 'CASCADE',
});

PlanFeature.belongsTo(SubscriptionFeature, {
  foreignKey: 'subscription_feature_id',
  as: 'feature',
});

// User <-> CoinPurchase associations
User.hasMany(CoinPurchase, {
  foreignKey: 'userId',
  as: 'coinPurchases',
  onDelete: 'CASCADE',
});

CoinPurchase.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// CoinPackage <-> CoinPurchase associations
CoinPackage.hasMany(CoinPurchase, {
  foreignKey: 'packageId',
  as: 'purchases',
  onDelete: 'SET NULL',
});

CoinPurchase.belongsTo(CoinPackage, {
  foreignKey: 'packageId',
  as: 'package',
});

// User <-> CoinTransaction (ledger) associations
User.hasMany(CoinTransaction, {
  foreignKey: 'userId',
  as: 'coinTransactions',
  onDelete: 'CASCADE',
});

CoinTransaction.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// User <-> UserSubscription associations
User.hasMany(UserSubscription, {
  foreignKey: 'userId',
  as: 'subscriptions',
  onDelete: 'CASCADE',
});

UserSubscription.belongsTo(User, {
  foreignKey: 'userId',
  as: 'user',
});

// SubscriptionPlan <-> UserSubscription associations
SubscriptionPlan.hasMany(UserSubscription, {
  foreignKey: 'planId',
  as: 'subscriptions',
  onDelete: 'SET NULL',
});

UserSubscription.belongsTo(SubscriptionPlan, {
  foreignKey: 'planId',
  as: 'plan',
});

// User <-> NotificationOutbox associations
User.hasMany(NotificationOutbox, {
  foreignKey: 'recipientId',
  as: 'notificationOutbox',
  onDelete: 'CASCADE',
});

NotificationOutbox.belongsTo(User, {
  foreignKey: 'recipientId',
  as: 'recipient',
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
  ConversationPin,
  ConnectionRequest,
  UserDevice,
  Notification,
  QuickMoment,
  QuickMomentReaction,
  QuickMomentView,
  MomentGift,
  MOMENT_GIFTS_CATALOG,
  GiftCatalogItem,
  DeepLink,
  CoinPackage,
  SubscriptionPlan,
  SubscriptionFeature,
  PlanFeature,
  CoinPurchase,
  CoinTransaction,
  UserSubscription,
  SubscriptionEventLog,
  UserDiscoveryPreference,
  MomentCommentLike,
  NotificationOutbox,
  NotificationSetting,
  DEFAULT_NOTIFY_SETTINGS,
  NotificationSettings,
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

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'coverPicture') THEN
                ALTER TABLE "users" ADD COLUMN "coverPicture" VARCHAR(500);
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

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'drinking') THEN
                ALTER TABLE "users" ADD COLUMN "drinking" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'education') THEN
                ALTER TABLE "users" ADD COLUMN "education" VARCHAR(100);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'height') THEN
                ALTER TABLE "users" ADD COLUMN "height" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'sexuality') THEN
                ALTER TABLE "users" ADD COLUMN "sexuality" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'smoking') THEN
                ALTER TABLE "users" ADD COLUMN "smoking" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'weight') THEN
                ALTER TABLE "users" ADD COLUMN "weight" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'eyeColor') THEN
                ALTER TABLE "users" ADD COLUMN "eyeColor" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'hairColor') THEN
                ALTER TABLE "users" ADD COLUMN "hairColor" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'living') THEN
                ALTER TABLE "users" ADD COLUMN "living" VARCHAR(100);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'relationship') THEN
                ALTER TABLE "users" ADD COLUMN "relationship" VARCHAR(50);
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'children') THEN
                ALTER TABLE "users" ADD COLUMN "children" VARCHAR(100);
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

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'coins') THEN
                ALTER TABLE "users" ADD COLUMN "coins" INTEGER DEFAULT 0;
              ELSE
                ALTER TABLE "users" ALTER COLUMN "coins" SET DEFAULT 0;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'lastActiveAt') THEN
                ALTER TABLE "users" ADD COLUMN "lastActiveAt" TIMESTAMP WITH TIME ZONE;
              END IF;

              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'notification_settings') THEN
                ALTER TABLE "users" ADD COLUMN "notification_settings" JSONB DEFAULT '{"new_message":true,"new_matches":true,"likes_comments_calls":true,"profile_visit":true,"new_tips_available":false,"push":true,"email":false,"app_updates":true,"promotions":false,"discounts":false}'::jsonb;
              END IF;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notification_settings') THEN
              CREATE TABLE IF NOT EXISTS "notification_settings" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "userId" UUID NOT NULL UNIQUE REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
                "new_messages" BOOLEAN NOT NULL DEFAULT true,
                "new_matches" BOOLEAN NOT NULL DEFAULT true,
                "like_comments" BOOLEAN NOT NULL DEFAULT true,
                "profile_visits" BOOLEAN NOT NULL DEFAULT true,
                "dating_tips" BOOLEAN NOT NULL DEFAULT false,
                "push_notifications" BOOLEAN NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
              );
            ELSE
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notification_settings' AND column_name = 'dating_tips') THEN
                ALTER TABLE "notification_settings" ADD COLUMN "dating_tips" BOOLEAN DEFAULT false;
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

            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_reports') THEN
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_reports' AND column_name = 'targetType') THEN
                ALTER TABLE "user_reports" ADD COLUMN "targetType" VARCHAR(20) DEFAULT 'user';
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_reports' AND column_name = 'momentId') THEN
                ALTER TABLE "user_reports" ADD COLUMN "momentId" UUID;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_reports' AND column_name = 'conversationId') THEN
                ALTER TABLE "user_reports" ADD COLUMN "conversationId" UUID;
              END IF;
            END IF;

            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'connection_requests') THEN
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connection_requests' AND column_name = 'reason') THEN
                ALTER TABLE "connection_requests" ADD COLUMN "reason" VARCHAR(150);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connection_requests' AND column_name = 'momentId') THEN
                ALTER TABLE "connection_requests" ADD COLUMN "momentId" UUID;
              END IF;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'coin_packages') THEN
              CREATE TABLE IF NOT EXISTS "coin_packages" (
                "id" SERIAL PRIMARY KEY,
                "name" VARCHAR(255) NOT NULL,
                "price" DECIMAL(10, 2) NOT NULL,
                "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
                "coins" INTEGER NOT NULL,
                "bonus_coins" INTEGER NOT NULL DEFAULT 0,
                "google_product_id" VARCHAR(255),
                "apple_product_id" VARCHAR(255),
                "is_active" BOOLEAN NOT NULL DEFAULT true,
                "sort_order" INTEGER NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
              );
              CREATE INDEX IF NOT EXISTS "coin_packages_is_active_idx" ON "coin_packages" ("is_active");
              CREATE INDEX IF NOT EXISTS "coin_packages_sort_order_idx" ON "coin_packages" ("is_active", "sort_order", "id");
              CREATE INDEX IF NOT EXISTS "coin_packages_price_idx" ON "coin_packages" ("price");
              CREATE INDEX IF NOT EXISTS "coin_packages_coins_idx" ON "coin_packages" ("coins");
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscription_plans') THEN
              CREATE TABLE IF NOT EXISTS "subscription_plans" (
                "id" SERIAL PRIMARY KEY,
                "name" VARCHAR(255) NOT NULL,
                "description" TEXT,
                "price" DECIMAL(10, 2) NOT NULL,
                "currency" VARCHAR(10) NOT NULL DEFAULT 'USD',
                "duration_days" INTEGER NOT NULL,
                "billing_cycle" VARCHAR(50) NOT NULL DEFAULT 'monthly',
                "trial_period" INTEGER,
                "is_recurring" BOOLEAN NOT NULL DEFAULT true,
                "bonus_coins" INTEGER NOT NULL DEFAULT 0,
                "discount" VARCHAR(50),
                "is_popular_plan" BOOLEAN NOT NULL DEFAULT false,
                "google_product_id" VARCHAR(255),
                "apple_product_id" VARCHAR(255),
                "icon" VARCHAR(500),
                "is_active" BOOLEAN NOT NULL DEFAULT true,
                "sort_order" INTEGER NOT NULL DEFAULT 0,
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
              );
              CREATE INDEX IF NOT EXISTS "subscription_plans_is_active_idx" ON "subscription_plans" ("is_active");
              CREATE INDEX IF NOT EXISTS "subscription_plans_sort_order_idx" ON "subscription_plans" ("is_active", "sort_order", "id");
              CREATE INDEX IF NOT EXISTS "subscription_plans_google_product_id_idx" ON "subscription_plans" ("google_product_id");
              CREATE INDEX IF NOT EXISTS "subscription_plans_apple_product_id_idx" ON "subscription_plans" ("apple_product_id");
            ELSE
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscription_plans' AND column_name = 'discount') THEN
                ALTER TABLE "subscription_plans" ADD COLUMN "discount" VARCHAR(50);
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscription_plans' AND column_name = 'is_popular_plan') THEN
                ALTER TABLE "subscription_plans" ADD COLUMN "is_popular_plan" BOOLEAN DEFAULT false;
              END IF;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscription_features') THEN
              CREATE TABLE IF NOT EXISTS "subscription_features" (
                "id" SERIAL PRIMARY KEY,
                "text" VARCHAR(255) NOT NULL,
                "image" VARCHAR(500) NOT NULL,
                "sort_order" INTEGER NOT NULL DEFAULT 0,
                "is_active" BOOLEAN NOT NULL DEFAULT true,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
              );
              CREATE INDEX IF NOT EXISTS "subscription_features_is_active_idx" ON "subscription_features" ("is_active");
              CREATE INDEX IF NOT EXISTS "subscription_features_sort_order_idx" ON "subscription_features" ("sort_order");
            END IF;

            IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_features') THEN
              CREATE TABLE IF NOT EXISTS "plan_features" (
                "id" SERIAL PRIMARY KEY,
                "subscription_plan_id" INTEGER NOT NULL REFERENCES "subscription_plans"("id") ON DELETE CASCADE,
                "subscription_feature_id" INTEGER NOT NULL REFERENCES "subscription_features"("id") ON DELETE CASCADE,
                "sort_order" INTEGER NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                CONSTRAINT "plan_features_plan_feature_unique" UNIQUE ("subscription_plan_id", "subscription_feature_id")
              );
              CREATE INDEX IF NOT EXISTS "plan_features_sort_order_idx" ON "plan_features" ("sort_order");
            END IF;
          END $$;
        `);

        // Explicit direct DDL for maximum reliability on all PostgreSQL environments
        try {
          await sequelize.query('ALTER TABLE "moments" ALTER COLUMN "expiresAt" DROP NOT NULL;');
        } catch (_dropErr) {
          // Safe to ignore if moments table does not exist yet or is already nullable
        }

        try {
          await sequelize.query('ALTER TABLE "user_reports" ADD COLUMN IF NOT EXISTS "targetType" VARCHAR(20) DEFAULT \'user\';');
          await sequelize.query('ALTER TABLE "user_reports" ADD COLUMN IF NOT EXISTS "momentId" UUID;');
          await sequelize.query('ALTER TABLE "user_reports" ADD COLUMN IF NOT EXISTS "conversationId" UUID;');
        } catch (_urColErr) {
          // Safe to ignore if user_reports does not exist yet
        }

        try {
          await sequelize.query('ALTER TABLE "connection_requests" ADD COLUMN IF NOT EXISTS "reason" VARCHAR(150);');
          await sequelize.query('ALTER TABLE "connection_requests" ADD COLUMN IF NOT EXISTS "momentId" UUID;');
        } catch (_crColErr) {
          // Safe to ignore if connection_requests does not exist yet
        }

        try {
          await sequelize.query('ALTER TABLE "email_verifications" ADD COLUMN IF NOT EXISTS "userId" UUID;');
          await sequelize.query('ALTER TABLE "email_verifications" ADD COLUMN IF NOT EXISTS "purpose" VARCHAR(50) DEFAULT \'auth\';');
        } catch (_evColErr) {
          // Safe to ignore if email_verifications does not exist yet
        }

        try {
          await sequelize.query('ALTER TABLE "phone_verifications" ADD COLUMN IF NOT EXISTS "userId" UUID;');
          await sequelize.query('ALTER TABLE "phone_verifications" ADD COLUMN IF NOT EXISTS "purpose" VARCHAR(50) DEFAULT \'auth\';');
        } catch (_pvColErr) {
          // Safe to ignore if phone_verifications does not exist yet
        }

        try {
          await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP WITH TIME ZONE;');
        } catch (_laColErr) {
          // Safe to ignore if users does not exist yet
        }

        // Ensure quick_moments and moment_gifts tables exist immediately on all environments
        try {
          await QuickMoment.sync();
          await QuickMomentReaction.sync();
          await QuickMomentView.sync();
          await MomentGift.sync();
          await MomentCommentLike.sync();
        } catch (_qmSyncErr: any) {
          console.warn('⚠️ Could not sync quick_moments / moment_gifts tables:', _qmSyncErr.message);
        }
      } catch (preMigrationError) {
        // Safe to ignore if database/table is newly initialized
      }
    }

    try {
      if (sequelize.getDialect() === 'sqlite') {
        if (isForce) {
          try {
            await sequelize.query('PRAGMA foreign_keys = OFF;');
          } catch (_) {}
        }
        await sequelize.sync({ force: isForce });
        if (isForce) {
          try {
            await sequelize.query('PRAGMA foreign_keys = ON;');
          } catch (_) {}
        }
        try {
          await sequelize.query('ALTER TABLE "connection_requests" ADD COLUMN "reason" VARCHAR(150);');
        } catch (_) {}
        try {
          await sequelize.query('ALTER TABLE "connection_requests" ADD COLUMN "momentId" VARCHAR(36);');
        } catch (_) {}
        try {
          await sequelize.query('ALTER TABLE "users" ADD COLUMN "lastActiveAt" DATETIME;');
        } catch (_) {}
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
        if (sequelize.getDialect() === 'sqlite' && isForce) {
          try {
            await sequelize.query('PRAGMA foreign_keys = OFF;');
          } catch (_) {}
        }
        await sequelize.sync({ force: isForce, alter: false });
        if (sequelize.getDialect() === 'sqlite' && isForce) {
          try {
            await sequelize.query('PRAGMA foreign_keys = ON;');
          } catch (_) {}
        }
      } else {
        throw syncError;
      }
    }

    await ensureCoinPackageTables();
    await ensureSubscriptionTables();
    await ensureCoinPurchaseTables();
    await UserDiscoveryPreference.sync();
    await MomentCommentLike.sync();
    await NotificationSetting.sync();
    await ConversationPin.sync();

    // Seed initial interests catalog
    await seedDefaultInterests();

    // Seed 50 dummy discovery people profiles (skip in test environment to avoid SQLite file locking)
    if (process.env.NODE_ENV !== 'test') {
      try {
        const { seed50DiscoveryUsers } = await import('../services/seedDiscovery.service');
        await seed50DiscoveryUsers();
      } catch (seedErr: any) {
        console.warn('⚠️ Could not seed default discovery users:', seedErr.message);
      }
    }

    // Seed 10 production coin packages idempotently
    try {
      const { seedCoinPackages } = await import('../services/seedCoinPackage.service');
      await seedCoinPackages(false);
    } catch (coinSeedErr: any) {
      console.warn('⚠️ Could not seed coin packages:', coinSeedErr.message);
    }

    // Seed verified subscription plans idempotently
    try {
      const { seedSubscriptions } = await import('../services/seedSubscription.service');
      await seedSubscriptions(false);
    } catch (subSeedErr: any) {
      console.warn('⚠️ Could not seed subscription plans:', subSeedErr.message);
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
      // 20 Canonical Discovery Filter UI Interests
      { name: 'Cinema', icon: '🎬', category: 'Entertainment' },
      { name: 'Cooking', icon: '🍳', category: 'Lifestyle' },
      { name: 'Dance', icon: '💃', category: 'Arts' },
      { name: 'Drawing', icon: '🎨', category: 'Creativity' },
      { name: 'Extreme', icon: '🏄', category: 'Sports' },
      { name: 'Fitness', icon: '💪', category: 'Fitness' },
      { name: 'Gaming', icon: '🎮', category: 'Entertainment' },
      { name: 'Handcraft', icon: '🧵', category: 'Creativity' },
      { name: 'Lyrics Music', icon: '🎵', category: 'Entertainment' },
      { name: 'Party', icon: '🎉', category: 'Social' },
      { name: 'Pets', icon: '🐶', category: 'Lifestyle' },
      { name: 'Photography', icon: '📷', category: 'Creativity' },
      { name: 'Planting', icon: '🌱', category: 'Lifestyle' },
      { name: 'Reading', icon: '📚', category: 'Lifestyle' },
      { name: 'Shopping', icon: '🛍️', category: 'Lifestyle' },
      { name: 'Sports', icon: '⚽', category: 'Sports' },
      { name: 'Television', icon: '📺', category: 'Entertainment' },
      { name: 'Travelling', icon: '✈️', category: 'Travel' },
      { name: 'Writing', icon: '✍️', category: 'Creativity' },
      { name: 'Yoga', icon: '🧘', category: 'Fitness' },
      // Additional catalog items for backward compatibility
      { name: 'Karaoke', icon: '🎤', category: 'Entertainment' },
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

/**
 * Ensures moment_gifts table and users.coins column exist on all database environments
 */
export const ensureMomentGiftTables = async (): Promise<void> => {
  try {
    if (sequelize.getDialect() === 'postgres') {
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "coins" INTEGER DEFAULT 0;');
        await sequelize.query('ALTER TABLE "users" ALTER COLUMN "coins" SET DEFAULT 0;');
      } catch (_e) {}
    } else if (sequelize.getDialect() === 'sqlite') {
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN "coins" INTEGER DEFAULT 0;');
      } catch (_e) {}
    }
    await MomentGift.sync();
  } catch (err: any) {
    console.warn('⚠️ Could not sync MomentGift table:', err.message);
  }
};

/**
 * Ensures coin_packages table exists on all database environments
 */
export const ensureCoinPackageTables = async (): Promise<void> => {
  try {
    await CoinPackage.sync();
  } catch (err: any) {
    console.warn('⚠️ Could not sync CoinPackage table:', err.message);
  }
};

/**
 * Ensures subscription_plans, subscription_features, and plan_features tables exist on all database environments
 */
export const ensureSubscriptionTables = async (): Promise<void> => {
  try {
    if (sequelize.getDialect() === 'postgres') {
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_subscribed" BOOLEAN DEFAULT false;');
        await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscription_expires_at" TIMESTAMP WITH TIME ZONE;');
        await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "active_subscription_plan_id" INTEGER;');
        await sequelize.query('ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "discount" VARCHAR(50);');
        await sequelize.query('ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "is_popular_plan" BOOLEAN DEFAULT false;');
      } catch (_e) {}
    } else if (sequelize.getDialect() === 'sqlite') {
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN "is_subscribed" BOOLEAN DEFAULT false;');
      } catch (_e) {}
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN "subscription_expires_at" DATETIME;');
      } catch (_e) {}
      try {
        await sequelize.query('ALTER TABLE "users" ADD COLUMN "active_subscription_plan_id" INTEGER;');
      } catch (_e) {}
      try {
        await sequelize.query('ALTER TABLE "subscription_plans" ADD COLUMN "discount" VARCHAR(50);');
      } catch (_e) {}
      try {
        await sequelize.query('ALTER TABLE "subscription_plans" ADD COLUMN "is_popular_plan" BOOLEAN DEFAULT false;');
      } catch (_e) {}
    }
    await SubscriptionPlan.sync();
    await SubscriptionFeature.sync();
    await PlanFeature.sync();
    await UserSubscription.sync();
    await SubscriptionEventLog.sync();
  } catch (err: any) {
    console.warn('⚠️ Could not sync Subscription tables:', err.message);
  }
};

/**
 * Ensures coin_purchases and coin_transactions tables exist with required constraints on all database environments
 */
export const ensureCoinPurchaseTables = async (): Promise<void> => {
  try {
    await CoinPurchase.sync();
    await CoinTransaction.sync();
    await NotificationOutbox.sync();
  } catch (err: any) {
    console.warn('⚠️ Could not sync CoinPurchase / CoinTransaction / NotificationOutbox tables:', err.message);
  }
};

