import { z } from 'zod';

export const getSubscriptionsQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export type GetSubscriptionsQuery = z.infer<typeof getSubscriptionsQuerySchema>;

export interface SubscriptionFeatureDTO {
  id: number;
  text: string;
  image: string;
  sort_order: number;
}

export interface SubscriptionPlanDTO {
  id: number;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  duration_days: number;
  billing_cycle: string;
  trial_period: number | null;
  is_recurring: boolean;
  bonus_coins: number;
  discount: string | null;
  discount_percentage?: number;
  is_popular: boolean;
  popular_plan: boolean;
  is_popular_plan: boolean;
  isPopular?: boolean;
  google_product_id: string | null;
  apple_product_id: string | null;
  icon: string | null;
  icon_url: string;
  is_active: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  features: SubscriptionFeatureDTO[];
}

export interface SubscriptionsApiResponse {
  status: boolean;
  img_base_url: string;
  message: string;
  data: SubscriptionPlanDTO[];
}
