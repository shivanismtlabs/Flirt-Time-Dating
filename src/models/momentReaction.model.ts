import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type MomentReactionType =
  | 'heart'
  | 'love_eyes'
  | 'fire'
  | 'laugh'
  | 'surprised'
  | 'clap';

export interface MomentReactionAttributes {
  id: string;
  momentId: string;
  userId: string;
  reaction: MomentReactionType;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentReactionCreationAttributes
  extends Optional<MomentReactionAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class MomentReaction
  extends Model<MomentReactionAttributes, MomentReactionCreationAttributes>
  implements MomentReactionAttributes {
  declare public id: string;
  declare public momentId: string;
  declare public userId: string;
  declare public reaction: MomentReactionType;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

MomentReaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    momentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'moments',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
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
    reaction: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'moment_reactions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['momentId', 'userId'],
        name: 'unique_moment_user_reaction',
      },
      {
        fields: ['momentId', 'reaction'],
        name: 'idx_moment_reaction_type',
      },
    ],
  }
);
