import { z } from 'zod';

export const directSendMessageSchema = z.object({
  recipientId: z
    .string({ required_error: 'recipientId is required' })
    .uuid('recipientId must be a valid UUID'),
  content: z
    .string({ required_error: 'Message content is required' })
    .trim()
    .min(1, 'Message content cannot be empty')
    .max(5000, 'Message content cannot exceed 5000 characters'),
  type: z
    .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'])
    .optional(),
  messageType: z
    .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'])
    .optional()
    .default('text'),
  metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
  clientMessageId: z.string().trim().max(100).optional(),
});

export type DirectSendMessageInput = z.infer<typeof directSendMessageSchema>;

export const getChatListSchema = z.object({
  query: z.object({
    search: z.string().trim().max(100, { message: 'Search query cannot exceed 100 characters' }).optional(),
    archived: z
      .string()
      .optional()
      .transform((val) => val === 'true' || val === '1'),
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
  params: z
    .object({
      conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }).optional(),
      targetUserId: z.string().uuid({ message: 'Invalid targetUserId UUID format' }).optional(),
      recipientId: z.string().uuid({ message: 'Invalid recipientId UUID format' }).optional(),
    })
    .optional(),
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
    before: z.string().optional(),
    after: z.string().optional(),
    cursor: z.string().optional(),
    pinned: z
      .string()
      .optional()
      .transform((val) => val === 'true' || val === '1'),
  }),
});

export const locationMetadataSchema = z
  .object({
    latitude: z
      .number({ required_error: 'latitude is required for location message' })
      .min(-90, { message: 'latitude must be between -90 and 90' })
      .max(90, { message: 'latitude must be between -90 and 90' })
      .refine((val) => Number.isFinite(val), { message: 'latitude must be a finite number' }),
    longitude: z
      .number({ required_error: 'longitude is required for location message' })
      .min(-180, { message: 'longitude must be between -180 and 180' })
      .max(180, { message: 'longitude must be between -180 and 180' })
      .refine((val) => Number.isFinite(val), { message: 'longitude must be a finite number' }),
    name: z.string().trim().max(200, { message: 'Location name cannot exceed 200 characters' }).optional(),
    address: z.string().trim().max(500, { message: 'Address cannot exceed 500 characters' }).optional(),
  })
  .strict({ message: 'Unknown property in location metadata. Duplicate or unpermitted keys are rejected' });

export const contactMetadataSchema = z
  .object({
    name: z
      .string({ required_error: 'Contact name is required' })
      .trim()
      .min(1, { message: 'Contact name cannot be empty' })
      .max(100, { message: 'Contact name cannot exceed 100 characters' }),
    phoneNumber: z
      .string({ required_error: 'Contact phoneNumber is required' })
      .trim()
      .min(3, { message: 'Phone number must be at least 3 characters' })
      .max(30, { message: 'Phone number cannot exceed 30 characters' }),
    email: z.string().trim().email({ message: 'Invalid contact email' }).max(100).optional(),
  })
  .strict({ message: 'Unknown property in contact metadata. Duplicate or unpermitted keys are rejected' });

export const imageMetadataSchema = z
  .object({
    thumbnailUrl: z.string().url().max(1000).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fileSize: z
      .number()
      .int()
      .positive()
      .max(20 * 1024 * 1024, { message: 'Image size exceeds maximum limit (20MB)' })
      .optional(),
    mimeType: z
      .string()
      .regex(/^image\/(jpeg|png|webp|gif|avif)$/, { message: 'Unsupported image MIME type' })
      .optional(),
    source: z.enum(['photo', 'camera']).optional(),
  })
  .strict();

