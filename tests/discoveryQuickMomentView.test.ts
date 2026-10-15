import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  QuickMoment,
  QuickMomentView,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Discover People API — hasViewedQuickMoment Story Status', () => {
  let viewerUser: User;
  let viewerToken: string;
  let otherViewerUser: User;
  let otherViewerToken: string;

  let candViewedSingle: User;
  let candViewedMulti: User;
  let candUnviewedSingle: User;
  let candUnviewedMulti: User;
  let candPartialViewed: User;
  let candExpiredOnly: User;
  let candExpiredViewedAndActiveUnviewed: User;
  let candExpiredUnviewedAndActiveViewed: User;
  let candMissingMoments: User;

  let testInterest: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    [testInterest] = await Interest.findOrCreate({
      where: { name: 'Music_QM_Test' },
      defaults: { name: 'Music_QM_Test', icon: '🎵', isActive: true },
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    await QuickMomentView.destroy({ where: {} });
    await QuickMoment.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });

    const now = new Date();
    const futureExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
    const pastExpiry = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

    // 1. Authenticated Viewer (Male, looking for women)
    viewerUser = await User.create({
      username: 'viewer_qm',
      email: 'viewer_qm@flirttime.app',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      city: 'Mumbai',
    });

    viewerToken = generateToken({
      id: viewerUser.id,
      email: viewerUser.email,
      role: viewerUser.role,
    });

    // 2. Another Viewer (to test viewer isolation)
    otherViewerUser = await User.create({
      username: 'other_viewer_qm',
      email: 'other_viewer_qm@flirttime.app',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      city: 'Mumbai',
    });

    otherViewerToken = generateToken({
      id: otherViewerUser.id,
      email: otherViewerUser.email,
      role: otherViewerUser.role,
    });

    // Attach interest to viewer so vibe & discovery matching works smoothly
    await UserInterest.create({ userId: viewerUser.id, interestId: testInterest.id });
    await UserInterest.create({ userId: otherViewerUser.id, interestId: testInterest.id });

    // 3. Candidate 1: Viewed Single (has 1 active quick moment, viewed by viewer)
    candViewedSingle = await User.create({
      username: 'cand_viewed_single',
      email: 'cand_viewed_single@flirttime.app',
      firstName: 'Anya',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candViewedSingle.id, interestId: testInterest.id });

    const qmViewedSingle = await QuickMoment.create({
      userId: candViewedSingle.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/anya1.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMomentView.create({
      quickMomentId: qmViewedSingle.id,
      userId: viewerUser.id,
    });

    // 4. Candidate 2: Viewed Multi (has 2 active quick moments, BOTH viewed by viewer)
    candViewedMulti = await User.create({
      username: 'cand_viewed_multi',
      email: 'cand_viewed_multi@flirttime.app',
      firstName: 'Bella',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candViewedMulti.id, interestId: testInterest.id });

    const qmViewedMulti1 = await QuickMoment.create({
      userId: candViewedMulti.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/bella1.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    const qmViewedMulti2 = await QuickMoment.create({
      userId: candViewedMulti.id,
      type: 'text',
      text: 'Good vibes only!',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMomentView.create({
      quickMomentId: qmViewedMulti1.id,
      userId: viewerUser.id,
    });
    await QuickMomentView.create({
      quickMomentId: qmViewedMulti2.id,
      userId: viewerUser.id,
    });

    // 5. Candidate 3: Unviewed Single (has 1 active quick moment, not viewed by viewer)
    candUnviewedSingle = await User.create({
      username: 'cand_unviewed_single',
      email: 'cand_unviewed_single@flirttime.app',
      firstName: 'Chloe',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candUnviewedSingle.id, interestId: testInterest.id });

    await QuickMoment.create({
      userId: candUnviewedSingle.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/chloe1.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });

    // 6. Candidate 4: Unviewed Multi (has 2 active quick moments, neither viewed by viewer)
    candUnviewedMulti = await User.create({
      username: 'cand_unviewed_multi',
      email: 'cand_unviewed_multi@flirttime.app',
      firstName: 'Diana',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candUnviewedMulti.id, interestId: testInterest.id });

    await QuickMoment.create({
      userId: candUnviewedMulti.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/diana1.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMoment.create({
      userId: candUnviewedMulti.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/diana2.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });

    // 7. Candidate 5: Partial Viewed (has 2 active quick moments, viewer has only viewed 1)
    candPartialViewed = await User.create({
      username: 'cand_partial_viewed',
      email: 'cand_partial_viewed@flirttime.app',
      firstName: 'Elena',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candPartialViewed.id, interestId: testInterest.id });

    const qmPartial1 = await QuickMoment.create({
      userId: candPartialViewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/elena1.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMoment.create({
      userId: candPartialViewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/elena2.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    // Viewer only viewed the first slide
    await QuickMomentView.create({
      quickMomentId: qmPartial1.id,
      userId: viewerUser.id,
    });

    // 8. Candidate 6: Expired Only (has 2 moments, but both expired or deleted, even if viewed)
    candExpiredOnly = await User.create({
      username: 'cand_expired_only',
      email: 'cand_expired_only@flirttime.app',
      firstName: 'Fiona',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candExpiredOnly.id, interestId: testInterest.id });

    const qmExpiredTime = await QuickMoment.create({
      userId: candExpiredOnly.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/fiona_exp.jpg',
      status: 'active',
      publishedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      expiresAt: pastExpiry,
    });
    const qmDeletedStatus = await QuickMoment.create({
      userId: candExpiredOnly.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/fiona_del.jpg',
      status: 'deleted',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    // Viewer viewed the expired moment back when it was active
    await QuickMomentView.create({
      quickMomentId: qmExpiredTime.id,
      userId: viewerUser.id,
    });
    await QuickMomentView.create({
      quickMomentId: qmDeletedStatus.id,
      userId: viewerUser.id,
    });

    // 9. Candidate 7: Expired (viewed) + Active (unviewed) -> should be false!
    candExpiredViewedAndActiveUnviewed = await User.create({
      username: 'cand_exp_viewed_act_unviewed',
      email: 'cand_exp_act_unviewed@flirttime.app',
      firstName: 'Gia',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candExpiredViewedAndActiveUnviewed.id, interestId: testInterest.id });

    const qmGiaExpired = await QuickMoment.create({
      userId: candExpiredViewedAndActiveUnviewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/gia_exp.jpg',
      status: 'active',
      publishedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      expiresAt: pastExpiry,
    });
    await QuickMoment.create({
      userId: candExpiredViewedAndActiveUnviewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/gia_active.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMomentView.create({
      quickMomentId: qmGiaExpired.id,
      userId: viewerUser.id,
    });

    // 10. Candidate 8: Expired (unviewed) + Active (viewed) -> should be true!
    candExpiredUnviewedAndActiveViewed = await User.create({
      username: 'cand_exp_unviewed_act_viewed',
      email: 'cand_exp_act_viewed@flirttime.app',
      firstName: 'Hannah',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candExpiredUnviewedAndActiveViewed.id, interestId: testInterest.id });

    await QuickMoment.create({
      userId: candExpiredUnviewedAndActiveViewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/hannah_exp.jpg',
      status: 'active',
      publishedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      expiresAt: pastExpiry,
    });
    const qmHannahActive = await QuickMoment.create({
      userId: candExpiredUnviewedAndActiveViewed.id,
      type: 'image',
      mediaUrl: 'https://cdn.flirttime.app/stories/hannah_active.jpg',
      status: 'active',
      publishedAt: now,
      expiresAt: futureExpiry,
    });
    await QuickMomentView.create({
      quickMomentId: qmHannahActive.id,
      userId: viewerUser.id,
    });

    // 11. Candidate 9: Missing Quick Moments (has never created any quick moment)
    candMissingMoments = await User.create({
      username: 'cand_missing_moments',
      email: 'cand_missing@flirttime.app',
      firstName: 'Iris',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candMissingMoments.id, interestId: testInterest.id });
  });

  describe('1. Response Structure & hasViewedQuickMoment Field Hygiene', () => {
    it('should return boolean hasViewedQuickMoment on every profile in Discover feed', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.users)).toBe(true);
      expect(res.body.data.users.length).toBe(9);

      for (const user of res.body.data.users) {
        expect(user).toHaveProperty('hasViewedQuickMoment');
        expect(typeof user.hasViewedQuickMoment).toBe('boolean');
        // Ensure existing fields remain intact
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('userId');
        expect(user).toHaveProperty('name');
        expect(user).toHaveProperty('username');
        expect(user).toHaveProperty('momentCount');
        expect(user).toHaveProperty('compatibility');
        expect(user.compatibility).toHaveProperty('interestMatchPercentage');
      }
    });
  });

  describe('2. Viewed Quick Moments (Gray Outline Trigger)', () => {
    it('should return hasViewedQuickMoment: true when candidate has 1 active moment and viewer viewed it', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candViewedSingle.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(true);
    });

    it('should return hasViewedQuickMoment: true when candidate has multiple active moments and viewer viewed ALL of them', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candViewedMulti.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(true);
    });
  });

  describe('3. Unviewed Quick Moments (Active Story Outline Trigger)', () => {
    it('should return hasViewedQuickMoment: false when candidate has 1 active moment and viewer has NOT viewed it', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candUnviewedSingle.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });

    it('should return hasViewedQuickMoment: false when candidate has multiple active moments and viewer has viewed NONE of them', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candUnviewedMulti.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });

    it('should return hasViewedQuickMoment: false when candidate has multiple active moments and viewer has only viewed SOME (partial view)', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candPartialViewed.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });
  });

  describe('4. Expired and Inactive Quick Moments', () => {
    it('should return hasViewedQuickMoment: false when candidate only has expired or deleted moments', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candExpiredOnly.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });

    it('should return hasViewedQuickMoment: false when candidate has an expired viewed moment but an active UNVIEWED moment', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find(
        (u: any) => u.userId === candExpiredViewedAndActiveUnviewed.id
      );
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });

    it('should return hasViewedQuickMoment: true when candidate has an expired unviewed moment but all active moments are VIEWED', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find(
        (u: any) => u.userId === candExpiredUnviewedAndActiveViewed.id
      );
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(true);
    });
  });

  describe('5. Missing Quick Moments', () => {
    it('should return hasViewedQuickMoment: false when candidate has no quick moments at all', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candMissingMoments.id);
      expect(user).toBeDefined();
      expect(user.hasViewedQuickMoment).toBe(false);
    });
  });

  describe('6. Viewer Isolation & Dynamic State Transition', () => {
    it('should evaluate view status strictly for authenticated viewer, ignoring other users views', async () => {
      // Find CandUnviewedSingle's active moment
      const moment = await QuickMoment.findOne({ where: { userId: candUnviewedSingle.id } });
      expect(moment).toBeDefined();

      // otherViewerUser views CandUnviewedSingle's story
      await QuickMomentView.create({
        quickMomentId: moment!.id,
        userId: otherViewerUser.id,
      });

      // From otherViewerUser perspective -> hasViewedQuickMoment is true
      const resOther = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${otherViewerToken}`);

      const userForOther = resOther.body.data.users.find(
        (u: any) => u.userId === candUnviewedSingle.id
      );
      expect(userForOther.hasViewedQuickMoment).toBe(true);

      // From viewerUser perspective -> hasViewedQuickMoment MUST STILL BE FALSE
      const resViewer = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const userForViewer = resViewer.body.data.users.find(
        (u: any) => u.userId === candUnviewedSingle.id
      );
      expect(userForViewer.hasViewedQuickMoment).toBe(false);
    });

    it('should dynamically transition from false to true after viewer marks active moment viewed', async () => {
      // 1. Initial state: CandUnviewedSingle has hasViewedQuickMoment: false
      let res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      let user = res.body.data.users.find((u: any) => u.userId === candUnviewedSingle.id);
      expect(user.hasViewedQuickMoment).toBe(false);

      // 2. Viewer views CandUnviewedSingle's story via mark-viewed endpoint
      const moment = await QuickMoment.findOne({ where: { userId: candUnviewedSingle.id } });
      await request(app)
        .post(`/api/v1/quick-moments/${moment!.id}/view`)
        .set('Authorization', `Bearer ${viewerToken}`);

      // 3. Subsequent Discover feed query: hasViewedQuickMoment transitions to true!
      res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      user = res.body.data.users.find((u: any) => u.userId === candUnviewedSingle.id);
      expect(user.hasViewedQuickMoment).toBe(true);
    });
  });

  describe('7. Pagination and Profile Uniqueness', () => {
    it('should return each profile exactly once across paginated results', async () => {
      const resPage1 = await request(app)
        .get('/api/v1/discovery/people?page=1&limit=5')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.users.length).toBe(5);

      const resPage2 = await request(app)
        .get('/api/v1/discovery/people?page=2&limit=5')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.users.length).toBe(4);

      const allIds = [
        ...resPage1.body.data.users.map((u: any) => u.id),
        ...resPage2.body.data.users.map((u: any) => u.id),
      ];
      expect(allIds.length).toBe(9);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(9);
    });
  });
});
