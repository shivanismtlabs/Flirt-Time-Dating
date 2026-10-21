import { sequelize } from '../config/database';
import { User } from '../models/user.model';
import { Conversation } from '../models/conversation.model';

async function main() {
  const users = await User.findAll({ raw: true });
  console.log(`Total users: ${users.length}`);
  for (const u of users) {
    if (u.email?.includes('discovery')) continue;
    console.log('Non-discovery user:', JSON.stringify({
      id: u.id,
      fullName: u.fullName,
      firstName: u.firstName,
      lastName: u.lastName,
      nickName: u.nickName,
      username: u.username,
      email: u.email
    }));
  }
  
  // Also check if any dummy user has asif or tush in any field
  for (const u of users) {
    const str = JSON.stringify(u).toLowerCase();
    if (str.includes('asif') || str.includes('tush') || str.includes('khan')) {
      console.log('MATCHED USER:', u);
    }
  }

  process.exit(0);
}

main().catch(console.error);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
