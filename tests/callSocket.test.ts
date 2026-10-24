import http from 'http';
import { AddressInfo } from 'net';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import app from '../src/app';
import { sequelize, User, VideoCall, ChatMessage, Conversation, initDb } from '../src/models';
import { generateToken } from '../src/utils/jwt';
import { env } from '../src/config/env';
import { initSocketServer, closeSocketServer } from '../src/realtime';
import { videoCallService } from '../src/services/videoCall.service';

describe('Call socket updates', () => {
  let httpServer: http.Server;
  let serverUrl: string;
  const clients: ClientSocket[] = [];

  const once = <T>(socket: ClientSocket, event: string, ms = 5000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const connect = (token: string): Promise<ClientSocket> => {
    const socket = ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
      auth: { token },
    });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    env.AGORA_APP_ID = '970ca35de60c44645bbae8a21506140d';
    env.AGORA_APP_CERTIFICATE = '5cfd2fd1755d40ecb729f39468041a97';
    env.AGORA_TOKEN_EXPIRATION_SECONDS = 3600;
    env.AGORA_RINGING_EXPIRATION_SECONDS = 60;
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
    for (const socket of clients) {
      if (socket.connected) socket.disconnect();
    }
    await closeSocketServer();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await sequelize.close();
  });

  beforeEach(async () => {
    while (clients.length) {
      const socket = clients.pop();
      if (socket?.connected) socket.disconnect();
    }
    await VideoCall.destroy({ where: {} });
    await ChatMessage.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    await User.destroy({ where: {} });
  });

  async function pair(prefix: string) {
    const caller = await User.create({
      username: `${prefix}_caller`,
      email: `${prefix}_caller@example.com`,
      fullName: 'Caller',
      isActive: true,
      role: 'user',
    });
    const callee = await User.create({
      username: `${prefix}_callee`,
      email: `${prefix}_callee@example.com`,
      fullName: 'Callee',
      isActive: true,
      role: 'user',
    });
    const callerSocket = await connect(generateToken({ id: caller.id, role: caller.role }));
    const calleeSocket = await connect(generateToken({ id: callee.id, role: callee.role }));
    return { caller, callee, callerSocket, calleeSocket };
  }

  it('updates both people for a voice call incoming and ended event', async () => {
    const { caller, callee, callerSocket, calleeSocket } = await pair('voice');
    let videoIncoming = false;
    let videoEnded = false;
    calleeSocket.on('video_call:incoming', () => {
      videoIncoming = true;
    });
    calleeSocket.on('video_call:ended', () => {
      videoEnded = true;
    });

    const incomingPromise = once<{ callId: string; callType: string; type: string }>(
      calleeSocket,
      'call:incoming'
    );
    const started = await videoCallService.initiateCall(
      caller.id,
      { calleeId: callee.id, callType: 'audio' } as any,
      'audio'
    );
    const incoming = await incomingPromise;
    expect(incoming.callId).toBe(started.callId);
    expect(incoming.callType).toBe('audio');
    expect(incoming.type).toBe('audio');

    await videoCallService.acceptCall(callee.id, started.callId);

    const callerEnded = once<{ callId: string; callEnded: boolean; callType: string }>(
      callerSocket,
      'call:ended'
    );
    const calleeEnded = once<{ callId: string; callEnded: boolean; callType: string }>(
      calleeSocket,
      'call:ended'
    );
    await videoCallService.endCall(caller.id, started.callId);
    const [fromCaller, fromCallee] = await Promise.all([callerEnded, calleeEnded]);
    expect(fromCaller.callId).toBe(started.callId);
    expect(fromCaller.callEnded).toBe(true);
    expect(fromCaller.callType).toBe('audio');
    expect(fromCallee.callId).toBe(started.callId);
    expect(fromCallee.callEnded).toBe(true);
    expect(videoIncoming).toBe(false);
    expect(videoEnded).toBe(false);
  });

  it('updates both people for a video call incoming and ended event', async () => {
    const { caller, callee, callerSocket, calleeSocket } = await pair('video');
    const incomingPromise = once<{ callId: string; callType: string }>(calleeSocket, 'call:incoming');
    const videoIncomingPromise = once<{ callId: string }>(calleeSocket, 'video_call:incoming');
    const started = await videoCallService.initiateCall(
      caller.id,
      { calleeId: callee.id, callType: 'video' } as any,
      'video'
    );
    const [incoming, videoIncoming] = await Promise.all([incomingPromise, videoIncomingPromise]);
    expect(incoming.callId).toBe(started.callId);
    expect(incoming.callType).toBe('video');
    expect(videoIncoming.callId).toBe(started.callId);

    await videoCallService.acceptCall(callee.id, started.callId);

    const ended = Promise.all([
      once<{ callId: string; callEnded: boolean }>(callerSocket, 'call:ended'),
      once<{ callId: string; callEnded: boolean }>(calleeSocket, 'call:ended'),
      once<{ callId: string; callEnded: boolean }>(callerSocket, 'video_call:ended'),
      once<{ callId: string; callEnded: boolean }>(calleeSocket, 'video_call:ended'),
    ]);
    await videoCallService.endCall(callee.id, started.callId);
    const [callerEnd, calleeEnd, callerVideoEnd, calleeVideoEnd] = await ended;
    expect(callerEnd.callEnded).toBe(true);
    expect(calleeEnd.callId).toBe(started.callId);
    expect(callerVideoEnd.callId).toBe(started.callId);
    expect(calleeVideoEnd.callEnded).toBe(true);
  });

  it('tells the caller when a voice call is declined', async () => {
    const { caller, callee, callerSocket } = await pair('decline');
    const started = await videoCallService.initiateCall(
      caller.id,
      { calleeId: callee.id, callType: 'audio' } as any,
      'audio'
    );
    const declined = once<{ callId: string; callEnded: boolean; callType: string }>(
      callerSocket,
      'call:declined'
    );
    await videoCallService.rejectCall(callee.id, started.callId);
    const payload = await declined;
    expect(payload.callId).toBe(started.callId);
    expect(payload.callEnded).toBe(true);
    expect(payload.callType).toBe('audio');
  });
});
