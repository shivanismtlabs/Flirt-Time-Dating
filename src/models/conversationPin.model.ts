import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ConversationPinAttributes {
  id: string;
  conversationId: string;
  userId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ConversationPinCreationAttributes
  extends Optional<ConversationPinAttributes, 'id' | 'createdAt' | 'updatedAt'> {}

export class ConversationPin
  extends Model<ConversationPinAttributes, ConversationPinCreationAttributes>
  implements ConversationPinAttributes {
  declare public id: string;
  declare public conversationId: string;
  declare public userId: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public conversation?: any;
  declare public user?: any;
}

ConversationPin.init(
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
  },
  {
    sequelize,
    tableName: 'conversation_pins',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'conversationId'],
        name: 'unique_user_conversation_pin',
      },
      {
        fields: ['conversationId'],
        name: 'idx_conversation_pins_conversation_id',
      },
    ],
  }
);
