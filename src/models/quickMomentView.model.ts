import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface QuickMomentViewAttributes {
  id: string;
  quickMomentId: string;
  userId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface QuickMomentViewCreationAttributes
  extends Optional<QuickMomentViewAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class QuickMomentView
  extends Model<QuickMomentViewAttributes, QuickMomentViewCreationAttributes>
  implements QuickMomentViewAttributes {
  declare public id: string;
  declare public quickMomentId: string;
  declare public userId: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public viewer?: any;
  declare public quickMoment?: any;
}

QuickMomentView.init(
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
  },
  {
    sequelize,
    tableName: 'quick_moment_views',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['quickMomentId', 'userId'],
        name: 'idx_qm_views_moment_user_unique',
      },
      {
        fields: ['quickMomentId'],
        name: 'idx_qm_views_moment_id',
      },
      {
        fields: ['userId'],
        name: 'idx_qm_views_user_id',
      },
    ],
  }
);
