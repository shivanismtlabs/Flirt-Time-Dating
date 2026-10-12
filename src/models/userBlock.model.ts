import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserBlockAttributes {
  id: string;
  userId: string;
  blockedUserId: string;
  reason?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserBlockCreationAttributes
  extends Optional<UserBlockAttributes, 'id' | 'reason'> {}

export class UserBlock
  extends Model<UserBlockAttributes, UserBlockCreationAttributes>
  implements UserBlockAttributes {
  declare public id: string;
  declare public userId: string;
  declare public blockedUserId: string;
  declare public reason: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

UserBlock.init(
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
    blockedUserId: {
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
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'user_blocks',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'blockedUserId'],
        name: 'unique_user_blocked_user',
      },
    ],
  }
);
