import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface SubscriptionFeatureAttributes {
  id: number;
  text: string;
  image: string;
  sort_order: number;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export interface SubscriptionFeatureCreationAttributes
  extends Optional<
    SubscriptionFeatureAttributes,
    'id' | 'sort_order' | 'is_active' | 'created_at' | 'updated_at'
  > {}

export class SubscriptionFeature
  extends Model<SubscriptionFeatureAttributes, SubscriptionFeatureCreationAttributes>
  implements SubscriptionFeatureAttributes
{
  declare public id: number;
  declare public text: string;
  declare public image: string;
  declare public sort_order: number;
  declare public is_active: boolean;

  declare public readonly created_at: Date;
  declare public readonly updated_at: Date;

  public get sortOrder(): number {
    return this.sort_order;
  }
  public get isActive(): boolean {
    return this.is_active;
  }
}

SubscriptionFeature.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    text: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    image: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: 'subscription_features',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['is_active'],
      },
      {
        fields: ['sort_order'],
      },
    ],
  }
);
