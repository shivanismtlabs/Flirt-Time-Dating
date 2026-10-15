import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserDiscoveryPreferenceAttributes {
  id: string;
  userId: string;
  genders: string[];
  ageMin: number;
  ageMax: number;
  maxDistanceKm: number | null;
  lookingFor: string[];
  interestIds: string[];
  verifiedOnly: boolean;
  onlineOnly: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserDiscoveryPreferenceCreationAttributes
  extends Optional<
    UserDiscoveryPreferenceAttributes,
    | 'id'
    | 'genders'
    | 'ageMin'
    | 'ageMax'
    | 'maxDistanceKm'
    | 'lookingFor'
    | 'interestIds'
    | 'verifiedOnly'
    | 'onlineOnly'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class UserDiscoveryPreference
  extends Model<UserDiscoveryPreferenceAttributes, UserDiscoveryPreferenceCreationAttributes>
  implements UserDiscoveryPreferenceAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public genders: string[];
  declare public ageMin: number;
  declare public ageMax: number;
  declare public maxDistanceKm: number | null;
  declare public lookingFor: string[];
  declare public interestIds: string[];
  declare public verifiedOnly: boolean;
  declare public onlineOnly: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;
}

UserDiscoveryPreference.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    genders: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: ['everyone'],
    },
    ageMin: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 18,
    },
    ageMax: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 70,
    },
    maxDistanceKm: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
    },
    lookingFor: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    interestIds: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    verifiedOnly: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    onlineOnly: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: 'user_discovery_preferences',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId'],
        name: 'unique_user_discovery_preference_user_id',
      },
    ],
  }
);
