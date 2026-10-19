import { z } from 'zod';

export const getChatListSchema = z.object({
  query: z.object({
    search: z.string().trim().max(100, { message: 'Search query cannot exceed 100 characters' }).optional(),
    page: z
      .string()
      .regex(/^\d+$/, { message: 'Page must be a positive integer' })
      .transform(Number)
      .pipe(z.number().int().min(1))
      .optional()
      .default('1'),
    limit: z
      .string()
      .regex(/^\d+$/, { message: 'Limit must be a positive integer' })
      .transform(Number)
      .pipe(z.number().int().min(1).max(50, { message: 'Limit cannot exceed 50' }))
      .optional()
      .default('20'),
  }),
});

export const getConversationDetailSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
});

export const getMessagesSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  query: z.object({
    page: z
      .string()
      .regex(/^\d+$/, { message: 'Page must be a positive integer' })
      .transform(Number)
      .pipe(z.number().int().min(1))
      .optional()
      .default('1'),
    limit: z
      .string()
      .regex(/^\d+$/, { message: 'Limit must be a positive integer' })
      .transform(Number)
      .pipe(z.number().int().min(1).max(100, { message: 'Limit cannot exceed 100' }))
      .optional()
      .default('30'),
    before: z.string().datetime({ message: 'Invalid ISO timestamp for before cursor' }).optional(),
  }),
});

export const sendMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    content: z
      .string({ required_error: 'Message content is required' })
      .trim()
      .min(1, { message: 'Message content cannot be empty' })
      .max(5000, { message: 'Message content cannot exceed 5000 characters' }),
    messageType: z
      .enum(['text', 'audio', 'image', 'moment_reply', 'moment_gift'], {
        errorMap: () => ({
          message: 'Invalid messageType. Allowed values: text, audio, image, moment_reply, moment_gift',
        }),
      })
      .optional()
      .default('text'),
    clientMessageId: z.string().uuid({ message: 'Invalid clientMessageId UUID format' }).optional(),
    metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
  }),
});

export const markReadSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
});

export const pinConversationSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    isPinned: z.boolean({ required_error: 'isPinned is required (true to pin, false to unpin)' }),
  }),
});

export const startConversationSchema = z.object({
  body: z.object({
    recipientId: z.string().uuid({ message: 'Invalid recipientId UUID format' }),
  }),
});

export type GetChatListQuery = z.infer<typeof getChatListSchema>['query'];
export type SendMessageInput = z.infer<typeof sendMessageSchema>['body'];
export type PinConversationInput = z.infer<typeof pinConversationSchema>['body'];
export type StartConversationInput = z.infer<typeof startConversationSchema>['body'];
