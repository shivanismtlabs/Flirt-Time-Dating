import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserInterestAttributes {
  id: string;
  userId: string;
  interestId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserInterestCreationAttributes
  extends Optional<UserInterestAttributes, 'id'> {}

export class UserInterest extends Model<UserInterestAttributes, UserInterestCreationAttributes>
  implements UserInterestAttributes {
  declare public id: string;
  declare public userId: string;
  declare public interestId: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

UserInterest.init(
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
    interestId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'interests',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  },
  {
    sequelize,
    tableName: 'user_interests',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'interestId'],
        name: 'user_interests_user_id_interest_id_unique',
      },
    ],
  }
);
