import { Sequelize, Op } from 'sequelize';
import { env } from '../config/env';
import { User } from '../models/user.model';
import { UserSubscription } from '../models/userSubscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';

const targetEmails = ['tushar1234@yopmail.com', 'tushar12345@yopmail.com'];

async function run() {
  console.log('=====================================================');
  console.log('🚀 FlirtTime Subscription Grant Script');
  console.log('=====================================================');

  // Allow connecting to custom/live database if environment variables or CLI flags are provided
  const dbHost = process.env.LIVE_DB_HOST || env.DB_HOST;
  const dbPort = Number(process.env.LIVE_DB_PORT || env.DB_PORT);
  const dbName = process.env.LIVE_DB_NAME || env.DB_NAME;
  const dbUser = process.env.LIVE_DB_USER || env.DB_USER;
  const dbPassword = process.env.LIVE_DB_PASSWORD || env.DB_PASSWORD;
  const dbSsl = process.env.LIVE_DB_SSL === 'true' || env.DB_SSL;

  console.log(`📡 Connecting to PostgreSQL at ${dbHost}:${dbPort}/${dbName} (User: ${dbUser})...`);

  const customSequelize = new Sequelize(dbName, dbUser, dbPassword, {
    host: dbHost,
    port: dbPort,
    dialect: 'postgres',
    logging: false,
    dialectOptions: dbSsl
      ? {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        }
      : {},
  });

  try {
    await customSequelize.authenticate();
    console.log('✅ Connected successfully to database.\n');

    // 1. Fetch target users
    const [rawUsers]: any = await customSequelize.query(
      `SELECT id, email, username, "fullName", is_subscribed, subscription_expires_at, active_subscription_plan_id 
       FROM users 
       WHERE email IN (:emails)`,
      {
        replacements: { emails: targetEmails },
      }
    );

    if (!rawUsers || rawUsers.length === 0) {
      console.warn(`⚠️ No users found matching emails: ${targetEmails.join(', ')}`);
      console.log('Please verify you are connected to the correct database (Live vs Local).');
      return;
    }

    console.log(`🔍 Found ${rawUsers.length} user(s):`);
    for (const u of rawUsers) {
      console.log(`  - User: ${u.email} | ID: ${u.id} | is_subscribed: ${u.is_subscribed} | expires: ${u.subscription_expires_at}`);
    }

    // 2. Fetch default active subscription plan (e.g., Monthly Plan or highest plan)
    const [plans]: any = await customSequelize.query(
      `SELECT id, name, duration_days, apple_product_id, google_product_id, bonus_coins 
       FROM subscription_plans 
       WHERE is_active = true 
       ORDER BY id ASC`
    );

    const selectedPlan = plans.find((p: any) => p.id === 2) || plans[0] || {
      id: 2,
      name: 'One Month + 200 Coin',
      duration_days: 30,
      google_product_id: 'one_month_subscription_plan',
      apple_product_id: 'com.flirttime.monthly',
      bonus_coins: 200,
    };

    console.log(`\n📦 Using Subscription Plan ID ${selectedPlan.id} ("${selectedPlan.name}")`);

    // 3. Set expiry to 1 year from now (365 days)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Detect timestamp column names dynamically for table resilience
    const [subCols]: any = await customSequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_subscriptions' AND column_name IN ('createdAt', 'created_at', 'updatedAt', 'updated_at')
    `);
    const subCreatedCol = subCols.some((c: any) => c.column_name === 'created_at') ? 'created_at' : '"createdAt"';
    const subUpdatedCol = subCols.some((c: any) => c.column_name === 'updated_at') ? 'updated_at' : '"updatedAt"';

    const [userCols]: any = await customSequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name IN ('updatedAt', 'updated_at')
    `);
    const userUpdatedCol = userCols.some((c: any) => c.column_name === 'updated_at') ? 'updated_at' : '"updatedAt"';

    for (const u of rawUsers) {
      console.log(`\n⚙️ Granting active subscription to: ${u.email} (${u.id})...`);

      // Update users table
      await customSequelize.query(
        `UPDATE users 
         SET is_subscribed = true, 
             subscription_expires_at = :expiresAt, 
             active_subscription_plan_id = :planId, 
             ${userUpdatedCol} = NOW() 
         WHERE id = :userId`,
        {
          replacements: {
            expiresAt,
            planId: selectedPlan.id,
            userId: u.id,
          },
        }
      );

      // Create / Ensure active UserSubscription record
      const transactionId = `manual_grant_${u.id}_${Date.now()}`;
      await customSequelize.query(
        `INSERT INTO user_subscriptions (
          id,
          user_id,
          plan_id,
          platform,
          product_id,
          store_transaction_id,
          status,
          is_entitled,
          starts_at,
          expires_at,
          auto_renewing,
          currency,
          environment,
          acknowledged,
          bonus_coins_credited,
          bonus_coins_amount,
          ${subCreatedCol},
          ${subUpdatedCol}
        ) VALUES (
          gen_random_uuid(),
          :userId,
          :planId,
          'android',
          :productId,
          :transactionId,
          'active',
          true,
          NOW(),
          :expiresAt,
          true,
          'USD',
          'production',
          true,
          true,
          :bonusCoins,
          NOW(),
          NOW()
        )`,
        {
          replacements: {
            userId: u.id,
            planId: selectedPlan.id,
            productId: selectedPlan.google_product_id || 'one_month_subscription_plan',
            transactionId,
            expiresAt,
            bonusCoins: selectedPlan.bonus_coins || 200,
          },
        }
      );

      console.log(`  ✅ Successfully updated user ${u.email} -> is_subscribed = true, expires = ${expiresAt.toISOString()}`);
    }

    // 4. Verify results
    console.log('\n📊 Final Verification:');
    const [verifiedUsers]: any = await customSequelize.query(
      `SELECT id, email, is_subscribed, subscription_expires_at, active_subscription_plan_id 
       FROM users 
       WHERE email IN (:emails)`,
      {
        replacements: { emails: targetEmails },
      }
    );

    for (const vu of verifiedUsers) {
      console.log(`  ✨ ${vu.email}: is_subscribed = ${vu.is_subscribed}, plan_id = ${vu.active_subscription_plan_id}, expires = ${vu.subscription_expires_at}`);
    }

    console.log('\n🎉 All operations completed successfully.');
  } catch (error: any) {
    console.error('❌ Error executing script:', error.message || error);
    process.exit(1);
  } finally {
    await customSequelize.close();
  }
}

run();
