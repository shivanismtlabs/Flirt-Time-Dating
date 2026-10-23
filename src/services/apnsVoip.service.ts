import { Notification, Provider } from '@parse/node-apn';
import { env } from '../config/env';
import { normalizeVoipToken } from '../utils/voipToken';

export type VoipCallPayload = {
  type: 'incoming_call';
  callId: string;
  conversationId: string;
  channelName: string;
  callType: 'audio' | 'video';
  callerId: string;
  calleeId: string;
  callerName: string;
  callerAvatar: string;
  title: string;
  body: string;
  join?: string;
};

export type VoipSendResult = {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
  failedTokens: string[];
};

export type ApnsVoipStatus = {
  ready: boolean;
  production: boolean;
  topic: string;
  missing: string[];
};

let provider: Provider | null = null;

function flag(name: string): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return false;
  return raw === 'true' || raw === '1';
}

/** Read at send time so a missing key is visible in logs, not only at boot. */
export function getApnsVoipStatus(): ApnsVoipStatus {
  const enabled = flag('APNS_ENABLED') || env.APNS_ENABLED;
  const keyId = (process.env.APNS_KEY_ID || env.APNS_KEY_ID || env.APPLE_KEY_ID || '').trim();
  const teamId = (process.env.APNS_TEAM_ID || env.APNS_TEAM_ID || env.APPLE_TEAM_ID || '').trim();
  const privateKey = (
    process.env.APNS_PRIVATE_KEY ||
    env.APNS_PRIVATE_KEY ||
    env.APPLE_PRIVATE_KEY ||
    ''
  )
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim();
  const topic = (
    process.env.APNS_VOIP_TOPIC ||
    env.APNS_VOIP_TOPIC ||
    (env.APPLE_BUNDLE_ID ? `${env.APPLE_BUNDLE_ID}.voip` : '')
  ).trim();
  const productionRaw = process.env.APNS_PRODUCTION;
  const production =
    productionRaw == null || productionRaw === ''
      ? env.APNS_PRODUCTION
      : productionRaw !== 'false' && productionRaw !== '0';

  const missing: string[] = [];
  if (!enabled) missing.push('APNS_ENABLED');
  if (!keyId) missing.push('APNS_KEY_ID');
  if (!teamId) missing.push('APNS_TEAM_ID');
  if (!privateKey) missing.push('APNS_PRIVATE_KEY');
  if (!topic) missing.push('APNS_VOIP_TOPIC');

  return { ready: missing.length === 0, production, topic, missing };
}

function getProvider(): Provider | null {
  const status = getApnsVoipStatus();
  if (!status.ready) return null;
  if (provider) return provider;

  const keyId = (process.env.APNS_KEY_ID || env.APNS_KEY_ID || env.APPLE_KEY_ID).trim();
  const teamId = (process.env.APNS_TEAM_ID || env.APNS_TEAM_ID || env.APPLE_TEAM_ID).trim();
  const key = (process.env.APNS_PRIVATE_KEY || env.APNS_PRIVATE_KEY || env.APPLE_PRIVATE_KEY)
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');

  provider = new Provider({
    token: { key, keyId, teamId },
    production: status.production,
  });
  return provider;
}

function isInvalidVoipToken(reason?: string | null): boolean {
  if (!reason) return false;
  return /BadDeviceToken|Unregistered|DeviceTokenNotForTopic|TopicDisallowed/i.test(reason);
}

/**
 * PushKit VoIP push for iOS CallKit.
 * Apple accepting the push is not the ring — the app must call reportNewIncomingCall.
 * Payload keeps FlirtTime keys plus CallKeep / native aliases.
 */
export async function sendVoipPushToTokens(
  tokens: string[],
  payload: VoipCallPayload
): Promise<VoipSendResult> {
  const unique = [...new Set(tokens.map((token) => normalizeVoipToken(token)).filter(Boolean))];
  if (!unique.length) {
    return { successCount: 0, failureCount: 0, invalidTokens: [], failedTokens: [] };
  }

  const status = getApnsVoipStatus();
  const apnProvider = getProvider();
  if (!apnProvider) {
    console.error(
      '[APNs VoIP] skipped — CallKit will not ring on locked/killed iOS',
      status.missing
    );
    return {
      successCount: 0,
      failureCount: unique.length,
      invalidTokens: [],
      failedTokens: unique,
    };
  }

  const hasVideo = payload.callType === 'video';
  const handle = payload.callerName || payload.callerId || 'FlirtTime';

  const notification = new Notification();
  notification.topic = status.topic;
  notification.pushType = 'voip';
  notification.priority = 10;
  notification.expiry = Math.floor(Date.now() / 1000) + 45;
  notification.contentAvailable = true;
  notification.payload = {
    type: payload.type,
    callId: payload.callId,
    conversationId: payload.conversationId,
    channelName: payload.channelName,
    callType: payload.callType,
    callerId: payload.callerId,
    calleeId: payload.calleeId,
    callerName: payload.callerName,
    callerAvatar: payload.callerAvatar,
    title: payload.title,
    body: payload.body,
    join: payload.join ?? '1',
    uuid: payload.callId,
    callUUID: payload.callId,
    handle,
    name: payload.callerName,
    hasVideo,
    id: payload.callId,
    caller_id: payload.callerId,
    caller_name: payload.callerName,
    callee_id: payload.calleeId,
  };

  try {
    const result = await apnProvider.send(notification, unique);
    const invalidTokens: string[] = [];
    const failedTokens: string[] = [];
    for (const fail of result.failed ?? []) {
      const device = normalizeVoipToken(String(fail.device ?? ''));
      const reason = fail.response?.reason || fail.error?.message || String(fail.error ?? '');
      if (device) {
        failedTokens.push(device);
        if (isInvalidVoipToken(reason)) invalidTokens.push(device);
      }
      console.warn('[APNs VoIP] push failed', { device: device.slice(0, 12), reason });
    }
    if (result.sent?.length) {
      console.info('[APNs VoIP] push sent', {
        sent: result.sent.length,
        failed: result.failed?.length ?? 0,
        topic: status.topic,
        production: status.production,
        callId: payload.callId,
      });
    }
    return {
      successCount: result.sent?.length ?? 0,
      failureCount: result.failed?.length ?? 0,
      invalidTokens: [...new Set(invalidTokens)],
      failedTokens: [...new Set(failedTokens)],
    };
  } catch (err: any) {
    console.warn('[APNs VoIP] send error', err?.message || err);
    return {
      successCount: 0,
      failureCount: unique.length,
      invalidTokens: [],
      failedTokens: unique,
    };
  }
}
