import request from 'supertest';
import app from '../src/app';
import { sequelize, User } from '../src/models';

describe('Username availability (GET /api/v1/auth/username/availability)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await User.destroy({ where: {}, truncate: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  const check = (username?: string) => {
    const req = request(app).get('/api/v1/auth/username/availability');
    if (username !== undefined) {
      return req.query({ username });
    }
    return req;
  };

  it('returns available for a username that is not taken', async () => {
    const res = await check('alex_turner');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Username is available');
    expect(res.body.data).toEqual({
      username: 'alex_turner',
      available: true,
    });
    expect(Object.keys(res.body).sort()).toEqual(['data', 'message', 'success']);
    expect(Object.keys(res.body.data).sort()).toEqual(['available', 'username']);
  });

  it('returns taken when the username already exists, including a different case', async () => {
    await User.create({
      username: 'Alex_Turner',
      email: 'alex@example.com',
      isActive: true,
    });

    const res = await check('alex_turner');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Username is already taken');
    expect(res.body.data).toEqual({
      username: 'alex_turner',
      available: false,
    });
    expect(res.body.data.id).toBeUndefined();
    expect(res.body.data.email).toBeUndefined();
    expect(res.body.data.phone).toBeUndefined();
    expect(res.body.data.user).toBeUndefined();
    expect(res.body.data.password).toBeUndefined();
  });

  it('treats an inactive account username as taken', async () => {
    await User.create({
      username: 'paused_user',
      email: 'paused@example.com',
      isActive: false,
    });

    const res = await check('paused_user');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      username: 'paused_user',
      available: false,
    });
  });

  it('trims surrounding spaces before checking', async () => {
    const res = await check('  fresh_name  ');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      username: 'fresh_name',
      available: true,
    });
  });

  it('does not require authentication', async () => {
    const res = await request(app)
      .get('/api/v1/auth/username/availability')
      .query({ username: 'open_signup' });

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
  });

  it('rejects a missing, short, or oversized username', async () => {
    const missing = await check();
    expect(missing.status).toBe(400);
    expect(missing.body.success).toBe(false);
    expect(missing.body.message).toBe('Validation failed');

    const tooShort = await check('ab');
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.success).toBe(false);

    const tooLong = await check('a'.repeat(51));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.success).toBe(false);
  });

  it('accepts usernames at the 3 and 50 character limits', async () => {
    const shortName = await check('abc');
    expect(shortName.status).toBe(200);
    expect(shortName.body.data.available).toBe(true);

    const longName = 'u'.repeat(50);
    const longRes = await check(longName);
    expect(longRes.status).toBe(200);
    expect(longRes.body.data).toEqual({
      username: longName,
      available: true,
    });
  });

  it('rate limits repeated checks when the test rate-limit header is set', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .get('/api/v1/auth/username/availability')
        .set('x-test-rate-limit', 'true')
        .query({ username: `name_${i}_ok` });
      expect(res.status).toBe(200);
    }

    const limited = await request(app)
      .get('/api/v1/auth/username/availability')
      .set('x-test-rate-limit', 'true')
      .query({ username: 'one_more_name' });

    expect(limited.status).toBe(429);
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many username checks/i);
  });
});
