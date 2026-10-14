import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { SubscriptionFeature } from './subscriptionFeature.model';
import { PlanFeature } from './planFeature.model';

export interface SubscriptionPlanAttributes {
  id: number;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  duration_days: number;
  billing_cycle: string;
  trial_period: number | null;
  is_recurring: boolean;
  bonus_coins: number;
  google_product_id?: string | null;
  apple_product_id?: string | null;
  icon?: string | null;
  is_active: boolean;
  sort_order: number;
  deleted_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface SubscriptionPlanCreationAttributes
  extends Optional<
    SubscriptionPlanAttributes,
    | 'id'
    | 'description'
    | 'currency'
    | 'billing_cycle'
    | 'trial_period'
    | 'is_recurring'
    | 'bonus_coins'
    | 'google_product_id'
    | 'apple_product_id'
    | 'icon'
    | 'is_active'
    | 'sort_order'
    | 'deleted_at'
    | 'created_at'
    | 'updated_at'
  > {}

export class SubscriptionPlan
  extends Model<SubscriptionPlanAttributes, SubscriptionPlanCreationAttributes>
  implements SubscriptionPlanAttributes
{
  declare public id: number;
  declare public name: string;
  declare public description: string | null;
  declare public price: string | number;
  declare public currency: string;
  declare public duration_days: number;
  declare public billing_cycle: string;
  declare public trial_period: number | null;
  declare public is_recurring: boolean;
  declare public bonus_coins: number;
  declare public google_product_id: string | null;
  declare public apple_product_id: string | null;
  declare public icon: string | null;
  declare public is_active: boolean;
  declare public sort_order: number;
  declare public deleted_at: Date | null;

  declare public readonly created_at: Date;
  declare public readonly updated_at: Date;

  declare public features?: SubscriptionFeature[];
  declare public planFeatures?: PlanFeature[];

  // Aliases for camelCase consumption if required
  public get durationDays(): number {
    return this.duration_days;
  }
  public get billingCycle(): string {
    return this.billing_cycle;
  }
  public get trialPeriod(): number | null {
    return this.trial_period;
  }
  public get isRecurring(): boolean {
    return this.is_recurring;
  }
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

SubscriptionPlan.init(
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
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
      defaultValue: 'USD',
    },
    duration_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
      },
    },
    billing_cycle: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'monthly',
    },
    trial_period: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    is_recurring: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
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
    icon: {
      type: DataTypes.STRING(500),
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
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'subscription_plans',
    timestamps: true,
    paranoid: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
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
        fields: ['google_product_id'],
      },
      {
        fields: ['apple_product_id'],
      },
    ],
  }
);
