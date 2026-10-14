import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CoinPurchaseAttributes {
  id: string;
  userId: string;
  packageId?: number | null;
  platform: 'ios' | 'android';
  productId: string;
  storeTransactionId: string;
  purchaseToken?: string | null;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  price: string | number;
  currency: string;
  status: 'completed' | 'pending' | 'failed' | 'refunded' | 'revoked';
  environment: 'production' | 'sandbox';
  rawVerificationData?: any;
  acknowledged: boolean;
  acknowledgedAt?: Date | null;
  verifiedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CoinPurchaseCreationAttributes
  extends Optional<
    CoinPurchaseAttributes,
    | 'id'
    | 'packageId'
    | 'purchaseToken'
    | 'bonusCoins'
    | 'status'
    | 'environment'
    | 'rawVerificationData'
    | 'acknowledged'
    | 'acknowledgedAt'
    | 'createdAt'
    | 'updatedAt'
  > {}

export class CoinPurchase
  extends Model<CoinPurchaseAttributes, CoinPurchaseCreationAttributes>
  implements CoinPurchaseAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public packageId: number | null;
  declare public platform: 'ios' | 'android';
  declare public productId: string;
  declare public storeTransactionId: string;
  declare public purchaseToken: string | null;
  declare public coins: number;
  declare public bonusCoins: number;
  declare public totalCoins: number;
  declare public price: string | number;
  declare public currency: string;
  declare public status: 'completed' | 'pending' | 'failed' | 'refunded' | 'revoked';
  declare public environment: 'production' | 'sandbox';
  declare public rawVerificationData: any;
  declare public acknowledged: boolean;
  declare public acknowledgedAt: Date | null;
  declare public verifiedAt: Date;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

CoinPurchase.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    packageId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'coin_packages',
        key: 'id',
      },
      onDelete: 'SET NULL',
    },
    platform: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['ios', 'android']],
      },
    },
    productId: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    storeTransactionId: {
      type: DataTypes.STRING(500),
      allowNull: false,
      unique: true,
    },
    purchaseToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    bonusCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    totalCoins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      get() {
        const val = this.getDataValue('price');
        if (val === null || val === undefined) return '0.00';
        return typeof val === 'number' ? val.toFixed(2) : String(val);
      },
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'INR',
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'completed',
      validate: {
        isIn: [['completed', 'pending', 'failed', 'refunded', 'revoked']],
      },
    },
    environment: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'production',
    },
    rawVerificationData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    acknowledged: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    acknowledgedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    verifiedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'coin_purchases',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['storeTransactionId'],
      },
      {
        fields: ['userId'],
      },
      {
        fields: ['platform'],
      },
      {
        fields: ['productId'],
      },
      {
        fields: ['status'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);
