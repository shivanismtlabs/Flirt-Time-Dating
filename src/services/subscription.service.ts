import { env } from '../config/env';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { SubscriptionFeature } from '../models/subscriptionFeature.model';
import { PlanFeature } from '../models/planFeature.model';
import {
  SubscriptionFeatureDTO,
  SubscriptionPlanDTO,
  SubscriptionsApiResponse,
} from '../schemas/subscription.schema';

export class SubscriptionServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'SubscriptionServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, SubscriptionServiceError.prototype);
  }
}

export class SubscriptionService {
  /**
   * Retrieves configured media base URL for S3 assets
   */
  public getMediaBaseUrl(): string {
    if (process.env.AWS_URL && process.env.AWS_URL.trim() !== '') {
      return process.env.AWS_URL.trim().replace(/\/+$/, '');
    }
    const bucket = env.AWS_S3_BUCKET || 'flirttime';
    const region = env.AWS_REGION || 'ap-south-1';
    return `https://${bucket}.s3.${region}.amazonaws.com`;
  }

  /**
   * Resolves subscription icon URL with fallback to standard default icon
   */
  public resolveIconUrl(icon?: string | null): string {
    const defaultIconUrl = 'https://flirttime.in/assets/src/images/default-icon.png';
    if (!icon || icon.trim() === '') {
      return defaultIconUrl;
    }
    const trimmed = icon.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const mediaBase = this.getMediaBaseUrl();
    const cleanKey = trimmed.replace(/^\/+/, '');
    return `${mediaBase}/${cleanKey}`;
  }

  /**
   * Resolves feature image URL
   */
  public resolveFeatureImageUrl(image?: string | null): string {
    if (!image || image.trim() === '') {
      return '';
    }
    const trimmed = image.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const mediaBase = this.getMediaBaseUrl();
    const cleanKey = trimmed.replace(/^\/+/, '');
    return `${mediaBase}/${cleanKey}`;
  }

  /**
   * Formats a raw SubscriptionFeature instance into a public DTO
   */
  public formatFeature(feature: any): SubscriptionFeatureDTO {
    const rawSort =
      feature.PlanFeature?.sort_order ??
      feature.plan_feature?.sort_order ??
      feature.sort_order ??
      0;

    return {
      id: Number(feature.id),
      text: String(feature.text || ''),
      image: this.resolveFeatureImageUrl(feature.image),
      sort_order: Number(rawSort),
    };
  }

  /**
   * Formats a raw SubscriptionPlan instance into the exact Laravel response DTO
   */
  public formatPlan(plan: SubscriptionPlan): SubscriptionPlanDTO {
    const rawPrice = plan.getDataValue('price');
    let formattedPrice: string;
    if (typeof rawPrice === 'number') {
      formattedPrice = rawPrice.toFixed(2);
    } else if (typeof rawPrice === 'string' && !isNaN(parseFloat(rawPrice))) {
      formattedPrice = parseFloat(rawPrice).toFixed(2);
    } else {
      formattedPrice = String(rawPrice || '0.00');
    }

    // Format and sort nested features
    const rawFeatures = (plan.features as any[]) || [];
    const formattedFeatures = rawFeatures
      .map((f) => this.formatFeature(f))
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return a.id - b.id;
      });

    const rawDiscount = plan.getDataValue('discount');
    const discount = rawDiscount !== undefined && rawDiscount !== null ? String(rawDiscount) : null;
    const isPopular = Boolean(
      plan.getDataValue('is_popular_plan') ||
      (plan as any).is_popular ||
      (plan as any).popular_plan
    );

    let discountPercentage = 0;
    if (discount) {
      const parsed = parseInt(discount.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsed)) {
        discountPercentage = parsed;
      }
    }

    return {
      id: Number(plan.id),
      name: String(plan.name || ''),
      price: formattedPrice,
      currency: String(plan.currency || 'USD'),
      duration_days: Number(plan.duration_days),
      is_active: Boolean(plan.is_active),
      description: plan.description !== undefined && plan.description !== null ? String(plan.description) : null,
      bonus_coins: Number(plan.bonus_coins || 0),
      discount,
      discount_percentage: discountPercentage,
      is_popular: isPopular,
      popular_plan: isPopular,
      is_popular_plan: isPopular,
      isPopular: isPopular,
      is_recurring: Boolean(plan.is_recurring),
      billing_cycle: String(plan.billing_cycle || 'monthly'),
      trial_period: plan.trial_period !== null && plan.trial_period !== undefined ? Number(plan.trial_period) : null,
      features: formattedFeatures,
      google_product_id: plan.google_product_id ? String(plan.google_product_id) : null,
      apple_product_id: plan.apple_product_id ? String(plan.apple_product_id) : null,
      icon: plan.icon ? String(plan.icon) : null,
      sort_order: Number(plan.sort_order || 0),
      created_at: plan.created_at ? new Date(plan.created_at).toISOString() : new Date().toISOString(),
      updated_at: plan.updated_at ? new Date(plan.updated_at).toISOString() : new Date().toISOString(),
      deleted_at: plan.deleted_at ? new Date(plan.deleted_at).toISOString() : null,
      icon_url: this.resolveIconUrl(plan.icon),
    };
  }

  /**
   * Retrieves subscription plans matching active status and ordered by sort_order ASC, id ASC
   */
  public async getSubscriptions(options: { includeInactive?: boolean } = {}): Promise<SubscriptionsApiResponse> {
    const whereClause: any = {};
    if (!options.includeInactive) {
      whereClause.is_active = true;
    }

    const plans = await SubscriptionPlan.findAll({
      where: whereClause,
      include: [
        {
          model: SubscriptionFeature,
          as: 'features',
          through: {
            attributes: ['sort_order'],
          },
          required: false,
        },
      ],
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC'],
      ],
    });

    const formattedData = plans.map((plan) => this.formatPlan(plan));

    return {
      status: true,
      message: 'Subscriptions retrieved successfully',
      data: formattedData,
      img_base_url: this.getMediaBaseUrl(),
    };
  }
}

export const subscriptionService = new SubscriptionService();
