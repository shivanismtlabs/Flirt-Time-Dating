import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface SubscriptionEventLogAttributes {
  id: string;
  platform: 'ios' | 'android';
  eventId: string;
  eventType: string;
  subtype?: string | null;
  originalTransactionId?: string | null;
  storeTransactionId?: string | null;
  purchaseToken?: string | null;
  eventTimestamp: Date;
  processed: boolean;
  processingResult?: string | null;
  rawPayload?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SubscriptionEventLogCreationAttributes
  extends Optional<
    SubscriptionEventLogAttributes,
    | 'id'
    | 'subtype'
    | 'originalTransactionId'
    | 'storeTransactionId'
    | 'purchaseToken'
    | 'processed'
    | 'processingResult'
    | 'rawPayload'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class SubscriptionEventLog
  extends Model<SubscriptionEventLogAttributes, SubscriptionEventLogCreationAttributes>
  implements SubscriptionEventLogAttributes
{
  declare public id: string;
  declare public platform: 'ios' | 'android';
  declare public eventId: string;
  declare public eventType: string;
  declare public subtype: string | null;
  declare public originalTransactionId: string | null;
  declare public storeTransactionId: string | null;
  declare public purchaseToken: string | null;
  declare public eventTimestamp: Date;
  declare public processed: boolean;
  declare public processingResult: string | null;
  declare public rawPayload: any;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

const isPostgres = sequelize.getDialect() === 'postgres';

SubscriptionEventLog.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    platform: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    eventId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      field: 'event_id',
    },
    eventType: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'event_type',
    },
    subtype: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    originalTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'original_transaction_id',
    },
    storeTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'store_transaction_id',
    },
    purchaseToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'purchase_token',
    },
    eventTimestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'event_timestamp',
    },
    processed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    processingResult: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'processing_result',
    },
    rawPayload: {
      type: isPostgres ? DataTypes.JSONB : DataTypes.JSON,
      allowNull: true,
      field: 'raw_payload',
    },
  },
  {
    sequelize,
    tableName: 'subscription_event_logs',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['event_id'],
      },
      {
        fields: ['platform'],
      },
      {
        fields: ['event_type'],
      },
      {
        fields: ['original_transaction_id'],
      },
      {
        fields: ['event_timestamp'],
      },
    ],
  }
);
