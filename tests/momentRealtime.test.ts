import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import app from '../src/app';
import { sequelize, User, Moment, Match, UserBlock, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';
import { publishMomentRealtime } from '../src/realtime/socket.moment';

describe('Moment realtime updates', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  let owner: User;
  let viewer: User;
  let stranger: User;
  let moment: Moment;
  let privateMoment: Moment;
  const clientSockets: ClientSocket[] = [];

  const connectClient = (token: string): Promise<ClientSocket> => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: { token },
    });
    clientSockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  const waitForEvent = (socket: ClientSocket, event: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 4000);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);
    httpServer = http.createServer(app);
    initSocketServer(httpServer, {
      pingTimeout: 10000,
      pingInterval: 10000,
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address() as AddressInfo;
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    await closeSocketServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await sequelize.close();
  });

  beforeEach(async () => {
    await Match.destroy({ where: {} });
    await UserBlock.destroy({ where: {} });
    await Moment.destroy({ where: {} });
    await User.destroy({ where: {} });

    owner = await User.create({
      username: 'moment_owner',
      email: 'moment_owner@example.com',
      fullName: 'Moment Owner',
      firstName: 'Moment',
      isActive: true,
      role: 'user',
    });
    viewer = await User.create({
      username: 'moment_viewer',
      email: 'moment_viewer@example.com',
      fullName: 'Moment Viewer',
      firstName: 'Viewer',
      isActive: true,
      role: 'user',
    });
    stranger = await User.create({
      username: 'moment_stranger',
      email: 'moment_stranger@example.com',
      fullName: 'Moment Stranger',
      firstName: 'Stranger',
      isActive: true,
      role: 'user',
    });

    moment = await Moment.create({
      userId: owner.id,
      caption: 'Public moment',
      audience: 'everyone',
      status: 'active',
      publishedAt: new Date(),
    });
    privateMoment = await Moment.create({
      userId: owner.id,
      caption: 'Matches only',
      audience: 'matches_only',
      status: 'active',
      publishedAt: new Date(),
    });
  });

  afterEach(() => {
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) socket.disconnect();
    }
  });

  it('delivers a like once to the owner and to a viewer watching the moment', async () => {
    const ownerSocket = await connectClient(
      generateToken({ id: owner.id, email: owner.email, role: owner.role })
    );
    const viewerSocket = await connectClient(
      generateToken({ id: viewer.id, email: viewer.email, role: viewer.role })
    );

    const ownerJoin = await new Promise<any>((resolve) => {
      ownerSocket.emit('moment:join', { momentId: moment.id }, resolve);
    });
    const viewerWatch = await new Promise<any>((resolve) => {
      viewerSocket.emit('moment:watch', { momentIds: [moment.id] }, resolve);
    });

    expect(ownerJoin.success).toBe(true);
    expect(viewerWatch.joined).toEqual([moment.id]);

    const ownerEvents: any[] = [];
    const viewerEvents: any[] = [];
    ownerSocket.on('moment:updated', (payload) => ownerEvents.push(payload));
    viewerSocket.on('moment:updated', (payload) => viewerEvents.push(payload));

    const ownerLike = waitForEvent(ownerSocket, 'moment:like_updated');
    const viewerLike = waitForEvent(viewerSocket, 'moment:like_updated');

    await publishMomentRealtime({
      type: 'like',
      momentId: moment.id,
      ownerId: owner.id,
      actorId: viewer.id,
      likesCount: 1,
      commentsCount: 0,
      giftsCount: 0,
      reaction: 'like',
      reactionCounts: { like: 1 },
    });

    const [ownerPayload, viewerPayload] = await Promise.all([ownerLike, viewerLike]);

    expect(ownerPayload.type).toBe('like');
    expect(ownerPayload.momentId).toBe(moment.id);
    expect(ownerPayload.likesCount).toBe(1);
    expect(ownerPayload.actor.id).toBe(viewer.id);
    expect(ownerPayload.actor.name).toBe('Moment Viewer');
    expect(ownerPayload.isLiked).toBeUndefined();
    expect(viewerPayload).toMatchObject({
      type: 'like',
      momentId: moment.id,
      likesCount: 1,
      commentsCount: 0,
      giftsCount: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ownerEvents).toHaveLength(1);
    expect(viewerEvents).toHaveLength(1);
  });

  it('hides matches-only moments from viewers who are not a match', async () => {
    const strangerSocket = await connectClient(
      generateToken({ id: stranger.id, email: stranger.email, role: stranger.role })
    );

    const denied = await new Promise<any>((resolve) => {
      strangerSocket.emit('moment:join', { momentId: privateMoment.id }, resolve);
    });
    expect(denied.success).toBe(false);

    let received = false;
    strangerSocket.on('moment:gift_sent', () => {
      received = true;
    });
    strangerSocket.on('moment:updated', () => {
      received = true;
    });

    await publishMomentRealtime({
      type: 'gift',
      momentId: privateMoment.id,
      ownerId: owner.id,
      actorId: viewer.id,
      giftsCount: 1,
      gift: {
        code: 'rose',
        name: 'Rose',
        quantity: 1,
        totalCoins: 10,
        sender: { id: viewer.id, previousBalance: 100, newBalance: 90, coinsDeducted: 10 },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(received).toBe(false);
  });

  it('lets a match watch a matches-only moment and strips gift balances', async () => {
    const [user1Id, user2Id] = [owner.id, viewer.id].sort();
    await Match.create({ user1Id, user2Id, isActive: true, matchedBy: 'like' });

    const viewerSocket = await connectClient(
      generateToken({ id: viewer.id, email: viewer.email, role: viewer.role })
    );
    const joined = await new Promise<any>((resolve) => {
      viewerSocket.emit('moment:join', { momentId: privateMoment.id }, resolve);
    });
    expect(joined.success).toBe(true);

    const payload = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('gift event missing')), 4000);
      viewerSocket.once('moment:gift_sent', (data) => {
        clearTimeout(timer);
        resolve(data);
      });
      void publishMomentRealtime({
        type: 'gift',
        momentId: privateMoment.id,
        ownerId: owner.id,
        actorId: viewer.id,
        giftsCount: 2,
        gift: {
          code: 'rose',
          name: 'Rose',
          quantity: 2,
          totalCoins: 20,
          sender: { id: viewer.id, previousBalance: 100, newBalance: 80, coinsDeducted: 20 },
        },
      });
    });

    expect(payload.giftsCount).toBe(2);
    expect(payload.gift.sender.previousBalance).toBeUndefined();
    expect(payload.gift.sender.newBalance).toBeUndefined();
    expect(payload.gift.sender.coinsDeducted).toBeUndefined();
    expect(payload.gift.code).toBe('rose');
  });

  it('rejects a blocked viewer', async () => {
    await UserBlock.create({ userId: owner.id, blockedUserId: viewer.id });
    const viewerSocket = await connectClient(
      generateToken({ id: viewer.id, email: viewer.email, role: viewer.role })
    );
    const denied = await new Promise<any>((resolve) => {
      viewerSocket.emit('moment:join', { momentId: moment.id }, resolve);
    });
    expect(denied.success).toBe(false);
  });
});
