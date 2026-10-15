import { z } from 'zod';

export const createDeepLinkSchema = z.object({
  body: z.object({
    contentType: z.enum(['moment', 'quick_moment', 'profile'], {
      errorMap: () => ({ message: 'contentType must be one of: moment, quick_moment, profile' }),
    }),
    contentId: z.string().uuid('contentId must be a valid UUID'),
    metadata: z.record(z.any()).optional(),
  }),
});

export const resolveDeepLinkSchema = z.object({
  params: z.object({
    code: z
      .string()
      .min(4, 'Deep link code must be at least 4 characters')
      .max(64, 'Deep link code cannot exceed 64 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Deep link code must contain only alphanumeric characters, dashes, or underscores'),
  }),
});

export const trackDeepLinkSchema = z.object({
  params: z.object({
    code: z
      .string()
      .min(4, 'Deep link code must be at least 4 characters')
      .max(64, 'Deep link code cannot exceed 64 characters')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Deep link code must contain only alphanumeric characters, dashes, or underscores'),
  }),
  body: z.object({
    event: z
      .enum(['link_opened', 'app_opened', 'content_viewed', 'share_clicked', 'install_referred'])
      .default('link_opened'),
    platform: z.enum(['ios', 'android', 'web']).optional(),
    metadata: z.record(z.any()).optional(),
  }),
});
