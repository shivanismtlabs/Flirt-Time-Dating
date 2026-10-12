import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface NotificationAttributes {
  id: string;
  recipientId: string;
  senderId?: string | null;
  type: string;
  title: string;
  body: string;
  entityId?: string | null;
  data?: Record<string, any> | null;
  isRead: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NotificationCreationAttributes
  extends Optional<NotificationAttributes, 'id' | 'senderId' | 'entityId' | 'data' | 'isRead' | 'createdAt' | 'updatedAt'> {}

export class Notification
  extends Model<NotificationAttributes, NotificationCreationAttributes>
  implements NotificationAttributes
{
  declare id: string;
  declare recipientId: string;
  declare senderId: string | null;
  declare type: string;
  declare title: string;
  declare body: string;
  declare entityId: string | null;
  declare data: Record<string, any> | null;
  declare isRead: boolean;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare recipient?: any;
  declare sender?: any;
}

Notification.init(
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
    senderId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'SET NULL',
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'general',
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
      type: DataTypes.UUID,
      allowNull: true,
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'notifications',
    timestamps: true,
    indexes: [
      {
        fields: ['recipientId'],
      },
      {
        fields: ['recipientId', 'isRead'],
      },
      {
        fields: ['type'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);
