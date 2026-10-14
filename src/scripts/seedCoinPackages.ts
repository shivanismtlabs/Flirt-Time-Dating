import { connectDatabase } from '../config/database';
import { ensureCoinPackageTables } from '../models';
import { seedCoinPackages } from '../services/seedCoinPackage.service';

const run = async () => {
  console.log('🚀 Connecting to database to seed 10 FlirtTime coin packages...');
  const connected = await connectDatabase();
  if (!connected) {
    console.error('❌ Failed to connect to database. Check credentials in .env.');
    process.exit(1);
  }

  try {
    // Only ensure coin_packages table exists, isolated from other tables
    await ensureCoinPackageTables();
    console.log('🌱 Seeding production coin packages idempotently...');
    const result = await seedCoinPackages(true);
    console.log('📊 Result summary:', {
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
      total: result.total,
    });
    console.log('✅ Seeding completed successfully.');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during coin packages seeding:', error.message || error);
    process.exit(1);
  }
};

run();
