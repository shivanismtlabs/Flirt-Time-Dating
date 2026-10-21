import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type SwipeActionType = 'like' | 'nope' | 'super_like';

export interface SwipeActionAttributes {
  id: string;
  userId: string;
  targetUserId: string;
  action: SwipeActionType;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SwipeActionCreationAttributes
  extends Optional<SwipeActionAttributes, 'id'> {}

export class SwipeAction
  extends Model<SwipeActionAttributes, SwipeActionCreationAttributes>
  implements SwipeActionAttributes {
  declare public id: string;
  declare public userId: string;
  declare public targetUserId: string;
  declare public action: SwipeActionType;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

SwipeAction.init(
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
    action: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'swipe_actions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'targetUserId'],
        name: 'unique_user_target_swipe',
      },
      {
        fields: ['targetUserId', 'action'],
      },
      {
        fields: ['userId', 'createdAt'],
        name: 'idx_swipe_actions_user_created_at',
      },
    ],
  }
);
