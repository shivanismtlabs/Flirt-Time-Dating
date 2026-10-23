import { z } from 'zod';

export const CONNECTION_REASONS = [
  {
    id: 'love_their_vibe',
    label: 'Love their vibe',
  },
  {
    id: 'same_interests',
    label: 'Same interests',
  },
  {
    id: 'liked_their_moment',
    label: 'Liked their Moment',
  },
  {
    id: 'great_energy',
    label: 'Great energy',
  },
  {
    id: 'want_to_chat',
    label: 'Want to chat',
  },
] as const;

export const createConnectionRequestSchema = z.object({
  body: z.object({
    targetUserId: z
      .string({ required_error: 'targetUserId is required' })
      .uuid('targetUserId must be a valid UUID format'),
    reason: z
      .string()
      .trim()
      .max(150, 'reason cannot exceed 150 characters')
      .optional()
      .nullable(),
    message: z
      .string()
      .trim()
      .max(500, 'message cannot exceed 500 characters')
      .optional()
      .nullable(),
    momentId: z
      .string()
      .uuid('momentId must be a valid UUID format')
      .optional()
      .nullable(),
  }),
});

export const getConnectionReasonsSchema = z.object({
  query: z.object({
    targetUserId: z
      .string()
      .uuid('targetUserId must be a valid UUID format')
      .optional(),
  }),
});

export const registerDeviceTokenSchema = z.object({
  body: z
    .object({
      deviceToken: z.string().trim().min(1).optional(),
      fcmToken: z.string().trim().min(1).optional(),
      token: z.string().trim().min(1).optional(),
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
    })
    .refine(
      (data) =>
        Boolean(
          data.deviceToken ||
            data.fcmToken ||
            data.token ||
            data.device_token ||
            data.fcm_token ||
            data.registrationToken ||
            data.registration_token ||
            data.pushToken ||
            data.push_token
        ),
      {
        message: 'deviceToken or fcmToken is required',
        path: ['deviceToken'],
      }
    ),
});
