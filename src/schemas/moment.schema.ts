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
  }),
});

export const getMomentDetailSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
});

export const getUserMomentsSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID format'),
  }),
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