export const sendMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z
    .object({
      content: z
        .string()
        .trim()
        .max(5000, { message: 'Message content cannot exceed 5000 characters' })
        .optional(),
      type: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'])
        .optional(),
      messageType: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'], {
          errorMap: () => ({
            message:
              'Invalid messageType. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
          }),
        })
        .optional()
        .default('text'),
      clientMessageId: z.string().trim().max(100, { message: 'Invalid clientMessageId format' }).optional(),
      metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
    })
    .superRefine((data, ctx) => {
      const type = data.type || data.messageType || 'text';
      if (type === 'text') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Message content cannot be empty for text message',
          });
        }
      } else if (type === 'image') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Image URL or storage key is required in content for image message',
          });
        }
        if (data.metadata) {
          let metaObj = data.metadata;
          if (typeof metaObj === 'string') {
            try {
              metaObj = JSON.parse(metaObj);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: 'Invalid JSON string in metadata',
              });
              return;
            }
          }
          if (metaObj && typeof metaObj === 'object') {
            const parsed = imageMetadataSchema.safeParse(metaObj);
            if (!parsed.success) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: parsed.error.errors[0]?.message || 'Invalid image metadata',
              });
            }
          }
        }
      } else if (type === 'audio') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Audio URL or storage key is required in content for audio message',
          });
        }
      } else if (type === 'location') {
        let metaObj = data.metadata;
        if (typeof metaObj === 'string') {
          try {
            metaObj = JSON.parse(metaObj);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['metadata'],
              message: 'Invalid JSON string in metadata',
            });
            return;
          }
        }
        if (!metaObj || typeof metaObj !== 'object') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: 'Location coordinates (latitude and longitude) are required in metadata',
          });
          return;
        }
        const parsed = locationMetadataSchema.safeParse(metaObj);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: parsed.error.errors[0]?.message || 'Invalid location metadata',
          });
        }
      } else if (type === 'contact') {
        let metaObj = data.metadata;
        if (typeof metaObj === 'string') {
          try {
            metaObj = JSON.parse(metaObj);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['metadata'],
              message: 'Invalid JSON string in metadata',
            });
            return;
          }
        }
        if (!metaObj || typeof metaObj !== 'object' || Array.isArray(metaObj)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: 'Contact details (name and phoneNumber) are required in metadata',
          });
          return;
        }
        const parsed = contactMetadataSchema.safeParse(metaObj);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: parsed.error.errors[0]?.message || 'Invalid contact metadata',
          });
        }
      }
    }),
});

export const sendMultiMessageSchema = z.object({
  body: z
    .object({
      recipientIds: z
        .array(z.string().uuid({ message: 'Every recipientId must be a valid UUID' }))
        .min(1, { message: 'recipientIds array cannot be empty' })
        .max(50, { message: 'Cannot send message to more than 50 recipients at once' })
        .optional(),
      recipientId: z.string().uuid({ message: 'Invalid recipientId UUID format' }).optional(),
      conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }).optional(),
      content: z
        .string()
        .trim()
        .max(5000, { message: 'Message content cannot exceed 5000 characters' })
        .optional(),
      type: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'], {
          errorMap: () => ({
            message:
              'Invalid message type. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
          }),
        })
        .optional(),
      messageType: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift'], {
          errorMap: () => ({
            message:
              'Invalid messageType. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
          }),
        })
        .optional(),
      clientMessageId: z
        .string()
        .trim()
        .max(100, { message: 'clientMessageId cannot exceed 100 characters' })
        .optional(),
      clientMessageIds: z.record(z.string().trim().max(100)).optional(),
      metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
    })
    .superRefine((data, ctx) => {
      const hasRecipients =
        (data.recipientIds && data.recipientIds.length > 0) ||
        !!data.recipientId ||
        !!data.conversationId;

      if (!hasRecipients) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipientIds'],
          message: 'At least one recipientId or recipientIds or conversationId must be provided',
        });
      }

      const type = data.type || data.messageType || 'text';
      if (type === 'text') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Message content cannot be empty for text message',
          });
        }
      } else if (type === 'image') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Image URL or storage key is required in content for image message',
          });
        }
        if (data.metadata) {
          let metaObj = data.metadata;
          if (typeof metaObj === 'string') {
            try {
              metaObj = JSON.parse(metaObj);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: 'Invalid JSON string in metadata',
              });
              return;
            }
          }
          if (metaObj && typeof metaObj === 'object') {
            const parsed = imageMetadataSchema.safeParse(metaObj);
            if (!parsed.success) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: parsed.error.errors[0]?.message || 'Invalid image metadata',
              });
            }
          }
        }
      } else if (type === 'audio') {
        if (!data.content || data.content.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['content'],
            message: 'Audio URL or storage key is required in content for audio message',
          });
        }
      } else if (type === 'location') {
        let metaObj = data.metadata;
        if (typeof metaObj === 'string') {
          try {
            metaObj = JSON.parse(metaObj);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['metadata'],
              message: 'Invalid JSON string in metadata',
            });
            return;
          }
        }
        if (!metaObj || typeof metaObj !== 'object') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: 'Location coordinates (latitude and longitude) are required in metadata',
          });
          return;
        }
        const parsed = locationMetadataSchema.safeParse(metaObj);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: parsed.error.errors[0]?.message || 'Invalid location metadata',
          });
        }
      } else if (type === 'contact') {
        let metaObj = data.metadata;
        if (typeof metaObj === 'string') {
          try {
            metaObj = JSON.parse(metaObj);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['metadata'],
              message: 'Invalid JSON string in metadata',
            });
            return;
          }
        }
        if (!metaObj || typeof metaObj !== 'object' || Array.isArray(metaObj)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: 'Contact details (name and phoneNumber) are required in metadata',
          });
          return;
        }
        const parsed = contactMetadataSchema.safeParse(metaObj);
        if (!parsed.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['metadata'],
            message: parsed.error.errors[0]?.message || 'Invalid contact metadata',
          });
        }
      }
    }),
});

