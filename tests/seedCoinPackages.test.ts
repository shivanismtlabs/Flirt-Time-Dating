import { sequelize } from '../src/config/database';
import { CoinPackage } from '../src/models/coinPackage.model';
import {
  seedCoinPackages,
  PRODUCTION_COIN_PACKAGES,
} from '../src/services/seedCoinPackage.service';

describe('Production Coin Packages Seeder (Idempotent & Transaction-Safe)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await CoinPackage.destroy({ where: {}, truncate: true });
  });

  it('should seed exactly 10 coin packages on first execution with correct values and sort order', async () => {
    const result = await seedCoinPackages(false);

    expect(result.inserted).toBe(10);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
    expect(result.total).toBe(10);

    const packages = await CoinPackage.findAll({
      order: [['sort_order', 'ASC']],
    });

    expect(packages.length).toBe(10);

    // Verify all 10 packages match the specifications
    for (let i = 0; i < PRODUCTION_COIN_PACKAGES.length; i++) {
      const expected = PRODUCTION_COIN_PACKAGES[i];
      const actual = packages[i];

      expect(actual.name).toBe(expected.name);
      expect(parseFloat(String(actual.price)).toFixed(2)).toBe(expected.price);
      expect(actual.currency).toBe('INR');
      expect(actual.coins).toBe(expected.coins);
      expect(actual.bonus_coins).toBe(expected.bonus_coins);
      expect(actual.sort_order).toBe(expected.sort_order);
      expect(actual.google_product_id).toBe(expected.google_product_id);
      expect(actual.apple_product_id).toBe(expected.apple_product_id);
      expect(actual.is_active).toBe(true);
    }
  });

  it('should be completely idempotent when executed multiple times without creating duplicates', async () => {
    // First run
    const firstResult = await seedCoinPackages(false);
    expect(firstResult.inserted).toBe(10);

    // Second run
    const secondResult = await seedCoinPackages(false);
    expect(secondResult.inserted).toBe(0);
    expect(secondResult.updated).toBe(0);
    expect(secondResult.unchanged).toBe(10);
    expect(secondResult.total).toBe(10);

    // Verify database count is still exactly 10
    const count = await CoinPackage.count();
    expect(count).toBe(10);
  });

  it('should safely update fields if an existing package has stale data without duplicating', async () => {
    await seedCoinPackages(false);

    // Artificially change a package in the DB to test update detection
    await CoinPackage.update(
      { price: '39.00', bonus_coins: 5 },
      { where: { google_product_id: 'starter_pack' } }
    );

    const reseedResult = await seedCoinPackages(false);
    expect(reseedResult.inserted).toBe(0);
    expect(reseedResult.updated).toBe(1);
    expect(reseedResult.unchanged).toBe(9);

    // Verify the package was restored to canonical values
    const starter = await CoinPackage.findOne({
      where: { google_product_id: 'starter_pack' },
    });
    expect(parseFloat(String(starter?.price)).toFixed(2)).toBe('49.00');
    expect(starter?.bonus_coins).toBe(10);
  });
});
