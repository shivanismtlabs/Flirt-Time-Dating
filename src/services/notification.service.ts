import { Op, WhereOptions } from 'sequelize';
import { getFirebaseMessaging } from '../config/firebase';
import { Notification, UserDevice, User, UserPhoto, NotificationSetting } from '../models';
import { formatThumbnailUrl } from './s3.service';
import { resolveDisplayName } from './discovery.service';
import { getUserRoomName, isUserConnected } from '../realtime/socket.lifecycle';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';
import { normalizeVoipToken } from '../utils/voipToken';

export interface PushNotificationResult {
  inAppCreated: boolean;
  pushStatus: 'sent_to_fcm' | 'no_device_tokens' | 'failed' | 'suppressed_by_settings';
  inAppNotificationId?: string;
  successCount?: number;
  failureCount?: number;
  message?: string;
}

export interface NotificationSenderSummary {
  id: string;
  name: string;
  profilePhotoUrl: string | null;
}

export interface NotificationNavigationDTO {
  type: string;
  targetId: string;
}

export interface NotificationActorDTO {
  id: string;
  name?: string;
  profilePhoto: string | null;
}

export interface NotificationItemDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  actor: NotificationActorDTO | null;
  sender: NotificationSenderSummary | null;
  data: Record<string, any>;
  navigation: NotificationNavigationDTO;
  actionMetadata?: Record<string, any> | null;
}

export interface NotificationSectionDTO {
  title: 'Today' | 'Yesterday' | 'Earlier';
  items: NotificationItemDTO[];
}

export interface GroupedNotificationsResponse {
  notifications: NotificationItemDTO[];
  items: NotificationItemDTO[];
  sections: NotificationSectionDTO[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

/**
 * Resolves raw event type to iOS tap navigation canonical notify_type:
 * - moment_like / moment_comment / moment_comment_reply / moment_comment_like / moment_gift stay moment-specific
 * - like / favorite / super_like -> Explore -> Likes
 * - match / new_match -> Explore -> Matches
 * - compliment -> Explore -> Compliments
 * - membership-upgrade / premium -> Premium
 * - message / new_message -> Chat
 * - gesture-unverified / profile-image-unverified / incomplete -> Verify / Edit profile
 */
export const resolveNotifyType = (rawType: string): string => {
  const t = (rawType || '').toLowerCase().trim();
  if (
    t === 'moment_like' ||
    t === 'moment_comment' ||
    t === 'moment_comment_reply' ||
    t === 'moment_comment_like' ||
    t === 'moment_gift' ||
    t === 'moment_reaction' ||
    t === 'quick_moment_reaction' ||
    t === 'moment_reply' ||
    t === 'quick_moment_reply'
  ) {
    if (t === 'quick_moment_reaction') return 'moment_reaction';
    if (t === 'quick_moment_reply') return 'moment_reply';
    return t;
  }
  if (t === 'comment_like') return 'moment_comment_like';
  if (t === 'super_like') return 'super_like';
  if (t === 'favorite') return 'favorite';
  if (t.includes('like') || t.includes('reaction')) return 'like';
  if (t === 'new_match' || t.includes('match') || t.includes('connection')) return 'match';
  if (t.includes('compliment')) return 'compliment';
  if (t.includes('membership') || t.includes('premium') || t.includes('upgrade')) return 'membership-upgrade';
  if (t === 'new_message' || t.includes('message') || t.includes('chat')) return 'message';
  if (t.includes('gesture') || t.includes('unverified') || t.includes('incomplete')) return 'gesture-unverified';
  if (t.includes('visit') || t.includes('view') || t.includes('profile')) return 'profile_visit';
  if (t.includes('tip')) return 'dating_tip';
  return rawType || 'like';
};

/** Direct dispatcher calls for call types stay data-only. Live audio/video rings use callPush (PushKit + incoming_calls). */
const SILENT_CALL_NOTIFY_TYPES = new Set(['incoming_call', 'video_call', 'audio_call']);

export const isSilentCallNotification = (type: string): boolean =>
  SILENT_CALL_NOTIFY_TYPES.has((type || '').toLowerCase().trim());

export class NotificationServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'NotificationServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, NotificationServiceError.prototype);
  }
}

/**
 * Categorizes a timestamp into Today, Yesterday, or Earlier in the target timezone
 */
export const getDateGroup = (date: Date, timezone = 'UTC'): 'Today' | 'Yesterday' | 'Earlier' => {
  const now = new Date();

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  const nowDateStr = formatter.format(now);
  const itemDateStr = formatter.format(date);

  if (nowDateStr === itemDateStr) {
    return 'Today';
  }

  // Determine yesterday in target timezone
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayDateStr = formatter.format(yesterday);
  if (itemDateStr === yesterdayDateStr) {
    return 'Yesterday';
  }

  return 'Earlier';
};

export class NotificationService {
  /**
   * Helper to resolve primary approved profile photo URL
   */
  public resolvePrimaryPhoto(userProfilePicture?: string | null, photos?: any[] | null, version?: any): string | null {
    let photo = userProfilePicture || null;
    let photoVersion = version;
    if (photos && photos.length > 0) {
      const approvedPhotos = photos.filter((p) => p.status === 'approved');
      if (approvedPhotos.length > 0) {
        const primary = approvedPhotos.find((p) => p.isPrimary);
        if (primary) {
          photo = primary.imageUrl;
          photoVersion = primary.updatedAt || version;
        } else if (!photo) {
          photo = approvedPhotos[0].imageUrl;
          photoVersion = approvedPhotos[0].updatedAt || version;
        }
      }
    }
    return photo ? formatThumbnailUrl(photo, photoVersion) : null;
  }

