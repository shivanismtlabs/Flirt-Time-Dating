import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface QuickMomentReactionAttributes {
  id: string;
  quickMomentId: string;
  userId: string;
  emoji: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QuickMomentReactionCreationAttributes
  extends Optional<QuickMomentReactionAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class QuickMomentReaction
  extends Model<QuickMomentReactionAttributes, QuickMomentReactionCreationAttributes>
  implements QuickMomentReactionAttributes {
  declare public id: string;
  declare public quickMomentId: string;
  declare public userId: string;
  declare public emoji: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;
  declare public quickMoment?: any;
}

QuickMomentReaction.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    quickMomentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'quick_moments',
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
    emoji: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'quick_moment_reactions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['quickMomentId', 'userId'],
        name: 'idx_qm_reactions_moment_user_unique',
      },
      {
        fields: ['quickMomentId'],
        name: 'idx_qm_reactions_moment_id',
      },
      {
        fields: ['userId'],
        name: 'idx_qm_reactions_user_id',
      },
    ],
  }
);
