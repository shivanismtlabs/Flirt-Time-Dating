import request from 'supertest';
import app from '../src/app';
import {
  initDb,
  SubscriptionPlan,
  SubscriptionFeature,
  PlanFeature,
  User,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { seedSubscriptions } from '../src/services/seedSubscription.service';

describe('Production-Ready Subscriptions API (GET /api/v1/subscriptions)', () => {
  let testUser: User;
  let testToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  beforeEach(async () => {
    // Clear all tables before each test
    await PlanFeature.destroy({ where: {}, force: true });
    await SubscriptionPlan.destroy({ where: {}, force: true });
    await SubscriptionFeature.destroy({ where: {}, force: true });
    await User.destroy({ where: {}, force: true });

    testUser = await User.create({
      username: 'sub_tester',
      email: 'sub_tester@flirttime.app',
      isActive: true,
      role: 'user',
    });

    testToken = generateToken({
      id: testUser.id,
      email: testUser.email!,
      role: testUser.role,
    });
  });

  describe('1. Successful Retrieval and Laravel Envelope Compatibility', () => {
    it('should return matching status, img_base_url, message and data array structure', async () => {
      await seedSubscriptions(true);

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.message).toBe('Subscriptions retrieved successfully');
      expect(typeof res.body.img_base_url).toBe('string');
      expect(res.body.img_base_url).toContain('https://');
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('should also respond at /api/subscriptions for dual-path compatibility', async () => {
      await seedSubscriptions(true);

      const res = await request(app).get('/api/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data.length).toBe(2);
    });

    it('should return all required plan fields with compatible data types', async () => {
      await seedSubscriptions(true);

      const res = await request(app).get('/api/v1/subscriptions');

      const plan1 = res.body.data[0];
      expect(plan1).toHaveProperty('id', 1);
      expect(plan1).toHaveProperty('name', 'One Week + 50 Coins');
      expect(plan1).toHaveProperty('price', '4.99');
      expect(plan1).toHaveProperty('currency', 'USD');
      expect(plan1).toHaveProperty('duration_days', 7);
      expect(plan1).toHaveProperty('is_active', true);
      expect(plan1).toHaveProperty('description', 'Access basic features for 1 week');
      expect(plan1).toHaveProperty('bonus_coins', 50);
      expect(plan1).toHaveProperty('is_recurring', true);
      expect(plan1).toHaveProperty('billing_cycle', 'monthly');
      expect(plan1).toHaveProperty('trial_period', null);
      expect(plan1).toHaveProperty('google_product_id', 'one_week_subscription');
      expect(plan1).toHaveProperty('apple_product_id', 'com.flirttime.weekly');
      expect(plan1).toHaveProperty('icon', null);
      expect(plan1).toHaveProperty('icon_url', 'https://flirttime.in/assets/src/images/default-icon.png');
      expect(plan1).toHaveProperty('sort_order', 1);
      expect(plan1).toHaveProperty('deleted_at', null);
      expect(typeof plan1.created_at).toBe('string');
      expect(typeof plan1.updated_at).toBe('string');
      expect(Array.isArray(plan1.features)).toBe(true);
      expect(plan1.features.length).toBe(6);
    });
  });

  describe('2. Four Configured Active Plans Verification', () => {
    it('should return exactly four plans when all four intended plans are active and configured', async () => {
      // Seed initial 2 verified plans
      await seedSubscriptions(true);

      // Add the remaining 2 configured plans
      const plan3 = await SubscriptionPlan.create({
        id: 3,
        name: 'Three Months + 600 Coins',
        price: '24.99',
        currency: 'USD',
        duration_days: 90,
        is_active: true,
        description: 'Access premium features for 3 months',
        bonus_coins: 600,
        is_recurring: true,
        billing_cycle: 'quarterly',
        trial_period: null,
        google_product_id: 'three_months_subscription',
        apple_product_id: 'com.flirttime.quarterly',
        sort_order: 3,
      });

      const plan4 = await SubscriptionPlan.create({
        id: 4,
        name: 'One Year VIP + 2500 Coins',
        price: '79.99',
        currency: 'USD',
        duration_days: 365,
        is_active: true,
        description: 'Access all VIP features for 1 full year',
        bonus_coins: 2500,
        is_recurring: true,
        billing_cycle: 'annual',
        trial_period: null,
        google_product_id: 'one_year_subscription',
        apple_product_id: 'com.flirttime.yearly',
        sort_order: 4,
      });

      // Link features to plan 3 and plan 4
      for (const featId of [1, 2, 5, 6, 8, 9]) {
        await PlanFeature.create({
          subscription_plan_id: plan3.id,
          subscription_feature_id: featId,
          sort_order: 0,
        });
        await PlanFeature.create({
          subscription_plan_id: plan4.id,
          subscription_feature_id: featId,
          sort_order: 0,
        });
      }

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(4);
      expect(res.body.data.map((p: any) => p.id)).toEqual([1, 2, 3, 4]);
      expect(res.body.data.map((p: any) => p.name)).toEqual([
        'One Week + 50 Coins',
        'One Month + 200 Coin',
        'Three Months + 600 Coins',
        'One Year VIP + 2500 Coins',
      ]);
    });
  });

  describe('3. Plan and Feature Sorting & Ordering Integrity', () => {
    it('should sort plans strictly by sort_order ASC with stable id ASC tie-breaker', async () => {
      await SubscriptionPlan.bulkCreate([
        {
          id: 10,
          name: 'Plan High Order',
          price: '50.00',
          currency: 'USD',
          duration_days: 30,
          is_active: true,
          sort_order: 5,
        },
        {
          id: 20,
          name: 'Plan Tie A',
          price: '20.00',
          currency: 'USD',
          duration_days: 30,
          is_active: true,
          sort_order: 2,
        },
        {
          id: 15,
          name: 'Plan Tie B',
          price: '20.00',
          currency: 'USD',
          duration_days: 30,
          is_active: true,
          sort_order: 2,
        },
        {
          id: 5,
          name: 'Plan Low Order',
          price: '10.00',
          currency: 'USD',
          duration_days: 7,
          is_active: true,
          sort_order: 1,
        },
      ]);

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      const planIds = res.body.data.map((p: any) => p.id);
      // Expected order: sort_order 1 (id 5), sort_order 2 tie broken by id (id 15 then 20), sort_order 5 (id 10)
      expect(planIds).toEqual([5, 15, 20, 10]);
    });

    it('should sort nested features by sort_order ASC with id ASC tie-breaker', async () => {
      const plan = await SubscriptionPlan.create({
        id: 1,
        name: 'Single Plan',
        price: '9.99',
        currency: 'USD',
        duration_days: 30,
        is_active: true,
        sort_order: 1,
      });

      const f1 = await SubscriptionFeature.create({
        id: 10,
        text: 'Feature C',
        image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/c.png',
        sort_order: 2,
      });
      const f2 = await SubscriptionFeature.create({
        id: 5,
        text: 'Feature A',
        image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/a.png',
        sort_order: 0,
      });
      const f3 = await SubscriptionFeature.create({
        id: 8,
        text: 'Feature B',
        image: 'https://flirttime.s3.ap-south-1.amazonaws.com/icons/b.png',
        sort_order: 1,
      });

      await PlanFeature.bulkCreate([
        { subscription_plan_id: plan.id, subscription_feature_id: f1.id, sort_order: 2 },
        { subscription_plan_id: plan.id, subscription_feature_id: f2.id, sort_order: 0 },
        { subscription_plan_id: plan.id, subscription_feature_id: f3.id, sort_order: 1 },
      ]);

      const res = await request(app).get('/api/v1/subscriptions');

      const returnedFeatures = res.body.data[0].features;
      expect(returnedFeatures.map((f: any) => f.id)).toEqual([5, 8, 10]);
      expect(returnedFeatures.map((f: any) => f.text)).toEqual(['Feature A', 'Feature B', 'Feature C']);
    });
  });

  describe('4. Image & Icon URL Resolution and Fallbacks', () => {
    it('should fallback to default icon when icon is null or empty', async () => {
      await SubscriptionPlan.create({
        id: 1,
        name: 'Plan Null Icon',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        icon: null,
        sort_order: 1,
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].icon_url).toBe('https://flirttime.in/assets/src/images/default-icon.png');
    });

    it('should prefix relative S3 key with img_base_url for icons and features', async () => {
      const plan = await SubscriptionPlan.create({
        id: 1,
        name: 'Plan Relative Icon',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        icon: 'icons/custom_badge.png',
        sort_order: 1,
      });

      const feat = await SubscriptionFeature.create({
        id: 1,
        text: 'Feature Relative Image',
        image: 'icons/feature_icon.png',
        sort_order: 1,
      });

      await PlanFeature.create({
        subscription_plan_id: plan.id,
        subscription_feature_id: feat.id,
        sort_order: 1,
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].icon_url).toBe(`${res.body.img_base_url}/icons/custom_badge.png`);
      expect(res.body.data[0].features[0].image).toBe(`${res.body.img_base_url}/icons/feature_icon.png`);
    });

    it('should preserve full HTTPS URLs without double-prefixing', async () => {
      const plan = await SubscriptionPlan.create({
        id: 1,
        name: 'Plan HTTPS Icon',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        icon: 'https://cdn.example.com/badge.png',
        sort_order: 1,
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].icon_url).toBe('https://cdn.example.com/badge.png');
    });
  });

  describe('5. Inactive and Soft-Deleted Plans Exclusion', () => {
    it('should exclude plans where is_active is false', async () => {
      await SubscriptionPlan.bulkCreate([
        {
          id: 1,
          name: 'Active Plan',
          price: '4.99',
          currency: 'USD',
          duration_days: 7,
          is_active: true,
          sort_order: 1,
        },
        {
          id: 2,
          name: 'Inactive Plan',
          price: '9.99',
          currency: 'USD',
          duration_days: 30,
          is_active: false,
          sort_order: 2,
        },
      ]);

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(1);
    });

    it('should exclude soft-deleted plans (paranoid mode)', async () => {
      const plan1 = await SubscriptionPlan.create({
        id: 1,
        name: 'Preserved Plan',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        sort_order: 1,
      });

      const plan2 = await SubscriptionPlan.create({
        id: 2,
        name: 'Deleted Plan',
        price: '9.99',
        currency: 'USD',
        duration_days: 30,
        is_active: true,
        sort_order: 2,
      });

      // Soft delete plan 2
      await plan2.destroy();

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].id).toBe(1);
    });
  });

  describe('6. Empty Database and Graceful Handling', () => {
    it('should return 200 with empty array when no plans are configured', async () => {
      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(typeof res.body.img_base_url).toBe('string');
    });

    it('should handle plans without any features gracefully', async () => {
      await SubscriptionPlan.create({
        id: 1,
        name: 'Plan Without Features',
        price: '4.99',
        currency: 'USD',
        duration_days: 7,
        is_active: true,
        sort_order: 1,
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].features).toEqual([]);
    });
  });

  describe('7. Authentication Flexibility (Public and Bearer Token Access)', () => {
    it('should allow public unauthenticated access', async () => {
      await seedSubscriptions(true);

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
    });

    it('should allow authenticated access with valid Bearer token', async () => {
      await seedSubscriptions(true);

      const res = await request(app)
        .get('/api/v1/subscriptions')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data.length).toBe(2);
    });
  });

  describe('8. Decimal-Safe Price Representation', () => {
    it('should always serialize price with exactly two decimal places as string', async () => {
      await SubscriptionPlan.create({
        id: 1,
        name: 'Integer Price Plan',
        price: 15, // number
        currency: 'USD',
        duration_days: 30,
        is_active: true,
        sort_order: 1,
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(200);
      expect(res.body.data[0].price).toBe('15.00');
    });
  });

  describe('9. Idempotent Seeding and Platform Product IDs', () => {
    it('should run seeder multiple times without creating duplicates or altering product IDs', async () => {
      const run1 = await seedSubscriptions(false);
      expect(run1.plansCreated).toBe(2);
      expect(run1.featuresCreated).toBe(6);

      // Running second time should not insert duplicate plans
      const run2 = await seedSubscriptions(false);
      expect(run2.plansCreated).toBe(0);
      expect(run2.featuresCreated).toBe(0);

      const totalPlans = await SubscriptionPlan.count();
      const totalFeatures = await SubscriptionFeature.count();
      expect(totalPlans).toBe(2);
      expect(totalFeatures).toBe(6);

      const plan1 = await SubscriptionPlan.findByPk(1);
      expect(plan1?.google_product_id).toBe('one_week_subscription');
      expect(plan1?.apple_product_id).toBe('com.flirttime.weekly');

      const plan2 = await SubscriptionPlan.findByPk(2);
      expect(plan2?.google_product_id).toBe('one_month_subscription_plan');
      expect(plan2?.apple_product_id).toBe('com.flirttime.monthly');
    });
  });

  describe('10. Database Error Handling without Leaking SQL', () => {
    it('should return 500 without leaking SQL statements if database query fails', async () => {
      const originalFindAll = SubscriptionPlan.findAll;
      jest.spyOn(SubscriptionPlan, 'findAll').mockImplementationOnce(() => {
        throw new Error('FATAL: Table subscription_plans does not exist in schema internal_credentials_vault');
      });

      const res = await request(app).get('/api/v1/subscriptions');

      expect(res.status).toBe(500);
      expect(res.body.status).toBe(false);
      expect(res.body.message).toBe('Internal server error while retrieving subscriptions');
      expect(JSON.stringify(res.body)).not.toContain('internal_credentials_vault');

      SubscriptionPlan.findAll = originalFindAll;
    });
  });
});