  /**
   * Checks whether push notifications are enabled for the recipient and this event type.
   * Rules:
   * 1. Global master pushNotifications switch: When false, NOT a single notification is triggered.
   * 2. Incoming call pushes (`incoming_call`) follow the master push switch.
   *    Other types whose name contains "call" stay out of likes/comments.
   * 3. Category checks:
   *    - New messages (newMessages)
   *    - New matches (newMatches)
   *    - Like & comments (likeComments)
   *    - Profile visits (profileVisits)
   */
  public shouldSendPush(settings: any, type: string): boolean {
    if (!settings) {
      return true; // default all enabled
    }

    // 1. Master push switch: when OFF, not a single notification triggers!
    const isMasterPushOn =
      settings.pushNotifications !== undefined
        ? settings.pushNotifications
        : settings.push_notifications !== undefined
        ? settings.push_notifications
        : settings.push !== undefined
        ? settings.push
        : true;

    if (!isMasterPushOn) {
      return false;
    }

    const normalizedType = (type || '').toLowerCase();

    // Incoming audio/video call ring. Not part of likes & comments.
    if (
      normalizedType === 'incoming_call' ||
      normalizedType === 'video_call' ||
      normalizedType === 'audio_call'
    ) {
      return true;
    }

    // Other "*call*" types are not likes/comments and are not call signaling.
    if (normalizedType.includes('call')) {
      return false;
    }

    // New messages
    if (normalizedType.includes('message') || normalizedType.includes('chat')) {
      const allowed =
        settings.newMessages !== undefined
          ? settings.newMessages
          : settings.new_messages !== undefined
          ? settings.new_messages
          : settings.new_message !== undefined
          ? settings.new_message
          : true;
      return Boolean(allowed);
    }

    // New matches
    if (normalizedType.includes('match') || normalizedType.includes('connection')) {
      const allowed =
        settings.newMatches !== undefined
          ? settings.newMatches
          : settings.new_matches !== undefined
          ? settings.new_matches
          : true;
      return Boolean(allowed);
    }

    // Like, comments, reactions, quick-moment replies, and moment gifts - NOT calls
    if (
      normalizedType.includes('like') ||
      normalizedType.includes('comment') ||
      normalizedType.includes('reaction') ||
      normalizedType.includes('reply') ||
      normalizedType.includes('compliment') ||
      normalizedType.includes('gift')
    ) {
      const allowed =
        settings.likeComments !== undefined
          ? settings.likeComments
          : settings.like_comments !== undefined
          ? settings.like_comments
          : settings.likes_comments_calls !== undefined
          ? settings.likes_comments_calls
          : true;
      return Boolean(allowed);
    }

    // Profile visits
    if (
      normalizedType.includes('visit') ||
      normalizedType.includes('view') ||
      normalizedType.includes('profile')
    ) {
      const allowed =
        settings.profileVisits !== undefined
          ? settings.profileVisits
          : settings.profile_visits !== undefined
          ? settings.profile_visits
          : settings.profile_visit !== undefined
          ? settings.profile_visit
          : true;
      return Boolean(allowed);
    }

    // Dating tips
    if (normalizedType.includes('tip')) {
      const allowed =
        settings.datingTips !== undefined
          ? settings.datingTips
          : settings.dating_tips !== undefined
          ? settings.dating_tips
          : settings.new_tips_available !== undefined
          ? settings.new_tips_available
          : false;
      return Boolean(allowed);
    }

    return true;
  }

  /**
   * Registers or updates a device token.
   * If the token was previously registered to another user, safely reassigns ownership.
   */
  public async registerDeviceToken(
    userId: string,
    input: {
      deviceToken: string;
      platform?: 'ios' | 'android' | 'web';
      deviceId?: string | null;
      /**
       * iOS PushKit token. A non-empty value replaces the stored token.
       * Omit it to keep the previous CallKit registration.
       */
      voipToken?: string | null;
    }
  ) {
    const { deviceToken, deviceId } = input;
    const cleanToken = deviceToken.trim();
    const voipInRequest = normalizeVoipToken(input.voipToken);
    const rawPlatform = String(input.platform || 'android').toLowerCase().trim();
    const platform: 'ios' | 'android' | 'web' =
      rawPlatform === 'ios' || rawPlatform === 'iphone' || rawPlatform === 'ipad' || rawPlatform === 'apple'
        ? 'ios'
        : rawPlatform === 'web' || rawPlatform === 'browser'
        ? 'web'
        : 'android';

    let device = await UserDevice.findOne({ where: { deviceToken: cleanToken } });
    if (!device && deviceId) {
      device = await UserDevice.findOne({ where: { userId, deviceId } });
    }

    if (device) {
      device.userId = userId;
      device.deviceToken = cleanToken;
      device.platform = platform;
      if (deviceId !== undefined) device.deviceId = deviceId || null;
      device.isActive = true;
      device.lastUsedAt = new Date();
      if (voipInRequest) device.voipToken = voipInRequest;
      await device.save();
    } else {
      device = await UserDevice.create({
        userId,
        deviceToken: cleanToken,
        platform,
        deviceId: deviceId || null,
        voipToken: voipInRequest || null,
        isActive: true,
        lastUsedAt: new Date(),
      });
    }

    if (voipInRequest) {
      await UserDevice.update(
        { voipToken: null },
        {
          where: {
            voipToken: voipInRequest,
            id: { [Op.ne]: device.id },
          },
        }
      );
    }

    return {
      registered: true,
      deviceId: device.id,
      userId: device.userId,
      platform: device.platform,
      isActive: device.isActive,
      hasVoipToken: Boolean(normalizeVoipToken(device.voipToken)),
    };
  }

