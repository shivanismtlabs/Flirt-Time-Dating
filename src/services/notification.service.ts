import { Op } from 'sequelize';
import { getFirebaseMessaging } from '../config/firebase';
import { Notification, UserDevice } from '../models';
import type { MulticastMessage, BatchResponse } from 'firebase-admin/messaging';

export interface PushNotificationResult {
  inAppCreated: boolean;
  pushStatus: 'sent_to_fcm' | 'no_device_tokens' | 'failed';
  inAppNotificationId?: string;
  successCount?: number;
  failureCount?: number;
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

    // Reassign or create device token record
    const [device] = await UserDevice.upsert({
      userId,
      deviceToken,
      platform,
      deviceId: deviceId || null,
      isActive: true,
      lastUsedAt: new Date(),
    });

    return {
      registered: true,
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
    }
  ): Promise<PushNotificationResult> {
    let inAppNotificationId: string | undefined;

    // 1. Create In-App Notification record
    try {
      const inApp = await Notification.create({
        recipientId: targetUserId,
        senderId: input.requesterId,
        type: 'connection_request',
        title: 'New Connect Request',
        body: `${input.requesterName} wants to connect with you.`,
        entityId: input.requestId,
        data: {
          type: 'connection_request',
          requestId: input.requestId,
          senderId: input.requesterId,
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
      attributes: ['id', 'deviceToken'],
    });

    if (!devices || devices.length === 0) {
      return {
        inAppCreated: !!inAppNotificationId,
        pushStatus: 'no_device_tokens',
        inAppNotificationId,
        successCount: 0,
        failureCount: 0,
      };
    }

    const tokens = devices.map((d) => d.deviceToken);

    // 3. Dispatch multicast push notification via Firebase Admin
    try {
      const messaging = getFirebaseMessaging();
      const message: MulticastMessage = {
        tokens,
        notification: {
          title: 'New Connect Request',
          body: 'Someone wants to connect with you.',
        },
        data: {
          type: 'connection_request',
          requestId: input.requestId,
          senderId: input.requesterId,
          screen: 'connection_requests',
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'connection_requests',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response: BatchResponse = await messaging.sendEachForMulticast(message);

      // Clean up invalid or unregistered tokens
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
        inAppCreated: !!inAppNotificationId,
        pushStatus: response.successCount > 0 ? 'sent_to_fcm' : 'failed',
        inAppNotificationId,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (fcmErr: any) {
      console.warn('[FCM] Push notification dispatch failed safely:', fcmErr.message);
      return {
        inAppCreated: !!inAppNotificationId,
        pushStatus: 'failed',
        inAppNotificationId,
        successCount: 0,
        failureCount: tokens.length,
      };
    }
  }
}

export const notificationService = new NotificationService();
