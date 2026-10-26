import { initDb } from './src/models';
import { User } from './src/models/user.model';
import { Conversation } from './src/models/conversation.model';
import { ChatMessage } from './src/models/chatMessage.model';
import { chatService } from './src/services/chat.service';

async function run() {
  process.env.NODE_ENV = 'test';
  await initDb(true);

  const userA = await User.create({
    username: 'user_a',
    email: 'a@example.com',
    fullName: 'Alice Walker',
    firstName: 'Alice',
    lastName: 'Walker',
    profilePicture: 'photos/alice.jpg',
    isActive: true,
    role: 'user',
  });

  const userB = await User.create({
    username: 'user_b',
    email: 'b@example.com',
    fullName: 'Bob Smith',
    firstName: 'Bob',
    lastName: 'Smith',
    profilePicture: 'photos/bob.jpg',
    isActive: true,
    role: 'user',
  });

  const [u1, u2] = [userA.id, userB.id].sort();
  const conv = await Conversation.create({
    user1Id: u1,
    user2Id: u2,
  });

  // 1. Send msg1
  const msg1 = await chatService.sendMessage(userA.id, conv.id, {
    messageType: 'text',
    content: 'Hello World 1',
  });
  console.log('msg1 created:', msg1.id);

  // 2. Pin msg1
  const pin1 = await chatService.pinMessage(userA.id, conv.id, msg1.id, true);
  console.log('pin1 result:', {
    messageId: pin1.messageId,
    isPinned: pin1.isPinned,
    pinnedContent: pin1.message?.content,
  });

  // 3. getMessages after 1st pin
  const history1 = await chatService.getMessages(userA.id, conv.id);
  console.log('history1 pinnedMessages length:', history1.pinnedMessages.length);
  console.log('history1 pinnedMessages[0]:', {
    id: history1.pinnedMessages[0]?.id,
    content: history1.pinnedMessages[0]?.content,
    sender: history1.pinnedMessages[0]?.sender,
    isPinned: history1.pinnedMessages[0]?.isPinned,
  });

  // 4. Send msg2
  const msg2 = await chatService.sendMessage(userB.id, conv.id, {
    messageType: 'text',
    content: 'How are you 2',
  });
  console.log('msg2 created:', msg2.id);

  // 5. Pin msg2
  const pin2 = await chatService.pinMessage(userA.id, conv.id, msg2.id, true);
  console.log('pin2 result:', {
    messageId: pin2.messageId,
    isPinned: pin2.messageId,
    pinnedContent: pin2.message?.content,
  });

  // 6. getMessages after 2nd pin
  const history2 = await chatService.getMessages(userA.id, conv.id);
  console.log('history2 pinnedMessages length:', history2.pinnedMessages.length);
  console.log('history2 pinnedMessages contents:', history2.pinnedMessages.map(m => ({
    id: m.id,
    content: m.content,
    isPinned: m.isPinned,
    pinned: m.pinned,
  })));

  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
