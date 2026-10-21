import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ConversationUserStateAttributes {
  id: string;
  conversationId: string;
  userId: string;
  isArchived: boolean;
  archivedAt?: Date | null;
  isDeleted: boolean;
  deletedAt?: Date | null;
  clearedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ConversationUserStateCreationAttributes
  extends Optional<
    ConversationUserStateAttributes,
    'id' | 'isArchived' | 'archivedAt' | 'isDeleted' | 'deletedAt' | 'clearedAt' | 'createdAt' | 'updatedAt'
  > {}

export class ConversationUserState
  extends Model<ConversationUserStateAttributes, ConversationUserStateCreationAttributes>
  implements ConversationUserStateAttributes
{
  declare public id: string;
  declare public conversationId: string;
  declare public userId: string;
  declare public isArchived: boolean;
  declare public archivedAt: Date | null;
  declare public isDeleted: boolean;
  declare public deletedAt: Date | null;
  declare public clearedAt: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public user?: any;
}

ConversationUserState.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'conversations',
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
    isArchived: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    clearedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'conversation_user_states',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['conversationId', 'userId'],
        name: 'unique_conversation_user_state',
      },
      {
        fields: ['userId', 'isArchived'],
        name: 'idx_conversation_user_states_user_archived',
      },
      {
        fields: ['userId', 'isDeleted'],
        name: 'idx_conversation_user_states_user_deleted',
      },
    ],
  }
);
