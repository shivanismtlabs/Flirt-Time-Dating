import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ChatMessageReactionAttributes {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatMessageReactionCreationAttributes
  extends Optional<ChatMessageReactionAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class ChatMessageReaction
  extends Model<ChatMessageReactionAttributes, ChatMessageReactionCreationAttributes>
  implements ChatMessageReactionAttributes
{
  declare public id: string;
  declare public conversationId: string;
  declare public messageId: string;
  declare public userId: string;
  declare public emoji: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public message?: any;
  declare public user?: any;
}

ChatMessageReaction.init(
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
    messageId: {
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
    emoji: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'chat_message_reactions',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['messageId', 'userId'],
        name: 'unique_message_user_reaction',
      },
      {
        fields: ['conversationId'],
        name: 'idx_chat_message_reactions_conv_id',
      },
      {
        fields: ['messageId'],
        name: 'idx_chat_message_reactions_message_id',
      },
      {
        fields: ['userId'],
        name: 'idx_chat_message_reactions_user_id',
      },
    ],
  }
);
