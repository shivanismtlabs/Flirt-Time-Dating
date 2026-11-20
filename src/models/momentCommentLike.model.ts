import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface MomentCommentLikeAttributes {
  id: string;
  commentId: string;
  userId: string;
  reaction?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentCommentLikeCreationAttributes
  extends Optional<MomentCommentLikeAttributes, 'id' | 'reaction' | 'createdAt' | 'updatedAt'> {}

export class MomentCommentLike
  extends Model<MomentCommentLikeAttributes, MomentCommentLikeCreationAttributes>
  implements MomentCommentLikeAttributes {
  declare public id: string;
  declare public commentId: string;
  declare public userId: string;
  declare public reaction: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public user?: any;
  declare public comment?: any;
}

MomentCommentLike.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'chat_messages',
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
      defaultValue: 'like',
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'moment_comment_likes',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['commentId', 'userId'],
        name: 'unique_moment_comment_user_like',
      },
      {
        fields: ['commentId'],
        name: 'idx_moment_comment_likes_comment_id',
      },
      {
        fields: ['userId'],
        name: 'idx_moment_comment_likes_user_id',
      },
    ],
  }
);
