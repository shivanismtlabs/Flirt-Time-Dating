import { z } from 'zod';

export const sendMessageSchema = z.object({
  recipientId: z
    .string({ required_error: 'recipientId is required' })
    .uuid('recipientId must be a valid UUID'),
  content: z
    .string({ required_error: 'Message content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(2000, 'Message content cannot exceed 2000 characters'),
  messageType: z
    .enum(['text', 'moment_reply', 'moment_gift'])
    .optional()
    .default('text'),
  metadata: z.string().optional().nullable(),
});

export const getMessagesSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30)),
  cursor: z.string().optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