export const markReadSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z
    .object({
      lastReadMessageId: z
        .string()
        .uuid({ message: 'Invalid lastReadMessageId UUID format' })
        .optional()
        .nullable(),
    })
    .optional(),
});

export const deliveryReceiptSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    messageIds: z
      .array(
        z.string().uuid({ message: 'Every messageId must be a valid UUID' }),
        { required_error: 'messageIds array is required' }
      )
      .min(1, { message: 'messageIds array cannot be empty' })
      .max(100, { message: 'Cannot acknowledge more than 100 messages at once' }),
  }),
});

export const syncDeliveredMessagesSchema = z.object({
  body: z
    .object({
      conversationId: z
        .string()
        .uuid({ message: 'Invalid conversationId UUID format' })
        .optional()
        .nullable(),
      messageIds: z
        .array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
        .max(500, { message: 'Cannot sync more than 500 messages at once' })
        .optional(),
      deliveredMessageIds: z
        .array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
        .max(500)
        .optional(),
      messageId: z
        .string()
        .uuid({ message: 'Invalid messageId UUID format' })
        .optional(),
    })
    .optional()
    .default({}),
  query: z
    .object({
      conversationId: z
        .string()
        .uuid({ message: 'Invalid conversationId UUID format' })
        .optional(),
    })
    .optional()
    .default({}),
});

export const getUnreadCountSchema = z.object({
  query: z
    .object({
      conversationId: z
        .string()
        .uuid({ message: 'Invalid conversationId UUID format' })
        .optional(),
    })
    .optional(),
});

export const pinConversationSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    isPinned: z.boolean({ required_error: 'isPinned is required (true to pin, false to unpin)' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }).optional(),
    scope: z.enum(['user', 'conversation']).optional(),
  }),
});

export const pinMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }),
  }),
  body: z
    .object({
      isPinned: z.boolean().default(true),
      scope: z.enum(['user', 'conversation']).optional().default('user'),
    })
    .optional()
    .default({ isPinned: true, scope: 'user' }),
});

export const getPinnedMessagesSchema = z.object({
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
    scope: z.enum(['user', 'conversation', 'all']).optional().default('all'),
  }),
});

export const startConversationSchema = z.object({
  body: z.object({
    recipientId: z.string().uuid({ message: 'Invalid recipientId UUID format' }),
  }),
});

export const archiveConversationSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    isArchived: z.boolean({ required_error: 'isArchived is required' }),
  }),
});

export const deleteConversationSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z.object({
    deleteType: z.enum(['me', 'everyone'], {
      errorMap: () => ({ message: 'deleteType must be either "me" or "everyone"' }),
    }),
  }),
});

export type GetChatListQuery = z.infer<typeof getChatListSchema>['query'];
export type GetMessagesQuery = z.infer<typeof getMessagesSchema>['query'];
export type SendMessageInput = z.infer<typeof sendMessageSchema>['body'];
export type SendMultiMessageInput = z.infer<typeof sendMultiMessageSchema>['body'];
export type MarkReadInput = z.infer<typeof markReadSchema>['body'];
export type DeliveryReceiptInput = z.infer<typeof deliveryReceiptSchema>['body'];
export type SyncDeliveredMessagesInput = z.infer<typeof syncDeliveredMessagesSchema>['body'];
export type GetUnreadCountQuery = z.infer<typeof getUnreadCountSchema>['query'];
export type PinConversationInput = z.infer<typeof pinConversationSchema>['body'];
export type PinMessageInput = z.infer<typeof pinMessageSchema>['body'];
export type GetPinnedMessagesQuery = z.infer<typeof getPinnedMessagesSchema>['query'];
export type StartConversationInput = z.infer<typeof startConversationSchema>['body'];
export type ArchiveConversationInput = z.infer<typeof archiveConversationSchema>['body'];
export type DeleteConversationInput = z.infer<typeof deleteConversationSchema>['body'];

