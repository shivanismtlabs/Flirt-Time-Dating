import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type MomentAudience = 'everyone' | 'matches_only' | 'close_friends';
export type MomentStatus = 'active' | 'deleted' | 'expired';

export interface MomentAttributes {
  id: string;
  userId: string;
  caption?: string | null;
  audience: MomentAudience;
  status: MomentStatus;
  publishedAt: Date;
  expiresAt?: Date | null;
  locationLabel?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentCreationAttributes
  extends Optional<
    MomentAttributes,
    'id' | 'caption' | 'audience' | 'status' | 'expiresAt' | 'locationLabel' | 'createdAt' | 'updatedAt'
  > {}

export class Moment
  extends Model<MomentAttributes, MomentCreationAttributes>
  implements MomentAttributes {
  declare public id: string;
  declare public userId: string;
  declare public caption: string | null;
  declare public audience: MomentAudience;
  declare public status: MomentStatus;
  declare public publishedAt: Date;
  declare public expiresAt: Date | null;
  declare public locationLabel: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public media?: any[];
  declare public reactions?: any[];
  declare public user?: any;
}

Moment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
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
    caption: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    audience: {
      type: DataTypes.STRING(50),
      defaultValue: 'everyone',
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'active',
      allowNull: false,
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    locationLabel: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'moments',
    timestamps: true,
    indexes: [
      {
        fields: ['userId'],
        name: 'idx_moments_user_id',
      },
      {
        fields: ['expiresAt'],
        name: 'idx_moments_expires_at',
      },
      {
        fields: ['status', 'expiresAt'],
        name: 'idx_moments_status_expires',
      },
    ],
  }
);
