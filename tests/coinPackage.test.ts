import request from 'supertest';
import app from '../src/app';
import { sequelize, User, initDb, CoinPackage } from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Production-Ready Coin Packages API (GET /api/v1/coin-packages)', () => {
  let testUser: User;
  let testToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  beforeEach(async () => {
    // Clear packages and test users
    await CoinPackage.destroy({ where: {} });
    await User.destroy({ where: {} });

    testUser = await User.create({
      username: 'coin_tester',
      email: 'tester@flirttime.app',
      isActive: true,
      role: 'user',
    });

    testToken = generateToken({
      id: testUser.id,
      email: testUser.email!,
      role: testUser.role,
    });
  });

  const seedSamplePackages = async () => {
    return await CoinPackage.bulkCreate([
      {
        id: 1,
        name: 'Starter Pack',
        price: '49.00',
        currency: 'INR',
        coins: 110,
        bonus_coins: 10,
        google_product_id: 'com.flirttime.starter',
        apple_product_id: 'com.flirttime.starter.ios',
        is_active: true,
        sort_order: 1,
      },
      {
        id: 2,
        name: 'Bronze Pack',
        price: '99.00',
        currency: 'INR',
        coins: 220,
        bonus_coins: 20,
        google_product_id: 'com.flirttime.bronze',
        apple_product_id: 'com.flirttime.bronze.ios',
        is_active: true,
        sort_order: 2,
      },
      {
        id: 3,
        name: 'Basic Pack',
        price: '149.00',
        currency: 'INR',
        coins: 300,
        bonus_coins: 30,
        google_product_id: 'com.flirttime.basic',
        apple_product_id: null,
        is_active: true,
        sort_order: 3,
      },
      {
        id: 4,
        name: 'Silver Pack',
        price: '199.00',
        currency: 'INR',
        coins: 440,
        bonus_coins: 40,
        google_product_id: 'com.flirttime.silver',
        apple_product_id: null,
        is_active: true,
        sort_order: 4,
      },
      {
        id: 5,
        name: 'Gold Pack',
        price: '249.00',
        currency: 'INR',
        coins: 550,
        bonus_coins: 50,
        google_product_id: 'com.flirttime.gold',
        apple_product_id: null,
        is_active: true,
        sort_order: 5,
      },
      {
        id: 6,
        name: 'Platinum Pack',
        price: '299.00',
        currency: 'INR',
        coins: 660,
        bonus_coins: 60,
        google_product_id: 'com.flirttime.platinum',
        apple_product_id: null,
        is_active: true,
        sort_order: 6,
      },
      {
        id: 7,
        name: 'Diamond Pack',
        price: '349.00',
        currency: 'INR',
        coins: 770,
        bonus_coins: 70,
        google_product_id: 'com.flirttime.diamond',
        apple_product_id: null,
        is_active: true,
        sort_order: 7,
      },
      {
        id: 8,
        name: 'Elite Pack',
        price: '399.00',
        currency: 'INR',
        coins: 880,
        bonus_coins: 80,
        google_product_id: 'com.flirttime.elite',
        apple_product_id: null,
        is_active: true,
        sort_order: 8,
      },
      {
        id: 9,
        name: 'Royal Pack',
        price: '449.00',
        currency: 'INR',
        coins: 990,
        bonus_coins: 90,
        google_product_id: 'com.flirttime.royal',
        apple_product_id: null,
        is_active: true,
        sort_order: 9,
      },
      {
        id: 10,
        name: 'Mega Pack',
        price: '499.00',
        currency: 'INR',
        coins: 1100,
        bonus_coins: 100,
        google_product_id: 'com.flirttime.mega',
        apple_product_id: null,
        is_active: true,
        sort_order: 10,
      },
      {
        id: 99,
        name: 'Deprecated Inactive Pack',
        price: '19.00',
        currency: 'INR',
        coins: 30,
        bonus_coins: 0,
        google_product_id: 'com.flirttime.deprecated',
        apple_product_id: null,
        is_active: false,
        sort_order: 99,
      },
    ]);
  };

  describe('1. Successful Retrieval and Legacy Response Structure', () => {
    it('should return active packages with matching legacy status, message, data and keys', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.message).toMatch(/coin packages retrieved successfully/i);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(10);

      // Verify exact keys of first package
      const first = res.body.data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name', 'Starter Pack');
      expect(first).toHaveProperty('price', '49.00');
      expect(first).toHaveProperty('currency', 'INR');
      expect(first).toHaveProperty('coins', 110);
      expect(first).toHaveProperty('bonus_coins', 10);
      expect(first).toHaveProperty('google_product_id', 'com.flirttime.starter');
      expect(first).toHaveProperty('apple_product_id', 'com.flirttime.starter.ios');
      expect(first).toHaveProperty('is_active', true);
      expect(first).toHaveProperty('sort_order', 1);
      expect(first).toHaveProperty('created_at');
      expect(first).toHaveProperty('updated_at');

      // Verify coins and bonus_coins are separate and not artificially added
      expect(first.coins).toBe(110);
      expect(first.bonus_coins).toBe(10);
    });

    it('should also respond at /api/coin-packages for dual-path compatibility', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/coin-packages');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data.length).toBe(10);
    });
  });

  describe('2. Default sort_order Ordering', () => {
    it('should strictly order by sort_order ASC, then id ASC by default to match Laravel', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages');

      expect(res.status).toBe(200);
      const names = res.body.data.map((p: any) => p.name);
      expect(names).toEqual([
        'Starter Pack',
        'Bronze Pack',
        'Basic Pack',
        'Silver Pack',
        'Gold Pack',
        'Platinum Pack',
        'Diamond Pack',
        'Elite Pack',
        'Royal Pack',
        'Mega Pack',
      ]);
    });
  });

  describe('3. Pagination with page and limit Parameters', () => {
    it('should paginate items correctly and return backward-compatible metadata', async () => {
      await seedSamplePackages();

      // Page 1, limit 5
      const page1Res = await request(app).get('/api/v1/coin-packages?page=1&limit=5');
      expect(page1Res.status).toBe(200);
      expect(page1Res.body.data.length).toBe(5);
      expect(page1Res.body.data[0].name).toBe('Starter Pack');
      expect(page1Res.body.data[4].name).toBe('Gold Pack');

      expect(page1Res.body.pagination).toEqual({
        page: 1,
        limit: 5,
        total: 10,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Page 2, limit 5
      const page2Res = await request(app).get('/api/v1/coin-packages?page=2&limit=5');
      expect(page2Res.status).toBe(200);
      expect(page2Res.body.data.length).toBe(5);
      expect(page2Res.body.data[0].name).toBe('Platinum Pack');
      expect(page2Res.body.data[4].name).toBe('Mega Pack');

      expect(page2Res.body.pagination).toEqual({
        page: 2,
        limit: 5,
        total: 10,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });

  describe('4. Empty Result Sets', () => {
    it('should return 200 with empty data array and valid pagination when table is empty', async () => {
      const res = await request(app).get('/api/v1/coin-packages');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.totalPages).toBe(0);
      expect(res.body.pagination.hasNextPage).toBe(false);
      expect(res.body.pagination.hasPreviousPage).toBe(false);
    });
  });

  describe('5. Price Ascending and Descending Sorting', () => {
    it('should sort packages by price ascending', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?sortBy=price&sortOrder=asc');

      expect(res.status).toBe(200);
      const prices = res.body.data.map((p: any) => parseFloat(p.price));
      expect(prices[0]).toBe(49);
      expect(prices[prices.length - 1]).toBe(499);
      for (let i = 0; i < prices.length - 1; i++) {
        expect(prices[i]).toBeLessThanOrEqual(prices[i + 1]);
      }
    });

    it('should sort packages by price descending', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?sortBy=price&sortOrder=desc');

      expect(res.status).toBe(200);
      const prices = res.body.data.map((p: any) => parseFloat(p.price));
      expect(prices[0]).toBe(499);
      expect(prices[prices.length - 1]).toBe(49);
      for (let i = 0; i < prices.length - 1; i++) {
        expect(prices[i]).toBeGreaterThanOrEqual(prices[i + 1]);
      }
    });
  });

  describe('6. Coins Ascending and Descending Sorting', () => {
    it('should sort packages by coins ascending', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?sortBy=coins&sortOrder=asc');

      expect(res.status).toBe(200);
      const coins = res.body.data.map((p: any) => p.coins);
      expect(coins[0]).toBe(110);
      expect(coins[coins.length - 1]).toBe(1100);
      for (let i = 0; i < coins.length - 1; i++) {
        expect(coins[i]).toBeLessThanOrEqual(coins[i + 1]);
      }
    });

    it('should sort packages by coins descending', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?sortBy=coins&sortOrder=desc');

      expect(res.status).toBe(200);
      const coins = res.body.data.map((p: any) => p.coins);
      expect(coins[0]).toBe(1100);
      expect(coins[coins.length - 1]).toBe(110);
      for (let i = 0; i < coins.length - 1; i++) {
        expect(coins[i]).toBeGreaterThanOrEqual(coins[i + 1]);
      }
    });
  });

  describe('7. Valid and Invalid Price / Coin Filters', () => {
    it('should filter by minPrice and maxPrice range', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?minPrice=99&maxPrice=249');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(4);
      const names = res.body.data.map((p: any) => p.name);
      expect(names).toEqual(['Bronze Pack', 'Basic Pack', 'Silver Pack', 'Gold Pack']);
    });

    it('should filter by minCoins and maxCoins range', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?minCoins=300&maxCoins=660');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(4);
      const names = res.body.data.map((p: any) => p.name);
      expect(names).toEqual(['Basic Pack', 'Silver Pack', 'Gold Pack', 'Platinum Pack']);
    });

    it('should reject when minPrice > maxPrice with 400', async () => {
      const res = await request(app).get('/api/v1/coin-packages?minPrice=500&maxPrice=100');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/minPrice cannot be greater than maxPrice/i);
    });

    it('should reject when minCoins > maxCoins with 400', async () => {
      const res = await request(app).get('/api/v1/coin-packages?minCoins=800&maxCoins=200');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).toMatch(/minCoins cannot be greater than maxCoins/i);
    });

    it('should reject negative price or non-integer coins with 400', async () => {
      const negPriceRes = await request(app).get('/api/v1/coin-packages?minPrice=-10');
      expect(negPriceRes.status).toBe(400);

      const floatCoinsRes = await request(app).get('/api/v1/coin-packages?minCoins=12.5');
      expect(floatCoinsRes.status).toBe(400);
    });
  });

  describe('8. Parameter Validation and Rejection of Invalid Inputs', () => {
    it('should reject invalid page with 400', async () => {
      const res1 = await request(app).get('/api/v1/coin-packages?page=0');
      expect(res1.status).toBe(400);

      const res2 = await request(app).get('/api/v1/coin-packages?page=-5');
      expect(res2.status).toBe(400);

      const res3 = await request(app).get('/api/v1/coin-packages?page=abc');
      expect(res3.status).toBe(400);
    });

    it('should reject limit outside 1-50 with 400', async () => {
      const res1 = await request(app).get('/api/v1/coin-packages?limit=0');
      expect(res1.status).toBe(400);

      const res2 = await request(app).get('/api/v1/coin-packages?limit=51');
      expect(res2.status).toBe(400);
    });

    it('should reject non-whitelisted sortBy or sortOrder with 400', async () => {
      const res1 = await request(app).get('/api/v1/coin-packages?sortBy=drop_table');
      expect(res1.status).toBe(400);
      expect(JSON.stringify(res1.body)).toMatch(/invalid sortby/i);

      const res2 = await request(app).get('/api/v1/coin-packages?sortOrder=sideways');
      expect(res2.status).toBe(400);
      expect(JSON.stringify(res2.body)).toMatch(/invalid sortorder/i);
    });
  });

  describe('9. Stable Ordering for Equal Prices / Coins', () => {
    it('should break ties deterministically using id ASC', async () => {
      await CoinPackage.create({
        id: 101,
        name: 'Promo A',
        price: '99.00',
        currency: 'INR',
        coins: 200,
        bonus_coins: 0,
        sort_order: 1,
        is_active: true,
      });
      await CoinPackage.create({
        id: 102,
        name: 'Promo B',
        price: '99.00',
        currency: 'INR',
        coins: 200,
        bonus_coins: 0,
        sort_order: 1,
        is_active: true,
      });

      const res = await request(app).get('/api/v1/coin-packages?sortBy=price&sortOrder=asc');

      expect(res.status).toBe(200);
      const promoAIndex = res.body.data.findIndex((p: any) => p.name === 'Promo A');
      const promoBIndex = res.body.data.findIndex((p: any) => p.name === 'Promo B');
      expect(promoAIndex).toBeLessThan(promoBIndex);
    });
  });

  describe('10. Authentication Behavior Matching Existing Policy', () => {
    it('should allow public access when unauthenticated', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
    });

    it('should allow authenticated access when valid Bearer token is provided', async () => {
      await seedSamplePackages();

      const res = await request(app)
        .get('/api/v1/coin-packages')
        .set('Authorization', `Bearer ${testToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(true);
      expect(res.body.data.length).toBe(10);
    });
  });

  describe('11. Decimal-Safe Price Serialization', () => {
    it('should serialize decimal prices with exact 2 decimal places', async () => {
      await CoinPackage.create({
        id: 201,
        name: 'Micro Pack',
        price: '9.90',
        currency: 'INR',
        coins: 25,
        bonus_coins: 0,
        sort_order: 1,
        is_active: true,
      });

      const res = await request(app).get('/api/v1/coin-packages?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data[0].price).toBe('9.90');
    });
  });

  describe('12. Inactive Packages Exclusion', () => {
    it('should never return inactive packages in results', async () => {
      await seedSamplePackages();

      const res = await request(app).get('/api/v1/coin-packages?limit=50');

      expect(res.status).toBe(200);
      const inactive = res.body.data.find((p: any) => p.name === 'Deprecated Inactive Pack');
      expect(inactive).toBeUndefined();
      expect(res.body.data.every((p: any) => p.is_active === true)).toBe(true);
    });
  });

  describe('13. Database Error Handling without Leaking SQL', () => {
    it('should return 500 without leaking SQL statements or stack traces if database query fails', async () => {
      jest.spyOn(CoinPackage, 'findAndCountAll').mockRejectedValueOnce(
        new Error('SequelizeDatabaseError: syntax error at or near "SECRET_CREDENTIALS"')
      );

      const res = await request(app).get('/api/v1/coin-packages');

      expect(res.status).toBe(500);
      expect(res.body.status).toBe(false);
      expect(res.body.message).toMatch(/internal server error/i);
      expect(JSON.stringify(res.body)).not.toContain('syntax error');
      expect(JSON.stringify(res.body)).not.toContain('SECRET_CREDENTIALS');
    });
  });
});
