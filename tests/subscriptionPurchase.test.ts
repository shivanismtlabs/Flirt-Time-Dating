import request from 'supertest';
import app from '../src/app';
import { Op } from 'sequelize';
import {
  sequelize,
  User,
  initDb,
  SubscriptionPlan,
  SubscriptionFeature,
  PlanFeature,
  UserSubscription,
  SubscriptionEventLog,
  CoinTransaction,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { iapService } from '../src/services/iap.service';
import { seedSubscriptions } from '../src/services/seedSubscription.service';

describe('Production-Ready Subscription Purchase and Lifecycle APIs', () => {
  let testUser: User;
  let testToken: string;
  let weeklyPlan: SubscriptionPlan;
  let monthlyPlan: SubscriptionPlan;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  beforeEach(async () => {
    // Clear subscription and transaction tables
    await CoinTransaction.destroy({ where: {} });
    await SubscriptionEventLog.destroy({ where: {} });
    await UserSubscription.destroy({ where: {} });
    await PlanFeature.destroy({ where: {} });
    await SubscriptionPlan.destroy({ where: {}, force: true });
    await SubscriptionFeature.destroy({ where: {}, force: true });
    await User.destroy({ where: {} });

    // Seed authoritative plans
    await seedSubscriptions(true);
    weeklyPlan = (await SubscriptionPlan.findByPk(1))!;
    monthlyPlan = (await SubscriptionPlan.findByPk(2))!;

    testUser = await User.create({
      username: 'sub_tester',
      email: 'subscriber@flirttime.app',
      isActive: true,
      role: 'user',
      coins: 500,
      isSubscribed: false,
    });

    testToken = generateToken({
      id: testUser.id,
      email: testUser.email!,
      role: testUser.role,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Apple App Store Subscription Verification (POST /api/v1/subscriptions/purchase/verify)', () => {
    it('should successfully verify a valid Apple subscription and grant entitlement + bonus coins', async () => {
      const mockTxId = `apple_sub_tx_${Date.now()}`;
      const expiresDate = new Date(Date.now() + 7 * 86400000); // 7 days in future

      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.flirttime.app',
        productId: 'com.flirttime.weekly',
        transactionId: mockTxId,
        originalTransactionId: mockTxId,
        purchaseDate: Date.now(),
        expiresDate: expiresDate.getTime(),
        type: 'Auto-Renewable Subscription',
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          productId: 'com.flirttime.weekly',
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEntitled).toBe(true);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.bonusCoinsCredited).toBe(50); // Plan 1 bonus coins
      expect(res.body.data.currentBalance).toBe(550); // 500 + 50

      // Verify Database records
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.isSubscribed).toBe(true);
      expect(updatedUser?.coins).toBe(550);

      const dbSub = await UserSubscription.findOne({ where: { storeTransactionId: mockTxId } });
      expect(dbSub).not.toBeNull();
      expect(dbSub?.isEntitled).toBe(true);
      expect(dbSub?.bonusCoinsCredited).toBe(true);
      expect(dbSub?.bonusCoinsAmount).toBe(50);

      // Verify Ledger record
      const ledger = await CoinTransaction.findOne({ where: { referenceId: dbSub!.id } });
      expect(ledger).not.toBeNull();
      expect(ledger?.amount).toBe(50);
      expect(ledger?.balanceAfter).toBe(550);
    });

    it('should verify Apple subscription by productId alone without requiring planId', async () => {
      const mockTxId = `apple_sub_pid_${Date.now()}`;
      const expiresDate = new Date(Date.now() + 30 * 86400000);

      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.flirttime.app',
        productId: 'com.flirttime.monthly',
        transactionId: mockTxId,
        originalTransactionId: mockTxId,
        purchaseDate: Date.now(),
        expiresDate: expiresDate.getTime(),
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          productId: 'com.flirttime.monthly',
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.plan.name).toBe('One Month + 200 Coin');
      expect(res.body.data.bonusCoinsCredited).toBe(100);
      expect(res.body.data.currentBalance).toBe(600);
    });

    it('should reject Apple subscription with bundle ID mismatch', async () => {
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.onevibe.live', // Wrong/unauthorized bundle
        productId: 'com.flirttime.weekly',
        transactionId: '1001',
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('BUNDLE_ID_MISMATCH');
    });

    it('should reject revoked or refunded Apple subscription', async () => {
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.flirttime.app',
        productId: 'com.flirttime.weekly',
        transactionId: '1002',
        revocationDate: Date.now(),
        revocationReason: 1,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('SUBSCRIPTION_REVOKED');
    });
  });

  describe('2. Google Play Subscription Verification (POST /api/v1/subscriptions/purchase/verify)', () => {
    it('should successfully verify a valid Google Play subscription and grant entitlement + bonus coins', async () => {
      const mockOrderId = `GPA.${Date.now()}-12345..0`;
      const expiresDate = new Date(Date.now() + 7 * 86400000);

      jest.spyOn(iapService, 'queryGooglePlaySubscriptionAPI').mockResolvedValue({
        startTimeMillis: String(Date.now()),
        expiryTimeMillis: String(expiresDate.getTime()),
        autoRenewing: true,
        paymentState: 1, // Received
        acknowledgementState: 1,
        orderId: mockOrderId,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          productId: 'one_week_subscription',
          purchaseToken: 'play_valid_sub_token_123',
          packageName: 'com.app.flirttime',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isEntitled).toBe(true);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.bonusCoinsCredited).toBe(50);
      expect(res.body.data.currentBalance).toBe(550);
    });

    it('should reject Google Play subscription when package name mismatches', async () => {
      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          productId: 'one_week_subscription',
          purchaseToken: 'play_token',
          packageName: 'com.app.wrongpackage',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PACKAGE_NAME_MISMATCH');
    });

    it('should reject Google Play subscription if payment is pending (state 0)', async () => {
      jest.spyOn(iapService, 'queryGooglePlaySubscriptionAPI').mockResolvedValue({
        startTimeMillis: String(Date.now()),
        expiryTimeMillis: String(Date.now() + 7 * 86400000),
        autoRenewing: true,
        paymentState: 0, // Pending
        acknowledgementState: 0,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          productId: 'one_week_subscription',
          purchaseToken: 'play_token_pending',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('SUBSCRIPTION_PAYMENT_PENDING');
    });

    it('should preserve entitlement until expiry when subscription is canceled (autoRenewing = false)', async () => {
      const expiresDate = new Date(Date.now() + 5 * 86400000); // 5 days left

      jest.spyOn(iapService, 'queryGooglePlaySubscriptionAPI').mockResolvedValue({
        startTimeMillis: String(Date.now()),
        expiryTimeMillis: String(expiresDate.getTime()),
        autoRenewing: false, // Canceled auto-renew
        cancelReason: 0, // User canceled
        paymentState: 1,
        acknowledgementState: 1,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          productId: 'one_week_subscription',
          purchaseToken: 'play_token_canceled_active',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('canceled');
      expect(res.body.data.isEntitled).toBe(true); // Entitled until expiry!
      expect(res.body.data.autoRenewing).toBe(false);
    });
  });

  describe('3. Validation, Product Mismatch & Idempotency Safeguards', () => {
    it('should reject purchase for an inactive subscription plan with 400', async () => {
      await weeklyPlan.update({ is_active: false });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PLAN_INACTIVE');
    });

    it('should reject when store product does not match database plan product', async () => {
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.flirttime.app',
        productId: 'different_unmatched_product',
        transactionId: '1004',
        purchaseDate: Date.now(),
        expiresDate: Date.now() + 86400000,
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PRODUCT_MISMATCH');
    });

    it('should handle duplicate verification request idempotently without crediting bonus coins again', async () => {
      const mockTxId = `dup_sub_tx_${Date.now()}`;
      const expiresDate = new Date(Date.now() + 7 * 86400000);

      jest.spyOn(iapService, 'verifyAppleSubscription').mockResolvedValue({
        platform: 'ios',
        storeTransactionId: mockTxId,
        originalTransactionId: mockTxId,
        productId: 'com.flirttime.weekly',
        environment: 'production',
        purchaseDate: new Date(),
        expiresDate,
        autoRenewing: true,
        status: 'active',
        isEntitled: true,
        isAcknowledged: true,
        rawResponse: {},
      });

      // Request 1: Fresh purchase
      const res1 = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ platform: 'ios', planId: weeklyPlan.id, transactionId: mockTxId });

      expect(res1.status).toBe(200);
      expect(res1.body.data.alreadyProcessed).toBe(false);
      expect(res1.body.data.bonusCoinsCredited).toBe(50);
      expect(res1.body.data.currentBalance).toBe(550);

      // Request 2: Duplicate request
      const res2 = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ platform: 'ios', planId: weeklyPlan.id, transactionId: mockTxId });

      expect(res2.status).toBe(200);
      expect(res2.body.data.alreadyProcessed).toBe(true);
      expect(res2.body.data.bonusCoinsCredited).toBe(0); // ZERO duplicate coins!
      expect(res2.body.data.currentBalance).toBe(550); // Balance unchanged!

      // Check DB records: exactly ONE subscription and ONE bonus coin ledger entry
      const subCount = await UserSubscription.count({ where: { storeTransactionId: mockTxId } });
      expect(subCount).toBe(1);

      const ledgerCount = await CoinTransaction.count({ where: { description: { [Op.like]: '%One Week%' } } });
      expect(ledgerCount).toBe(1);
    });

    it('should safely handle two concurrent verification requests without duplicate entitlements or bonus coins', async () => {
      const concurrentTxId = `concurrent_sub_${Date.now()}`;
      const expiresDate = new Date(Date.now() + 7 * 86400000);

      jest.spyOn(iapService, 'verifyAppleSubscription').mockResolvedValue({
        platform: 'ios',
        storeTransactionId: concurrentTxId,
        originalTransactionId: concurrentTxId,
        productId: 'com.flirttime.weekly',
        environment: 'production',
        purchaseDate: new Date(),
        expiresDate,
        autoRenewing: true,
        status: 'active',
        isEntitled: true,
        isAcknowledged: true,
        rawResponse: {},
      });

      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/subscriptions/purchase/verify')
          .set('Authorization', `Bearer ${testToken}`)
          .send({ platform: 'ios', planId: weeklyPlan.id, transactionId: concurrentTxId }),
        request(app)
          .post('/api/v1/subscriptions/purchase/verify')
          .set('Authorization', `Bearer ${testToken}`)
          .send({ platform: 'ios', planId: weeklyPlan.id, transactionId: concurrentTxId }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const oneAlreadyProcessed = res1.body.data.alreadyProcessed || res2.body.data.alreadyProcessed;
      expect(oneAlreadyProcessed).toBe(true);

      const finalUser = await User.findByPk(testUser.id);
      expect(finalUser?.coins).toBe(550); // Credited exactly ONCE!
      expect(finalUser?.isSubscribed).toBe(true);
    });
  });

  describe('4. Entitlement & History APIs (GET /my and GET /history)', () => {
    it('should retrieve current active weekly subscription with canonical envelope and dynamic remaining validity', async () => {
      const expiresDate = new Date(Date.now() + 6 * 86400000 + 4 * 3600000); // 6 days 4 hours in future

      await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: 'my_sub_tx_1',
        originalTransactionId: 'my_sub_tx_1',
        status: 'active',
        isEntitled: true,
        startsAt: new Date(Date.now() - 86400000),
        expiresAt: expiresDate,
        autoRenewing: true,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      await testUser.update({ isSubscribed: true });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body as any).status).toBeUndefined(); // No duplicate status at root level
      expect(res.body.message).toBe('Current subscription retrieved successfully');

      // Top-level entitlement
      expect(res.body.data.isSubscribed).toBe(true);

      // Subscription object
      const subData = res.body.data.subscription;
      expect(subData).toBeDefined();
      expect(subData.platform).toBe('ios');
      expect(subData.productId).toBe('com.flirttime.weekly');
      expect(subData.status).toBe('active');
      expect(subData.isExpired).toBe(false);
      expect(subData.remainingValidity.days).toBe(6);
      expect(subData.remainingValidity.hours).toBeGreaterThanOrEqual(3);
      expect(subData.autoRenewing).toBe(true);
      expect(subData.nextRenewalDate).toBe(expiresDate.toISOString());

      // Plan object (Weekly/Monthly mismatch fixed!)
      const planData = res.body.data.plan;
      expect(planData).toBeDefined();
      expect(planData.name).toBe('One Week + 50 Coins');
      expect(planData.productId).toBe('com.flirttime.weekly');
      expect(planData.billingCycle).toBe('weekly'); // Seven-day plan must show 'weekly'
      expect(planData.durationDays).toBe(7);
      expect(planData.price).toBe('4.99');
      expect(planData.currency).toBe('USD');
      expect(planData.includedCoins).toBe(50);

      // Benefits array
      expect(Array.isArray(res.body.data.benefits)).toBe(true);
      expect(res.body.data.benefits.length).toBeGreaterThan(0);
      expect(res.body.data.benefits[0]).toHaveProperty('id');
      expect(res.body.data.benefits[0]).toHaveProperty('text');
      expect(res.body.data.benefits[0]).toHaveProperty('sortOrder');

      // Verify no duplicate root date objects or internal secrets
      expect((res.body.data as any).expiresAt).toBeUndefined();
      expect((res.body.data as any).autoRenewing).toBeUndefined();
      expect((res.body.data as any).features).toBeUndefined();
      expect(subData.purchaseToken).toBeUndefined();
      expect(subData.rawVerificationData).toBeUndefined();
      expect(subData.planName).toBeUndefined();
      expect(subData.durationDays).toBeUndefined();
    });

    it('should retrieve monthly subscription with monthly billing cycle and included coins', async () => {
      const expiresDate = new Date(Date.now() + 30 * 86400000);

      await UserSubscription.create({
        userId: testUser.id,
        planId: monthlyPlan.id,
        platform: 'android',
        productId: 'com.flirttime.monthly',
        storeTransactionId: 'monthly_sub_tx',
        originalTransactionId: 'monthly_sub_tx',
        status: 'active',
        isEntitled: true,
        startsAt: new Date(),
        expiresAt: expiresDate,
        autoRenewing: true,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 100,
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSubscribed).toBe(true);
      expect(res.body.data.subscription.platform).toBe('android');
      expect(res.body.data.subscription.autoRenewing).toBe(true);
      expect(res.body.data.subscription.nextRenewalDate).toBe(expiresDate.toISOString());
      expect(res.body.data.plan.name).toBe('One Month + 200 Coin');
      expect(res.body.data.plan.billingCycle).toBe('monthly');
      expect(res.body.data.plan.durationDays).toBe(30);
      expect(res.body.data.plan.includedCoins).toBe(100);
    });

    it('should handle cancelled-but-still-valid subscription with positive remaining validity and null nextRenewalDate', async () => {
      const futureExpiry = new Date(Date.now() + 4 * 86400000 + 10 * 3600000); // 4 days 10 hours left

      await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: 'canceled_still_valid_tx',
        originalTransactionId: 'canceled_still_valid_tx',
        status: 'canceled',
        isEntitled: true,
        startsAt: new Date(Date.now() - 3 * 86400000),
        expiresAt: futureExpiry,
        autoRenewing: false,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSubscribed).toBe(true); // User paid for full period, entitled until expiresAt
      expect(res.body.data.subscription.status).toBe('canceled');
      expect(res.body.data.subscription.isExpired).toBe(false);
      expect(res.body.data.subscription.remainingValidity.days).toBe(4);
      expect(res.body.data.subscription.autoRenewing).toBe(false);
      expect(res.body.data.subscription.nextRenewalDate).toBeNull(); // No renewal since canceled
    });

    it('should mark entitlement as false and return zero remaining validity when subscription is expired', async () => {
      const pastDate = new Date(Date.now() - 2 * 86400000); // Expired 2 days ago

      await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: 'expired_sub_tx',
        originalTransactionId: 'expired_sub_tx',
        status: 'active',
        isEntitled: true,
        startsAt: new Date(Date.now() - 9 * 86400000),
        expiresAt: pastDate,
        autoRenewing: false,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSubscribed).toBe(false);
      expect(res.body.data.subscription.status).toBe('expired');
      expect(res.body.data.subscription.isExpired).toBe(true);
      expect(res.body.data.subscription.remainingValidity).toEqual({
        days: 0,
        hours: 0,
        minutes: 0,
      });
      expect(res.body.data.subscription.autoRenewing).toBe(false);
      expect(res.body.data.subscription.nextRenewalDate).toBeNull();
    });

    it('should preserve provider-verified store expiry as authoritative and never overwrite with locally guessed expiry (Requirement 4)', async () => {
      // Suppose provider returned a verified expiry of 2 days from purchase
      const purchaseTime = new Date('2026-10-15T12:00:06.000Z');
      const verifiedStoreExpiry = new Date('2026-10-17T12:00:06.000Z'); // 2-day verified store window

      const subRecord = await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: 'authoritative_store_tx',
        originalTransactionId: 'authoritative_store_tx',
        status: 'active',
        isEntitled: true,
        startsAt: purchaseTime,
        expiresAt: verifiedStoreExpiry,
        autoRenewing: true,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      await testUser.update({ isSubscribed: true });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      const subData = res.body.data.subscription;
      expect(subData).toBeDefined();

      // Provider-verified date MUST NOT be overwritten by a local 7-day guess!
      expect(subData.expiresAt).toBe(verifiedStoreExpiry.toISOString());
      expect(subData.startsAt).toBe(purchaseTime.toISOString());

      const reloadedSub = await UserSubscription.findByPk(subRecord.id);
      expect(new Date(reloadedSub!.expiresAt).getTime()).toBe(verifiedStoreExpiry.getTime());
    });

    it('should calculate 7-day interval expiration date and dynamic remaining validity when store verification has no explicit expiresDate', async () => {
      const mockTxId = `fallback_interval_tx_${Date.now()}`;
      const purchaseTime = new Date('2026-10-15T12:00:06.000Z');

      // Apple JWS payload with purchaseDate but missing expiresDate
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValue({
        bundleId: 'com.flirttime.app',
        productId: 'com.flirttime.weekly',
        transactionId: mockTxId,
        originalTransactionId: mockTxId,
        purchaseDate: purchaseTime.getTime(),
        // expiresDate omitted
      });

      const verifyRes = await request(app)
        .post('/api/v1/subscriptions/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          planId: weeklyPlan.id,
          productId: 'com.flirttime.weekly',
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.success).toBe(true);

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSubscribed).toBe(true);

      const subData = res.body.data.subscription;
      expect(subData).toBeDefined();
      expect(subData.status).toBe('active');
      expect(subData.isExpired).toBe(false);

      // Exactly 7 days from purchaseTime (2026-10-15T12:00:06.000Z -> 2026-10-22T12:00:06.000Z)
      const expectedExpiry = new Date(purchaseTime.getTime() + 7 * 86400000);
      expect(subData.startsAt).toBe(purchaseTime.toISOString());
      expect(subData.expiresAt).toBe(expectedExpiry.toISOString());
      expect(subData.nextRenewalDate).toBe(expectedExpiry.toISOString());
    });

    it('should return clean missing-subscription payload for user who never subscribed', async () => {
      const unsubscribedUser = await User.create({
        username: 'never_subscribed_user',
        email: 'nosub@flirttime.app',
        isActive: true,
        role: 'user',
        coins: 100,
        isSubscribed: false,
      });

      const unsubToken = generateToken({
        id: unsubscribedUser.id,
        email: unsubscribedUser.email!,
        role: unsubscribedUser.role,
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/my')
        .set('Authorization', `Bearer ${unsubToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect((res.body as any).status).toBeUndefined();
      expect(res.body.message).toBe('Current subscription retrieved successfully');
      expect(res.body.data.isSubscribed).toBe(false);
      expect(res.body.data.subscription).toBeNull();
      expect(res.body.data.plan).toBeNull();
      expect(res.body.data.benefits).toEqual([]);
    });

    it('should retrieve paginated subscription history via GET /api/v1/subscriptions/history', async () => {
      await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: 'hist_tx_1',
        status: 'active',
        isEntitled: true,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        autoRenewing: true,
        price: '4.99',
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      const res = await request(app)
        .get('/api/v1/subscriptions/history?page=1&limit=10')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.subscriptions.length).toBe(1);
      expect(res.body.data.pagination.totalSubscriptions).toBe(1);
    });
  });

  describe('5. Store Server Notifications & Webhooks', () => {
    it('should handle Apple App Store Server Notification (DID_RENEW)', async () => {
      const origTx = 'orig_tx_renew_test';
      const initialExpires = new Date(Date.now() + 1000);
      const renewedExpires = new Date(Date.now() + 7 * 86400000);

      const sub = await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'ios',
        productId: 'com.flirttime.weekly',
        storeTransactionId: origTx,
        originalTransactionId: origTx,
        status: 'active',
        isEntitled: true,
        startsAt: new Date(),
        expiresAt: initialExpires,
        autoRenewing: true,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockImplementation((jws: string) => {
        if (jws.includes('payload_signed_transaction')) {
          return {
            transactionId: `renewed_tx_${Date.now()}`,
            originalTransactionId: origTx,
            productId: 'com.flirttime.weekly',
            expiresDate: renewedExpires.getTime(),
          };
        }
        return {
          notificationType: 'DID_RENEW',
          subtype: 'BILLING_RECOVERY',
          notificationUUID: `notif_${Date.now()}`,
          data: {
            signedTransactionInfo: 'payload_signed_transaction',
          },
        };
      });

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook/apple')
        .send({ signedPayload: 'outer_apple_jws_payload' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.eventType).toBe('DID_RENEW');

      const updatedSub = await UserSubscription.findByPk(sub.id);
      expect(updatedSub?.status).toBe('active');
      expect(updatedSub?.isEntitled).toBe(true);
      expect(new Date(updatedSub!.expiresAt).getTime()).toBe(renewedExpires.getTime());
    });

    it('should handle Google Play Pub/Sub Real-Time Notification', async () => {
      const token = 'google_sub_token_webhook';
      const sub = await UserSubscription.create({
        userId: testUser.id,
        planId: weeklyPlan.id,
        platform: 'android',
        productId: 'one_week_subscription',
        storeTransactionId: 'gpa_webhook_order',
        purchaseToken: token,
        status: 'active',
        isEntitled: true,
        startsAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400000),
        autoRenewing: true,
        currency: 'USD',
        environment: 'production',
        acknowledged: true,
        bonusCoinsCredited: true,
        bonusCoinsAmount: 50,
      });

      const pubSubBody = {
        message: {
          data: Buffer.from(
            JSON.stringify({
              version: '1.0',
              packageName: 'com.app.flirttime',
              eventTimeMillis: String(Date.now()),
              subscriptionNotification: {
                version: '1.0',
                notificationType: 13, // SUBSCRIPTION_EXPIRED
                purchaseToken: token,
                subscriptionId: 'one_week_subscription',
              },
            })
          ).toString('base64'),
          messageId: `msg_${Date.now()}`,
        },
      };

      const res = await request(app)
        .post('/api/v1/subscriptions/webhook/google')
        .send(pubSubBody);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const refreshedSub = await UserSubscription.findByPk(sub.id);
      expect(refreshedSub?.status).toBe('expired');
      expect(refreshedSub?.isEntitled).toBe(false);
    });
  });
});
