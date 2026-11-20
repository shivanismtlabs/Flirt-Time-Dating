import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CoinTransactionAttributes {
  id: string;
  userId: string;
  type: 'purchase' | 'gift_sent' | 'gift_received' | 'admin_credit' | 'refund' | 'bonus' | 'super_like';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string | null;
  referenceType?: string | null;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CoinTransactionCreationAttributes
  extends Optional<
    CoinTransactionAttributes,
    'id' | 'referenceId' | 'referenceType' | 'createdAt' | 'updatedAt'
  > {}

export class CoinTransaction
  extends Model<CoinTransactionAttributes, CoinTransactionCreationAttributes>
  implements CoinTransactionAttributes
{
  declare public id: string;
  declare public userId: string;
  declare public type: 'purchase' | 'gift_sent' | 'gift_received' | 'admin_credit' | 'refund' | 'bonus' | 'super_like';
  declare public amount: number;
  declare public balanceBefore: number;
  declare public balanceAfter: number;
  declare public referenceId: string | null;
  declare public referenceType: string | null;
  declare public description: string;

  declare public readonly createdAt: Date;
  declare public readonly updatedAt: Date;
}

CoinTransaction.init(
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
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['purchase', 'gift_sent', 'gift_received', 'admin_credit', 'refund', 'bonus', 'super_like']],
      },
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    balanceBefore: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    balanceAfter: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    referenceId: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    referenceType: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'coin_transactions',
    timestamps: true,
    indexes: [
      {
        fields: ['userId'],
      },
      {
        fields: ['type'],
      },
      {
        fields: ['referenceId'],
      },
      {
        fields: ['createdAt'],
      },
    ],
  }
);
