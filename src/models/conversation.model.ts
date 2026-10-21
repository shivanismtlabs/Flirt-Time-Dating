import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface ConversationAttributes {
  id: string;
  user1Id: string;
  user2Id: string;
  lastMessage?: string | null;
  lastMessageAt?: Date | null;
  isDeletedForEveryone?: boolean;
  deletedForEveryoneAt?: Date | null;
  deletedForEveryoneBy?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ConversationCreationAttributes
  extends Optional<
    ConversationAttributes,
    | 'id'
    | 'lastMessage'
    | 'lastMessageAt'
    | 'isDeletedForEveryone'
    | 'deletedForEveryoneAt'
    | 'deletedForEveryoneBy'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class Conversation
  extends Model<ConversationAttributes, ConversationCreationAttributes>
  implements ConversationAttributes {
  declare public id: string;
  declare public user1Id: string;
  declare public user2Id: string;
  declare public lastMessage: string | null;
  declare public lastMessageAt: Date | null;
  declare public isDeletedForEveryone: boolean;
  declare public deletedForEveryoneAt: Date | null;
  declare public deletedForEveryoneBy: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public messages?: any[];
  declare public user1?: any;
  declare public user2?: any;
  declare public userStates?: any[];
}

Conversation.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user1Id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    user2Id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    lastMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isDeletedForEveryone: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    deletedForEveryoneAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deletedForEveryoneBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
  },
  {
    sequelize,
    tableName: 'conversations',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['user1Id', 'user2Id'],
        name: 'unique_user1_user2_conversation',
      },
    ],
  }
);
