import { z } from 'zod';

export const getNotificationsSchema = z.object({
  query: z.object({
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 20))
      .refine((val) => !isNaN(val) && val >= 1 && val <= 50, {
        message: 'limit must be an integer between 1 and 50',
      })
      .default('20' as any),
    cursor: z.string().trim().optional(),
    timezone: z.string().trim().optional().default('UTC'),
    unreadOnly: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
  }),
});

export const notificationIdParamSchema = z.object({
  params: z.object({
    id: z
      .string()
      .uuid('Notification ID must be a valid UUID format')
      .optional(),
    notificationId: z
      .string()
      .uuid('Notification ID must be a valid UUID format')
      .optional(),
  }).refine((data) => Boolean(data.id || data.notificationId), {
    message: 'notificationId is required',
  }),
});

export const deviceRegisterSchema = z.object({
  body: z
    .object({
      token: z.string().trim().min(1, 'Token cannot be empty').optional(),
      deviceToken: z.string().trim().min(1).optional(),
      fcmToken: z.string().trim().min(1).optional(),
      device_token: z.string().trim().min(1).optional(),
      fcm_token: z.string().trim().min(1).optional(),
      registrationToken: z.string().trim().min(1).optional(),
      registration_token: z.string().trim().min(1).optional(),
      pushToken: z.string().trim().min(1).optional(),
      push_token: z.string().trim().min(1).optional(),
      platform: z
        .string()
        .optional()
        .transform((val) => {
          const normalized = (val || 'android').toLowerCase().trim();
          if (['ios', 'iphone', 'ipad', 'apple'].includes(normalized)) return 'ios';
          if (normalized === 'web' || normalized === 'browser') return 'web';
          return 'android';
        })
        .default('android'),
      deviceId: z.string().trim().max(255).optional().nullable(),
      voipToken: z.string().trim().max(4096).optional().nullable(),
      voip_token: z.string().trim().max(4096).optional().nullable(),
      pushKitToken: z.string().trim().max(4096).optional().nullable(),
      push_kit_token: z.string().trim().max(4096).optional().nullable(),
      apnsVoipToken: z.string().trim().max(4096).optional().nullable(),
      apns_voip_token: z.string().trim().max(4096).optional().nullable(),
      voipPushToken: z.string().trim().max(4096).optional().nullable(),
    })
    .refine(
      (data) =>
        Boolean(
          data.token ||
            data.deviceToken ||
            data.fcmToken ||
            data.device_token ||
            data.fcm_token ||
            data.registrationToken ||
            data.registration_token ||
            data.pushToken ||
            data.push_token
        ),
      {
        message: 'token is required',
        path: ['token'],
      }
    ),
});

export const deviceUnregisterSchema = z.object({
  body: z
    .object({
      token: z.string().trim().min(1).optional(),
      deviceToken: z.string().trim().min(1).optional(),
      fcmToken: z.string().trim().min(1).optional(),
      device_token: z.string().trim().min(1).optional(),
    })
    .optional(),
  query: z
    .object({
      token: z.string().trim().min(1).optional(),
      deviceToken: z.string().trim().min(1).optional(),
    })
    .optional(),
});
