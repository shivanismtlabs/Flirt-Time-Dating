import { z } from 'zod';

export const momentAudienceEnum = z.enum(
  ['everyone', 'matches_only', 'close_friends'],
  {
    errorMap: () => ({
      message: 'Invalid audience. Allowed values: everyone, matches_only, close_friends',
    }),
  }
);

export const momentReactionEnum = z.enum(
  ['heart', 'love_eyes', 'fire', 'laugh', 'surprised', 'clap'],
  {
    errorMap: () => ({
      message:
        'Invalid reaction type. Allowed values: heart, love_eyes, fire, laugh, surprised, clap',
    }),
  }
);

export const createMomentSchema = z.object({
  body: z.object({
    caption: z
      .string()
      .trim()
      .max(500, 'Caption must not exceed 500 characters')
      .optional()
      .nullable(),
    audience: momentAudienceEnum.optional().default('everyone'),
    locationLabel: z
      .string()
      .trim()
      .max(100, 'Location label must not exceed 100 characters')
      .optional()
      .nullable(),
    mediaUrls: z
      .union([
        z.array(z.string().min(1)),
        z.string().min(1).transform((s) => [s]),
      ])
      .optional(),
    mediaUrl: z.string().min(1).optional(),
    images: z
      .union([
        z.array(z.string().min(1)),
        z.string().min(1).transform((s) => [s]),
      ])
      .optional(),
  }),
});

export const getMomentDetailSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
});

export const getUserMomentsSchema = z.object({
  params: z.object({
    userId: z.string().min(1, 'User ID is required'),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
    })
    .optional(),
});

export const reactMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  body: z.object({
    reaction: momentReactionEnum,
  }),
});

export const replyMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  body: z.object({
    message: z
      .string({ required_error: 'Reply message is required' })
      .trim()
      .min(1, 'Reply message cannot be empty')
      .max(1000, 'Reply message must not exceed 1000 characters'),
  }),
});

export const getAllMomentsSchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
    type: z.enum(['feed', 'stories']).optional().default('feed'),
    scope: z.enum(['all', 'others', 'self', 'matches', 'friends']).optional().default('all'),
  }),
});

export const momentReportReasons = [
  'inappropriate_content',
  'nudity',
  'harassment',
  'violence',
  'spam',
  'fake_content',
  'other',
] as const;

export const reportMomentReasonEnum = z.enum(momentReportReasons, {
  errorMap: () => ({
    message:
      'Invalid report reason. Allowed values: inappropriate_content, nudity, harassment, violence, spam, fake_content, other',
  }),
});

export const reportMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  body: z.object({
    reason: reportMomentReasonEnum,
    description: z
      .string()
      .trim()
      .max(1000, 'Description must not exceed 1000 characters')
      .optional()
      .nullable(),
  }),
});

