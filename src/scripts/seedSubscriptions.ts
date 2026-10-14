import { connectDatabase } from '../config/database';
import { ensureSubscriptionTables } from '../models';
import { seedSubscriptions } from '../services/seedSubscription.service';

const run = async () => {
  console.log('🚀 Connecting to database to seed FlirtTime subscriptions...');
  const connected = await connectDatabase();
  if (!connected) {
    console.error('❌ Failed to connect to database. Check credentials in .env.');
    process.exit(1);
  }

  try {
    // Isolated sync for subscription tables only
    await ensureSubscriptionTables();
    console.log('🌱 Seeding subscription plans and features idempotently...');
    const result = await seedSubscriptions(true);
    console.log('📊 Result summary:', result);
    console.log('✅ Subscription seeding completed successfully.');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during subscription seeding:', error.message || error);
    process.exit(1);
  }
};

run();
