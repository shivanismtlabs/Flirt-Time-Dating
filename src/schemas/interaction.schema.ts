import { z } from 'zod';

export const interactionTypeSchema = z.enum([
  'likes',
  'you_liked',
  'matches',
  'compliments',
]);

export type InteractionType = z.infer<typeof interactionTypeSchema>;

export const getInteractionsSchema = z.object({
  query: z.object({
    type: interactionTypeSchema,
    limit: z
      .string()
      .optional()
      .transform((val) => (val ? parseInt(val, 10) : 20))
      .refine((val) => !isNaN(val) && val >= 1 && val <= 50, {
        message: 'limit must be an integer between 1 and 50',
      })
      .default('20' as any),
    cursor: z.string().trim().optional(),
    sort: z
      .string()
      .trim()
      .optional()
      .refine((val) => !val || val === 'recent', {
        message: 'Invalid sort parameter. Supported values: recent',
      })
      .default('recent'),
    excludeMatched: z
      .string()
      .optional()
      .transform((val) => val === 'true'),
  }),
});

export const markInteractionReadSchema = z.object({
  params: z.object({
    interactionId: z
      .string({ required_error: 'interactionId is required' })
      .uuid('interactionId must be a valid UUID format'),
  }),
});

export const sendComplimentSchema = z.object({
  params: z
    .object({
      userId: z.string().uuid('userId must be a valid UUID format').optional(),
    })
    .optional(),
  body: z.object({
    targetUserId: z
      .string()
      .uuid('targetUserId must be a valid UUID format')
      .optional(),
    userId: z
      .string()
      .uuid('userId must be a valid UUID format')
      .optional(),
    message: z
      .string({ required_error: 'message is required' })
      .trim()
      .min(1, 'message cannot be empty')
      .max(500, 'message cannot exceed 500 characters'),
    reason: z
      .string()
      .trim()
      .max(150, 'reason cannot exceed 150 characters')
      .optional()
      .nullable(),
    momentId: z
      .string()
      .uuid('momentId must be a valid UUID format')
      .optional()
      .nullable(),
  }),
});

