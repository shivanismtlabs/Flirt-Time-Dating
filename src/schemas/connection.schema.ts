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
  body: z.object({
    deviceToken: z
      .string({ required_error: 'deviceToken is required' })
      .trim()
      .min(1, 'deviceToken cannot be empty'),
    platform: z.enum(['ios', 'android', 'web']).optional().default('android'),
    deviceId: z.string().trim().max(255).optional().nullable(),
  }),
});
