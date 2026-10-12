import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ReportReason =
  | 'fake_profile'
  | 'harassment'
  | 'inappropriate_content'
  | 'spam'
  | 'scam'
  | 'underage'
  | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'dismissed' | 'resolved';

export interface UserReportAttributes {
  id: string;
  reporterId: string;
  targetUserId: string;
  reason: ReportReason;
  description?: string | null;
  status: ReportStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserReportCreationAttributes
  extends Optional<UserReportAttributes, 'id' | 'description' | 'status'> {}

export class UserReport
  extends Model<UserReportAttributes, UserReportCreationAttributes>
  implements UserReportAttributes {
  declare public id: string;
  declare public reporterId: string;
  declare public targetUserId: string;
  declare public reason: ReportReason;
  declare public description: string | null;
  declare public status: ReportStatus;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
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
    ],
  }
);
