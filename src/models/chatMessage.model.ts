import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ChatMessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'location'
  | 'contact'
  | 'moment_reply'
  | 'moment_gift';

export interface ChatMessageAttributes {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: ChatMessageType;
  metadata?: string | null;
  isRead: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatMessageCreationAttributes
  extends Optional<
    ChatMessageAttributes,
    'id' | 'messageType' | 'metadata' | 'isRead' | 'createdAt' | 'updatedAt'
  > {}

export class ChatMessage
  extends Model<ChatMessageAttributes, ChatMessageCreationAttributes>
  implements ChatMessageAttributes {
  declare public id: string;
  declare public conversationId: string;
  declare public senderId: string;
  declare public recipientId: string;
  declare public content: string;
  declare public messageType: ChatMessageType;
  declare public metadata: string | null;
  declare public isRead: boolean;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public sender?: any;
  declare public recipient?: any;
}

ChatMessage.init(
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
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    recipientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    messageType: {
      type: DataTypes.STRING(20),
      defaultValue: 'text',
      allowNull: false,
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'chat_messages',
    timestamps: true,
    indexes: [
      {
        fields: ['conversationId'],
        name: 'idx_chat_messages_conversation',
      },
      {
        fields: ['recipientId', 'isRead'],
        name: 'idx_chat_messages_recipient_read',
      },
    ],
  }
);
