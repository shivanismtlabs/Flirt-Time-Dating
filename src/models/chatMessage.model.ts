import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type ChatMessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'location'
  | 'contact'
  | 'moment_reply'
  | 'moment_gift'
  | 'call';

export interface ChatMessageAttributes {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: ChatMessageType;
  metadata?: string | null;
  clientMessageId?: string | null;
  isDelivered?: boolean;
  deliveredAt?: Date | null;
  isRead: boolean;
  readAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ChatMessageCreationAttributes
  extends Optional<
    ChatMessageAttributes,
    | 'id'
    | 'messageType'
    | 'metadata'
    | 'clientMessageId'
    | 'isDelivered'
    | 'deliveredAt'
    | 'isRead'
    | 'readAt'
    | 'createdAt'
    | 'updatedAt'
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
  declare public clientMessageId: string | null;
  declare public isDelivered: boolean;
  declare public deliveredAt: Date | null;
  declare public isRead: boolean;
  declare public readAt: Date | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public sender?: any;
  declare public recipient?: any;

  /**
   * Computed canonical message status according to receipt semantics:
   * 'read' > 'delivered' > 'sent'
   */
  public get status(): 'sent' | 'delivered' | 'read' {
    if (this.isRead) return 'read';
    if (this.isDelivered) return 'delivered';
    return 'sent';
  }
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
    clientMessageId: {
      type: DataTypes.STRING(80),
      allowNull: true,
    },
    isDelivered: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
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
        fields: ['conversationId', 'senderId', 'clientMessageId'],
        name: 'idx_chat_messages_client_id',
      },
      {
        fields: ['conversationId', 'createdAt'],
        name: 'idx_chat_messages_conv_created',
      },
      {
        fields: ['recipientId', 'isRead'],
        name: 'idx_chat_messages_recipient_read',
      },
      {
        fields: ['recipientId', 'isDelivered'],
        name: 'idx_chat_messages_recipient_deliv',
      },
      {
        fields: ['conversationId', 'recipientId', 'isDelivered'],
        name: 'idx_chat_messages_conv_recipient_deliv',
      },
      {
        fields: ['conversationId', 'recipientId', 'isRead'],
        name: 'idx_chat_messages_conv_recipient_read',
      },
    ],
  }
);
