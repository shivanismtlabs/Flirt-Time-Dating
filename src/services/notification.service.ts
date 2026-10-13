import { Op } from 'sequelize';
import { getFirebaseMessaging } from '../config/firebase';
import { Notification, UserDevice, User } from '../models';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';

export interface PushNotificationResult {
  inAppCreated: boolean;
  pushStatus: 'sent_to_fcm' | 'no_device_tokens' | 'failed';
  inAppNotificationId?: string;
  successCount?: number;
  failureCount?: number;
  message?: string;
}

export class NotificationService {
  /**
   * Registers or refreshes a device token for push notifications
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

    // Check if device token already exists
    let device = await UserDevice.findOne({ where: { deviceToken } });
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
        deviceToken,
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
   * Disables or removes an expired/invalid device token
   */
  public async deactivateDeviceToken(deviceToken: string) {
    await UserDevice.update(
      { isActive: false },
      { where: { deviceToken } }
    );
  }

  /**
   * Persists an in-app notification and attempts reliable FCM push notification delivery.
   * A Firebase outage or network error will NOT affect database persistence.
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
    let inAppNotificationId: string | undefined;

    const inAppBody = input.reason
      ? `${input.requesterName} wants to connect: "${input.reason}"`
      : `${input.requesterName} wants to connect with you.`;

    // 1. Create In-App Notification record
    try {
      const inApp = await Notification.create({
        recipientId: targetUserId,
        senderId: input.requesterId,
        type: 'connection_request',
        title: 'New Connect Request',
        body: inAppBody,
        entityId: input.requestId,
        data: {
          type: 'connection_request',
          requestId: input.requestId,
          senderId: input.requesterId,
          senderName: input.requesterName,
          reason: input.reason || '',
          screen: 'connection_requests',
        },
        isRead: false,
      });
      inAppNotificationId = inApp.id;
    } catch (inAppErr: any) {
      console.warn('Failed to create in-app notification record:', inAppErr.message);
    }

    // 2. Fetch active device tokens for the target user
    const devices = await UserDevice.findAll({
      where: {
        userId: targetUserId,
        isActive: true,
      },
      attributes: ['id', 'deviceToken', 'platform'],
    });

    const tokens = (devices || [])
      .map((d) => (d.deviceToken || '').trim())
      .filter((t): t is string => Boolean(t && t.length > 5));

    if (tokens.length === 0) {
      console.warn(
        `[Notification] Target user ${targetUserId} has NO active device tokens registered in user_devices.`
      );
      return {
        inAppCreated: !!inAppNotificationId,
        pushStatus: 'no_device_tokens',
        inAppNotificationId,
        successCount: 0,
        failureCount: 0,
        message:
          'In-app notification created, but target user has no registered active device tokens. Register device token via POST /api/v1/users/device-token.',
      };
    }

    // 3. Dispatch multicast push notification via Firebase Admin
    try {
      const messaging = getFirebaseMessaging();
      const message: MulticastMessage = {
        tokens,
        notification: {
          title: 'New Connect Request',
          body: inAppBody,
        },
        data: {
          type: 'connection_request',
          requestId: String(input.requestId || ''),
          senderId: String(input.requesterId || ''),
          senderName: String(input.requesterName || ''),
          reason: String(input.reason || ''),
          screen: 'connection_requests',
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high',
          notification: {
            title: 'New Connect Request',
            body: inAppBody,
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
              alert: {
                title: 'New Connect Request',
                body: inAppBody,
              },
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      const response: BatchResponse = await messaging.sendEachForMulticast(message);

      // Clean up invalid or unregistered tokens & log results
      const badTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error) {
          const code = resp.error.code;
          console.warn(
            `[FCM] Token delivery failed for token [${tokens[idx]?.substring(0, 10)}...]: ${resp.error.message} (${code})`
          );
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            badTokens.push(tokens[idx]);
          }
        } else if (resp.success) {
          console.log(
            `[FCM] Successfully delivered push notification to token [${tokens[idx]?.substring(0, 10)}...]`
          );
        }
      });

      if (badTokens.length > 0) {
        await UserDevice.update(
          { isActive: false },
          { where: { deviceToken: { [Op.in]: badTokens } } }
        );
      }

      return {
        inAppCreated: !!inAppNotificationId,
        pushStatus: response.successCount > 0 ? 'sent_to_fcm' : 'failed',
        inAppNotificationId,
        successCount: response.successCount,
        failureCount: response.failureCount,
        message:
          response.successCount > 0
            ? `Push notification successfully sent to ${response.successCount} device(s).`
            : `FCM push attempt failed for ${response.failureCount} device(s).`,
      };
    } catch (fcmErr: any) {
      console.warn('[FCM] Push notification dispatch failed safely:', fcmErr.message);
      return {
        inAppCreated: !!inAppNotificationId,
        pushStatus: 'failed',
        inAppNotificationId,
        successCount: 0,
        failureCount: tokens.length,
        message: `FCM push error: ${fcmErr.message}`,
      };
    }
  }

  /**
   * Retrieves paginated in-app notifications for a user with unread count
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
            attributes: [
              'id',
              'fullName',
              'firstName',
              'username',
              'profilePicture',
              'isVerified',
            ],
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
   * Marks a single in-app notification as read
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
   * Sends a test push notification to a device token or to the user's active devices
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
      // Also register this token for future pushes
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

    const response = await messaging.sendEachForMulticast(message);

    return {
      success: response.successCount > 0,
      successCount: response.successCount,
      failureCount: response.failureCount,
      details: response.responses.map((r, i) => ({
        tokenPrefix: tokens[i]?.substring(0, 10),
        success: r.success,
        error: r.error ? { code: r.error.code, message: r.error.message } : null,
      })),
    };
  }
}

export const notificationService = new NotificationService();
