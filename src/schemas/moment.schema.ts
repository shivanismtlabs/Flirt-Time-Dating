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
  ['like', 'heart', 'love_eyes', 'fire', 'laugh', 'surprised', 'clap'],
  {
    errorMap: () => ({
      message:
        'Invalid reaction type. Allowed values: like, heart, love_eyes, fire, laugh, surprised, clap',
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
    location: z
      .union([
        z.string().trim().max(100),
        z.object({
          name: z.string().trim().max(100).optional(),
          city: z.string().trim().max(100).optional(),
          label: z.string().trim().max(100).optional(),
          address: z.string().trim().max(100).optional(),
          latitude: z.number().optional(),
          longitude: z.number().optional(),
        }),
      ])
      .optional()
      .nullable(),
    imageKey: z.string().min(1).optional(),
    imageKeys: z
      .union([
        z.array(z.string().min(1)),
        z.string().min(1).transform((s) => [s]),
      ])
      .optional(),
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
  body: z
    .object({
      reaction: momentReactionEnum.optional().default('like'),
    })
    .optional()
    .default({ reaction: 'like' }),
});

export const replyMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
    commentId: z.string().uuid('Invalid comment ID format').optional(),
  }),
  body: z
    .object({
      message: z.string().trim().min(1).max(1000).optional(),
      comment: z.string().trim().min(1).max(1000).optional(),
      text: z.string().trim().min(1).max(1000).optional(),
      reply: z.string().trim().min(1).max(1000).optional(),
      parentCommentId: z.string().uuid('Invalid parent comment ID format').optional().nullable(),
      parentId: z.string().uuid('Invalid parent comment ID format').optional().nullable(),
      replyToCommentId: z.string().uuid('Invalid parent comment ID format').optional().nullable(),
      commentId: z.string().uuid('Invalid comment ID format').optional().nullable(),
      parentReplyId: z.string().uuid('Invalid parent reply ID format').optional().nullable(),
    })
    .refine((data) => Boolean(data.message || data.comment || data.text || data.reply), {
      message: 'Comment or reply message cannot be empty',
    }),
});

export const getMomentCommentsSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
    })
    .optional(),
});

export const getMomentLikesSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
      reaction: z.string().optional(),
    })
    .optional(),
});

export const sendMomentGiftSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  body: z
    .object({
      giftCode: z.string().trim().min(1).optional(),
      giftId: z.string().trim().min(1).optional(),
      gift: z.string().trim().min(1).optional(),
      quantity: z
        .union([z.number().int().positive().max(100), z.string().regex(/^\d+$/).transform(Number)])
        .optional()
        .default(1),
      message: z.string().trim().max(500, 'Message cannot exceed 500 characters').optional(),
    })
    .refine((data) => Boolean(data.giftCode || data.giftId || data.gift), {
      message:
        'Gift identifier is required (e.g. rose, heart, chocolate, teddy, bouquet, ring, crown, sports_car)',
    }),
});

export const getMomentGiftsCatalogSchema = z.object({
  params: z
    .object({
      momentId: z.string().uuid('Invalid moment ID format').optional(),
    })
    .optional(),
});

export const getMomentGiftsReceivedSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
    })
    .optional(),
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

export const deleteMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
});

export const likeMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
  body: z
    .object({
      like: z.boolean().optional(),
      isLiked: z.boolean().optional(),
      action: z.enum(['like', 'unlike', 'toggle']).optional(),
      type: z.enum(['like', 'unlike', 'toggle']).optional(),
      reaction: z.string().optional(),
    })
    .optional(),
});

export const unlikeMomentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
  }),
});

export const deleteMomentCommentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format').optional(),
    commentId: z.string().uuid('Invalid comment ID format'),
  }),
});

export const likeMomentCommentSchema = z.object({
  params: z
    .object({
      momentId: z.string().uuid('Invalid moment ID format').optional(),
      commentId: z.string().uuid('Invalid comment ID format').optional(),
      replyId: z.string().uuid('Invalid reply ID format').optional(),
    })
    .refine((data) => !!(data.commentId || data.replyId), {
      message: 'Either commentId or replyId is required',
    }),
  body: z
    .object({
      like: z.boolean().optional(),
      isLiked: z.boolean().optional(),
      action: z.enum(['like', 'unlike', 'toggle']).optional(),
      type: z.enum(['like', 'unlike', 'toggle']).optional(),
      reaction: z.string().optional(),
    })
    .optional(),
});

export const getMomentCommentLikesSchema = z.object({
  params: z
    .object({
      momentId: z.string().uuid('Invalid moment ID format').optional(),
      commentId: z.string().uuid('Invalid comment ID format').optional(),
      replyId: z.string().uuid('Invalid reply ID format').optional(),
    })
    .refine((data) => !!(data.commentId || data.replyId), {
      message: 'Either commentId or replyId is required',
    }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
    })
    .optional(),
});

export const replyMomentCommentSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format').optional(),
    commentId: z.string().uuid('Invalid comment ID format'),
  }),
  body: z
    .object({
      reply: z.string().trim().min(1).max(1000).optional(),
      comment: z.string().trim().min(1).max(1000).optional(),
      message: z.string().trim().min(1).max(1000).optional(),
      text: z.string().trim().min(1).max(1000).optional(),
      parentCommentId: z.string().uuid('Invalid parent comment ID format').optional().nullable(),
      parentId: z.string().uuid('Invalid parent comment ID format').optional().nullable(),
      parentReplyId: z.string().uuid('Invalid parent reply ID format').optional().nullable(),
    })
    .refine((data) => Boolean(data.reply || data.comment || data.message || data.text), {
      message: 'Reply message cannot be empty',
    }),
});

export const getMomentCommentRepliesSchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
    commentId: z.string().uuid('Invalid comment ID format'),
  }),
  query: z
    .object({
      page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).optional().default('20'),
      format: z.string().optional(),
      flat: z.string().optional(),
    })
    .optional(),
});

export const deleteMomentCommentReplySchema = z.object({
  params: z.object({
    momentId: z.string().uuid('Invalid moment ID format'),
    commentId: z.string().uuid('Invalid comment ID format'),
    replyId: z.string().uuid('Invalid reply ID format'),
  }),
});


