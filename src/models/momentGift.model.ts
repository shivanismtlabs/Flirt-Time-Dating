import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface GiftCatalogItem {
  id: string;
  code: string;
  name: string;
  coins: number;
  icon: string;
  description: string;
  displayOrder: number;
}

export const MOMENT_GIFTS_CATALOG: GiftCatalogItem[] = [
  {
    id: 'rose',
    code: 'rose',
    name: 'Rose',
    coins: 1,
    icon: '🌹',
    description: 'A classic red rose to show appreciation',
    displayOrder: 1,
  },
  {
    id: 'heart',
    code: 'heart',
    name: 'Heart',
    coins: 5,
    icon: '💖',
    description: 'A sparkling pink heart',
    displayOrder: 2,
  },
  {
    id: 'chocolate',
    code: 'chocolate',
    name: 'Chocolate',
    coins: 10,
    icon: '🍫',
    description: 'Sweet delicious chocolate',
    displayOrder: 3,
  },
  {
    id: 'teddy',
    code: 'teddy',
    name: 'Teddy',
    coins: 20,
    icon: '🧸',
    description: 'A cute cuddly teddy bear',
    displayOrder: 4,
  },
  {
    id: 'bouquet',
    code: 'bouquet',
    name: 'Bouquet',
    coins: 50,
    icon: '💐',
    description: 'A vibrant bouquet of fresh flowers',
    displayOrder: 5,
  },
  {
    id: 'ring',
    code: 'ring',
    name: 'Ring',
    coins: 100,
    icon: '💍',
    description: 'A sparkling diamond ring',
    displayOrder: 6,
  },
  {
    id: 'crown',
    code: 'crown',
    name: 'Crown',
    coins: 200,
    icon: '👑',
    description: 'A royal golden crown',
    displayOrder: 7,
  },
  {
    id: 'sports_car',
    code: 'sports_car',
    name: 'Sports car',
    coins: 500,
    icon: '🏎️',
    description: 'A luxury high-speed sports car',
    displayOrder: 8,
  },
];

export interface MomentGiftAttributes {
  id: string;
  momentId: string;
  senderId: string;
  recipientId: string;
  giftCode: string;
  giftName: string;
  icon: string;
  coins: number;
  quantity: number;
  totalCoins: number;
  message?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentGiftCreationAttributes
  extends Optional<MomentGiftAttributes, 'id' | 'quantity' | 'message' | 'createdAt' | 'updatedAt'> {}

export class MomentGift
  extends Model<MomentGiftAttributes, MomentGiftCreationAttributes>
  implements MomentGiftAttributes
{
  declare public id: string;
  declare public momentId: string;
  declare public senderId: string;
  declare public recipientId: string;
  declare public giftCode: string;
  declare public giftName: string;
  declare public icon: string;
  declare public coins: number;
  declare public quantity: number;
  declare public totalCoins: number;
  declare public message: string | null;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;

  declare public sender?: any;
  declare public recipient?: any;
  declare public moment?: any;
}

MomentGift.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    momentId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'moments',
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
    giftCode: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    giftName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    icon: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      allowNull: false,
    },
    totalCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'moment_gifts',
    indexes: [
      {
        fields: ['momentId'],
      },
      {
        fields: ['senderId'],
      },
      {
        fields: ['recipientId'],
      },
      {
        fields: ['giftCode'],
      },
    ],
  }
);
