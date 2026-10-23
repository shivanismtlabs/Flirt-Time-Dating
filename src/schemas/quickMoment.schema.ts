import { z } from 'zod';

export const ALLOWED_QUICK_REACTION_EMOJIS = [
  '😍',
  '🔥',
  '😂',
  '😮',
  '👏',
  '❤️',
] as const;

export const createQuickMomentSchema = z.object({
  body: z.object({
    type: z.enum(['image', 'text']).optional(),
    text: z.string().max(1000).optional(),
    backgroundColor: z.string().max(50).optional(),
    textColor: z.string().max(50).optional(),
    caption: z.string().max(500).optional(),
    locationLabel: z.string().max(150).optional(),
    mediaUrl: z.string().max(1000).optional(),
    imageKey: z.string().max(1000).optional(),
    key: z.string().max(1000).optional(),
    imageUrl: z.string().max(1000).optional(),
  }),
});

export const reactQuickMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid quick moment ID'),
  }),
  body: z
    .object({
      emoji: z.string().min(1).max(20).optional(),
      reaction: z.string().min(1).max(20).optional(),
    })
    .refine((data) => Boolean(data.emoji || data.reaction), {
      message: 'Reaction emoji is required',
    }),
});

export const replyQuickMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid quick moment ID'),
  }),
  body: z.object({
    message: z.string().min(1, 'Reply message cannot be empty').max(1000),
  }),
});

export const getQuickMomentReactionsSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid quick moment ID'),
  }),
  query: z.object({
    page: z.string().regex(/^\d+$/).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
    emoji: z.string().optional(),
  }).optional(),
});

export const getTargetUserQuickMomentsSchema = z.object({
  params: z.object({
    userId: z.string().min(1),
  }),
});

export const getPresignedUploadUrlSchema = z.object({
  body: z.object({
    mimeType: z.string().optional(),
    folder: z.string().optional(),
  }),
});
