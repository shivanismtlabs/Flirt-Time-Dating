import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import app from '../src/app';
import { sequelize, User, Notification, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { initSocketServer, closeSocketServer } from '../src/realtime';
import { notificationService } from '../src/services/notification.service';

describe('notification:count socket', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  let user: User;
  let other: User;
  let token: string;
  let otherToken: string;
  const clients: ClientSocket[] = [];

  const connectClient = (authToken: string) => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: { token: authToken },
    });
    clients.push(socket);
    const events: Array<{ unreadCount: number }> = [];
    socket.on('notification:count', (data) => {
      events.push(data);
    });
    return { socket, events };
  };

  const waitForEvents = async (events: unknown[], count: number) => {
    const start = Date.now();
    while (events.length < count) {
      if (Date.now() - start > 5000) {
        throw new Error(`expected ${count} notification:count events, got ${events.length}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const waitConnect = (socket: ClientSocket) =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) {
        resolve();
        return;
      }
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err) => reject(err));
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

  beforeEach(async () => {
    await Notification.destroy({ where: {} });
    await User.destroy({ where: {} });
    user = await User.create({
      username: 'count_user',
      email: 'count_user@example.com',
      isActive: true,
      role: 'user',
    });
    other = await User.create({
      username: 'count_other',
      email: 'count_other@example.com',
      isActive: true,
      role: 'user',
    });
    token = generateToken({ id: user.id, email: user.email, role: user.role });
    otherToken = generateToken({ id: other.id, email: other.email, role: other.role });
  });

  afterEach(() => {
    while (clients.length > 0) {
      const socket = clients.pop();
      socket?.disconnect();
    }
  });

  afterAll(async () => {
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  it('pushes only unreadCount when the badge changes', async () => {
    const mine = connectClient(token);
    const theirs = connectClient(otherToken);
    await Promise.all([waitConnect(mine.socket), waitConnect(theirs.socket)]);
    await Promise.all([waitForEvents(mine.events, 1), waitForEvents(theirs.events, 1)]);

    expect(mine.events[0]).toEqual({ unreadCount: 0 });
    expect(Object.keys(mine.events[0])).toEqual(['unreadCount']);

    const created = await notificationService.dispatchNotification(user.id, {
      type: 'like',
      title: 'New like',
      body: 'Someone liked you',
    });
    await waitForEvents(mine.events, 2);
    expect(mine.events[1]).toEqual({ unreadCount: 1 });
    expect(theirs.events).toHaveLength(1);

    await notificationService.markAsRead(user.id, created.inAppNotificationId as string);
    await waitForEvents(mine.events, 3);
    expect(mine.events[2]).toEqual({ unreadCount: 0 });

    await notificationService.dispatchNotification(user.id, {
      type: 'match',
      title: 'New match',
      body: 'You matched',
    });
    await waitForEvents(mine.events, 4);
    expect(mine.events[3]).toEqual({ unreadCount: 1 });

    await notificationService.markAllAsRead(user.id);
    await waitForEvents(mine.events, 5);
    expect(mine.events[4]).toEqual({ unreadCount: 0 });

    const second = await notificationService.dispatchNotification(user.id, {
      type: 'like',
      title: 'Another like',
      body: 'Liked again',
    });
    await waitForEvents(mine.events, 6);
    await notificationService.deleteNotification(user.id, second.inAppNotificationId as string);
    await waitForEvents(mine.events, 7);
    expect(mine.events[6]).toEqual({ unreadCount: 0 });
    expect(theirs.events).toEqual([{ unreadCount: 0 }]);
  });
});
