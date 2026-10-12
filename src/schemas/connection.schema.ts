import { z } from 'zod';

export const createConnectionRequestSchema = z.object({
  body: z.object({
    targetUserId: z
      .string({ required_error: 'targetUserId is required' })
      .uuid('targetUserId must be a valid UUID format'),
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
