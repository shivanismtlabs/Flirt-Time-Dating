import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type DevicePlatform = 'ios' | 'android' | 'web';

export interface UserDeviceAttributes {
  id: string;
  userId: string;
  deviceToken: string;
  platform: DevicePlatform;
  deviceId?: string | null;
  /** iOS PushKit token. Required for CallKit when the app is locked or killed. */
  voipToken?: string | null;
  isActive: boolean;
  lastUsedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserDeviceCreationAttributes
  extends Optional<
    UserDeviceAttributes,
    'id' | 'deviceId' | 'voipToken' | 'isActive' | 'lastUsedAt' | 'createdAt' | 'updatedAt'
  > {}

export class UserDevice
  extends Model<UserDeviceAttributes, UserDeviceCreationAttributes>
  implements UserDeviceAttributes
{
  declare id: string;
  declare userId: string;
  declare deviceToken: string;
  declare platform: DevicePlatform;
  declare deviceId: string | null;
  declare voipToken: string | null;
  declare isActive: boolean;
  declare lastUsedAt: Date | null;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  // Associations
  declare user?: any;
}

UserDevice.init(
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
    },
    deviceToken: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    platform: {
      type: DataTypes.ENUM('ios', 'android', 'web'),
      allowNull: false,
      defaultValue: 'android',
    },
    deviceId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    voipToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'user_devices',
    timestamps: true,
    indexes: [
      {
        fields: ['userId'],
      },
      {
        fields: ['userId', 'isActive'],
      },
      {
        fields: ['voipToken'],
        name: 'user_devices_voip_token',
      },
    ],
  }
);
