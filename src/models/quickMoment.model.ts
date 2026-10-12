import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type QuickMomentType = 'image' | 'text' | 'video';
export type QuickMomentStatus = 'active' | 'deleted' | 'expired';

export interface QuickMomentAttributes {
  id: string;
  userId: string;
  type: QuickMomentType;
  mediaUrl?: string | null;
  thumbnailUrl?: string | null;
  text?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  caption?: string | null;
  locationLabel?: string | null;
  viewsCount: number;
  repliesCount: number;
  status: QuickMomentStatus;
  publishedAt: Date;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QuickMomentCreationAttributes
  extends Optional<
    QuickMomentAttributes,
    | 'id'
    | 'type'
    | 'mediaUrl'
    | 'thumbnailUrl'
    | 'text'
    | 'backgroundColor'
    | 'textColor'
    | 'caption'
    | 'locationLabel'
    | 'viewsCount'
    | 'repliesCount'
    | 'status'
    | 'publishedAt'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class QuickMoment
  extends Model<QuickMomentAttributes, QuickMomentCreationAttributes>
  implements QuickMomentAttributes {
  declare public id: string;
  declare public userId: string;
  declare public type: QuickMomentType;
  declare public mediaUrl: string | null;
  declare public thumbnailUrl: string | null;
  declare public text: string | null;
  declare public backgroundColor: string | null;
  declare public textColor: string | null;
  declare public caption: string | null;
  declare public locationLabel: string | null;
  declare public viewsCount: number;
  declare public repliesCount: number;
  declare public status: QuickMomentStatus;
  declare public publishedAt: Date;
  declare public expiresAt: Date;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public author?: any;
  declare public reactions?: any[];
  declare public views?: any[];
}

QuickMoment.init(
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
    type: {
      type: DataTypes.STRING(20),
      defaultValue: 'image',
      allowNull: false,
    },
    mediaUrl: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    thumbnailUrl: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    text: {
      type: DataTypes.STRING(1000),
      allowNull: true,
    },
    backgroundColor: {
      type: DataTypes.STRING(50),
      defaultValue: '#2d0b1e',
      allowNull: true,
    },
    textColor: {
      type: DataTypes.STRING(50),
      defaultValue: '#ffffff',
      allowNull: true,
    },
    caption: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    locationLabel: {
      type: DataTypes.STRING(150),
      allowNull: true,
    },
    viewsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    repliesCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'active',
      allowNull: false,
    },
    publishedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'quick_moments',
    timestamps: true,
    indexes: [
      {
        fields: ['userId'],
        name: 'idx_quick_moments_user_id',
      },
      {
        fields: ['expiresAt'],
        name: 'idx_quick_moments_expires_at',
      },
      {
        fields: ['status', 'expiresAt'],
        name: 'idx_quick_moments_status_expires',
      },
    ],
  }
);
