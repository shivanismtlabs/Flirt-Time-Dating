import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type DeepLinkContentType = 'moment' | 'quick_moment' | 'profile';
export type DeepLinkStatus = 'active' | 'revoked';

export interface DeepLinkAttributes {
  id: string;
  code: string;
  contentType: DeepLinkContentType;
  contentId: string;
  creatorId: string;
  status: DeepLinkStatus;
  expiresAt?: Date | null;
  clicksCount: number;
  lastAccessedAt?: Date | null;
  metadata?: Record<string, any> | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface DeepLinkCreationAttributes
  extends Optional<
    DeepLinkAttributes,
    | 'id'
    | 'status'
    | 'expiresAt'
    | 'clicksCount'
    | 'lastAccessedAt'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class DeepLink
  extends Model<DeepLinkAttributes, DeepLinkCreationAttributes>
  implements DeepLinkAttributes {
  declare public id: string;
  declare public code: string;
  declare public contentType: DeepLinkContentType;
  declare public contentId: string;
  declare public creatorId: string;
  declare public status: DeepLinkStatus;
  declare public expiresAt: Date | null;
  declare public clicksCount: number;
  declare public lastAccessedAt: Date | null;
  declare public metadata: Record<string, any> | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public creator?: any;
}

DeepLink.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
    },
    contentType: {
      type: DataTypes.STRING(30),
      allowNull: false,
    },
    contentId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'active',
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    clicksCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      allowNull: false,
    },
    lastAccessedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: 'deep_links',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['code'],
        name: 'idx_deep_links_code',
      },
      {
        fields: ['contentType', 'contentId', 'creatorId'],
        name: 'idx_deep_links_content_creator',
      },
      {
        fields: ['status', 'expiresAt'],
        name: 'idx_deep_links_status_expires',
      },
      {
        fields: ['creatorId'],
        name: 'idx_deep_links_creator_id',
      },
    ],
  }
);