  /**
   * Deactivates a device token for the user upon logout or unregister
   */
  public async deactivateDeviceToken(deviceToken: string, userId?: string) {
    const where: any = { deviceToken: deviceToken.trim() };
    if (userId) {
      where.userId = userId;
    }
    await UserDevice.update({ isActive: false }, { where });
    return { unregistered: true };
  }

  /**
   * Deactivates all device tokens for a user upon logout
   */
  public async deactivateAllUserDevices(userId: string) {
    await UserDevice.update({ isActive: false }, { where: { userId } });
    return { unregistered: true };
  }

  /**
   * General notification dispatcher:
   * 1. Idempotency & deduplication check
   * 2. Persists In-App notification in DB (source of truth)
   * 3. Dispatches FCM multicast push to all active devices
   * 4. Deactivates invalid/expired tokens automatically
   */
  public async dispatchNotification(
    recipientId: string,
    input: {
      type: string;
      title: string;
      body: string;
      senderId?: string | null;
      entityId?: string | null;
      data?: Record<string, any> | null;
      navigation?: NotificationNavigationDTO;
      idempotencyKey?: string;
      isForeground?: boolean;
      /** Data-only push: no alert and no sound. */
      silent?: boolean;
      /** How long a silent call push stays deliverable, in milliseconds. */
      ttlMs?: number;
    }
  ): Promise<PushNotificationResult> {
    const { type, title, body, senderId, entityId, navigation, idempotencyKey, isForeground } = input;
    const silentPush =
      Boolean(input.silent) || isSilentCallNotification(type) || isSilentCallNotification(String(input.data?.type || ''));
    const resolvedNotifyType = resolveNotifyType(input.data?.notify_type || type);
    // The recipient's open app already draws one banner from the data payload.
    // A second OS alert for the same gift is the duplicate the device shows.
    const giftWhileAppOpen = resolvedNotifyType === 'moment_gift' && isUserConnected(recipientId);
    const actorUserId = String(input.data?.user_id || senderId || '');

    // 1. Idempotency / deduplication check (only when explicit idempotencyKey is provided).
    // The key is stored on the payload, not as entityId, so a retried gift does not
    // insert a second in-app row and a second push.
    if (idempotencyKey) {
      const candidates = await Notification.findAll({
        where: {
          recipientId,
          type: resolvedNotifyType,
          ...(entityId ? { entityId } : {}),
        },
        order: [['createdAt', 'DESC']],
        limit: 25,
      });
      const existing = candidates.find((row) => {
        const payload =
          row.data && typeof row.data === 'string'
            ? (() => {
                try {
                  return JSON.parse(row.data);
                } catch {
                  return null;
                }
              })()
            : row.data;
        return payload?.idempotencyKey === idempotencyKey;
      });

      if (existing) {
        return {
          inAppCreated: true,
          pushStatus: 'sent_to_fcm',
          inAppNotificationId: existing.id,
          message: 'Notification already exists (idempotent)',
        };
      }
    }

    const momentId = String(input.data?.momentId || input.data?.quickMomentId || '').trim();
    const quickMomentId = String(input.data?.quickMomentId || '').trim();

    const payloadData: Record<string, any> = {
      ...(input.data || {}),
      notify_type: resolvedNotifyType,
      type: resolvedNotifyType,
      entityId: entityId || '',
      navigation: navigation || { type: resolvedNotifyType, targetId: entityId || '' },
      ...(idempotencyKey && { idempotencyKey }),
      ...(momentId ? { momentId } : {}),
    };
    if (actorUserId) {
      payloadData.user_id = actorUserId;
    }

    // 2. Persist In-App Notification in DB
    let createdRecord: Notification;
    try {
      createdRecord = await Notification.create({
        recipientId,
        senderId: senderId || null,
        type: resolvedNotifyType,
        title,
        body,
        entityId: entityId || null,
        data: payloadData,
        isRead: false,
      });
      await this.publishUnreadCount(recipientId);
    } catch (dbErr: any) {
      console.error('[Notification Dispatch DB Error]:', dbErr.message);
      throw dbErr;
    }

    // 3. Check user notification settings from notification_settings table before sending push
    try {
      const settingRecord = await NotificationSetting.findOne({
        where: { userId: recipientId },
      });

      let settings: any = settingRecord;
      if (!settings) {
        const recipientUser = await User.findByPk(recipientId, {
          attributes: ['id', 'notificationSettings'],
        });
        settings = recipientUser?.notificationSettings;
      }

      const isPushAllowed = this.shouldSendPush(settings, resolvedNotifyType);

      if (!isPushAllowed) {
        return {
          inAppCreated: true,
          pushStatus: 'suppressed_by_settings',
          inAppNotificationId: createdRecord.id,
          successCount: 0,
          failureCount: 0,
          message:
            'Notification saved in DB, but push was suppressed by user notification settings',
        };
      }
    } catch (checkErr: any) {
      console.warn('[Notification Settings Check Warn]:', checkErr.message);
      // Fallback: proceed with push if check encounters error
    }

    // 4. Query active device tokens for the recipient
    const devices = await UserDevice.findAll({
      where: { userId: recipientId, isActive: true },
      attributes: ['deviceToken', 'platform'],
    });

    const tokens = (devices || [])
      .map((d) => (d.deviceToken || '').trim())
      .filter((t) => t.length > 5);

    if (tokens.length === 0) {
      return {
        inAppCreated: true,
        pushStatus: 'no_device_tokens',
        inAppNotificationId: createdRecord.id,
        successCount: 0,
        failureCount: 0,
        message: 'Notification saved in DB, but user has no active registered devices',
      };
    }

    // 5. Dispatch Multicast Message via Firebase Admin
    try {
      const messaging = getFirebaseMessaging();
      const isAppForeground = Boolean(isForeground);
      const dataOnly = isAppForeground || silentPush || giftWhileAppOpen;
      const giftCollapseKey =
        resolvedNotifyType === 'moment_gift'
          ? idempotencyKey || `moment_gift_${entityId || recipientId}`
          : undefined;
      const callTtlMs = silentPush
        ? Math.max(1000, Math.min(input.ttlMs ?? 60_000, 5 * 60 * 1000))
        : undefined;

      const fcmData: Record<string, string> = {
        notify_type: resolvedNotifyType,
        type: resolvedNotifyType,
        id: String(createdRecord.id),
        entityId: String(entityId || ''),
        senderId: String(senderId || actorUserId || ''),
        navType: String(navigation?.type || resolvedNotifyType),
        navTargetId: String(navigation?.targetId || entityId || actorUserId || ''),
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        isForeground: isAppForeground ? 'true' : 'false',
        title,
        body,
        ...(input.data
          ? Object.fromEntries(
              Object.entries(input.data).map(([k, v]) => [k, String(v ?? '')])
            )
          : {}),
      };
      if (actorUserId) {
        fcmData.user_id = actorUserId;
        fcmData.actor_id = actorUserId;
      }
      fcmData.notify_type = resolvedNotifyType;
      fcmData.type = resolvedNotifyType;
      if (momentId) {
        fcmData.momentId = momentId;
      }
      if (quickMomentId) {
        fcmData.quickMomentId = quickMomentId;
      }
      if (silentPush) {
        fcmData.silent = 'true';
      }

      const apnsCustom: Record<string, string> = {
        notify_type: resolvedNotifyType,
        type: resolvedNotifyType,
        navType: String(navigation?.type || resolvedNotifyType),
        navTargetId: String(navigation?.targetId || entityId || actorUserId || ''),
        ...(actorUserId ? { user_id: actorUserId } : {}),
        ...(momentId ? { momentId } : {}),
        ...(quickMomentId ? { quickMomentId } : {}),
      };

      const message: MulticastMessage = {
        tokens,
        ...(dataOnly
          ? {} // Foreground and incoming calls: data-only so the OS does not show a banner or play a sound
          : {
              notification: {
                title,
                body,
              },
            }),
        data: fcmData,
        android: dataOnly
          ? {
              priority: 'high',
              ...(giftCollapseKey ? { collapseKey: giftCollapseKey } : {}),
              ...(silentPush
                ? { ttl: callTtlMs, collapseKey: 'incoming_call' }
                : {}),
            }
          : {
              priority: 'high',
              ...(giftCollapseKey ? { collapseKey: giftCollapseKey } : {}),
              notification: {
                title,
                body,
                sound: 'default',
                priority: 'high',
                defaultSound: true,
                defaultVibrateTimings: true,
              },
            },
        apns: dataOnly
          ? {
              headers: {
                'apns-priority': '5',
                'apns-push-type': 'background',
                ...(silentPush
                  ? {
                      'apns-collapse-id': 'incoming-call',
                      'apns-expiration': String(Math.floor(Date.now() / 1000) + Math.ceil((callTtlMs || 60_000) / 1000)),
                    }
                  : {}),
              },
              payload: {
                aps: {
                  contentAvailable: true,
                },
                ...apnsCustom,
                ...(silentPush ? { silent: 'true' } : {}),
              },
            }
          : {
              headers: {
                'apns-priority': '10',
                'apns-push-type': 'alert',
                ...(giftCollapseKey ? { 'apns-collapse-id': giftCollapseKey } : {}),
              },
              payload: {
                aps: {
                  alert: { title, body },
                  sound: 'default',
                  badge: 1,
                  contentAvailable: true,
                },
                ...apnsCustom,
              },
            },
      };

      const response: BatchResponse = await messaging.sendEachForMulticast(message);

      // Clean up dead/unregistered tokens and keep the FCM error for the caller.
      const badTokens: string[] = [];
      const failureMessages: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code;
          failureMessages.push(`${code}: ${resp.error.message}`);
          console.warn('[FCM] Token send failed:', {
            code,
            message: resp.error.message,
            tokenLength: tokens[idx]?.length || 0,
          });
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            badTokens.push(tokens[idx]);
          }
        }
      });

      if (badTokens.length > 0) {
        await UserDevice.update(
          { isActive: false },
          { where: { deviceToken: { [Op.in]: badTokens } } }
        );
      }

      if (response.successCount === 0 && failureMessages.length > 0) {
        console.warn('[FCM] Push failed for all tokens:', failureMessages[0]);
      }

      return {
        inAppCreated: true,
        pushStatus: response.successCount > 0 ? 'sent_to_fcm' : 'failed',
        inAppNotificationId: createdRecord.id,
        successCount: response.successCount,
        failureCount: response.failureCount,
        message:
          response.successCount > 0
            ? undefined
            : failureMessages[0] || 'FCM accepted no tokens',
      };
    } catch (fcmErr: any) {
      console.warn('[FCM] Push dispatch caught safely without DB loss:', fcmErr.message);
      return {
        inAppCreated: true,
        pushStatus: 'failed',
        inAppNotificationId: createdRecord.id,
        successCount: 0,
        failureCount: tokens.length,
        message: `FCM push error: ${fcmErr.message}`,
      };
    }
  }

  /**
   * Compatibility wrapper for Connection Requests
   */
  public async sendConnectionRequestNotification(
    targetUserId: string,
    input: {
      requesterId: string;
      requesterName: string;
      requestId: string;
      reason?: string | null;
    }
  ): Promise<PushNotificationResult> {
    const body = input.reason
      ? `${input.requesterName} wants to connect: "${input.reason}"`
      : `${input.requesterName} wants to connect with you.`;

    return this.dispatchNotification(targetUserId, {
      type: 'connection_request',
      title: 'New Connect Request',
      body,
      senderId: input.requesterId,
      entityId: input.requestId,
      navigation: {
        type: 'connection_request',
        targetId: input.requestId,
      },
      data: {
        reason: input.reason || '',
        senderName: input.requesterName,
      },
    });
  }

  /**
   * Dispatches In-App and Push Notification for a profile compliment
   */
  public async sendComplimentNotification(
    targetUserId: string,
    input: {
      requesterId: string;
      requesterName: string;
      complimentId: string;
      message: string;
    }
  ): Promise<PushNotificationResult> {
    const title = 'New Compliment!';
    const preview =
      input.message.length > 80
        ? `${input.message.substring(0, 77)}...`
        : input.message;
    const body = `${input.requesterName} sent you a compliment: "${preview}"`;

    return this.dispatchNotification(targetUserId, {
      type: 'compliment',
      title,
      body,
      senderId: input.requesterId,
      entityId: input.complimentId,
      navigation: {
        type: 'compliments',
        targetId: input.complimentId,
      },
      data: {
        type: 'compliment',
        interactionType: 'compliments',
        complimentId: input.complimentId,
        requestId: input.complimentId,
        senderId: input.requesterId,
        senderName: input.requesterName,
        message: input.message,
      },
    });
  }

  /**
   * Dispatches notification for a new message
   */
  public async sendMessageNotification(
    recipientId: string,
    input: {
      senderId: string;
      senderName: string;
      message: string;
      conversationId?: string;
    }
  ): Promise<PushNotificationResult> {
    const preview =
      input.message.length > 70 ? `${input.message.slice(0, 67)}...` : input.message;
    return this.dispatchNotification(recipientId, {
      type: 'new_message',
      title: input.senderName,
      body: preview,
      senderId: input.senderId,
      entityId: input.conversationId || input.senderId,
      navigation: {
        type: 'chat',
        targetId: input.conversationId || input.senderId,
      },
      data: {
        type: 'chat',
        conversationId: input.conversationId || '',
        senderId: input.senderId,
        senderName: input.senderName,
      },
    });
  }

  /**
   * Dispatches mutual match notifications to both matched users
   */
  public async sendMatchNotification(
    user1Id: string,
    user2Id: string,
    input: {
      user1Name: string;
      user2Name: string;
      matchId: string;
    }
  ): Promise<void> {
    try {
      await Promise.allSettled([
        this.dispatchNotification(user1Id, {
          type: 'match',
          title: "It's a Match! 🎉",
          body: `You and ${input.user2Name} liked each other! Start chatting now.`,
          senderId: user2Id,
          entityId: input.matchId,
          navigation: { type: 'match', targetId: input.matchId },
          data: { matchId: input.matchId, partnerName: input.user2Name },
        }),
        this.dispatchNotification(user2Id, {
          type: 'match',
          title: "It's a Match! 🎉",
          body: `You and ${input.user1Name} liked each other! Start chatting now.`,
          senderId: user1Id,
          entityId: input.matchId,
          navigation: { type: 'match', targetId: input.matchId },
          data: { matchId: input.matchId, partnerName: input.user1Name },
        }),
      ]);
    } catch {}
  }

  /**
   * Dispatches notification for a like or reaction on a profile or moment
   */
  public async sendLikeNotification(
    recipientId: string,
    input: {
      senderId: string;
      senderName: string;
      isSuper?: boolean;
      momentId?: string;
      reaction?: string;
    }
  ): Promise<PushNotificationResult> {
    const isSuper = !!input.isSuper;
    const isMoment = !!input.momentId;
    const title = isSuper
      ? 'New Super Like! ⭐'
      : isMoment
      ? 'Moment Liked ❤️'
      : 'New Like ❤️';
    const body = isMoment
      ? `${input.senderName} liked your moment!`
      : isSuper
      ? `${input.senderName} super liked your profile!`
      : `${input.senderName} liked your profile!`;

    return this.dispatchNotification(recipientId, {
      type: isMoment ? 'moment_like' : isSuper ? 'super_like' : 'like',
      title,
      body,
      senderId: input.senderId,
      entityId: input.momentId || input.senderId,
      navigation: {
        type: isMoment ? 'moment' : 'profile',
        targetId: input.momentId || input.senderId,
      },
      data: {
        senderId: input.senderId,
        senderName: input.senderName,
        momentId: input.momentId || '',
        reaction: input.reaction || 'like',
      },
    });
  }

  /**
   * Dispatches notification for a comment or reply on a moment
   */
  public async sendCommentNotification(
    recipientId: string,
    input: {
      senderId: string;
      senderName: string;
      comment: string;
      momentId: string;
      commentId?: string;
      isReply?: boolean;
    }
  ): Promise<PushNotificationResult> {
    const snippet =
      input.comment.length > 60 ? `${input.comment.slice(0, 57)}...` : input.comment;
    const title = input.isReply
      ? 'New Reply to Your Comment 💬'
      : 'New Comment on Your Moment 💬';
    const body = `${input.senderName}: "${snippet}"`;

    return this.dispatchNotification(recipientId, {
      type: input.isReply ? 'moment_comment_reply' : 'moment_comment',
      title,
      body,
      senderId: input.senderId,
      entityId: input.momentId,
      navigation: {
        type: 'moment',
        targetId: input.momentId,
      },
      data: {
        momentId: input.momentId,
        commentId: input.commentId || '',
        senderId: input.senderId,
        senderName: input.senderName,
      },
    });
  }

  /**
   * Dispatches notification when someone likes a moment comment or reply
   */
  public async sendCommentLikeNotification(
    recipientId: string,
    input: {
      senderId: string;
      senderName: string;
      commentId: string;
      momentId?: string | null;
      commentSnippet?: string | null;
    }
  ): Promise<PushNotificationResult> {
    const rawSnippet = (input.commentSnippet || '').trim();
    const snippet =
      rawSnippet.length > 50 ? `${rawSnippet.slice(0, 47)}...` : rawSnippet;
    const body = snippet
      ? `${input.senderName} liked your comment: "${snippet}"`
      : `${input.senderName} liked your comment!`;
    const targetId = input.momentId || input.commentId;

    return this.dispatchNotification(recipientId, {
      type: 'moment_comment_like',
      title: 'Comment Liked ❤️',
      body,
      senderId: input.senderId,
      entityId: targetId,
      navigation: {
        type: 'moment',
        targetId,
      },
      data: {
        momentId: input.momentId || '',
        commentId: input.commentId,
        senderId: input.senderId,
        senderName: input.senderName,
      },
    });
  }

  /**
   * Dispatches notification when someone sends a gift on a moment
   */
  public async sendMomentGiftNotification(
    recipientId: string,
    input: {
      senderId: string;
      senderName: string;
      momentId: string;
      giftName: string;
      giftIcon?: string | null;
      giftCode?: string | null;
      quantity?: number;
      totalCoins?: number;
      giftId?: string | null;
    }
  ): Promise<PushNotificationResult> {
    const qty = input.quantity && input.quantity > 1 ? input.quantity : 1;
    const icon = input.giftIcon || '🎁';
    const qtyLabel = qty > 1 ? `${qty}x ` : '';

    return this.dispatchNotification(recipientId, {
      type: 'moment_gift',
      title: `New Gift Received! ${icon}`,
      body: `${input.senderName} sent you ${qtyLabel}${input.giftName} ${icon} on your moment!`,
      senderId: input.senderId,
      entityId: input.momentId,
      idempotencyKey: input.giftId ? `moment_gift_${input.giftId}` : undefined,
      navigation: {
        type: 'moment',
        targetId: input.momentId,
      },
      data: {
        momentId: input.momentId,
        giftId: input.giftId || '',
        giftCode: input.giftCode || '',
        giftName: input.giftName,
        icon,
        quantity: String(qty),
        totalCoins: String(input.totalCoins || 0),
        senderName: input.senderName,
      },
    });
  }

  /**
   * Dispatches notification for a profile visit
   */
  public async sendProfileVisitNotification(
    recipientId: string,
    input: {
      visitorId: string;
      visitorName: string;
    }
  ): Promise<PushNotificationResult> {
    return this.dispatchNotification(recipientId, {
      type: 'profile_visit',
      title: 'Profile Visit 👀',
      body: `${input.visitorName} viewed your profile!`,
      senderId: input.visitorId,
      entityId: input.visitorId,
      navigation: {
        type: 'profile',
        targetId: input.visitorId,
      },
      data: {
        visitorId: input.visitorId,
        visitorName: input.visitorName,
      },
      idempotencyKey: `profile_visit_${input.visitorId}_${recipientId}_${new Date().toISOString().slice(0, 13)}`,
    });
  }

  /**
   * Dispatches a Dating Tip alert to a user
   */
  public async sendDatingTipNotification(
    recipientId: string,
    input: {
      title?: string;
      body: string;
      tipId?: string;
    }
  ): Promise<PushNotificationResult> {
    return this.dispatchNotification(recipientId, {
      type: 'dating_tip',
      title: input.title || 'Dating Tip 💡',
      body: input.body,
      entityId: input.tipId || '',
      navigation: {
        type: 'dating_tips',
        targetId: input.tipId || '',
      },
      data: {
        tipId: input.tipId || '',
      },
    });
  }

  /**
   * Get Notifications grouped into Today, Yesterday, and Earlier sections with cursor pagination
   */
  public async getGroupedNotifications(
    userId: string,
    options: {
      limit?: number;
      cursor?: string;
      timezone?: string;
      unreadOnly?: boolean;
    } = {}
  ): Promise<GroupedNotificationsResponse> {
    const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
    const timezone = options.timezone || 'UTC';

    let cursorPayload: { createdAt: string; id: string } | null = null;
    if (options.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
        if (decoded.createdAt && decoded.id) {
          cursorPayload = decoded;
        }
      } catch {
        throw new NotificationServiceError('Invalid cursor provided', 400, 'INVALID_CURSOR');
      }
    }

    const whereClause: any = {
      recipientId: userId,
    };

    if (options.unreadOnly) {
      whereClause.isRead = false;
    }

    if (cursorPayload) {
      whereClause[Op.and] = [
        {
          [Op.or]: [
            { createdAt: { [Op.lt]: new Date(cursorPayload.createdAt) } },
            {
              createdAt: new Date(cursorPayload.createdAt),
              id: { [Op.lt]: cursorPayload.id },
            },
          ],
        },
      ];
    }

    const rows = await Notification.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'sender',
          attributes: ['id', 'firstName', 'fullName', 'nickName', 'username', 'profilePicture'],
          required: false,
          include: [
            {
              model: UserPhoto,
              as: 'photos',
              where: { status: 'approved' },
              required: false,
              separate: true,
            },
          ],
        },
      ],
      order: [
        ['createdAt', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: limit + 1,
    });

    // A sender with several approved photos used to multiply the parent row
    // in the join, so one gift (or any other event) showed up twice.
    const uniqueRows: Notification[] = [];
    const seenIds = new Set<string>();
    for (const row of rows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      uniqueRows.push(row);
    }

    const hasMore = uniqueRows.length > limit;
    const itemsToReturn = hasMore ? uniqueRows.slice(0, limit) : uniqueRows;

    // Transform into standard DTOs
    const dtos: NotificationItemDTO[] = itemsToReturn.map((n) => {
      let senderSummary: NotificationSenderSummary | null = null;
      let primaryPhoto: string | null = null;
      if (n.sender) {
        primaryPhoto = this.resolvePrimaryPhoto(
          n.sender.profilePicture,
          n.sender.photos,
          n.sender.updatedAt
        );
        senderSummary = {
          id: n.sender.id,
          name: resolveDisplayName(n.sender),
          profilePhotoUrl: primaryPhoto,
        };
      }

      const actorUserId = n.sender?.id || n.senderId || n.data?.user_id || '';
      const actor: NotificationActorDTO | null = actorUserId
        ? {
            id: actorUserId,
            name: senderSummary?.name,
            profilePhoto: primaryPhoto,
          }
        : null;

      const resolvedType = resolveNotifyType(n.type);
      const momentId = String(n.data?.momentId || n.data?.quickMomentId || '').trim();
      const quickMomentId = String(n.data?.quickMomentId || '').trim();

      // Safe navigation payload
      const nav = n.data?.navigation || {
        type: resolvedType,
        targetId: n.entityId || n.id,
      };

      return {
        id: n.id,
        type: resolvedType,
        title: n.title,
        body: n.body,
        isRead: Boolean(n.isRead),
        createdAt: n.createdAt.toISOString(),
        actor,
        sender: senderSummary,
        data: {
          ...(n.data || {}),
          notify_type: resolvedType,
          type: resolvedType,
          user_id: actorUserId,
          ...(momentId ? { momentId } : {}),
          ...(quickMomentId ? { quickMomentId } : {}),
        },
        navigation: {
          type: nav.type || resolvedType,
          targetId: String(nav.targetId || n.entityId || n.id),
        },
        actionMetadata: n.data?.actionMetadata || null,
      };
    });

    // Group items into Today, Yesterday, Earlier
    const todayItems: NotificationItemDTO[] = [];
    const yesterdayItems: NotificationItemDTO[] = [];
    const earlierItems: NotificationItemDTO[] = [];

    dtos.forEach((item) => {
      const group = getDateGroup(new Date(item.createdAt), timezone);
      if (group === 'Today') {
        todayItems.push(item);
      } else if (group === 'Yesterday') {
        yesterdayItems.push(item);
      } else {
        earlierItems.push(item);
      }
    });

    const allSections: { title: 'Today' | 'Yesterday' | 'Earlier'; items: NotificationItemDTO[] }[] = [
      { title: 'Today', items: todayItems },
      { title: 'Yesterday', items: yesterdayItems },
      { title: 'Earlier', items: earlierItems },
    ];
    const sections: NotificationSectionDTO[] = allSections.filter((s) => s.items.length > 0);

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? Buffer.from(
            JSON.stringify({
              createdAt: itemsToReturn[itemsToReturn.length - 1].createdAt.toISOString(),
              id: itemsToReturn[itemsToReturn.length - 1].id,
            })
          ).toString('base64url')
        : null;

    return {
      notifications: dtos,
      items: dtos,
      sections,
      pagination: {
        limit,
        nextCursor,
        hasMore,
      },
    };
  }

  /**
   * Legacy adapter for backward compatibility
   */
  public async getUserNotifications(
    userId: string,
    options: { page?: number; limit?: number; unreadOnly?: boolean } = {}
  ) {
    const page = Math.max(1, Number(options.page || 1));
    const limit = Math.min(50, Math.max(1, Number(options.limit || 20)));
    const offset = (page - 1) * limit;

    const whereClause: any = { recipientId: userId };
    if (options.unreadOnly) {
      whereClause.isRead = false;
    }

    const [unreadCount, { count: total, rows: notifications }] = await Promise.all([
      Notification.count({
        where: { recipientId: userId, isRead: false },
      }),
      Notification.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'sender',
            attributes: ['id', 'fullName', 'firstName', 'username', 'profilePicture'],
            required: false,
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      }),
    ]);

    return {
      notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get total unread notifications count for badge display
   */
  public async getUnreadCount(userId: string): Promise<number> {
    return Notification.count({
      where: {
        recipientId: userId,
        isRead: false,
      },
    });
  }

  /**
   * Pushes the current unread badge to the user's open sockets.
   * Keys match GET /notifications/counts so the open app can read any of them.
   */
  public async publishUnreadCount(userId: string): Promise<void> {
    try {
      const { getSocketServer } = await import('../realtime/socket.server');
      const io = getSocketServer();
      const unreadCount = await this.getUnreadCount(userId);
      const payload = { unreadCount, count: unreadCount, unread: unreadCount };
      io.to(getUserRoomName(userId)).emit('notification:count', payload);
      if (userId.toLowerCase() !== userId) {
        io.to(getUserRoomName(userId.toLowerCase())).emit('notification:count', payload);
      }
    } catch (err: any) {
      if (!String(err?.message || '').includes('has not been initialized')) {
        console.warn('[Notification Count Socket]:', err?.message || err);
      }
    }
  }

  /**
   * Marks a single in-app notification as read idempotently
   */
  public async markAsRead(userId: string, notificationId: string) {
    const notification = await Notification.findOne({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      return null;
    }

    const wasUnread = !notification.isRead;
    notification.isRead = true;
    await notification.save();
    if (wasUnread) {
      await this.publishUnreadCount(userId);
    }
    return notification;
  }

  /**
   * Marks all in-app notifications as read for a user
   */
  public async markAllAsRead(userId: string) {
    const [updatedCount] = await Notification.update(
      { isRead: true },
      { where: { recipientId: userId, isRead: false } }
    );
    if (updatedCount > 0) {
      await this.publishUnreadCount(userId);
    }
    return { updatedCount };
  }

  /**
   * Deletes a notification belonging to the authenticated user
   */
  public async deleteNotification(userId: string, notificationId: string): Promise<boolean> {
    const notification = await Notification.findOne({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      throw new NotificationServiceError('Notification not found', 404, 'NOT_FOUND');
    }

    const wasUnread = !notification.isRead;
    await notification.destroy();
    if (wasUnread) {
      await this.publishUnreadCount(userId);
    }
    return true;
  }

  /**
   * Dispatches a test push notification
   */
  public async sendTestPush(
    userId: string,
    options: {
      deviceToken?: string;
      title?: string;
      body?: string;
      platform?: 'ios' | 'android' | 'web';
    }
  ) {
    let tokens: string[] = [];

    if (options.deviceToken) {
      tokens = [options.deviceToken.trim()];
      await this.registerDeviceToken(userId, {
        deviceToken: options.deviceToken,
        platform: options.platform || 'android',
      });
    } else {
      const devices = await UserDevice.findAll({
        where: { userId, isActive: true },
        attributes: ['deviceToken'],
      });
      tokens = devices.map((d) => d.deviceToken).filter(Boolean);
    }

    if (tokens.length === 0) {
      return {
        success: false,
        message: 'No device tokens available to test push notification',
        tokensCount: 0,
      };
    }

    const messaging = getFirebaseMessaging();
    const title = options.title || 'FlirtTime Test Notification';
    const body = options.body || 'Firebase push notifications are connected successfully!';

    const message: MulticastMessage = {
      tokens,
      notification: { title, body },
      data: {
        type: 'test_notification',
        timestamp: new Date().toISOString(),
      },
    };

    const response = await messaging.sendEachForMulticast(message);
    const errors = response.responses
      .filter((resp) => !resp.success && resp.error)
      .map((resp) => ({
        code: resp.error?.code || 'unknown',
        message: resp.error?.message || 'FCM send failed',
      }));

    if (errors.length > 0) {
      console.warn('[FCM] Test push failed:', errors[0]);
    }

    return {
      success: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors,
    };
  }

  /**
   * Dispatches In-App and Push Notification for a verified coin purchase
   */
  public async sendCoinPurchaseNotification(
    recipientId: string,
    input: {
      purchaseId: string;
      packageName: string;
      coinsCredited: number;
      currentBalance: number;
      idempotencyKey?: string;
      isForeground?: boolean;
    }
  ): Promise<PushNotificationResult> {
    const title = 'Coins Added! 🪙';
    const body = `Your purchase of ${input.packageName} was successful. ${input.coinsCredited} coins have been added to your wallet.`;

    return this.dispatchNotification(recipientId, {
      type: 'coin_purchase',
      title,
      body,
      entityId: input.purchaseId,
      idempotencyKey: input.idempotencyKey || `coin_purchase_${input.purchaseId}`,
      isForeground: input.isForeground,
      navigation: {
        type: 'wallet',
        targetId: input.purchaseId,
      },
      data: {
        purchaseId: input.purchaseId,
        packageName: input.packageName,
        coinsCredited: String(input.coinsCredited),
        currentBalance: String(input.currentBalance),
        type: 'coin_purchase',
        navType: 'wallet',
      },
    });
  }
}

export const notificationService = new NotificationService();
