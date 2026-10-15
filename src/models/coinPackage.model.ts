import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CoinPackageAttributes {
  id: number;
  name: string;
  price: string | number;
  currency: string;
  coins: number;
  bonus_coins: number;
  google_product_id?: string | null;
  apple_product_id?: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface CoinPackageCreationAttributes
  extends Optional<
    CoinPackageAttributes,
    | 'id'
    | 'currency'
    | 'bonus_coins'
    | 'google_product_id'
    | 'apple_product_id'
    | 'is_active'
    | 'sort_order'
    | 'created_at'
    | 'updated_at'
  > {}

export class CoinPackage
  extends Model<CoinPackageAttributes, CoinPackageCreationAttributes>
  implements CoinPackageAttributes
{
  declare public id: number;
  declare public name: string;
  declare public price: string | number;
  declare public currency: string;
  declare public coins: number;
  declare public bonus_coins: number;
  declare public google_product_id: string | null;
  declare public apple_product_id: string | null;
  declare public is_active: boolean;
  declare public sort_order: number;

  declare public readonly created_at: Date;
  declare public readonly updated_at: Date;

  // Aliases for camelCase consumption if required
  public get bonusCoins(): number {
    return this.bonus_coins;
  }
  public get googleProductId(): string | null {
    return this.google_product_id;
  }
  public get appleProductId(): string | null {
    return this.apple_product_id;
  }
  public get isActive(): boolean {
    return this.is_active;
  }
  public get sortOrder(): number {
    return this.sort_order;
  }
}

CoinPackage.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
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
    coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 0,
      },
    },
    bonus_coins: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: {
        min: 0,
      },
    },
    google_product_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    apple_product_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'coin_packages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['is_active'],
      },
      {
        fields: ['is_active', 'sort_order', 'id'],
      },
      {
        fields: ['price'],
      },
      {
        fields: ['coins'],
      },
    ],
  }
);
