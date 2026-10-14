import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../config/database';
import { SubscriptionPlan } from './subscriptionPlan.model';
import { SubscriptionFeature } from './subscriptionFeature.model';

export interface PlanFeatureAttributes {
  id: number;
  subscription_plan_id: number;
  subscription_feature_id: number;
  sort_order: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface PlanFeatureCreationAttributes
  extends Optional<PlanFeatureAttributes, 'id' | 'sort_order' | 'created_at' | 'updated_at'> {}

export class PlanFeature
  extends Model<PlanFeatureAttributes, PlanFeatureCreationAttributes>
  implements PlanFeatureAttributes
{
  declare public id: number;
  declare public subscription_plan_id: number;
  declare public subscription_feature_id: number;
  declare public sort_order: number;

  declare public readonly created_at: Date;
  declare public readonly updated_at: Date;

  declare public plan?: SubscriptionPlan;
  declare public feature?: SubscriptionFeature;

  public get subscriptionPlanId(): number {
    return this.subscription_plan_id;
  }
  public get subscriptionFeatureId(): number {
    return this.subscription_feature_id;
  }
  public get sortOrder(): number {
    return this.sort_order;
  }
}

PlanFeature.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    subscription_plan_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'subscription_plans',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    subscription_feature_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'subscription_features',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  },
  {
    sequelize,
    tableName: 'plan_features',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['subscription_plan_id', 'subscription_feature_id'],
      },
      {
        fields: ['sort_order'],
      },
    ],
  }
);
