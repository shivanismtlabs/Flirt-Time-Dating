import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface NotificationOutboxAttributes {
  id: string;
  recipientId: string;
  type: string;
  title: string;
  body: string;
  entityId?: string | null;
  data?: Record<string, any> | null;
  idempotencyKey: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  nextRetryAt?: Date | null;
  processedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NotificationOutboxCreationAttributes
  extends Optional<
    NotificationOutboxAttributes,
    | 'id'
    | 'entityId'
    | 'data'
    | 'status'
    | 'attempts'
    | 'maxAttempts'
    | 'lastError'
    | 'nextRetryAt'
    | 'processedAt'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class NotificationOutbox
  extends Model<NotificationOutboxAttributes, NotificationOutboxCreationAttributes>
  implements NotificationOutboxAttributes
{
  declare public id: string;
  declare public recipientId: string;
  declare public type: string;
  declare public title: string;
  declare public body: string;
  declare public entityId: string | null;
  declare public data: Record<string, any> | null;
  declare public idempotencyKey: string;
  declare public status: 'pending' | 'sent' | 'failed';
  declare public attempts: number;
  declare public maxAttempts: number;
  declare public lastError: string | null;
  declare public nextRetryAt: Date | null;
  declare public processedAt: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

NotificationOutbox.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    recipientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'coin_purchase',
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    entityId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    idempotencyKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'sent', 'failed']],
      },
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    nextRetryAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'notification_outbox',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['idempotencyKey'],
      },
      {
        fields: ['status', 'nextRetryAt'],
      },
      {
        fields: ['recipientId'],
      },
      {
        fields: ['entityId'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);
