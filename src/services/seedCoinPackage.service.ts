import { sequelize } from '../config/database';
import { CoinPackage } from '../models/coinPackage.model';

export interface CoinPackageSeedData {
  name: string;
  price: string;
  currency: string;
  coins: number;
  bonus_coins: number;
  sort_order: number;
  google_product_id: string;
  apple_product_id: string;
  is_active: boolean;
}

export const PRODUCTION_COIN_PACKAGES: CoinPackageSeedData[] = [
  {
    name: 'Starter Pack',
    price: '49.00',
    currency: 'INR',
    coins: 110,
    bonus_coins: 10,
    sort_order: 1,
    google_product_id: 'starter_pack',
    apple_product_id: 'starter_pack',
    is_active: true,
  },
  {
    name: 'Bronze Pack',
    price: '99.00',
    currency: 'INR',
    coins: 220,
    bonus_coins: 20,
    sort_order: 2,
    google_product_id: 'bronze_pack',
    apple_product_id: 'bronze_pack',
    is_active: true,
  },
  {
    name: 'Basic Pack',
    price: '149.00',
    currency: 'INR',
    coins: 300,
    bonus_coins: 30,
    sort_order: 3,
    google_product_id: 'basic_pack',
    apple_product_id: 'basic_pack',
    is_active: true,
  },
  {
    name: 'Silver Pack',
    price: '199.00',
    currency: 'INR',
    coins: 440,
    bonus_coins: 40,
    sort_order: 4,
    google_product_id: 'silver_pack',
    apple_product_id: 'silver_pack',
    is_active: true,
  },
  {
    name: 'Gold Pack',
    price: '249.00',
    currency: 'INR',
    coins: 550,
    bonus_coins: 50,
    sort_order: 5,
    google_product_id: 'gold_pack',
    apple_product_id: 'gold_pack',
    is_active: true,
  },
  {
    name: 'Platinum Pack',
    price: '299.00',
    currency: 'INR',
    coins: 660,
    bonus_coins: 60,
    sort_order: 6,
    google_product_id: 'platinum_pack',
    apple_product_id: 'platinum_pack',
    is_active: true,
  },
  {
    name: 'Diamond Pack',
    price: '349.00',
    currency: 'INR',
    coins: 770,
    bonus_coins: 70,
    sort_order: 7,
    google_product_id: 'diamond_pack',
    apple_product_id: 'diamond_pack',
    is_active: true,
  },
  {
    name: 'Elite Pack',
    price: '399.00',
    currency: 'INR',
    coins: 880,
    bonus_coins: 80,
    sort_order: 8,
    google_product_id: 'elite_pack',
    apple_product_id: 'elite_pack',
    is_active: true,
  },
  {
    name: 'Royal Pack',
    price: '449.00',
    currency: 'INR',
    coins: 990,
    bonus_coins: 90,
    sort_order: 9,
    google_product_id: 'royal_pack',
    apple_product_id: 'royal_pack',
    is_active: true,
  },
  {
    name: 'Mega Pack',
    price: '499.00',
    currency: 'INR',
    coins: 1100,
    bonus_coins: 100,
    sort_order: 10,
    google_product_id: 'mega_pack',
    apple_product_id: 'mega_pack',
    is_active: true,
  },
];

export interface SeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
  total: number;
  packages: Array<{
    name: string;
    price: string;
    coins: number;
    bonus_coins: number;
    sort_order: number;
    google_product_id: string;
    action: 'inserted' | 'updated' | 'unchanged';
  }>;
}

/**
 * Idempotently seeds the 10 production coin packages into PostgreSQL.
 * - Wraps all operations in an isolated database transaction.
 * - Matches records by google_product_id or sort_order to prevent duplicates.
 * - Preserves existing package IDs and database sequences.
 * - Does not touch user wallets, coin balances, purchases, or unrelated tables.
 */
export const seedCoinPackages = async (logOutput = true): Promise<SeedResult> => {
  const transaction = await sequelize.transaction();

  try {
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const packageLogs: SeedResult['packages'] = [];

    for (const item of PRODUCTION_COIN_PACKAGES) {
      // Find existing package by google_product_id or sort_order
      let pkg = await CoinPackage.findOne({
        where: { google_product_id: item.google_product_id },
        transaction,
      });

      if (!pkg) {
        pkg = await CoinPackage.findOne({
          where: { sort_order: item.sort_order },
          transaction,
        });
      }

      if (!pkg) {
        // Insert new package
        const created = await CoinPackage.create(
          {
            name: item.name,
            price: item.price,
            currency: item.currency,
            coins: item.coins,
            bonus_coins: item.bonus_coins,
            google_product_id: item.google_product_id,
            apple_product_id: item.apple_product_id,
            is_active: item.is_active,
            sort_order: item.sort_order,
          },
          { transaction }
        );

        inserted++;
        packageLogs.push({
          name: created.name,
          price: String(created.price),
          coins: created.coins,
          bonus_coins: created.bonus_coins,
          sort_order: created.sort_order,
          google_product_id: created.google_product_id || item.google_product_id,
          action: 'inserted',
        });
      } else {
        // Check if any fields need updating
        const rawPrice = pkg.getDataValue('price');
        const numPrice = typeof rawPrice === 'number' ? rawPrice.toFixed(2) : parseFloat(String(rawPrice)).toFixed(2);
        const needsUpdate =
          pkg.name !== item.name ||
          numPrice !== item.price ||
          pkg.currency !== item.currency ||
          Number(pkg.coins) !== item.coins ||
          Number(pkg.bonus_coins) !== item.bonus_coins ||
          pkg.sort_order !== item.sort_order ||
          pkg.google_product_id !== item.google_product_id ||
          !pkg.is_active;

        if (needsUpdate) {
          pkg.name = item.name;
          pkg.price = item.price;
          pkg.currency = item.currency;
          pkg.coins = item.coins;
          pkg.bonus_coins = item.bonus_coins;
          pkg.sort_order = item.sort_order;
          pkg.google_product_id = item.google_product_id;
          pkg.apple_product_id = item.apple_product_id;
          pkg.is_active = item.is_active;
          await pkg.save({ transaction });

          updated++;
          packageLogs.push({
            name: pkg.name,
            price: item.price,
            coins: pkg.coins,
            bonus_coins: pkg.bonus_coins,
            sort_order: pkg.sort_order,
            google_product_id: pkg.google_product_id,
            action: 'updated',
          });
        } else {
          unchanged++;
          packageLogs.push({
            name: pkg.name,
            price: item.price,
            coins: pkg.coins,
            bonus_coins: pkg.bonus_coins,
            sort_order: pkg.sort_order,
            google_product_id: pkg.google_product_id || item.google_product_id,
            action: 'unchanged',
          });
        }
      }
    }

    await transaction.commit();

    if (logOutput) {
      console.log(
        `✅ Coin Packages Seed Complete: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged (Total: 10)`
      );
    }

    return {
      inserted,
      updated,
      unchanged,
      total: inserted + updated + unchanged,
      packages: packageLogs,
    };
  } catch (error: any) {
    await transaction.rollback();
    console.error('❌ Failed to seed coin packages (transaction rolled back):', error.message || error);
    throw error;
  }
};
