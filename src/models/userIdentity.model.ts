import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserIdentityAttributes {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string | null;
  isPrivateEmail?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserIdentityCreationAttributes
  extends Optional<
    UserIdentityAttributes,
    'id' | 'email' | 'isPrivateEmail' | 'createdAt' | 'updatedAt'
  > {}

export class UserIdentity
  extends Model<UserIdentityAttributes, UserIdentityCreationAttributes>
  implements UserIdentityAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public provider: string;
  declare public providerUserId: string;
  declare public email: string | null;
  declare public isPrivateEmail: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;
}

UserIdentity.init(
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
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    provider: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Identity provider (e.g. apple)',
    },
    providerUserId: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Provider unique user identifier (Apple sub / Apple user ID)',
    },
    email: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'User email from provider (may be Apple private relay email)',
    },
    isPrivateEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
      comment: 'Flag indicating if email is a private relay email',
    },
  },
  {
    sequelize,
    tableName: 'user_identities',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['provider', 'providerUserId'],
        name: 'user_identities_provider_provider_user_id_unique',
      },
      {
        fields: ['userId'],
        name: 'user_identities_user_id_idx',
      },
      {
        fields: ['email'],
        name: 'user_identities_email_idx',
      },
    ],
  }
);
