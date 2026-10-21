import { connectDatabase } from '../config/database';
import { ensureChatTables } from '../models';

const run = async () => {
  console.log('🚀 Connecting to database to apply chat tables migration...');
  const connected = await connectDatabase();
  if (!connected) {
    console.error('❌ Failed to connect to database. Check credentials in .env.');
    process.exit(1);
  }

  try {
    console.log('📦 Applying chat migrations: conversations & chat_messages columns, indexes, and user states...');
    await ensureChatTables();
    console.log('✅ Chat tables migration completed successfully.');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error during chat tables migration:', error.message || error);
    process.exit(1);
  }
};

run();
