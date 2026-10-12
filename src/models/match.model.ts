import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface MatchAttributes {
  id: string;
  user1Id: string;
  user2Id: string;
  matchedBy: 'like' | 'super_like';
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MatchCreationAttributes
  extends Optional<MatchAttributes, 'id' | 'isActive'> {}

export class Match
  extends Model<MatchAttributes, MatchCreationAttributes>
  implements MatchAttributes {
  declare public id: string;
  declare public user1Id: string;
  declare public user2Id: string;
  declare public matchedBy: 'like' | 'super_like';
  declare public isActive: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

Match.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user1Id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user2Id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    matchedBy: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'like',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'matches',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['user1Id', 'user2Id'],
        name: 'unique_user1_user2_match',
      },
    ],
  }
);
