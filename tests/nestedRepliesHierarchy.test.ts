import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  ChatMessage,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Nested Replies Hierarchy Verification', () => {
  let userA: User;
  let userB: User;
  let userC: User;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let moment: Moment;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await ChatMessage.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'user_a',
      email: 'a@example.com',
      fullName: 'User A',
      isActive: true,
      role: 'user',
    });
    userB = await User.create({
      username: 'user_b',
      email: 'b@example.com',
      fullName: 'User B',
      isActive: true,
      role: 'user',
    });
    userC = await User.create({
      username: 'user_c',
      email: 'c@example.com',
      fullName: 'User C',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, email: userA.email, role: 'user' });
    tokenB = generateToken({ id: userB.id, email: userB.email, role: 'user' });
    tokenC = generateToken({ id: userC.id, email: userC.email, role: 'user' });

    moment = await Moment.create({
      userId: userA.id,
      caption: 'Test moment',
      audience: 'everyone',
      status: 'active',
      publishedAt: new Date(),
    });
    await MomentMedia.create({
      momentId: moment.id,
      mediaUrl: 'moments/test.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });
  });

  it('Flow 1: Reply-to-reply created by POSTing to /comments/:replyId/replies', async () => {
    // 1. Create top-level comment
    const c1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ comment: 'Original comment' });
    expect(c1.status).toBe(201);
    const commentId = c1.body.data.id;

    // 2. Create reply-1 replying to commentId
    const r1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${commentId}/replies`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ reply: 'First reply' });
    expect(r1.status).toBe(201);
    const reply1Id = r1.body.data.id;
    expect(r1.body.data.parentCommentId).toBe(commentId);
    expect(r1.body.data.parentReplyId).toBeNull();

    // 3. Create reply-2 replying to reply1Id via /comments/:reply1Id/replies
    const r2 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${reply1Id}/replies`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ reply: 'Reply to first reply' });
    expect(r2.status).toBe(201);
    const reply2Id = r2.body.data.id;
    expect(r2.body.data.parentCommentId).toBe(commentId);
    expect(r2.body.data.parentReplyId).toBe(reply1Id);

    // 4. Fetch comments via GET /comments
    const getRes = await request(app)
      .get(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(getRes.status).toBe(200);
    const comments = getRes.body.data.comments;
    expect(comments).toHaveLength(1);
    const rootComment = comments[0];
    expect(rootComment.id).toBe(commentId);
    expect(rootComment.commentId).toBe(commentId);
    expect(rootComment.comment).toBe('Original comment');
    expect(rootComment.parentCommentId).toBeNull();
    expect(rootComment.parentReplyId).toBeNull();
    expect(rootComment.repliesCount).toBe(1); // 1 direct reply
    expect(rootComment.replies).toHaveLength(1);

    const firstReply = rootComment.replies[0];
    expect(firstReply.id).toBe(reply1Id);
    expect(firstReply.replyId).toBe(reply1Id);
    expect(firstReply.reply).toBe('First reply');
    expect(firstReply.parentCommentId).toBe(commentId);
    expect(firstReply.parentReplyId).toBeNull();
    expect(firstReply.repliesCount).toBe(1); // 1 direct sub-reply
    expect(firstReply.replies).toHaveLength(1);

    // MUST HAVE nested reply-2 inside firstReply.replies!
    const secondReply = firstReply.replies[0];
    expect(secondReply.id).toBe(reply2Id);
    expect(secondReply.replyId).toBe(reply2Id);
    expect(secondReply.reply).toBe('Reply to first reply');
    expect(secondReply.parentCommentId).toBe(commentId);
    expect(secondReply.parentReplyId).toBe(reply1Id);
    expect(secondReply.repliesCount).toBe(0);
    expect(secondReply.replies).toHaveLength(0);
  });

  it('Flow 2: Reply-to-reply created by POSTing to /comments with parentId = reply1Id', async () => {
    // 1. Create top-level comment
    const c1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ comment: 'Original comment' });
    const commentId = c1.body.data.id;

    // 2. Create reply-1
    const r1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ comment: 'First reply', parentId: commentId });
    const reply1Id = r1.body.data.id;

    // 3. Create reply-2 with parentId = reply1Id
    const r2 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ comment: 'Reply to first reply', parentId: reply1Id });
    expect(r2.status).toBe(201);
    const reply2Id = r2.body.data.id;

    // 4. Fetch comments via GET /comments
    const getRes = await request(app)
      .get(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(getRes.status).toBe(200);
    const comments = getRes.body.data.comments;
    expect(comments).toHaveLength(1);
    const rootComment = comments[0];
    expect(rootComment.repliesCount).toBe(1);
    expect(rootComment.replies).toHaveLength(1);
    const firstReply = rootComment.replies[0];
    expect(firstReply.id).toBe(reply1Id);
    expect(firstReply.repliesCount).toBe(1);
    expect(firstReply.replies).toHaveLength(1);
    const secondReply = firstReply.replies[0];
    expect(secondReply.id).toBe(reply2Id);
    expect(secondReply.parentCommentId).toBe(commentId);
    expect(secondReply.parentReplyId).toBe(reply1Id);
    expect(secondReply.repliesCount).toBe(0);
  });

  it('Flow 3: Reply-to-reply created by POSTing to /comments/:commentId/replies with parentReplyId', async () => {
    // 1. Create top-level comment
    const c1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ comment: 'Original comment' });
    const commentId = c1.body.data.id;

    // 2. Create reply-1
    const r1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${commentId}/replies`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ reply: 'First reply' });
    const reply1Id = r1.body.data.id;

    // 3. Create reply-2 with URL commentId = commentId and body parentReplyId = reply1Id
    const r2 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${commentId}/replies`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ reply: 'Reply to first reply', parentReplyId: reply1Id });
    expect(r2.status).toBe(201);
    const reply2Id = r2.body.data.id;

    // 4. Fetch comments via GET /comments
    const getRes = await request(app)
      .get(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(getRes.status).toBe(200);
    const comments = getRes.body.data.comments;
    expect(comments).toHaveLength(1);
    const rootComment = comments[0];
    expect(rootComment.repliesCount).toBe(1);
    expect(rootComment.replies).toHaveLength(1);
    const firstReply = rootComment.replies[0];
    expect(firstReply.id).toBe(reply1Id);
    expect(firstReply.repliesCount).toBe(1);
    expect(firstReply.replies).toHaveLength(1);
    const secondReply = firstReply.replies[0];
    expect(secondReply.id).toBe(reply2Id);
    expect(secondReply.parentCommentId).toBe(commentId);
    expect(secondReply.parentReplyId).toBe(reply1Id);
  });

  it('Flow 4: Three-level deep replies (Comment -> Reply 1 -> Reply 2 -> Reply 3)', async () => {
    // 1. Root comment
    const c1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ comment: 'Level 0 comment' });
    const commentId = c1.body.data.id;

    // 2. Reply 1
    const r1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${commentId}/replies`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ reply: 'Level 1 reply' });
    const r1Id = r1.body.data.id;

    // 3. Reply 2
    const r2 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${r1Id}/replies`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ reply: 'Level 2 reply' });
    const r2Id = r2.body.data.id;

    // 4. Reply 3 (replying to reply 2)
    const r3 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${r2Id}/replies`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ reply: 'Level 3 reply' });
    expect(r3.status).toBe(201);
    const r3Id = r3.body.data.id;
    expect(r3.body.data.parentCommentId).toBe(commentId);
    expect(r3.body.data.parentReplyId).toBe(r2Id);

    // 5. Verify recursive tree in GET /comments
    const getRes = await request(app)
      .get(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(getRes.status).toBe(200);
    const root = getRes.body.data.comments[0];
    expect(root.repliesCount).toBe(1);
    expect(root.replies).toHaveLength(1);

    const level1 = root.replies[0];
    expect(level1.id).toBe(r1Id);
    expect(level1.repliesCount).toBe(1);
    expect(level1.replies).toHaveLength(1);

    const level2 = level1.replies[0];
    expect(level2.id).toBe(r2Id);
    expect(level2.parentCommentId).toBe(commentId);
    expect(level2.parentReplyId).toBe(r1Id);
    expect(level2.repliesCount).toBe(1);
    expect(level2.replies).toHaveLength(1);

    const level3 = level2.replies[0];
    expect(level3.id).toBe(r3Id);
    expect(level3.parentCommentId).toBe(commentId);
    expect(level3.parentReplyId).toBe(r2Id);
    expect(level3.repliesCount).toBe(0);
    expect(level3.replies).toHaveLength(0);
  });

  it('Flow 5: Fetch replies via GET /comments?parentId=COMMENT_ID (OneVibe compatibility)', async () => {
    // 1. Root comment
    const c1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ comment: 'Root for parentId query' });
    const commentId = c1.body.data.id;

    // 2. Reply 1
    const r1 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${commentId}/replies`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ reply: 'Reply 1' });
    const r1Id = r1.body.data.id;

    // 3. Sub-reply
    const r2 = await request(app)
      .post(`/api/v1/moments/${moment.id}/comments/${r1Id}/replies`)
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ reply: 'Sub-reply to 1' });

    // 4. Query via GET /comments?parentId=COMMENT_ID
    const queryRes = await request(app)
      .get(`/api/v1/moments/${moment.id}/comments?parentId=${commentId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(queryRes.status).toBe(200);
    expect(queryRes.body.success).toBe(true);
    expect(queryRes.body.data.parentComment.id).toBe(commentId);
    expect(queryRes.body.data.replies).toHaveLength(1);
    expect(queryRes.body.data.replies[0].id).toBe(r1Id);
    expect(queryRes.body.data.replies[0].replies).toHaveLength(1);
    expect(queryRes.body.data.replies[0].replies[0].id).toBe(r2.body.data.id);
  });
});
