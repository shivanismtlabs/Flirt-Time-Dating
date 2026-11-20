import { sequelize } from '../config/database';
import { User } from '../models/user.model';
import { Conversation } from '../models/conversation.model';
import { ChatMessage } from '../models/chatMessage.model';

async function main() {
  const convs = await Conversation.findAll({ order: [['updatedAt', 'DESC']], limit: 5 });
  console.log('CONVERSATIONS:');
  for (const c of convs) {
    console.log({ id: c.id, user1Id: c.user1Id, user2Id: c.user2Id, lastMessage: c.lastMessage, lastMessageAt: c.lastMessageAt });
  }

  const msgs = await ChatMessage.findAll({ order: [['createdAt', 'DESC']], limit: 15 });
  console.log('LATEST MESSAGES:');
  for (const m of msgs) {
    console.log({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      messageType: m.messageType,
      content: m.content?.slice(0, 100),
      metadata: m.metadata,
      createdAt: m.createdAt,
    });
  }

  process.exit(0);
}

main().catch(console.error);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
