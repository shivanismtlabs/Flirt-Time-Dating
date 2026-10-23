import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface QuickMomentReplyAttributes {
  id: string;
  quickMomentId: string;
  userId: string;
  message: string;
  notificationId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QuickMomentReplyCreationAttributes
  extends Optional<
    QuickMomentReplyAttributes,
    'id' | 'notificationId' | 'createdAt' | 'updatedAt'
  > {}

export class QuickMomentReply
  extends Model<QuickMomentReplyAttributes, QuickMomentReplyCreationAttributes>
  implements QuickMomentReplyAttributes {
  declare public id: string;
  declare public quickMomentId: string;
  declare public userId: string;
  declare public message: string;
  declare public notificationId: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;
  declare public quickMoment?: any;
}

QuickMomentReply.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quickMomentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'quick_moments',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    notificationId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'quick_moment_replies',
    timestamps: true,
    indexes: [
      {
        fields: ['quickMomentId'],
        name: 'idx_qm_replies_moment_id',
      },
      {
        fields: ['userId'],
        name: 'idx_qm_replies_user_id',
      },
      {
        unique: true,
        fields: ['notificationId'],
        name: 'idx_qm_replies_notification_id_unique',
      },
    ],
  }
);
