import request from 'supertest';
import app from '../src/app';
import {
  sequelize,
  User,
  Interest,
  UserInterest,
  Moment,
  UserReport,
  initDb,
} from '../src/models';
import { generateToken } from '../src/utils/jwt';

describe('Discover People Cards — Moment Count & Interest Compatibility', () => {
  let viewer: User;
  let viewerToken: string;

  let candidateZeroMoments: User;
  let candidateOneMoment: User;
  let candidateMultipleMoments: User;
  let candidateExpiredAndDeleted: User;
  let candidateEmptyInterests: User;

  let intGaming: Interest;
  let intCooking: Interest;
  let intMusic: Interest;
  let intTravel: Interest;
  let intPhotography: Interest;
  let intArt: Interest;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(false);

    [intGaming] = await Interest.findOrCreate({
      where: { name: 'Gaming_Test' },
      defaults: { name: 'Gaming_Test', icon: '🎮', isActive: true },
    });
    [intCooking] = await Interest.findOrCreate({
      where: { name: 'Cooking_Test' },
      defaults: { name: 'Cooking_Test', icon: '🍳', isActive: true },
    });
    [intMusic] = await Interest.findOrCreate({
      where: { name: 'Music_Test' },
      defaults: { name: 'Music_Test', icon: '🎵', isActive: true },
    });
    [intTravel] = await Interest.findOrCreate({
      where: { name: 'Travel_Test' },
      defaults: { name: 'Travel_Test', icon: '✈️', isActive: true },
    });
    [intPhotography] = await Interest.findOrCreate({
      where: { name: 'Photography_Test' },
      defaults: { name: 'Photography_Test', icon: '📷', isActive: true },
    });
    [intArt] = await Interest.findOrCreate({
      where: { name: 'Art_Test' },
      defaults: { name: 'Art_Test', icon: '🎨', isActive: true },
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear reports, moments, user_interests, and users
    await UserReport.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await UserInterest.destroy({ where: {} });
    await User.destroy({ where: {} });

    // 1. Viewer User (Male, seeks Women)
    viewer = await User.create({
      username: 'viewer_user',
      email: 'viewer@example.com',
      gender: 'male',
      genderPreference: 'women',
      isActive: true,
      city: 'Mumbai',
    });

    viewerToken = generateToken({
      id: viewer.id,
      email: viewer.email,
      role: viewer.role,
    });

    // Viewer has 5 interests: Gaming, Cooking, Music, Travel, Photography
    await UserInterest.create({ userId: viewer.id, interestId: intGaming.id });
    await UserInterest.create({ userId: viewer.id, interestId: intCooking.id });
    await UserInterest.create({ userId: viewer.id, interestId: intMusic.id });
    await UserInterest.create({ userId: viewer.id, interestId: intTravel.id });
    await UserInterest.create({ userId: viewer.id, interestId: intPhotography.id });

    // Also viewer has their own active moments (must NEVER be counted towards candidates!)
    await Moment.create({
      userId: viewer.id,
      caption: 'Viewer moment 1',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(),
    });
    await Moment.create({
      userId: viewer.id,
      caption: 'Viewer moment 2',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(),
    });

    // 2. Candidate Zero Moments: Female, 4 interests (Gaming, Cooking, Music, Art)
    // Overlap with viewer (Gaming, Cooking, Music = 3 matches). Viewer has 5, candidate has 4.
    // round((3 / max(5, 4)) * 100) = 60%
    candidateZeroMoments = await User.create({
      username: 'candidate_zero',
      email: 'cand_zero@example.com',
      firstName: 'ZeroMoments',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candidateZeroMoments.id, interestId: intGaming.id });
    await UserInterest.create({ userId: candidateZeroMoments.id, interestId: intCooking.id });
    await UserInterest.create({ userId: candidateZeroMoments.id, interestId: intMusic.id });
    await UserInterest.create({ userId: candidateZeroMoments.id, interestId: intArt.id });

    // 3. Candidate One Moment: Female, 4 interests (Gaming, Cooking, Travel, Photography)
    // Overlap with viewer: 4 matches. Viewer 5, candidate 4.
    // round((4 / 5) * 100) = 80%
    candidateOneMoment = await User.create({
      username: 'candidate_one',
      email: 'cand_one@example.com',
      firstName: 'OneMoment',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candidateOneMoment.id, interestId: intGaming.id });
    await UserInterest.create({ userId: candidateOneMoment.id, interestId: intCooking.id });
    await UserInterest.create({ userId: candidateOneMoment.id, interestId: intTravel.id });
    await UserInterest.create({ userId: candidateOneMoment.id, interestId: intPhotography.id });

    // 1 active moment (permanent: expiresAt = null)
    await Moment.create({
      userId: candidateOneMoment.id,
      caption: 'Beach sunset',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(),
      expiresAt: null,
    });

    // 4. Candidate Multiple Moments: Female, 5 interests identical to viewer -> 100%
    candidateMultipleMoments = await User.create({
      username: 'candidate_multi',
      email: 'cand_multi@example.com',
      firstName: 'MultiMoments',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candidateMultipleMoments.id, interestId: intGaming.id });
    await UserInterest.create({ userId: candidateMultipleMoments.id, interestId: intCooking.id });
    await UserInterest.create({ userId: candidateMultipleMoments.id, interestId: intMusic.id });
    await UserInterest.create({ userId: candidateMultipleMoments.id, interestId: intTravel.id });
    await UserInterest.create({ userId: candidateMultipleMoments.id, interestId: intPhotography.id });

    // 3 eligible moments:
    // - 2 permanent moments (expiresAt: null)
    // - 1 24h expiring moment with future expiry
    const now = new Date();
    await Moment.create({
      userId: candidateMultipleMoments.id,
      caption: 'Active permanent moment 1',
      status: 'active',
      audience: 'everyone',
      publishedAt: now,
      expiresAt: null,
    });
    await Moment.create({
      userId: candidateMultipleMoments.id,
      caption: 'Active permanent moment 2',
      status: 'active',
      audience: 'everyone',
      publishedAt: now,
      expiresAt: null,
    });
    await Moment.create({
      userId: candidateMultipleMoments.id,
      caption: 'Active 24h moment with future expiry',
      status: 'active',
      audience: 'everyone',
      publishedAt: now,
      expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000), // 12 hours from now
    });

    // Plus 1 matches_only moment (must NOT be counted for discovery candidate stranger!)
    await Moment.create({
      userId: candidateMultipleMoments.id,
      caption: 'Matches only moment',
      status: 'active',
      audience: 'matches_only',
      publishedAt: now,
      expiresAt: null,
    });

    // 5. Candidate Expired and Deleted Moments: Female, 0 shared interests (Art only) -> 0%
    candidateExpiredAndDeleted = await User.create({
      username: 'candidate_expired',
      email: 'cand_exp@example.com',
      firstName: 'ExpiredDeleted',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
    await UserInterest.create({ userId: candidateExpiredAndDeleted.id, interestId: intArt.id });

    // 1 deleted moment
    await Moment.create({
      userId: candidateExpiredAndDeleted.id,
      caption: 'Deleted moment',
      status: 'deleted',
      audience: 'everyone',
      publishedAt: now,
      expiresAt: null,
    });
    // 1 expired status moment
    await Moment.create({
      userId: candidateExpiredAndDeleted.id,
      caption: 'Expired status moment',
      status: 'expired',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    // 1 active status moment whose expiresAt is in the past (e.g. expired 2 hours ago)
    await Moment.create({
      userId: candidateExpiredAndDeleted.id,
      caption: 'Expired timestamp moment',
      status: 'active',
      audience: 'everyone',
      publishedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000),
      expiresAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    });

    // 6. Candidate Empty Interests: Female, 0 interests saved -> 0%
    candidateEmptyInterests = await User.create({
      username: 'candidate_no_int',
      email: 'cand_no_int@example.com',
      firstName: 'NoInterests',
      gender: 'female',
      isActive: true,
      city: 'Mumbai',
    });
  });

  describe('1. Authentication and Authorization', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/discovery/people');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Discover Profile Cards Structure and Hygiene', () => {
    it('should return momentCount and compatibility.interestMatchPercentage for every candidate', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.users).toBeDefined();

      const users = res.body.data.users;
      expect(users.length).toBe(5);

      for (const card of users) {
        expect(card).toHaveProperty('id');
        expect(card).toHaveProperty('userId');
        expect(card).toHaveProperty('momentCount');
        expect(typeof card.momentCount).toBe('number');
        expect(card.momentCount).toBeGreaterThanOrEqual(0);

        expect(card).toHaveProperty('compatibility');
        expect(card.compatibility).toHaveProperty('interestMatchPercentage');
        expect(typeof card.compatibility.interestMatchPercentage).toBe('number');
        expect(card.compatibility.interestMatchPercentage).toBeGreaterThanOrEqual(0);
        expect(card.compatibility.interestMatchPercentage).toBeLessThanOrEqual(100);

        // Security / Hygiene: ensure no moment lists, media objects, or extra interest details returned
        expect(card).not.toHaveProperty('moments');
        expect(card).not.toHaveProperty('momentImages');
        expect(card).not.toHaveProperty('mediaUrls');
        expect(card.compatibility).not.toHaveProperty('commonInterests');
        expect(card.compatibility).not.toHaveProperty('sharedInterests');
      }
    });
  });

  describe('3. Moment Count Accuracy and Exclusions', () => {
    it('should return momentCount: 0 for candidate with zero moments', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateZeroMoments.id);
      expect(user).toBeDefined();
      expect(user.momentCount).toBe(0);
    });

    it('should return momentCount: 1 for candidate with exactly one eligible moment', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateOneMoment.id);
      expect(user).toBeDefined();
      expect(user.momentCount).toBe(1);
    });

    it('should return momentCount: 3 for candidate with 3 eligible moments and exclude matches_only', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateMultipleMoments.id);
      expect(user).toBeDefined();
      // Total created: 2 permanent + 1 expiring future + 1 matches_only = 4
      // Eligible count: exactly 3 (matches_only is excluded)
      expect(user.momentCount).toBe(3);
    });

    it('should exclude expired and deleted moments from count', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateExpiredAndDeleted.id);
      expect(user).toBeDefined();
      // Total created: 1 deleted + 1 expired status + 1 expired timestamp = 3
      // Eligible count: exactly 0
      expect(user.momentCount).toBe(0);
    });

    it('should exclude moments reported by the authenticated viewer', async () => {
      // Create a moment for candidateOneMoment, then viewer reports it
      const reportedMoment = await Moment.create({
        userId: candidateOneMoment.id,
        caption: 'Reportable content',
        status: 'active',
        audience: 'everyone',
        publishedAt: new Date(),
        expiresAt: null,
      });

      // Initially candidate has 2 eligible moments
      let res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);
      let user = res.body.data.users.find((u: any) => u.userId === candidateOneMoment.id);
      expect(user.momentCount).toBe(2);

      // Viewer reports this specific moment
      await UserReport.create({
        reporterId: viewer.id,
        targetUserId: candidateOneMoment.id,
        momentId: reportedMoment.id,
        targetType: 'moment',
        reason: 'spam',
        status: 'pending',
      });

      // Now candidate has 1 eligible moment (the reported one is excluded)
      res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);
      user = res.body.data.users.find((u: any) => u.userId === candidateOneMoment.id);
      expect(user.momentCount).toBe(1);
    });

    it('should never count the viewer own moments towards candidates', async () => {
      // Viewer has 2 moments
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const zeroUser = res.body.data.users.find((u: any) => u.userId === candidateZeroMoments.id);
      expect(zeroUser.momentCount).toBe(0);
    });
  });

  describe('4. Interest Compatibility Percentage Verification', () => {
    it('should return exact 60% compatibility when 3 of max(5, 4) interests match', async () => {
      // Viewer: [Gaming, Cooking, Music, Travel, Photography] (5)
      // CandidateZeroMoments: [Gaming, Cooking, Music, Art] (4)
      // Common: [Gaming, Cooking, Music] (3)
      // round((3 / 5) * 100) = 60
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateZeroMoments.id);
      expect(user.compatibility.interestMatchPercentage).toBe(60);
    });

    it('should return exact 80% compatibility when 4 of 5 interests match', async () => {
      // Viewer: 5, CandidateOneMoment: 4, Common: 4
      // round((4 / 5) * 100) = 80
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateOneMoment.id);
      expect(user.compatibility.interestMatchPercentage).toBe(80);
    });

    it('should return 100% compatibility when all interests match identically', async () => {
      // CandidateMultipleMoments has identical 5 interests to viewer
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateMultipleMoments.id);
      expect(user.compatibility.interestMatchPercentage).toBe(100);
    });

    it('should return 0% compatibility when there is zero overlap', async () => {
      // CandidateExpiredAndDeleted has only Art (viewer does not have Art)
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateExpiredAndDeleted.id);
      expect(user.compatibility.interestMatchPercentage).toBe(0);
    });

    it('should return 0% compatibility when candidate has no interests', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateEmptyInterests.id);
      expect(user.compatibility.interestMatchPercentage).toBe(0);
    });

    it('should return 0% compatibility for all candidates when viewer has no interests', async () => {
      // Remove all interests for viewer
      await UserInterest.destroy({ where: { userId: viewer.id } });

      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      for (const card of res.body.data.users) {
        expect(card.compatibility.interestMatchPercentage).toBe(0);
      }
    });

    it('should deduplicate interest associations before calculating and not inflate percentages', async () => {
      // Import helper and verify deduplication
      const { calculateInterestMatchPercentage } = await import('../src/utils/compatibility');

      // Candidate has 4 interests, viewer has 5 interests, 3 match -> 60%
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const user = res.body.data.users.find((u: any) => u.userId === candidateZeroMoments.id);
      expect(user.compatibility.interestMatchPercentage).toBe(60);

      // Verify that duplicate IDs in associations array do not inflate score
      const duplicateViewerIds = [intGaming.id, intGaming.id, intCooking.id, intMusic.id, intTravel.id, intPhotography.id];
      const duplicateCandidateIds = [intGaming.id, intGaming.id, intCooking.id, intMusic.id, intArt.id, intArt.id];
      const deduplicatedScore = calculateInterestMatchPercentage(duplicateViewerIds, duplicateCandidateIds);
      expect(deduplicatedScore).toBe(60);
    });

    it('should calculate each candidate compatibility independently against the viewer', async () => {
      const res = await request(app)
        .get('/api/v1/discovery/people')
        .set('Authorization', `Bearer ${viewerToken}`);

      const users = res.body.data.users;
      const scoreZero = users.find((u: any) => u.userId === candidateZeroMoments.id).compatibility.interestMatchPercentage;
      const scoreOne = users.find((u: any) => u.userId === candidateOneMoment.id).compatibility.interestMatchPercentage;
      const scoreMulti = users.find((u: any) => u.userId === candidateMultipleMoments.id).compatibility.interestMatchPercentage;
      const scoreExpired = users.find((u: any) => u.userId === candidateExpiredAndDeleted.id).compatibility.interestMatchPercentage;
      const scoreNoInt = users.find((u: any) => u.userId === candidateEmptyInterests.id).compatibility.interestMatchPercentage;

      expect(scoreZero).toBe(60);
      expect(scoreOne).toBe(80);
      expect(scoreMulti).toBe(100);
      expect(scoreExpired).toBe(0);
      expect(scoreNoInt).toBe(0);
    });
  });

  describe('5. Pagination and Profiles Count Unaltered', () => {
    it('should not alter total candidates count or pagination behavior', async () => {
      const resPage1 = await request(app)
        .get('/api/v1/discovery/people?page=1&limit=2')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.users.length).toBe(2);
      expect(resPage1.body.data.pagination.page).toBe(1);
      expect(resPage1.body.data.pagination.limit).toBe(2);
      expect(resPage1.body.data.pagination.total).toBe(5);
      expect(resPage1.body.data.pagination.hasMore).toBe(true);

      const resPage2 = await request(app)
        .get('/api/v1/discovery/people?page=2&limit=2')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.users.length).toBe(2);
      expect(resPage2.body.data.pagination.page).toBe(2);

      const resPage3 = await request(app)
        .get('/api/v1/discovery/people?page=3&limit=2')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(resPage3.status).toBe(200);
      expect(resPage3.body.data.users.length).toBe(1);
      expect(resPage3.body.data.pagination.page).toBe(3);
      expect(resPage3.body.data.pagination.hasMore).toBe(false);

      // Verify no duplicate IDs across pages
      const page1Ids = resPage1.body.data.users.map((u: any) => u.id);
      const page2Ids = resPage2.body.data.users.map((u: any) => u.id);
      const page3Ids = resPage3.body.data.users.map((u: any) => u.id);

      const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(5);
    });
  });
});
