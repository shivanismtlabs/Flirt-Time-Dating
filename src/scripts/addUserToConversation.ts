/**
 * Production Script: Add user (aasif123@youpmail.com) to conversation list
 *
 * Usage (production):
 *   LIVE_DB_HOST=<prod_host> LIVE_DB_USER=<prod_user> LIVE_DB_PASSWORD=<prod_pass> LIVE_DB_SSL=true npx ts-node src/scripts/addUserToConversation.ts
 *
 * OR update .env DB_HOST to production IP and run:
 *   npx ts-node src/scripts/addUserToConversation.ts
 */

import { Sequelize } from 'sequelize';
import { env } from '../config/env';

// Target email to add into conversation list
const TARGET_EMAIL = 'aasif123@youpmail.com';

// Use LIVE_DB_* env vars if provided, else fallback to .env credentials
const dbHost = process.env.LIVE_DB_HOST || env.DB_HOST;
const dbPort = Number(process.env.LIVE_DB_PORT || env.DB_PORT);
const dbName = process.env.LIVE_DB_NAME || env.DB_NAME;
const dbUser = process.env.LIVE_DB_USER || env.DB_USER;
const dbPassword = process.env.LIVE_DB_PASSWORD || env.DB_PASSWORD;
const dbSsl = process.env.LIVE_DB_SSL === 'true' || env.DB_SSL;

