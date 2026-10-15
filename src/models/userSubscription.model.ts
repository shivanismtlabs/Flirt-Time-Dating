import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { User } from './user.model';
import { SubscriptionPlan } from './subscriptionPlan.model';

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'expired'
  | 'in_grace_period'
  | 'on_hold'
  | 'paused'
  | 'revoked'
  | 'refunded'
  | 'pending';

export interface UserSubscriptionAttributes {
  id: string;
  userId: string;
  planId: number | null;
  platform: 'ios' | 'android';
  productId: string;
  storeTransactionId: string;
  originalTransactionId?: string | null;
  purchaseToken?: string | null;
  status: SubscriptionStatus;
  isEntitled: boolean;
  startsAt: Date;
  expiresAt: Date;
  gracePeriodExpiresAt?: Date | null;
  autoRenewing: boolean;
  cancelReason?: string | null;
  canceledAt?: Date | null;
  price?: number | string | null;
  currency: string;
  environment: 'production' | 'sandbox';
  acknowledged: boolean;
  acknowledgedAt?: Date | null;
  bonusCoinsCredited: boolean;
  bonusCoinsAmount: number;
  rawVerificationData?: any;
  latestEventId?: string | null;
  latestEventType?: string | null;
  latestEventTimestamp?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserSubscriptionCreationAttributes
  extends Optional<
    UserSubscriptionAttributes,
    | 'id'
    | 'planId'
    | 'originalTransactionId'
    | 'purchaseToken'
    | 'gracePeriodExpiresAt'
    | 'cancelReason'
    | 'canceledAt'
    | 'price'
    | 'currency'
    | 'environment'
    | 'acknowledged'
    | 'acknowledgedAt'
    | 'bonusCoinsCredited'
    | 'bonusCoinsAmount'
    | 'rawVerificationData'
    | 'latestEventId'
    | 'latestEventType'
    | 'latestEventTimestamp'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class UserSubscription
  extends Model<UserSubscriptionAttributes, UserSubscriptionCreationAttributes>
  implements UserSubscriptionAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public planId: number | null;
  declare public platform: 'ios' | 'android';
  declare public productId: string;
  declare public storeTransactionId: string;
  declare public originalTransactionId: string | null;
  declare public purchaseToken: string | null;
  declare public status: SubscriptionStatus;
  declare public isEntitled: boolean;
  declare public startsAt: Date;
  declare public expiresAt: Date;
  declare public gracePeriodExpiresAt: Date | null;
  declare public autoRenewing: boolean;
  declare public cancelReason: string | null;
  declare public canceledAt: Date | null;
  declare public price: number | string | null;
  declare public currency: string;
  declare public environment: 'production' | 'sandbox';
  declare public acknowledged: boolean;
  declare public acknowledgedAt: Date | null;
  declare public bonusCoinsCredited: boolean;
  declare public bonusCoinsAmount: number;
  declare public rawVerificationData: any;
  declare public latestEventId: string | null;
  declare public latestEventType: string | null;
  declare public latestEventTimestamp: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: User;
  declare public plan?: SubscriptionPlan;
}

const isPostgres = sequelize.getDialect() === 'postgres';

UserSubscription.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'user_id',
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    planId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'plan_id',
      references: {
        model: 'subscription_plans',
        key: 'id',
      },
      onDelete: 'SET NULL',
    },
    platform: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    productId: {
      type: DataTypes.STRING(150),
      allowNull: false,
      field: 'product_id',
    },
    storeTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      field: 'store_transaction_id',
    },
    originalTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'original_transaction_id',
    },
    purchaseToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'purchase_token',
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'active',
    },
    isEntitled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'is_entitled',
    },
    startsAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'starts_at',
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'expires_at',
    },
    gracePeriodExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'grace_period_expires_at',
    },
    autoRenewing: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'auto_renewing',
    },
    cancelReason: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'cancel_reason',
    },
    canceledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'canceled_at',
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'USD',
    },
    environment: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'production',
    },
    acknowledged: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    acknowledgedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'acknowledged_at',
    },
    bonusCoinsCredited: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'bonus_coins_credited',
    },
    bonusCoinsAmount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'bonus_coins_amount',
    },
    rawVerificationData: {
      type: isPostgres ? DataTypes.JSONB : DataTypes.JSON,
      allowNull: true,
      field: 'raw_verification_data',
    },
    latestEventId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'latest_event_id',
    },
    latestEventType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'latest_event_type',
    },
    latestEventTimestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'latest_event_timestamp',
    },
  },
  {
    sequelize,
    tableName: 'user_subscriptions',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['user_id'],
      },
      {
        unique: true,
        fields: ['store_transaction_id'],
      },
      {
        fields: ['original_transaction_id'],
      },
      {
        fields: ['product_id'],
      },
      {
        fields: ['status'],
      },
      {
        fields: ['is_entitled'],
      },
      {
        fields: ['expires_at'],
      },
    ],
  }
);
