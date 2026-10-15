import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Moment,
  MomentMedia,
  MomentReaction,
  MomentCommentLike,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { s3Service } from '../src/services/s3.service';

describe('Moment Comment Like & Comment Reply APIs', () => {
  let creatorUser: User;
  let commenterUser: User;
  let replierUser: User;
  let blockedUser: User;
  let creatorToken: string;
  let commenterToken: string;
  let replierToken: string;
  let blockedToken: string;
  let momentId: string;
  let commentId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear tables
    await MomentCommentLike.destroy({ where: {} });
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await MomentReaction.destroy({ where: {} });
    await MomentMedia.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await Match.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await User.destroy({ where: {} });

    jest.spyOn(s3Service, 'uploadMedia').mockImplementation(
      async (_buf, userId, _mime, folder) => `${folder}/${userId}/${Date.now()}_test.jpg`
    );
    jest.spyOn(s3Service, 'deleteObject').mockResolvedValue(undefined);

    creatorUser = await User.create({
      username: 'ananya_creator',
      email: 'ananya@example.com',
      fullName: 'Ananya Roy',
      firstName: 'Ananya',
      city: 'Delhi',
      isActive: true,
      role: 'user',
    });

    commenterUser = await User.create({
      username: 'kabir_commenter',
      email: 'kabir@example.com',
      fullName: 'Kabir Verma',
      firstName: 'Kabir',
      city: 'Delhi',
      isActive: true,
      role: 'user',
    });

    replierUser = await User.create({
      username: 'rohit_replier',
      email: 'rohit@example.com',
      fullName: 'Rohit Sen',
      firstName: 'Rohit',
      city: 'Delhi',
      isActive: true,
      role: 'user',
    });

    blockedUser = await User.create({
      username: 'blocked_user',
      email: 'blocked@example.com',
      fullName: 'Blocked User',
      city: 'Delhi',
      isActive: true,
      role: 'user',
    });

    creatorToken = generateToken({ id: creatorUser.id, email: creatorUser.email, role: 'user' });
    commenterToken = generateToken({ id: commenterUser.id, email: commenterUser.email, role: 'user' });
    replierToken = generateToken({ id: replierUser.id, email: replierUser.email, role: 'user' });
    blockedToken = generateToken({ id: blockedUser.id, email: blockedUser.email, role: 'user' });

    // Create a moment for creator
    const m = await Moment.create({
      userId: creatorUser.id,
      caption: 'Sunset in Delhi',
      audience: 'everyone',
      status: 'active',
      publishedAt: new Date(),
    });
    momentId = m.id;

    await MomentMedia.create({
      momentId,
      mediaUrl: 'moments/delhi_sunset.jpg',
      mediaType: 'image',
      displayOrder: 0,
    });

    // Kabir posts a top-level comment
    const commentRes = await request(app)
      .post(`/api/v1/moments/${momentId}/comments`)
      .set('Authorization', `Bearer ${commenterToken}`)
      .send({ comment: 'Breathtaking view! 🌆' });

    expect(commentRes.status).toBe(201);
    commentId = commentRes.body.data.commentId;
  });

  describe('1. Moment Comment Like API', () => {
    it('should like a comment via POST /api/v1/moments/:momentId/comments/:commentId/like', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/liked successfully/i);
      expect(res.body.data.commentId).toBe(commentId);
      expect(res.body.data.isLiked).toBe(true);
      expect(res.body.data.likesCount).toBe(1);
    });

    it('should like a comment directly via POST /api/v1/moments/comments/:commentId/like', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLiked).toBe(true);
      expect(res.body.data.likesCount).toBe(1);
    });

    it('should toggle like on consecutive calls', async () => {
      // First call -> like
      const res1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/toggle-like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      expect(res1.status).toBe(200);
      expect(res1.body.data.isLiked).toBe(true);
      expect(res1.body.data.likesCount).toBe(1);

      // Second call -> unlike
      const res2 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/toggle-like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      expect(res2.status).toBe(200);
      expect(res2.body.data.isLiked).toBe(false);
      expect(res2.body.data.likesCount).toBe(0);
    });

    it('should explicitly unlike a comment via DELETE /api/v1/moments/:momentId/comments/:commentId/like', async () => {
      // Like first
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      // Unlike
      const res = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/unliked successfully/i);
      expect(res.body.data.isLiked).toBe(false);
      expect(res.body.data.likesCount).toBe(0);
    });

    it('should explicitly unlike via POST /api/v1/moments/:momentId/comments/:commentId/unlike', async () => {
      // Like first
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send();

      // Unlike
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/unlike`)
        .set('Authorization', `Bearer ${creatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isLiked).toBe(false);
      expect(res.body.data.likesCount).toBe(0);
    });

    it('should list users who liked a comment via GET /api/v1/moments/:momentId/comments/:commentId/likes', async () => {
      // 2 users like the comment
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send();

      const res = await request(app)
        .get(`/api/v1/moments/${momentId}/comments/${commentId}/likes`)
        .set('Authorization', `Bearer ${commenterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.commentId).toBe(commentId);
      expect(res.body.data.totalLikes).toBe(2);
      expect(res.body.data.users).toHaveLength(2);
      const userIds = res.body.data.users.map((u: any) => u.id);
      expect(userIds).toContain(replierUser.id);
      expect(userIds).toContain(creatorUser.id);
    });

    it('should return 404 when liking a non-existent comment', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${fakeId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Moment Comment Reply API (Canonical REST)', () => {
    it('should reply to a comment via canonical POST /api/v1/moments/:momentId/comments/:commentId/replies', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Totally agree, colors are unreal! ✨' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toMatch(/reply posted successfully/i);
      expect(res.body.data.replyId).toBeDefined();
      expect(res.body.data.commentId).toBeDefined();
      expect(res.body.data.parentCommentId).toBe(commentId);
      expect(res.body.data.parentReplyId).toBeNull();
      expect(res.body.data.momentId).toBe(momentId);
      expect(res.body.data.reply).toBe('Totally agree, colors are unreal! ✨');
      expect(res.body.data.user.id).toBe(replierUser.id);
      expect(res.body.data.likesCount).toBe(0);
      expect(res.body.data.isLiked).toBe(false);
      expect(res.body.data.canDelete).toBe(true);
    });

    it('should post a nested sub-reply with parentReplyId via canonical POST endpoint', async () => {
      // 1. Post parent reply
      const parentReplyRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Parent reply here!' });

      expect(parentReplyRes.status).toBe(201);
      const parentReplyId = parentReplyRes.body.data.replyId;

      // 2. Post sub-reply referencing parentReplyId
      const subReplyRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({
          reply: 'Sub-reply to the parent reply!',
          parentReplyId,
        });

      expect(subReplyRes.status).toBe(201);
      expect(subReplyRes.body.success).toBe(true);
      expect(subReplyRes.body.data.parentCommentId).toBe(commentId);
      expect(subReplyRes.body.data.parentReplyId).toBe(parentReplyId);
      expect(subReplyRes.body.data.reply).toBe('Sub-reply to the parent reply!');
    });

    it('should support alternative body fields (comment, message, text)', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ comment: 'Thank you both!' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parentCommentId).toBe(commentId);
      expect(res.body.data.reply).toBe('Thank you both!');
    });

    it('should reject empty reply with 400', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: '   ' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject invalid UUID format with 400 validation error', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/invalid-moment-uuid/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Valid text' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should reject cross-moment mismatch with 404 when comment belongs to another moment', async () => {
      // Create another moment
      const otherMoment = await Moment.create({
        userId: creatorUser.id,
        caption: 'Another moment',
        audience: 'everyone',
        status: 'active',
        publishedAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/v1/moments/${otherMoment.id}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'This comment does not belong to otherMoment' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to the specified moment/i);
    });

    it('should reject cross-thread mismatch with 404 when parentReplyId belongs to another comment', async () => {
      // 1. Create a second comment on this moment
      const secondCommentRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments`)
        .set('Authorization', `Bearer ${commenterToken}`)
        .send({ comment: 'Second top comment' });
      const secondCommentId = secondCommentRes.body.data.commentId;

      // 2. Post reply on comment 1
      const replyOn1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply on comment 1' });
      const replyOn1Id = replyOn1.body.data.replyId;

      // 3. Try to reply to second comment with parentReplyId from comment 1
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${secondCommentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({
          reply: 'Mismatch attempt',
          parentReplyId: replyOn1Id,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/does not belong to the specified comment/i);
    });

    it('should get all replies for a comment via GET /api/v1/moments/:momentId/comments/:commentId/replies', async () => {
      // Rohit replies
      const reply1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply 1 from Rohit' });

      // Ananya replies
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ reply: 'Reply 2 from Ananya' });

      // Kabir likes reply 1
      const reply1Id = reply1.body.data.replyId;
      await request(app)
        .post(`/api/v1/moments/comments/${reply1Id}/like`)
        .set('Authorization', `Bearer ${commenterToken}`)
        .send();

      const getRes = await request(app)
        .get(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${commenterToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.commentId).toBe(commentId);
      expect(getRes.body.data.totalReplies).toBe(2);
      expect(getRes.body.data.parentComment.comment).toBe('Breathtaking view! 🌆');
      expect(getRes.body.data.replies).toHaveLength(2);
      expect(getRes.body.data.replies[0].reply).toBe('Reply 1 from Rohit');
      expect(getRes.body.data.replies[0].likesCount).toBe(1);
      expect(getRes.body.data.replies[0].isLiked).toBe(true); // Kabir liked it
      expect(getRes.body.data.replies[1].reply).toBe('Reply 2 from Ananya');

      // Test pagination
      const pageRes = await request(app)
        .get(`/api/v1/moments/${momentId}/comments/${commentId}/replies?page=1&limit=1`)
        .set('Authorization', `Bearer ${commenterToken}`);
      expect(pageRes.status).toBe(200);
      expect(pageRes.body.data.replies).toHaveLength(1);
      expect(pageRes.body.data.totalReplies).toBe(2);
      expect(pageRes.body.data.totalPages).toBe(2);
    });

    it('should allow author of reply, moment creator, or comment author to delete a reply', async () => {
      // 1. Reply author deletes own reply
      const replyRes1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply to delete by author' });
      const replyId1 = replyRes1.body.data.replyId;

      const delRes1 = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId1}`)
        .set('Authorization', `Bearer ${replierToken}`);
      expect(delRes1.status).toBe(200);
      expect(delRes1.body.success).toBe(true);

      // 2. Moment creator deletes another user's reply on their moment
      const replyRes2 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply to delete by moment creator' });
      const replyId2 = replyRes2.body.data.replyId;

      const delRes2 = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId2}`)
        .set('Authorization', `Bearer ${creatorToken}`);
      expect(delRes2.status).toBe(200);
      expect(delRes2.body.success).toBe(true);

      // 3. Parent comment author deletes reply on their comment thread
      const replyRes3 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply to delete by parent comment author' });
      const replyId3 = replyRes3.body.data.replyId;

      const delRes3 = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId3}`)
        .set('Authorization', `Bearer ${commenterToken}`);
      expect(delRes3.status).toBe(200);
      expect(delRes3.body.success).toBe(true);
    });

    it('should reject unauthorized user from deleting someone elses reply with 403', async () => {
      // Replier posts reply
      const replyRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Private reply' });

      const replyId = replyRes.body.data.replyId;

      // Blocked user (unrelated third party) tries to delete
      const delRes = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId}`)
        .set('Authorization', `Bearer ${blockedToken}`);

      expect(delRes.status).toBe(403);
      expect(delRes.body.success).toBe(false);
      expect(delRes.body.message).toMatch(/not authorized to delete this reply/i);
    });

    it('should return 404 when deleting with cross-resource mismatch or non-existent IDs', async () => {
      const fakeId = '00000000-0000-4000-8000-000000000000';
      const res = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${fakeId}`)
        .set('Authorization', `Bearer ${replierToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('should verify that all removed duplicate reply routes return 404', async () => {
      const fakeUuid = '00000000-0000-4000-8000-000000000000';

      // 1. POST /api/v1/moments/:momentId/comments/:commentId/reply
      const r1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/reply`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Test' });
      expect(r1.status).toBe(404);

      // 2. POST /api/v1/moments/comments/:commentId/replies
      const r2 = await request(app)
        .post(`/api/v1/moments/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Test' });
      expect(r2.status).toBe(404);

      // 3. POST /api/v1/moments/comments/:commentId/reply
      const r3 = await request(app)
        .post(`/api/v1/moments/comments/${commentId}/reply`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Test' });
      expect(r3.status).toBe(404);

      // 4. GET /api/v1/moments/comments/:commentId/replies
      const r4 = await request(app)
        .get(`/api/v1/moments/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`);
      expect(r4.status).toBe(404);

      // 5. DELETE /api/v1/moments/comments/:commentId/replies/:replyId
      const r5 = await request(app)
        .delete(`/api/v1/moments/comments/${commentId}/replies/${fakeUuid}`)
        .set('Authorization', `Bearer ${replierToken}`);
      expect(r5.status).toBe(404);
    });
  });

  describe('3. Top-Level Comments Listing Enrichment', () => {
    it('should accurately return likesCount, isLiked, and repliesCount on top-level comments', async () => {
      // 1. Replier likes the comment
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      // 2. Replier replies to the comment
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Nice picture!' });

      // 3. Replier fetches top-level comments list
      const res = await request(app)
        .get(`/api/v1/moments/${momentId}/comments`)
        .set('Authorization', `Bearer ${replierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalComments).toBe(1); // Only 1 top-level comment
      expect(res.body.data.comments).toHaveLength(1);

      const topComment = res.body.data.comments[0];
      expect(topComment.commentId).toBe(commentId);
      expect(topComment.likesCount).toBe(1);
      expect(topComment.isLiked).toBe(true);
      expect(topComment.repliesCount).toBe(1);
    });

    it('should cascade delete all child replies and comment likes when a top-level comment is deleted', async () => {
      // 1. Replier likes the comment
      await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send();

      // 2. Replier replies to the comment
      const replyRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply to be cascaded' });

      const replyId = replyRes.body.data.replyId;

      // 3. Commenter deletes their top-level comment
      const delRes = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${commenterToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // 4. Verify reply was also deleted
      const checkReply = await ChatMessage.findByPk(replyId);
      expect(checkReply).toBeNull();

      // 5. Verify comment likes were also cleaned up
      const checkLikes = await MomentCommentLike.count({ where: { commentId } });
      expect(checkLikes).toBe(0);
    });
  });

  describe('4. Privacy & Block Restrictions', () => {
    beforeEach(async () => {
      // Block creatorUser <-> blockedUser
      await UserBlock.create({
        userId: creatorUser.id,
        blockedUserId: blockedUser.id,
      });
    });

    it('should reject blocked user from liking a comment with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/like`)
        .set('Authorization', `Bearer ${blockedToken}`)
        .send();

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });

    it('should reject blocked user from replying to a comment with 403', async () => {
      const res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${blockedToken}`)
        .send({ reply: 'Should be rejected' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/privacy restrictions/i);
    });
  });

  describe('5. Nested Sub-replies Hierarchy & "Sub Reply ke Reply" retrieval', () => {
    it('should return all descendant replies (sub-replies and replies to sub-replies) when fetching comment replies', async () => {
      // 1. Replier posts Reply 1 to Comment
      const r1Res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply 1 by Rohit' });
      expect(r1Res.status).toBe(201);
      const r1Id = r1Res.body.data.replyId;

      // 2. Creator posts Sub-reply S1 to Reply 1
      const s1Res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ reply: 'Sub-reply S1 by Ananya to Rohit', parentReplyId: r1Id });
      expect(s1Res.status).toBe(201);
      const s1Id = s1Res.body.data.replyId;
      expect(s1Res.body.data.replyToUsername).toBe(replierUser.username);

      // 3. Commenter posts reply to Sub-reply S1 (Sub reply ke reply!)
      const t1Res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${commenterToken}`)
        .send({ reply: 'Reply T1 by Kabir to Sub-reply S1', parentReplyId: s1Id });
      expect(t1Res.status).toBe(201);
      const t1Id = t1Res.body.data.replyId;
      expect(t1Res.body.data.replyToUsername).toBe(creatorUser.username);

      // 4. Replier posts reply to T1 passing T1 directly in the URL param
      const u1Res = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${t1Id}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply U1 by Rohit to T1 via sub-reply URL' });
      expect(u1Res.status).toBe(201);
      const u1Id = u1Res.body.data.replyId;
      expect(u1Res.body.data.parentCommentId).toBe(commentId);
      expect(u1Res.body.data.parentReplyId).toBe(t1Id);
      expect(u1Res.body.data.replyToUsername).toBe(commenterUser.username);

      // 5. Fetch all replies for commentId via GET /api/v1/moments/:momentId/comments/:commentId/replies
      const getRepliesRes = await request(app)
        .get(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${commenterToken}`);

      expect(getRepliesRes.status).toBe(200);
      expect(getRepliesRes.body.success).toBe(true);
      expect(getRepliesRes.body.data.totalReplies).toBe(4);
      expect(getRepliesRes.body.data.replies).toHaveLength(4);

      const returnedIds = getRepliesRes.body.data.replies.map((r: any) => r.id);
      expect(returnedIds).toContain(r1Id);
      expect(returnedIds).toContain(s1Id);
      expect(returnedIds).toContain(t1Id);
      expect(returnedIds).toContain(u1Id);

      // Verify nested replies hierarchy on R1
      const r1Item = getRepliesRes.body.data.replies.find((r: any) => r.id === r1Id);
      expect(r1Item.replies).toHaveLength(1);
      expect(r1Item.replies[0].id).toBe(s1Id);

      const s1Item = r1Item.replies[0];
      expect(s1Item.replies).toHaveLength(1);
      expect(s1Item.replies[0].id).toBe(t1Id);

      const t1Item = s1Item.replies[0];
      expect(t1Item.replies).toHaveLength(1);
      expect(t1Item.replies[0].id).toBe(u1Id);

      // 6. Fetch top-level comments list via GET /api/v1/moments/:momentId/comments
      const getCommentsRes = await request(app)
        .get(`/api/v1/moments/${momentId}/comments`)
        .set('Authorization', `Bearer ${commenterToken}`);

      expect(getCommentsRes.status).toBe(200);
      expect(getCommentsRes.body.data.comments).toHaveLength(1);
      const commentData = getCommentsRes.body.data.comments[0];
      expect(commentData.repliesCount).toBe(4);
      expect(commentData.replies).toHaveLength(4);
      expect(commentData.replies.map((r: any) => r.id)).toContain(t1Id);
      expect(commentData.replies.map((r: any) => r.id)).toContain(u1Id);
    });

    it('should cascade delete all nested sub-replies when root comment is deleted', async () => {
      // Create sub-replies chain
      const r1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply 1' });
      const s1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send({ reply: 'Sub-reply S1', parentReplyId: r1.body.data.replyId });
      const t1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${s1.body.data.replyId}/replies`)
        .set('Authorization', `Bearer ${commenterToken}`)
        .send({ reply: 'Sub-reply T1' });

      // Delete root comment
      const delRes = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${commenterToken}`);
      expect(delRes.status).toBe(200);

      // Verify all sub-replies deleted
      expect(await ChatMessage.findByPk(r1.body.data.replyId)).toBeNull();
      expect(await ChatMessage.findByPk(s1.body.data.replyId)).toBeNull();
      expect(await ChatMessage.findByPk(t1.body.data.replyId)).toBeNull();
    });

    it('should like and unlike a sub-comment via dedicated sub-comment reply like endpoint', async () => {
      // 1. Post a reply
      const r1 = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies`)
        .set('Authorization', `Bearer ${replierToken}`)
        .send({ reply: 'Reply to like' });
      const replyId = r1.body.data.replyId;

      // 2. Like sub-comment via /moments/:momentId/comments/:commentId/replies/:replyId/like
      const likeRes = await request(app)
        .post(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId}/like`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .send();
      expect(likeRes.status).toBe(200);
      expect(likeRes.body.success).toBe(true);
      expect(likeRes.body.data.commentId).toBe(replyId);
      expect(likeRes.body.data.isLiked).toBe(true);
      expect(likeRes.body.data.likesCount).toBe(1);

      // 3. Get likes for this sub-comment
      const getLikesRes = await request(app)
        .get(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId}/likes`)
        .set('Authorization', `Bearer ${creatorToken}`);
      expect(getLikesRes.status).toBe(200);
      expect(getLikesRes.body.data.totalLikes).toBe(1);
      expect(getLikesRes.body.data.users[0].id).toBe(creatorUser.id);

      // 4. Unlike sub-comment via DELETE /moments/:momentId/comments/:commentId/replies/:replyId/like
      const unlikeRes = await request(app)
        .delete(`/api/v1/moments/${momentId}/comments/${commentId}/replies/${replyId}/like`)
        .set('Authorization', `Bearer ${creatorToken}`);
      expect(unlikeRes.status).toBe(200);
      expect(unlikeRes.body.data.isLiked).toBe(false);
      expect(unlikeRes.body.data.likesCount).toBe(0);
    });
  });
});

