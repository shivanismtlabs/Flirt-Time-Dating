import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Conversation,
  ChatMessage,
  ConversationUserState,
  QuickMoment,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Quick moment view keeps the chat conversation', () => {
  let viewer: User;
  let author: User;
  let viewerToken: string;
  let authorToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await ConversationUserState.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await User.destroy({ where: {} });

    viewer = await User.create({
      username: 'viewer_qm',
      email: 'viewer_qm@flirttime.test',
      fullName: 'Viewer Quinn',
      firstName: 'Viewer',
      isActive: true,
      role: 'user',
    });
    author = await User.create({
      username: 'author_qm',
      email: 'author_qm@flirttime.test',
      fullName: 'Author Quinn',
      firstName: 'Author',
      isActive: true,
      role: 'user',
    });
    viewerToken = generateToken({ id: viewer.id, role: 'user' });
    authorToken = generateToken({ id: author.id, role: 'user' });
  });

  async function seedChat(options: { blankPreview?: boolean; hideViewer?: boolean } = {}) {
    const [u1, u2] = [viewer.id, author.id].sort();
    const sentAt = new Date(Date.now() - 60_000);
    const conversation = await Conversation.create({
      user1Id: u1,
      user2Id: u2,
      lastMessage: options.blankPreview ? '' : 'See you tonight',
      lastMessageAt: options.blankPreview && options.hideViewer ? new Date() : sentAt,
    });
    await ChatMessage.create({
      conversationId: conversation.id,
      senderId: author.id,
      recipientId: viewer.id,
      content: 'See you tonight',
      messageType: 'text',
      isRead: false,
      createdAt: sentAt,
    });
    if (options.hideViewer) {
      const openedAt = conversation.lastMessageAt || new Date();
      await ConversationUserState.create({
        conversationId: conversation.id,
        userId: viewer.id,
        isDeleted: true,
        deletedAt: new Date(openedAt.getTime() + 1000),
        clearedAt: new Date(openedAt.getTime() + 1000),
        isArchived: false,
      });
    }
    return conversation;
  }

  async function storyForAuthor() {
    return QuickMoment.create({
      userId: author.id,
      type: 'text',
      text: 'Out for coffee',
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      status: 'active',
    });
  }

  function idsInList(body: any): string[] {
    const rows = [...(body.data.pinned || []), ...(body.data.conversations || [])];
    return rows.map((row) => row.participant?.userId);
  }

  it('keeps the author in the viewer chat list after the quick moment is opened and marked viewed', async () => {
    await seedChat({ blankPreview: true, hideViewer: true });
    const story = await storyForAuthor();

    const opened = await request(app)
      .get(`/api/v1/quick-moments/user/${author.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(opened.status).toBe(200);

    const viewed = await request(app)
      .post(`/api/v1/quick-moments/${story.id}/view`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewed.status).toBe(200);

    const list = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(list.status).toBe(200);
    expect(idsInList(list.body)).toContain(author.id);
    const row = list.body.data.conversations.find((item: any) => item.participant.userId === author.id)
      || list.body.data.pinned.find((item: any) => item.participant.userId === author.id);
    expect(row.lastMessage.content).toBe('See you tonight');

    const authorList = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${authorToken}`);
    expect(idsInList(authorList.body)).toContain(viewer.id);
  });

  it('does not hide the other person when an existing chat is opened while their story is viewed', async () => {
    await seedChat();
    const story = await storyForAuthor();

    const started = await request(app)
      .post('/api/v1/chats')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ recipientId: author.id });
    expect(started.status).toBe(200);

    await request(app)
      .post(`/api/v1/quick-moments/${story.id}/view`)
      .set('Authorization', `Bearer ${viewerToken}`);

    const viewerList = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${viewerToken}`);
    const authorList = await request(app)
      .get('/api/v1/chats')
      .set('Authorization', `Bearer ${authorToken}`);

    expect(idsInList(viewerList.body)).toContain(author.id);
    expect(idsInList(authorList.body)).toContain(viewer.id);

    const authorState = await ConversationUserState.findOne({
      where: { userId: author.id },
    });
    expect(authorState?.isDeleted).not.toBe(true);
  });
});