async function run() {
  console.log('=====================================================');
  console.log('🚀 FlirtTime — Add User to Conversation List Script');
  console.log('=====================================================');
  console.log(`📡 Connecting to: ${dbHost}:${dbPort}/${dbName} (User: ${dbUser})`);

  const db = new Sequelize(dbName, dbUser, dbPassword, {
    host: dbHost,
    port: dbPort,
    dialect: 'postgres',
    logging: false,
    dialectOptions: dbSsl
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
  });

  try {
    await db.authenticate();
    console.log('✅ Connected to database.\n');

    // ── Step 1: Find target user ──────────────────────────────────────────────
    const [users]: any = await db.query(
      `SELECT id, email, username, "fullName", "isActive"
       FROM users
       WHERE email = :email
       LIMIT 1`,
      { replacements: { email: TARGET_EMAIL } }
    );

    if (!users || users.length === 0) {
      console.error(`❌ User not found in production DB: ${TARGET_EMAIL}`);
      console.log('Please verify the email address or database connection.');
      return;
    }

    const targetUser = users[0];
    console.log('🔍 Found target user:');
    console.log(`   ID       : ${targetUser.id}`);
    console.log(`   Email    : ${targetUser.email}`);
    console.log(`   Username : ${targetUser.username}`);
    console.log(`   FullName : ${targetUser.fullName}`);
    console.log(`   isActive : ${targetUser.isActive}`);

    if (!targetUser.isActive) {
      console.warn('\n⚠️  User account is INACTIVE. Activating...');
      await db.query(
        `UPDATE users SET "isActive" = true, "updatedAt" = NOW() WHERE id = :userId`,
        { replacements: { userId: targetUser.id } }
      );
      console.log('✅ User activated.');
    }

    // ── Step 2: Check existing conversations ─────────────────────────────────
    const [existingConvs]: any = await db.query(
      `SELECT id, user1Id, user2Id, "lastMessage", "lastMessageAt"
       FROM conversations
       WHERE (user1Id = :userId OR user2Id = :userId)
         AND ("isDeletedForEveryone" = false OR "isDeletedForEveryone" IS NULL)`,
      { replacements: { userId: targetUser.id } }
    );

    console.log(`\n📋 Existing conversations for this user: ${existingConvs.length}`);

    if (existingConvs.length > 0) {
      // ── Step 3a: Fix conversations that have no lastMessage (won't show in list) ──
      const emptyConvs = existingConvs.filter(
        (c: any) => !c.lastMessage && !c.lastMessageAt
      );

      if (emptyConvs.length > 0) {
        console.log(`\n⚙️  Found ${emptyConvs.length} conversation(s) with no messages (hidden from list). Fixing...`);
        for (const conv of emptyConvs) {
          const partnerId = conv.user1Id === targetUser.id ? conv.user2Id : conv.user1Id;

          // Fetch partner name
          const [partners]: any = await db.query(
            `SELECT id, "fullName", username FROM users WHERE id = :id LIMIT 1`,
            { replacements: { id: partnerId } }
          );
          const partnerName = partners[0]?.fullName || partners[0]?.username || 'User';

          await db.query(
            `UPDATE conversations
             SET "lastMessage" = :msg, "lastMessageAt" = NOW(), "updatedAt" = NOW()
             WHERE id = :convId`,
            {
              replacements: {
                convId: conv.id,
                msg: `👋 Hey!`,
              },
            }
          );

          console.log(`   ✅ Fixed conversation ${conv.id} with partner: ${partnerName} (${partnerId})`);
        }
      } else {
        console.log('   ℹ️  All existing conversations already have messages — they should appear in the list.');
      }
    } else {
      // ── Step 3b: No conversations exist — find an admin/test user to create one ──
      console.log('\n📭 No conversations found. Looking for an admin user to create a conversation...');

      const [admins]: any = await db.query(
        `SELECT id, email, username, "fullName"
         FROM users
         WHERE "isActive" = true AND id != :userId
         ORDER BY "createdAt" ASC
         LIMIT 1`,
        { replacements: { userId: targetUser.id } }
      );

      if (!admins || admins.length === 0) {
        console.error('❌ No other active users found to create a conversation with.');
        return;
      }

      const adminUser = admins[0];
      console.log(`   Using partner: ${adminUser.email} (${adminUser.id})`);

      const [u1, u2] = [targetUser.id, adminUser.id].sort();

      // Check if conversation already exists (even deleted)
      const [existingConv]: any = await db.query(
        `SELECT id FROM conversations WHERE user1Id = :u1 AND user2Id = :u2 LIMIT 1`,
        { replacements: { u1, u2 } }
      );

      if (existingConv.length > 0) {
        // Restore and fix it
        await db.query(
          `UPDATE conversations
           SET "isDeletedForEveryone" = false,
               "deletedForEveryoneAt" = NULL,
               "deletedForEveryoneBy" = NULL,
               "lastMessage" = '👋 Hey!',
               "lastMessageAt" = NOW(),
               "updatedAt" = NOW()
           WHERE id = :convId`,
          { replacements: { convId: existingConv[0].id } }
        );
        console.log(`✅ Restored existing conversation: ${existingConv[0].id}`);
      } else {
        // Create fresh conversation
        const [created]: any = await db.query(
          `INSERT INTO conversations (id, user1Id, user2Id, "lastMessage", "lastMessageAt", "isDeletedForEveryone", "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), :u1, :u2, '👋 Hey!', NOW(), false, NOW(), NOW())
           RETURNING id`,
          { replacements: { u1, u2 } }
        );
        console.log(`✅ Created new conversation: ${created[0]?.id}`);
      }
    }

    // ── Step 4: Verify final state ────────────────────────────────────────────
    console.log('\n📊 Final Verification:');
    const [finalConvs]: any = await db.query(
      `SELECT c.id, c.user1Id, c.user2Id, c."lastMessage", c."lastMessageAt"
       FROM conversations c
       WHERE (c.user1Id = :userId OR c.user2Id = :userId)
         AND ("isDeletedForEveryone" = false OR "isDeletedForEveryone" IS NULL)
         AND (c."lastMessage" IS NOT NULL OR c."lastMessageAt" IS NOT NULL)`,
      { replacements: { userId: targetUser.id } }
    );

    if (finalConvs.length > 0) {
      console.log(`✨ ${TARGET_EMAIL} will appear in conversation list with ${finalConvs.length} conversation(s):`);
      for (const c of finalConvs) {
        const partnerId = c.user1Id === targetUser.id ? c.user2Id : c.user1Id;
        console.log(`   - Conv ID: ${c.id} | Partner: ${partnerId} | Last msg: "${c.lastMessage}"`);
      }
    } else {
      console.warn(`⚠️  Still no visible conversations found. Manual check required.`);
    }

    console.log('\n🎉 Done!');
  } catch (error: any) {
    console.error('❌ Error:', error.message || error);
  } finally {
    await db.close();
  }
}

run();
