import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { SubscriptionFeature } from '../models/subscriptionFeature.model';
import { PlanFeature } from '../models/planFeature.model';

export interface VerifiedFeatureDefinition {
  id: number;
  text: string;
  image: string;
  sort_order: number;
}

export interface VerifiedPlanDefinition {
  id: number;
  name: string;
  price: string;
  currency: string;
  duration_days: number;
  is_active: boolean;
  description: string;
  bonus_coins: number;
  is_recurring: boolean;
  billing_cycle: string;
  trial_period: number | null;
  google_product_id: string;
  apple_product_id: string;
  sort_order: number;
  icon?: string | null;
  featureIds: number[];
}

/**
 * The 6 features retrieved and verified from the live FlirtTime production Laravel API
 */
export const VERIFIED_SUBSCRIPTION_FEATURES: VerifiedFeatureDefinition[] = [
  {
    id: 1,
    text: 'Unlimited messages',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f4b654c79.png',
    sort_order: 0,
  },
  {
    id: 2,
    text: 'Full profile visibility',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f4c4891cb.png',
    sort_order: 0,
  },
  {
    id: 5,
    text: 'See who liked you',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f51bafac3.png',
    sort_order: 0,
  },
  {
    id: 6,
    text: 'See who favorite you',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f5292ad68.png',
    sort_order: 0,
  },
  {
    id: 8,
    text: 'VIP badge',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f53d5ff72.png',
    sort_order: 0,
  },
  {
    id: 9,
    text: '24/7 priority support',
    image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/68d3f53541e0b.png',
    sort_order: 0,
  },
];

/**
 * The active subscription plans verified from the live FlirtTime production Laravel API.
 * Currently, only 2 active plans exist in the verified live data source.
 * Additional plans (e.g. Plan 3 and Plan 4) must be confirmed by the stakeholder before production seeding.
 */
export const VERIFIED_SUBSCRIPTION_PLANS: VerifiedPlanDefinition[] = [
  {
    id: 1,
    name: 'One Week + 50 Coins',
    price: '4.99',
    currency: 'USD',
    duration_days: 7,
    is_active: true,
    description: 'Access basic features for 1 week',
    bonus_coins: 50,
    is_recurring: true,
    billing_cycle: 'monthly',
    trial_period: null,
    google_product_id: 'one_week_subscription',
    apple_product_id: 'com.flirttime.weekly',
    sort_order: 1,
    icon: null,
    featureIds: [1, 2, 5, 6, 8, 9],
  },
  {
    id: 2,
    name: 'One Month + 200 Coin',
    price: '9.99',
    currency: 'USD',
    duration_days: 30,
    is_active: true,
    description: 'Access basic features for 1 month',
    bonus_coins: 100,
    is_recurring: true,
    billing_cycle: 'monthly',
    trial_period: null,
    google_product_id: 'one_month_subscription_plan',
    apple_product_id: 'com.flirttime.monthly',
    sort_order: 2,
    icon: null,
    featureIds: [1, 2, 5, 6, 8, 9],
  },
];

/**
 * Idempotently seeds verified subscription features, plans, and feature linkages
 */
export const seedSubscriptions = async (forceOverwrite = false): Promise<{
  featuresCreated: number;
  featuresUpdated: number;
  plansCreated: number;
  plansUpdated: number;
}> => {
  let featuresCreated = 0;
  let featuresUpdated = 0;
  let plansCreated = 0;
  let plansUpdated = 0;

  // 1. Seed Features
  for (const item of VERIFIED_SUBSCRIPTION_FEATURES) {
    const existing = await SubscriptionFeature.findByPk(item.id);
    if (!existing) {
      await SubscriptionFeature.create({
        id: item.id,
        text: item.text,
        image: item.image,
        sort_order: item.sort_order,
        is_active: true,
      });
      featuresCreated++;
    } else if (forceOverwrite) {
      await existing.update({
        text: item.text,
        image: item.image,
        sort_order: item.sort_order,
        is_active: true,
      });
      featuresUpdated++;
    }
  }

  // 2. Seed Plans
  for (const item of VERIFIED_SUBSCRIPTION_PLANS) {
    const existing = await SubscriptionPlan.findByPk(item.id);
    if (!existing) {
      const plan = await SubscriptionPlan.create({
        id: item.id,
        name: item.name,
        price: item.price,
        currency: item.currency,
        duration_days: item.duration_days,
        is_active: item.is_active,
        description: item.description,
        bonus_coins: item.bonus_coins,
        is_recurring: item.is_recurring,
        billing_cycle: item.billing_cycle,
        trial_period: item.trial_period,
        google_product_id: item.google_product_id,
        apple_product_id: item.apple_product_id,
        sort_order: item.sort_order,
        icon: item.icon,
      });
      plansCreated++;

      // Link features
      for (const featId of item.featureIds) {
        await PlanFeature.findOrCreate({
          where: {
            subscription_plan_id: plan.id,
            subscription_feature_id: featId,
          },
          defaults: {
            subscription_plan_id: plan.id,
            subscription_feature_id: featId,
            sort_order: 0,
          },
        });
      }
    } else {
      if (forceOverwrite) {
        await existing.update({
          name: item.name,
          price: item.price,
          currency: item.currency,
          duration_days: item.duration_days,
          is_active: item.is_active,
          description: item.description,
          bonus_coins: item.bonus_coins,
          is_recurring: item.is_recurring,
          billing_cycle: item.billing_cycle,
          trial_period: item.trial_period,
          google_product_id: item.google_product_id,
          apple_product_id: item.apple_product_id,
          sort_order: item.sort_order,
          icon: item.icon,
        });
        plansUpdated++;
      }

      // Ensure junction associations exist
      for (const featId of item.featureIds) {
        await PlanFeature.findOrCreate({
          where: {
            subscription_plan_id: existing.id,
            subscription_feature_id: featId,
          },
          defaults: {
            subscription_plan_id: existing.id,
            subscription_feature_id: featId,
            sort_order: 0,
          },
        });
      }
    }
  }

  return {
    featuresCreated,
    featuresUpdated,
    plansCreated,
    plansUpdated,
  };
};
