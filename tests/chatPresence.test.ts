import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import app from '../src/app';
import { sequelize, User, Conversation, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime/socket.server';
import { getUserActiveSocketCount } from '../src/realtime/socket.lifecycle';

describe('Chat presence on the open thread', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clientSockets: ClientSocket[] = [];

  let userA: User;
  let userB: User;
  let tokenA: string;
  let tokenB: string;
  let conversation: Conversation;

  const createClientSocket = (token: string): ClientSocket => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: { token },
    });
    clientSockets.push(socket);
    return socket;
  };

  const waitForConnect = (socket: ClientSocket) =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) {
        resolve();
        return;
      }
      const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

  const waitForPresence = (
    socket: ClientSocket,
    predicate: (payload: {
      conversationId: string;
      userId: string;
      isOnline: boolean;
      lastSeenAt: string | null;
    }) => boolean
  ) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off('chat:presence', onEvent);
        reject(new Error('Timed out waiting for chat:presence'));
      }, 5000);
      const onEvent = (payload: any) => {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.off('chat:presence', onEvent);
        resolve(payload);
      };
      socket.on('chat:presence', onEvent);
    });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    httpServer = http.createServer(app);
    initSocketServer(httpServer);

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
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  beforeEach(async () => {
    for (const socket of clientSockets) {
      if (socket.connected) socket.disconnect();
    }
    clientSockets.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));

    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });

    userA = await User.create({
      username: 'presence_alex',
      email: 'presence.alex@example.com',
      fullName: 'Alex Morgan',
      isActive: true,
      role: 'user',
    });
    userB = await User.create({
      username: 'presence_jessica',
      email: 'presence.jessica@example.com',
      fullName: 'Jessica Parker',
      isActive: true,
      role: 'user',
    });

    tokenA = generateToken({ id: userA.id, role: 'user' });
    tokenB = generateToken({ id: userB.id, role: 'user' });

    const [user1Id, user2Id] = [userA.id, userB.id].sort();
    conversation = await Conversation.create({
      user1Id,
      user2Id,
      lastMessage: 'Hey',
      lastMessageAt: new Date(),
    });
  });

  it('tells the open chat immediately when the other person goes offline and comes back', async () => {
    const socketA = createClientSocket(tokenA);
    const socketB = createClientSocket(tokenB);
    await Promise.all([waitForConnect(socketA), waitForConnect(socketB)]);

    const opened = waitForPresence(
      socketB,
      (payload) => payload.userId === userA.id && payload.conversationId === conversation.id && payload.isOnline === true
    );
    socketB.emit('chat:conversation:viewing', { conversationId: conversation.id });
    const online = await opened;
    expect(online.lastSeenAt).toBeNull();

    const dropped = waitForPresence(
      socketB,
      (payload) => payload.userId === userA.id && payload.conversationId === conversation.id && payload.isOnline === false
    );
    socketA.disconnect();
    const offline = await dropped;
    expect(offline.lastSeenAt).toEqual(expect.any(String));

    const detailOffline = await request(app)
      .get(`/api/v1/chats/${conversation.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(detailOffline.status).toBe(200);
    expect(detailOffline.body.data.participant.isOnline).toBe(false);

    const historyOffline = await request(app)
      .get(`/api/v1/chats/${conversation.id}/messages`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(historyOffline.status).toBe(200);
    expect(historyOffline.body.data.participant).toEqual({
      userId: userA.id,
      isOnline: false,
    });

    const returned = waitForPresence(
      socketB,
      (payload) => payload.userId === userA.id && payload.conversationId === conversation.id && payload.isOnline === true
    );
    const socketA2 = createClientSocket(tokenA);
    await waitForConnect(socketA2);
    const backOnline = await returned;
    expect(backOnline.lastSeenAt).toBeNull();

    const detailOnline = await request(app)
      .get(`/api/v1/chats/${conversation.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(detailOnline.body.data.participant.isOnline).toBe(true);
  });

  it('stays online while another device is still connected', async () => {
    const phone = createClientSocket(tokenA);
    const tablet = createClientSocket(tokenA);
    const socketB = createClientSocket(tokenB);
    await Promise.all([waitForConnect(phone), waitForConnect(tablet), waitForConnect(socketB)]);
    expect(getUserActiveSocketCount(userA.id)).toBe(2);

    socketB.emit('chat:conversation:viewing', { conversationId: conversation.id });
    await waitForPresence(
      socketB,
      (payload) => payload.userId === userA.id && payload.isOnline === true
    );

    let sawOffline = false;
    socketB.on('chat:presence', (payload) => {
      if (payload.userId === userA.id && payload.isOnline === false) sawOffline = true;
    });

    phone.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sawOffline).toBe(false);
    expect(getUserActiveSocketCount(userA.id)).toBe(1);

    const dropped = waitForPresence(
      socketB,
      (payload) => payload.userId === userA.id && payload.isOnline === false
    );
    tablet.disconnect();
    await dropped;
    expect(getUserActiveSocketCount(userA.id)).toBe(0);
  });
});
