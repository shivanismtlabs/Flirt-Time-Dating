import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { sequelize, User, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { env } from '../src/config/env';
import {
  initSocketServer,
  closeSocketServer,
  getSocketServer,
  getUserActiveSocketCount,
  isUserConnected,
  getTotalActiveConnections,
  getUserRoomName,
  SOCKET_ERROR_CODES,
  SOCKET_DEFAULTS,
} from '../src/realtime';

describe('Real-Time Socket Infrastructure (Setup Only)', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  let activeUser: User;
  let inactiveUser: User;
  let activeUserToken: string;
  let inactiveUserToken: string;
  const clientSockets: ClientSocket[] = [];

  // Helper to create and track client sockets for clean teardown
  const createClientSocket = (
    options: Parameters<typeof ioClient>[1] = {}
  ): ClientSocket => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      ...options,
    });
    clientSockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb(true);

    // Create real HTTP server listening on an ephemeral OS-assigned port
    httpServer = http.createServer(app);
    initSocketServer(httpServer, {
      maxConnectionsPerUser: 2, // low bound for testing concurrency limit
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
    // Disconnect all test client sockets
    for (const socket of clientSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }

    // Gracefully shut down socket server and HTTP server
    await closeSocketServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    await sequelize.close();
  });

  beforeEach(async () => {
    await User.destroy({ where: {} });

    activeUser = await User.create({
      username: 'socket_user_active',
      email: 'active_socket@example.com',
      fullName: 'Active Socket User',
      firstName: 'Active',
      isActive: true,
      role: 'user',
    });

    inactiveUser = await User.create({
      username: 'socket_user_suspended',
      email: 'inactive_socket@example.com',
      fullName: 'Suspended Socket User',
      firstName: 'Suspended',
      isActive: false,
      role: 'user',
    });

    activeUserToken = generateToken({
      id: activeUser.id,
      email: activeUser.email,
      role: activeUser.role,
    });

    inactiveUserToken = generateToken({
      id: inactiveUser.id,
      email: inactiveUser.email,
      role: inactiveUser.role,
    });
  });

  afterEach(() => {
    // Close sockets opened during each individual test
    while (clientSockets.length > 0) {
      const socket = clientSockets.pop();
      if (socket?.connected) {
        socket.disconnect();
      }
    }
  });

  describe('1. Server Initialization and Attachment', () => {
    it('should initialize as singleton and return existing instance on repeated calls', () => {
      const io = getSocketServer();
      expect(io).toBeDefined();

      // Repeated initialization call must return the exact same instance without re-binding
      const secondaryIo = initSocketServer(httpServer);
      expect(secondaryIo).toBe(io);
    });

    it('should maintain operational HTTP REST API endpoints alongside Socket.IO', async () => {
      const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
        http.get(`${serverUrl}/health`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          });
        }).on('error', reject);
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('UP');
    });
  });

  describe('2. Authentication and Authorization Guard', () => {
    it('should accept connection with valid JWT in handshake auth payload', async () => {
      const client = createClientSocket({
        auth: { token: activeUserToken },
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', (err) => reject(err));
      });

      expect(client.connected).toBe(true);
      expect(isUserConnected(activeUser.id)).toBe(true);
      expect(getUserActiveSocketCount(activeUser.id)).toBe(1);
    });

    it('should accept connection with valid JWT in HTTP Authorization header', async () => {
      const client = createClientSocket({
        extraHeaders: {
          Authorization: `Bearer ${activeUserToken}`,
        },
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => resolve());
        client.on('connect_error', (err) => reject(err));
      });

      expect(client.connected).toBe(true);
    });

    it('should reject connection when token is completely missing', async () => {
      const client = createClientSocket();

      const error: any = await new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err));
      });

      expect(client.connected).toBe(false);
      expect(error.message).toMatch(/Authentication token is required/i);
    });

    it('should reject connection when token is invalid or malformed', async () => {
      const client = createClientSocket({
        auth: { token: 'invalid.jwt.token.signature' },
      });

      const error: any = await new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err));
      });

      expect(client.connected).toBe(false);
      expect(error.message).toMatch(/invalid or malformed/i);
    });

    it('should reject connection when token has expired', async () => {
      const expiredToken = jwt.sign(
        { id: activeUser.id, role: 'user' },
        env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      const client = createClientSocket({
        auth: { token: expiredToken },
      });

      const error: any = await new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err));
      });

      expect(client.connected).toBe(false);
      expect(error.message).toMatch(/expired/i);
    });

    it('should reject connection for deactivated or suspended user account', async () => {
      const client = createClientSocket({
        auth: { token: inactiveUserToken },
      });

      const error: any = await new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err));
      });

      expect(client.connected).toBe(false);
      expect(error.message).toMatch(/suspended or deactivated/i);
      expect(isUserConnected(inactiveUser.id)).toBe(false);
    });

    it('should reject connection if user does not exist in database', async () => {
      const nonExistentUserIdToken = generateToken({
        id: '00000000-0000-0000-0000-000000000099',
        role: 'user',
      });

      const client = createClientSocket({
        auth: { token: nonExistentUserIdToken },
      });

      const error: any = await new Promise((resolve) => {
        client.on('connect_error', (err) => resolve(err));
      });

      expect(client.connected).toBe(false);
      expect(error.message).toMatch(/no longer exists/i);
    });
  });

  describe('3. Connection Lifecycle and Multi-Device Support', () => {
    it('should allow multiple devices (concurrent sockets) for the same user within limits', async () => {
      const device1 = createClientSocket({ auth: { token: activeUserToken } });
      const device2 = createClientSocket({ auth: { token: activeUserToken } });

      await Promise.all([
        new Promise<void>((resolve, reject) => {
          device1.on('connect', () => resolve());
          device1.on('connect_error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          device2.on('connect', () => resolve());
          device2.on('connect_error', reject);
        }),
      ]);

      expect(device1.connected).toBe(true);
      expect(device2.connected).toBe(true);
      expect(getUserActiveSocketCount(activeUser.id)).toBe(2);
    });

    it('should enforce per-user connection limits and reject excess connections', async () => {
      // In beforeAll, maxConnectionsPerUser was set to 2
      const device1 = createClientSocket({ auth: { token: activeUserToken } });
      const device2 = createClientSocket({ auth: { token: activeUserToken } });

      await Promise.all([
        new Promise<void>((resolve) => device1.on('connect', resolve)),
        new Promise<void>((resolve) => device2.on('connect', resolve)),
      ]);

      expect(getUserActiveSocketCount(activeUser.id)).toBe(2);

      // Third concurrent connection should be rejected
      const device3 = createClientSocket({ auth: { token: activeUserToken } });

      const error: any = await new Promise((resolve) => {
        device3.on('connect_error', resolve);
        device3.on('system:error', resolve);
        device3.on('disconnect', () => resolve({ code: 'DISCONNECTED' }));
      });

      expect(device3.connected).toBe(false);
      expect(error).toBeDefined();
      const errorMsg = error.message || error.code || '';
      expect(errorMsg).toMatch(/exceeded|DISCONNECTED/i);
    });

    it('should clean up user and socket tracking immediately upon disconnection', async () => {
      const client = createClientSocket({ auth: { token: activeUserToken } });

      await new Promise<void>((resolve) => client.on('connect', resolve));
      expect(getUserActiveSocketCount(activeUser.id)).toBe(1);

      // Explicitly disconnect client
      client.disconnect();

      // Wait briefly for disconnect event to propagate on server
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(getUserActiveSocketCount(activeUser.id)).toBe(0);
      expect(isUserConnected(activeUser.id)).toBe(false);
    });
  });

  describe('4. Room Architecture', () => {
    it('should generate canonical user room format', () => {
      const room = getUserRoomName(activeUser.id);
      expect(room).toBe(`${SOCKET_DEFAULTS.USER_ROOM_PREFIX}${activeUser.id}`);
    });
  });
});
