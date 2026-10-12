import { connectDatabase } from '../config/database';
import { initDb } from '../models';
import { seed50DiscoveryUsers } from '../services/seedDiscovery.service';

const run = async () => {
  console.log('🚀 Connecting to database to seed 50 discovery users...');
  const connected = await connectDatabase();
  if (!connected) {
    console.error('❌ Failed to connect to database. Check credentials in .env.');
    process.exit(1);
  }

  try {
    await initDb();
    console.log('🌱 Seeding 50 dummy discovery users...');
    const result = await seed50DiscoveryUsers(true);
    console.log('✅ Seeding completed:', result);
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during discovery seeding:', error);
    process.exit(1);
  }
};

run();
