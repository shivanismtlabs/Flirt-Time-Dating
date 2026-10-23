import { Op } from 'sequelize';
import type { MulticastMessage } from 'firebase-admin/messaging';
import { getFirebaseMessaging } from '../config/firebase';
import { Notification, UserDevice } from '../models';
import { getApnsVoipStatus, sendVoipPushToTokens } from './apnsVoip.service';
import { normalizeVoipToken } from '../utils/voipToken';

export type IncomingCallPushInput = {
  calleeId: string;
  callId: string;
  conversationId?: string | null;
  channelName: string;
  callType: 'audio' | 'video';
  callerId: string;
  callerName: string;
  callerAvatar?: string | null;
  ttlMs?: number;
};

/**
 * Background incoming audio/video ring.
 * iOS with a PushKit token gets an APNs VoIP push (CallKit when locked or killed).
 * Android, and iOS without VoIP, get a high-priority FCM on the `incoming_calls` channel.
 * A socket `call:incoming` is still emitted for an open app; this push covers background.
 */
export async function notifyIncomingCallPush(input: IncomingCallPushInput): Promise<void> {
  const callerName = input.callerName.trim() || 'Incoming call';
  const callerAvatar = (input.callerAvatar || '').trim();
  const isVideo = input.callType === 'video';
  const title = callerName;
  const body = isVideo ? 'Incoming video call' : 'Incoming voice call';
  const ttlMs = Math.max(1000, Math.min(input.ttlMs ?? 60_000, 5 * 60 * 1000));
  const conversationId = input.conversationId || '';

  try {
    const existing = await Notification.findOne({
      where: {
        recipientId: input.calleeId,
        type: 'incoming_call',
        entityId: input.callId,
      },
      attributes: ['id'],
    });
    if (!existing) {
      await Notification.create({
        recipientId: input.calleeId,
        senderId: input.callerId,
        type: 'incoming_call',
        title,
        body,
        entityId: input.callId,
        data: {
          type: 'incoming_call',
          callId: input.callId,
          conversationId,
          channelName: input.channelName,
          callType: input.callType,
          callerId: input.callerId,
          calleeId: input.calleeId,
          callerName,
          idempotencyKey: `incoming_call:${input.callId}`,
        },
        isRead: false,
      });
    }
  } catch (err: any) {
    console.warn('[CallPush] could not store incoming-call row:', err?.message || err);
  }

  const devices = await UserDevice.findAll({
    where: { userId: input.calleeId, isActive: true },
    attributes: ['id', 'deviceToken', 'platform', 'voipToken'],
  });
  if (!devices.length) {
    console.warn('[CallPush] no active devices for callee', input.calleeId);
    return;
  }

  const voipTokens: string[] = [];
  const voipDeviceIds = new Set<string>();
  const fcmTokens: string[] = [];

  for (const device of devices) {
    const voip = normalizeVoipToken(device.voipToken);
    if (voip && device.platform === 'ios') {
      voipTokens.push(voip);
      voipDeviceIds.add(device.id);
      continue;
    }
    const fcm = (device.deviceToken || '').trim();
    if (fcm.length > 5) fcmTokens.push(fcm);
  }

  const apns = getApnsVoipStatus();
  console.info('[CallPush] incoming call targets', {
    callId: input.callId,
    callType: input.callType,
    voipCount: voipTokens.length,
    fcmCount: fcmTokens.length,
    apnsReady: apns.ready,
    apnsTopic: apns.topic || null,
  });

  if (!voipTokens.length) {
    console.warn(
      '[CallPush] no voipToken — CallKit will not ring on locked/killed iOS. Register PushKit as voipToken.'
    );
  }

  const voipPayload = {
    type: 'incoming_call' as const,
    callId: input.callId,
    conversationId,
    channelName: input.channelName,
    callType: input.callType,
    callerId: input.callerId,
    calleeId: input.calleeId,
    callerName,
    callerAvatar,
    title,
    body,
    join: '1',
  };

  let fcmFallback = [...fcmTokens];
  if (voipTokens.length && apns.ready) {
    const result = await sendVoipPushToTokens(voipTokens, voipPayload);
    if (result.invalidTokens.length) {
      await UserDevice.update(
        { voipToken: null },
        { where: { voipToken: { [Op.in]: result.invalidTokens } } }
      ).catch(() => undefined);
    }
    const failed = new Set(result.failedTokens.map((token) => normalizeVoipToken(token)));
    if (failed.size) {
      for (const device of devices) {
        const voip = normalizeVoipToken(device.voipToken);
        const fcm = (device.deviceToken || '').trim();
        if (voip && failed.has(voip) && fcm.length > 5) fcmFallback.push(fcm);
      }
    }
  } else if (voipTokens.length && !apns.ready) {
    console.error('[CallPush] APNs VoIP is not configured', apns.missing);
    for (const device of devices) {
      if (!voipDeviceIds.has(device.id)) continue;
      const fcm = (device.deviceToken || '').trim();
      if (fcm.length > 5) fcmFallback.push(fcm);
    }
  }

  fcmFallback = [...new Set(fcmFallback)];
  if (!fcmFallback.length) return;

  const data: Record<string, string> = {
    type: 'incoming_call',
    notify_type: 'incoming_call',
    callId: input.callId,
    conversationId,
    channelName: input.channelName,
    callType: input.callType,
    callerId: input.callerId,
    calleeId: input.calleeId,
    callerName,
    callerAvatar,
    title,
    body,
    join: '1',
    hasVideo: isVideo ? 'true' : 'false',
    icon: isVideo ? 'video_call' : 'call',
    silent: 'false',
    click_action: 'FLUTTER_NOTIFICATION_CLICK',
  };

  const message: MulticastMessage = {
    tokens: fcmFallback,
    data,
    android: {
      priority: 'high',
      ttl: ttlMs,
      collapseKey: `call-${input.callId}`,
      notification: {
        title,
        body,
        channelId: 'incoming_calls',
        sound: 'default',
        tag: `call-${input.callId}`,
        priority: 'max',
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-collapse-id': `call-${input.callId}`,
        'apns-expiration': String(Math.floor(Date.now() / 1000) + Math.ceil(ttlMs / 1000)),
      },
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          contentAvailable: true,
        },
        ...data,
      },
    },
  };

  try {
    const messaging = getFirebaseMessaging();
    const response = await messaging.sendEachForMulticast(message);
    const badTokens: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (resp.success || !resp.error) return;
      const code = resp.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        badTokens.push(fcmFallback[idx]);
      }
    });
    if (badTokens.length) {
      await UserDevice.update(
        { isActive: false },
        { where: { deviceToken: { [Op.in]: badTokens } } }
      );
    }
  } catch (err: any) {
    console.warn('[CallPush] FCM send failed:', err?.message || err);
  }
}
