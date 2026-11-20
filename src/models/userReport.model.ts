import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ReportTargetType = 'user' | 'moment' | 'chat';

export type ReportReason =
  | 'fake_profile'
  | 'harassment'
  | 'inappropriate_content'
  | 'spam'
  | 'scam'
  | 'underage'
  | 'nudity'
  | 'violence'
  | 'fake_content'
  | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'resolved';

export interface UserReportAttributes {
  id: string;
  reporterId: string;
  targetUserId: string;
  targetType?: ReportTargetType;
  momentId?: string | null;
  conversationId?: string | null;
  reason: ReportReason;
  description?: string | null;
  status: ReportStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserReportCreationAttributes
  extends Optional<
    UserReportAttributes,
    'id' | 'targetType' | 'momentId' | 'conversationId' | 'description' | 'status'
  > {}

export class UserReport
  extends Model<UserReportAttributes, UserReportCreationAttributes>
  implements UserReportAttributes {
  declare public id: string;
  declare public reporterId: string;
  declare public targetUserId: string;
  declare public targetType: ReportTargetType;
  declare public momentId: string | null;
  declare public conversationId: string | null;
  declare public reason: ReportReason;
  declare public description: string | null;
  declare public status: ReportStatus;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public moment?: any;
  declare public conversation?: any;
  declare public reporter?: any;
  declare public targetUser?: any;
}

UserReport.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    reporterId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    targetUserId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    targetType: {
      type: DataTypes.STRING(20),
      defaultValue: 'user',
      allowNull: false,
    },
    momentId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'moments',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'conversations',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    reason: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending',
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'user_reports',
    timestamps: true,
    indexes: [
      {
        fields: ['reporterId', 'targetUserId'],
        name: 'idx_user_reports_reporter_target',
      },
      {
        fields: ['targetUserId', 'status'],
        name: 'idx_user_reports_target_status',
      },
      {
        fields: ['momentId'],
        name: 'idx_user_reports_moment_id',
      },
      {
        fields: ['reporterId', 'momentId'],
        name: 'idx_user_reports_reporter_moment',
      },
      {
        fields: ['conversationId'],
        name: 'idx_user_reports_conversation_id',
      },
      {
        fields: ['reporterId', 'conversationId'],
        name: 'idx_user_reports_reporter_conversation',
      },
    ],
  }
);
