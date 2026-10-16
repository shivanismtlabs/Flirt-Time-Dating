import { Op, WhereOptions } from 'sequelize';
import { getFirebaseMessaging } from '../config/firebase';
import { Notification, UserDevice, User, UserPhoto, NotificationSetting } from '../models';
import { formatThumbnailUrl } from './s3.service';
import { resolveDisplayName } from './discovery.service';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';

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

export interface NotificationItemDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  sender: NotificationSenderSummary | null;
  isRead: boolean;
  createdAt: string;
  navigation: NotificationNavigationDTO;
  actionMetadata?: Record<string, any> | null;
}

export interface NotificationSectionDTO {
  title: 'Today' | 'Yesterday' | 'Earlier';
  items: NotificationItemDTO[];
}

export interface GroupedNotificationsResponse {
  sections: NotificationSectionDTO[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

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
   * 2. Calls are explicitly blocked from push.
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

    // Calls are explicitly excluded
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

    // Like & comments (reactions, likes, moment comments) - NOT calls
    if (
      normalizedType.includes('like') ||
      normalizedType.includes('comment') ||
      normalizedType.includes('reaction') ||
      normalizedType.includes('compliment')
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
    }
  ) {
    const { deviceToken, platform = 'android', deviceId } = input;
    const cleanToken = deviceToken.trim();

    let device = await UserDevice.findOne({ where: { deviceToken: cleanToken } });
    if (device) {
      device.userId = userId;
      device.platform = platform;
      if (deviceId !== undefined) device.deviceId = deviceId || null;
      device.isActive = true;
      device.lastUsedAt = new Date();
      await device.save();
    } else {
      device = await UserDevice.create({
        userId,
        deviceToken: cleanToken,
        platform,
        deviceId: deviceId || null,
        isActive: true,
        lastUsedAt: new Date(),
      });
    }

    return {
      registered: true,
      deviceId: device.id,
      userId: device.userId,
      platform: device.platform,
      isActive: device.isActive,
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
    }
  ): Promise<PushNotificationResult> {
    const { type, title, body, senderId, entityId, navigation, idempotencyKey } = input;

    // 1. Idempotency / deduplication check
    if (idempotencyKey || entityId) {
      const existing = await Notification.findOne({
        where: {
          recipientId,
          type,
          ...(entityId && { entityId }),
        },
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

    const payloadData: Record<string, any> = {
      ...(input.data || {}),
      type,
      entityId: entityId || '',
      navigation: navigation || { type, targetId: entityId || '' },
      ...(idempotencyKey && { idempotencyKey }),
    };

    // 2. Persist In-App Notification in DB
    let createdRecord: Notification;
    try {
      createdRecord = await Notification.create({
        recipientId,
        senderId: senderId || null,
        type,
        title,
        body,
        entityId: entityId || null,
        data: payloadData,
        isRead: false,
      });
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

      const isPushAllowed = this.shouldSendPush(settings, type);

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

    // 4. Dispatch Multicast Message via Firebase Admin
    try {
      const messaging = getFirebaseMessaging();
      const message: MulticastMessage = {
        tokens,
        notification: {
          title,
          body,
        },
        data: {
          id: String(createdRecord.id),
          type,
          entityId: String(entityId || ''),
          senderId: String(senderId || ''),
          navType: String(navigation?.type || type),
          navTargetId: String(navigation?.targetId || entityId || ''),
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          ...(input.data
            ? Object.fromEntries(
                Object.entries(input.data).map(([k, v]) => [k, String(v ?? '')])
              )
            : {}),
        },
        android: {
          priority: 'high',
          notification: {
            title,
            body,
            sound: 'default',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      const response: BatchResponse = await messaging.sendEachForMulticast(message);

      // Clean up dead/unregistered tokens
      const badTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code;
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

      return {
        inAppCreated: true,
        pushStatus: response.successCount > 0 ? 'sent_to_fcm' : 'failed',
        inAppNotificationId: createdRecord.id,
        successCount: response.successCount,
        failureCount: response.failureCount,
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

    const hasMore = rows.length > limit;
    const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

    // Transform into standard DTOs
    const dtos: NotificationItemDTO[] = itemsToReturn.map((n) => {
      let senderSummary: NotificationSenderSummary | null = null;
      if (n.sender) {
        senderSummary = {
          id: n.sender.id,
          name: resolveDisplayName(n.sender),
          profilePhotoUrl: this.resolvePrimaryPhoto(n.sender.profilePicture, n.sender.photos, n.sender.updatedAt),
        };
      }

      // Safe navigation payload
      const nav = n.data?.navigation || {
        type: n.type,
        targetId: n.entityId || n.id,
      };

      return {
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        sender: senderSummary,
        isRead: Boolean(n.isRead),
        createdAt: n.createdAt.toISOString(),
        navigation: {
          type: nav.type || n.type,
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
   * Marks a single in-app notification as read idempotently
   */
  public async markAsRead(userId: string, notificationId: string) {
    const notification = await Notification.findOne({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      return null;
    }

    notification.isRead = true;
    await notification.save();
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

    await notification.destroy();
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

    return {
      success: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
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
