import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ChatMessagePinAttributes {
  id: string;
  conversationId: string;
  messageId: string;
  userId: string;
  pinnedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatMessagePinCreationAttributes
  extends Optional<ChatMessagePinAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class ChatMessagePin
  extends Model<ChatMessagePinAttributes, ChatMessagePinCreationAttributes>
  implements ChatMessagePinAttributes
{
  declare public id: string;
  declare public conversationId: string;
  declare public messageId: string;
  declare public userId: string;
  declare public pinnedBy: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public message?: any;
  declare public user?: any;
  declare public pinner?: any;
}

ChatMessagePin.init(
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
    pinnedBy: {
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
    tableName: 'chat_message_pins',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'conversationId', 'messageId'],
        name: 'unique_user_conv_message_pin',
      },
      {
        fields: ['conversationId'],
        name: 'idx_chat_message_pins_conversation_id',
      },
      {
        fields: ['messageId'],
        name: 'idx_chat_message_pins_message_id',
      },
      {
        fields: ['userId'],
        name: 'idx_chat_message_pins_user_id',
      },
    ],
  }
);
