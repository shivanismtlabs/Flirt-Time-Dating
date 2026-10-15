import request from 'supertest';
import app from '../src/app';
import { Op } from 'sequelize';
import { sequelize, User, initDb, CoinPackage, CoinPurchase, CoinTransaction } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { iapService } from '../src/services/iap.service';

describe('Production-Ready Coin Purchase and In-App Billing APIs', () => {
  let testUser: User;
  let testToken: string;
  let sampleStarterPack: CoinPackage;
  let sampleBronzePack: CoinPackage;
  let inactivePack: CoinPackage;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  beforeEach(async () => {
    // Clear test tables
    await CoinTransaction.destroy({ where: {} });
    await CoinPurchase.destroy({ where: {} });
    await CoinPackage.destroy({ where: {} });
    await User.destroy({ where: {} });

    testUser = await User.create({
      username: 'buyer_test',
      email: 'buyer@flirttime.app',
      isActive: true,
      role: 'user',
      coins: 500, // Initial balance
    });

    testToken = generateToken({
      id: testUser.id,
      email: testUser.email!,
      role: testUser.role,
    });

    sampleStarterPack = await CoinPackage.create({
      id: 1,
      name: 'Starter Pack',
      price: '49.00',
      currency: 'INR',
      coins: 110,
      bonus_coins: 10,
      google_product_id: 'starter_pack',
      apple_product_id: 'starter_pack',
      is_active: true,
      sort_order: 1,
    });

    sampleBronzePack = await CoinPackage.create({
      id: 2,
      name: 'Bronze Pack',
      price: '99.00',
      currency: 'INR',
      coins: 220,
      bonus_coins: 20,
      google_product_id: 'bronze_pack',
      apple_product_id: 'bronze_pack',
      is_active: true,
      sort_order: 2,
    });

    inactivePack = await CoinPackage.create({
      id: 99,
      name: 'Inactive Pack',
      price: '19.00',
      currency: 'INR',
      coins: 50,
      bonus_coins: 0,
      google_product_id: 'inactive_pack',
      apple_product_id: 'inactive_pack',
      is_active: false,
      sort_order: 99,
    });
  });

  describe('1. Apple App Store Purchase Verification (POST /api/v1/coins/purchase/verify)', () => {
    it('should successfully verify a valid Apple StoreKit transaction and credit base + bonus coins', async () => {
      const mockTxId = `apple_tx_${Date.now()}`;
      jest.spyOn(iapService, 'verifyAppleTransaction').mockResolvedValueOnce({
        platform: 'ios',
        storeTransactionId: mockTxId,
        productId: 'starter_pack',
        environment: 'production',
        purchaseDate: new Date(),
        isAcknowledged: true,
        status: 'completed',
        rawResponse: { transactionId: mockTxId, productId: 'starter_pack' },
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          transactionId: mockTxId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.alreadyProcessed).toBe(false);
      expect(res.body.data.coinsCredited).toBe(120); // 110 base + 10 bonus
      expect(res.body.data.baseCoins).toBe(110);
      expect(res.body.data.bonusCoins).toBe(10);
      expect(res.body.data.previousBalance).toBe(500);
      expect(res.body.data.currentBalance).toBe(620); // 500 + 120
      expect(res.body.data.storeTransactionId).toBe(mockTxId);

      // Verify DB record
      const dbPurchase = await CoinPurchase.findOne({ where: { storeTransactionId: mockTxId } });
      expect(dbPurchase).not.toBeNull();
      expect(dbPurchase?.userId).toBe(testUser.id);
      expect(dbPurchase?.totalCoins).toBe(120);
      expect(dbPurchase?.status).toBe('completed');

      // Verify wallet ledger record
      const ledgerEntry = await CoinTransaction.findOne({ where: { referenceId: dbPurchase!.id } });
      expect(ledgerEntry).not.toBeNull();
      expect(ledgerEntry?.type).toBe('purchase');
      expect(ledgerEntry?.amount).toBe(120);
      expect(ledgerEntry?.balanceBefore).toBe(500);
      expect(ledgerEntry?.balanceAfter).toBe(620);

      // Verify User balance in DB
      const updatedUser = await User.findByPk(testUser.id);
      expect(updatedUser?.coins).toBe(620);
    });

    it('should verify Apple transaction by productId alone without requiring numeric packageId', async () => {
      const mockTxId = `apple_tx_prod_${Date.now()}`;
      jest.spyOn(iapService, 'verifyAppleTransaction').mockResolvedValueOnce({
        platform: 'ios',
        storeTransactionId: mockTxId,
        productId: 'bronze_pack',
        environment: 'sandbox',
        purchaseDate: new Date(),
        isAcknowledged: true,
        status: 'completed',
        rawResponse: { transactionId: mockTxId },
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          productId: 'bronze_pack',
          transactionId: mockTxId,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.coinsCredited).toBe(240); // 220 + 20
      expect(res.body.data.currentBalance).toBe(740); // 500 + 240
    });

    it('should reject Apple purchase with bundle ID mismatch', async () => {
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValueOnce({
        bundleId: 'com.malicious.fakeapp',
        productId: 'starter_pack',
        transactionId: '1001',
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('BUNDLE_ID_MISMATCH');
    });

    it('should reject refunded or revoked Apple transaction', async () => {
      jest.spyOn(iapService, 'decodeAndVerifyAppleJWS').mockReturnValueOnce({
        bundleId: 'com.flirttime.app',
        productId: 'starter_pack',
        transactionId: '1002',
        revocationDate: Date.now(),
        revocationReason: 1,
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          signedTransactionInfo: 'header.payload.signature',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('TRANSACTION_REVOKED');
    });
  });

  describe('2. Google Play Purchase Verification (POST /api/v1/coins/purchase/verify)', () => {
    it('should successfully verify a valid Google Play purchase token and consume/credit wallet', async () => {
      const mockToken = `google_token_${Date.now()}`;
      const mockOrderId = `GPA.1234-5678-${Date.now()}`;

      jest.spyOn(iapService, 'verifyGooglePurchase').mockResolvedValueOnce({
        platform: 'android',
        storeTransactionId: mockOrderId,
        purchaseToken: mockToken,
        productId: 'starter_pack',
        environment: 'production',
        purchaseDate: new Date(),
        isAcknowledged: false,
        status: 'completed',
        rawResponse: { orderId: mockOrderId },
      });

      jest.spyOn(iapService, 'consumeGooglePurchase').mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          packageId: sampleStarterPack.id,
          productId: 'starter_pack',
          purchaseToken: mockToken,
          orderId: mockOrderId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.alreadyProcessed).toBe(false);
      expect(res.body.data.coinsCredited).toBe(120);
      expect(res.body.data.currentBalance).toBe(620);
      expect(res.body.data.isAcknowledged).toBe(true);

      // Verify in DB
      const dbPurchase = await CoinPurchase.findOne({ where: { storeTransactionId: mockOrderId } });
      expect(dbPurchase?.acknowledged).toBe(true);
      expect(dbPurchase?.totalCoins).toBe(120);
    });

    it('should reject Google Play purchase when package name mismatches', async () => {
      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          packageId: sampleStarterPack.id,
          purchaseToken: 'sample_token',
          packageName: 'com.wrong.attacker.app',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PACKAGE_NAME_MISMATCH');
    });

    it('should reject Google Play purchase if purchase state is canceled (1)', async () => {
      jest.spyOn(iapService, 'queryGooglePlayDeveloperAPI').mockResolvedValueOnce({
        purchaseState: 1, // Canceled
        consumptionState: 0,
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          packageId: sampleStarterPack.id,
          productId: 'starter_pack',
          purchaseToken: 'canceled_token',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PURCHASE_CANCELED');
    });

    it('should reject Google Play purchase if purchase state is pending (2)', async () => {
      jest.spyOn(iapService, 'queryGooglePlayDeveloperAPI').mockResolvedValueOnce({
        purchaseState: 2, // Pending
        consumptionState: 0,
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          packageId: sampleStarterPack.id,
          productId: 'starter_pack',
          purchaseToken: 'pending_token',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PURCHASE_PENDING');
    });
  });

  describe('3. Validation, Package Mismatch & Inactive Package Safeguards', () => {
    it('should reject purchase for an inactive coin package with 400', async () => {
      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: inactivePack.id,
          transactionId: 'any_tx',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PACKAGE_INACTIVE');
    });

    it('should reject purchase when store product ID does not match database package product ID', async () => {
      jest.spyOn(iapService, 'verifyAppleTransaction').mockResolvedValueOnce({
        platform: 'ios',
        storeTransactionId: 'tx_mismatch_123',
        productId: 'completely_different_product_id',
        environment: 'production',
        purchaseDate: new Date(),
        isAcknowledged: true,
        status: 'completed',
        rawResponse: {},
      });

      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          transactionId: 'tx_mismatch_123',
        });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('PRODUCT_MISMATCH');
    });

    it('should reject missing proof fields with 400 validation error', async () => {
      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'android',
          packageId: sampleStarterPack.id,
          // Missing purchaseToken
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject unauthenticated verification requests with 401', async () => {
      const res = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          transactionId: 'tx_no_auth',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Idempotency, Duplicate Prevention & Concurrent Purchase Safety', () => {
    it('should handle duplicate purchase request idempotently without crediting coins again', async () => {
      const mockTxId = `idempotent_tx_${Date.now()}`;
      jest.spyOn(iapService, 'verifyAppleTransaction').mockResolvedValue({
        platform: 'ios',
        storeTransactionId: mockTxId,
        productId: 'starter_pack',
        environment: 'production',
        purchaseDate: new Date(),
        isAcknowledged: true,
        status: 'completed',
        rawResponse: {},
      });

      // First Request
      const res1 = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          transactionId: mockTxId,
        });

      expect(res1.status).toBe(200);
      expect(res1.body.alreadyProcessed).toBe(false);
      expect(res1.body.data.currentBalance).toBe(620); // 500 + 120

      // Second Repeated Request with SAME transaction ID
      const res2 = await request(app)
        .post('/api/v1/coins/purchase/verify')
        .set('Authorization', `Bearer ${testToken}`)
        .send({
          platform: 'ios',
          packageId: sampleStarterPack.id,
          transactionId: mockTxId,
        });

      expect(res2.status).toBe(200);
      expect(res2.body.alreadyProcessed).toBe(true);
      expect(res2.body.message).toMatch(/already been verified and credited/i);
      expect(res2.body.data.currentBalance).toBe(620); // Still 620! Not 740!

      // Check DB records: exactly ONE purchase and ONE ledger entry
      const purchaseCount = await CoinPurchase.count({ where: { storeTransactionId: mockTxId } });
      expect(purchaseCount).toBe(1);

      const ledgerCount = await CoinTransaction.count({ where: { description: { [Op.like]: '%Starter Pack%' } } });
      expect(ledgerCount).toBe(1);

      const finalUser = await User.findByPk(testUser.id);
      expect(finalUser?.coins).toBe(620);
    });

    it('should safely handle two concurrent requests for the same transaction without duplicate credits', async () => {
      const concurrentTxId = `concurrent_tx_${Date.now()}`;
      jest.spyOn(iapService, 'verifyAppleTransaction').mockResolvedValue({
        platform: 'ios',
        storeTransactionId: concurrentTxId,
        productId: 'starter_pack',
        environment: 'production',
        purchaseDate: new Date(),
        isAcknowledged: true,
        status: 'completed',
        rawResponse: {},
      });

      // Fire 2 simultaneous requests
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/coins/purchase/verify')
          .set('Authorization', `Bearer ${testToken}`)
          .send({ platform: 'ios', packageId: sampleStarterPack.id, transactionId: concurrentTxId }),
        request(app)
          .post('/api/v1/coins/purchase/verify')
          .set('Authorization', `Bearer ${testToken}`)
          .send({ platform: 'ios', packageId: sampleStarterPack.id, transactionId: concurrentTxId }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // One should be alreadyProcessed: true, the other false (or both processed cleanly without double credit)
      const oneAlreadyProcessed = res1.body.alreadyProcessed || res2.body.alreadyProcessed;
      expect(oneAlreadyProcessed).toBe(true);

      const finalUser = await User.findByPk(testUser.id);
      expect(finalUser?.coins).toBe(620); // Credited exactly ONCE!
    });
  });

  describe('5. Purchase History, Wallet Balance & Acknowledgement Retry APIs', () => {
    it('should retrieve paginated coin purchase history (GET /api/v1/coins/purchase/history)', async () => {
      // Create sample purchase
      await CoinPurchase.create({
        userId: testUser.id,
        packageId: sampleStarterPack.id,
        platform: 'ios',
        productId: 'starter_pack',
        storeTransactionId: 'hist_tx_1',
        coins: 110,
        bonusCoins: 10,
        totalCoins: 120,
        price: '49.00',
        currency: 'INR',
        status: 'completed',
        environment: 'production',
        acknowledged: true,
        verifiedAt: new Date(),
      });

      const res = await request(app)
        .get('/api/v1/coins/purchase/history?page=1&limit=10')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].productId).toBe('starter_pack');
      expect(res.body.data[0].totalCoins).toBe(120);
      expect(res.body.pagination.total).toBe(1);
    });

    it('should retrieve wallet balance and recent transactions (GET /api/v1/wallet/balance)', async () => {
      // Create ledger entry
      await CoinTransaction.create({
        userId: testUser.id,
        type: 'purchase',
        amount: 120,
        balanceBefore: 500,
        balanceAfter: 620,
        description: 'Starter Pack Purchase',
      });

      const res = await request(app)
        .get('/api/v1/wallet/balance')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.coins).toBe(500);
      expect(res.body.data.recentTransactions.length).toBe(1);
      expect(res.body.data.recentTransactions[0].amount).toBe(120);

      // Verify alias GET /api/v1/coins/balance also responds
      const aliasRes = await request(app)
        .get('/api/v1/coins/balance')
        .set('Authorization', `Bearer ${testToken}`);

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.data.coins).toBe(500);
    });

    it('should allow retrying store acknowledgement (POST /api/v1/coins/purchase/:purchaseId/acknowledge)', async () => {
      const unackPurchase = await CoinPurchase.create({
        userId: testUser.id,
        packageId: sampleStarterPack.id,
        platform: 'android',
        productId: 'starter_pack',
        storeTransactionId: 'unack_tx_123',
        purchaseToken: 'unack_token_123',
        coins: 110,
        bonusCoins: 10,
        totalCoins: 120,
        price: '49.00',
        currency: 'INR',
        status: 'completed',
        environment: 'production',
        acknowledged: false,
        verifiedAt: new Date(),
      });

      jest.spyOn(iapService, 'consumeGooglePurchase').mockResolvedValueOnce(true);

      const res = await request(app)
        .post(`/api/v1/coins/purchase/${unackPurchase.id}/acknowledge`)
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.acknowledged).toBe(true);

      const dbRecord = await CoinPurchase.findByPk(unackPurchase.id);
      expect(dbRecord?.acknowledged).toBe(true);
    });
  });
});
