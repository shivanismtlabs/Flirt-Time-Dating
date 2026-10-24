import { z } from 'zod';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_RE = /^[0-9a-f]{32}$/i;
const EMBEDDED_UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Profile → chat clients send recipientId in several shapes (UUID, compact UUID,
 * username, empty string next to userId, wrapped user object). Normalize before
 * UUID validation so POST /api/v1/chats does not 400 on valid profile flows.
 */
export const normalizeRecipientIdentifier = (raw: unknown): string | undefined => {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    raw = String(raw);
  }
  if (Array.isArray(raw)) {
    return raw.length > 0 ? normalizeRecipientIdentifier(raw[0]) : undefined;
  }
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return normalizeRecipientIdentifier(
      obj.id ??
        obj.userId ??
        obj.targetUserId ??
        obj.recipientId ??
        obj.participantId ??
        obj.toUserId ??
        obj.otherUserId ??
        obj.profileUserId ??
        obj.profileId
    );
  }
  if (typeof raw !== 'string') {
    return undefined;
  }

  let value = raw.trim();
  if (!value || value === 'null' || value === 'undefined') {
    return undefined;
  }
  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (COMPACT_UUID_RE.test(value)) {
    value = `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }
  const embedded = value.match(EMBEDDED_UUID_RE);
  if (embedded) {
    return embedded[0];
  }
  return value;
};

export const isUuidIdentifier = (value: string): boolean => UUID_RE.test(value);

export const pickRecipientIdentifier = (body: Record<string, unknown> | null | undefined): string | undefined => {
  if (!body) {
    return undefined;
  }
  return normalizeRecipientIdentifier(
    (Array.isArray(body.recipientIds) && body.recipientIds.length > 0
      ? body.recipientIds[0]
      : undefined) ||
      body.recipientIds ||
      body.recipientId ||
      body.userId ||
      body.targetUserId ||
      body.participantId ||
      body.toUserId ||
      body.otherUserId ||
      body.profileUserId ||
      body.profileId
  );
};

const normalizeRecipientList = (val: unknown): string[] | undefined => {
  if (val === null || val === undefined || val === '') {
    return undefined;
  }
  const asArray = Array.isArray(val) ? val : [val];
  const out = asArray
    .map((item) => normalizeRecipientIdentifier(item))
    .filter((item): item is string => !!item);
  return out.length > 0 ? out : undefined;
};

const optionalRecipientRef = z.preprocess(
  (val) => normalizeRecipientIdentifier(val),
  z
    .string()
    .trim()
    .min(1, { message: 'recipientId cannot be empty' })
    .max(80, { message: 'recipientId is too long' })
    .optional()
);

export const directSendMessageSchema = z.object({
  recipientId: z.preprocess(
    (val) => normalizeRecipientIdentifier(val),
    z
      .string({ required_error: 'recipientId is required' })
      .trim()
      .min(1, { message: 'recipientId cannot be empty' })
      .max(80, { message: 'recipientId is too long' })
  ),
    content: z
      .string()
      .trim()
      .max(5000000, 'Message content cannot exceed maximum limit')
      .optional(),
    imageUrl: z.string().trim().max(5000).optional(),
    image: z.string().trim().max(5000000).optional(),
    mediaUrl: z.string().trim().max(5000).optional(),
    imageKey: z.string().trim().max(5000).optional(),
    audioUrl: z.string().trim().max(5000).optional(),
    audio: z.string().trim().max(5000000).optional(),
    voiceUrl: z.string().trim().max(5000).optional(),
    url: z.string().trim().max(5000).optional(),
    fileUrl: z.string().trim().max(5000).optional(),
    images: z.union([z.array(z.any()), z.string()]).optional(),
    medias: z.union([z.array(z.any()), z.string()]).optional(),
    imageUrls: z.union([z.array(z.any()), z.string()]).optional(),
    mediaUrls: z.union([z.array(z.any()), z.string()]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    durationMs: z.union([z.number(), z.string()]).optional(),
    caption: z.string().trim().max(1000).optional(),
    type: z
      .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'])
      .optional()
      .transform((val) => (val === 'voice' ? 'audio' : val)),
    messageType: z
      .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'])
      .optional()
      .transform((val) => (val === 'voice' ? 'audio' : val))
      .default('text'),
    metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
    clientMessageId: z.string().trim().max(100).optional(),
    replyToMessageId: z.string().uuid('replyToMessageId must be a valid UUID').optional(),
    parentMessageId: z.string().uuid('parentMessageId must be a valid UUID').optional(),
    replyToId: z.string().uuid('replyToId must be a valid UUID').optional(),
  })
  .superRefine((data, ctx) => {
    let multiImageFirst: string | undefined;
    if (Array.isArray((data as any).images) && (data as any).images.length > 0) {
      const first = (data as any).images[0];
      multiImageFirst = typeof first === 'string' ? first : first.url || first.imageUrl || first.mediaUrl || first.key || '__MULTI_IMAGE__';
    } else if (Array.isArray((data as any).imageUrls) && (data as any).imageUrls.length > 0) {
      const first = (data as any).imageUrls[0];
      multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
    } else if (Array.isArray((data as any).mediaUrls) && (data as any).mediaUrls.length > 0) {
      const first = (data as any).mediaUrls[0];
      multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
    } else if (Array.isArray((data as any).medias) && (data as any).medias.length > 0) {
      const first = (data as any).medias[0];
      multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
    }

    const resolvedContent =
      data.content ||
      data.imageUrl ||
      data.image ||
      data.mediaUrl ||
      data.imageKey ||
      (data as any).audioUrl ||
      (data as any).audio ||
      (data as any).voiceUrl ||
      (data as any).url ||
      (data as any).fileUrl ||
      multiImageFirst;

    if (resolvedContent && !data.content) {
      data.content = resolvedContent;
    }

    if (!data.content || data.content.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'Message content cannot be empty',
      });
    }
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

const CONTACT_META_KEYS = new Set([
  'name',
  'displayName',
  'contactName',
  'phoneNumber',
  'phone',
  'mobile',
  'number',
  'email',
  'contact',
]);

export const contactMetadataSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const src = raw as Record<string, any>;
  const nested = src.contact && typeof src.contact === 'object' ? src.contact : {};
  const name = src.name || src.displayName || src.contactName || nested.name || nested.displayName || '';
  const phoneNumber =
    src.phoneNumber || src.phone || src.mobile || src.number || nested.phoneNumber || nested.phone || nested.mobile || nested.number || '';
  const email = src.email || nested.email;
  const canonical: Record<string, unknown> = {
    name: typeof name === 'string' ? name.trim() : name,
    phoneNumber: typeof phoneNumber === 'string' ? phoneNumber.trim() : phoneNumber,
    ...(typeof email === 'string' && email.trim() ? { email: email.trim() } : {}),
  };
  for (const key of Object.keys(src)) {
    if (!CONTACT_META_KEYS.has(key)) canonical[key] = src[key];
  }
  return canonical;
}, z
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
  .strict({ message: 'Unknown property in contact metadata. Duplicate or unpermitted keys are rejected' }));

export const imageMetadataSchema = z
  .object({
    thumbnailUrl: z.string().max(2000).optional(),
    imageUrl: z.string().max(2000).optional(),
    mediaUrl: z.string().max(2000).optional(),
    url: z.string().max(2000).optional(),
    caption: z.string().max(1000).optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    fileSize: z.union([z.number(), z.string()]).optional(),
    size: z.union([z.number(), z.string()]).optional(),
    mimeType: z.string().max(100).optional(),
    type: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
    name: z.string().max(500).optional(),
    fileName: z.string().max(500).optional(),
    uri: z.string().max(2000).optional(),
    path: z.string().max(2000).optional(),
    localPath: z.string().max(2000).optional(),
    images: z.array(z.any()).optional(),
  })
  .passthrough();

export const audioMetadataSchema = z
  .object({
    duration: z.union([z.number(), z.string()]).optional(),
    durationMs: z.union([z.number(), z.string()]).optional(),
    mimeType: z.string().max(100).optional(),
    type: z.string().max(100).optional(),
    fileSize: z.union([z.number(), z.string()]).optional(),
    size: z.union([z.number(), z.string()]).optional(),
    audioUrl: z.string().max(2000).optional(),
    mediaUrl: z.string().max(2000).optional(),
    url: z.string().max(2000).optional(),
    name: z.string().max(500).optional(),
    fileName: z.string().max(500).optional(),
    uri: z.string().max(2000).optional(),
    path: z.string().max(2000).optional(),
    localPath: z.string().max(2000).optional(),
  })
  .passthrough();

export const sendMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z
    .object({
      content: z
        .string()
        .trim()
        .max(5000000, { message: 'Message content cannot exceed maximum limit' })
        .optional(),
      imageUrl: z.string().trim().max(5000).optional(),
      image: z.string().trim().max(5000000).optional(),
      mediaUrl: z.string().trim().max(5000).optional(),
      imageKey: z.string().trim().max(5000).optional(),
      audioUrl: z.string().trim().max(5000).optional(),
      audio: z.string().trim().max(5000000).optional(),
      voiceUrl: z.string().trim().max(5000).optional(),
      url: z.string().trim().max(5000).optional(),
      fileUrl: z.string().trim().max(5000).optional(),
      images: z.union([z.array(z.any()), z.string()]).optional(),
    medias: z.union([z.array(z.any()), z.string()]).optional(),
      imageUrls: z.union([z.array(z.any()), z.string()]).optional(),
      mediaUrls: z.union([z.array(z.any()), z.string()]).optional(),
      duration: z.union([z.number(), z.string()]).optional(),
      durationMs: z.union([z.number(), z.string()]).optional(),
      caption: z.string().trim().max(1000).optional(),
      type: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'])
        .optional()
        .transform((val) => (val === 'voice' ? 'audio' : val)),
      messageType: z
        .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'], {
          errorMap: () => ({
            message:
              'Invalid messageType. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
          }),
        })
        .optional()
        .transform((val) => (val === 'voice' ? 'audio' : val))
        .default('text'),
      clientMessageId: z.string().trim().max(100, { message: 'Invalid clientMessageId format' }).optional(),
      replyToMessageId: z.string().uuid({ message: 'Invalid replyToMessageId UUID format' }).optional(),
      parentMessageId: z.string().uuid({ message: 'Invalid parentMessageId UUID format' }).optional(),
      replyToId: z.string().uuid({ message: 'Invalid replyToId UUID format' }).optional(),
      metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
    })
    .superRefine((data, ctx) => {
      let multiImageFirst: string | undefined;
      if (Array.isArray((data as any).images) && (data as any).images.length > 0) {
        const first = (data as any).images[0];
        multiImageFirst = typeof first === 'string' ? first : first.url || first.imageUrl || first.mediaUrl || first.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).imageUrls) && (data as any).imageUrls.length > 0) {
        const first = (data as any).imageUrls[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).mediaUrls) && (data as any).mediaUrls.length > 0) {
        const first = (data as any).mediaUrls[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).medias) && (data as any).medias.length > 0) {
        const first = (data as any).medias[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      }

      const resolvedContent =
        data.content ||
        data.imageUrl ||
        data.image ||
        data.mediaUrl ||
        data.imageKey ||
        (data as any).audioUrl ||
        (data as any).audio ||
        (data as any).voiceUrl ||
        (data as any).url ||
        (data as any).fileUrl ||
        multiImageFirst;

      if (resolvedContent && !data.content) {
        data.content = resolvedContent;
      }

      const isAudioSignal = !!((data as any).audioUrl || (data as any).audio || (data as any).voiceUrl);
      const isImageSignal = !!(data.imageUrl || data.image || data.imageKey || multiImageFirst);

      const type =
        data.type ||
        data.messageType ||
        (isImageSignal ? 'image' : isAudioSignal ? 'audio' : 'text');

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
            const parsed = audioMetadataSchema.safeParse(metaObj);
            if (!parsed.success) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: parsed.error.errors[0]?.message || 'Invalid audio metadata',
              });
            }
          }
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
        .preprocess(
          (val) => normalizeRecipientList(val),
          z
            .array(z.string().min(1).max(80))
            .min(1, { message: 'recipientIds array cannot be empty' })
            .max(50, { message: 'Cannot send message to more than 50 recipients at once' })
        )
        .optional(),
      recipientId: optionalRecipientRef,
      userId: optionalRecipientRef,
      targetUserId: optionalRecipientRef,
      participantId: optionalRecipientRef,
      toUserId: optionalRecipientRef,
      otherUserId: optionalRecipientRef,
      conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }).optional(),
          content: z
            .string()
            .trim()
            .max(5000000, { message: 'Message content cannot exceed maximum limit' })
            .optional(),
          imageUrl: z.string().trim().max(5000).optional(),
          image: z.string().trim().max(5000000).optional(),
          mediaUrl: z.string().trim().max(5000).optional(),
          imageKey: z.string().trim().max(5000).optional(),
          audioUrl: z.string().trim().max(5000).optional(),
          audio: z.string().trim().max(5000000).optional(),
          voiceUrl: z.string().trim().max(5000).optional(),
          url: z.string().trim().max(5000).optional(),
          fileUrl: z.string().trim().max(5000).optional(),
          images: z.union([z.array(z.any()), z.string()]).optional(),
    medias: z.union([z.array(z.any()), z.string()]).optional(),
          imageUrls: z.union([z.array(z.any()), z.string()]).optional(),
          mediaUrls: z.union([z.array(z.any()), z.string()]).optional(),
          duration: z.union([z.number(), z.string()]).optional(),
          durationMs: z.union([z.number(), z.string()]).optional(),
          caption: z.string().trim().max(1000).optional(),
          type: z
            .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'], {
              errorMap: () => ({
                message:
                  'Invalid message type. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
              }),
            })
            .optional()
            .transform((val) => (val === 'voice' ? 'audio' : val)),
          messageType: z
            .enum(['text', 'audio', 'image', 'location', 'contact', 'moment_reply', 'moment_gift', 'voice'], {
              errorMap: () => ({
                message:
                  'Invalid messageType. Allowed values: text, audio, image, location, contact, moment_reply, moment_gift',
              }),
            })
            .optional()
            .transform((val) => (val === 'voice' ? 'audio' : val)),
          clientMessageId: z
            .string()
            .trim()
            .max(100, { message: 'clientMessageId cannot exceed 100 characters' })
            .optional(),
          clientMessageIds: z.record(z.string().trim().max(100)).optional(),
          replyToMessageId: z.string().uuid({ message: 'Invalid replyToMessageId UUID format' }).optional(),
          parentMessageId: z.string().uuid({ message: 'Invalid parentMessageId UUID format' }).optional(),
          replyToId: z.string().uuid({ message: 'Invalid replyToId UUID format' }).optional(),
          metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
        })
        .superRefine((data, ctx) => {
          const hasRecipients =
            (data.recipientIds && data.recipientIds.length > 0) ||
            !!data.recipientId ||
            !!data.userId ||
            !!data.targetUserId ||
            !!data.participantId ||
            !!(data as any).toUserId ||
            !!(data as any).otherUserId ||
            !!data.conversationId;

          if (!hasRecipients) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['recipientIds'],
              message: 'At least one recipientId or recipientIds or conversationId must be provided',
            });
          }

      let multiImageFirst: string | undefined;
      if (Array.isArray((data as any).images) && (data as any).images.length > 0) {
        const first = (data as any).images[0];
        multiImageFirst = typeof first === 'string' ? first : first.url || first.imageUrl || first.mediaUrl || first.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).imageUrls) && (data as any).imageUrls.length > 0) {
        const first = (data as any).imageUrls[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).mediaUrls) && (data as any).mediaUrls.length > 0) {
        const first = (data as any).mediaUrls[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      } else if (Array.isArray((data as any).medias) && (data as any).medias.length > 0) {
        const first = (data as any).medias[0];
        multiImageFirst = typeof first === 'string' ? first : first?.url || first?.imageUrl || first?.mediaUrl || first?.key || '__MULTI_IMAGE__';
      }

      const resolvedContent =
        data.content ||
        data.imageUrl ||
        data.image ||
        data.mediaUrl ||
        data.imageKey ||
        (data as any).audioUrl ||
        (data as any).audio ||
        (data as any).voiceUrl ||
        (data as any).url ||
        (data as any).fileUrl ||
        multiImageFirst;

      if (resolvedContent && !data.content) {
        data.content = resolvedContent;
      }

      const isAudioSignal = !!((data as any).audioUrl || (data as any).audio || (data as any).voiceUrl);
      const isImageSignal = !!(data.imageUrl || data.image || data.imageKey || multiImageFirst);

      const type =
        data.type ||
        data.messageType ||
        (isImageSignal ? 'image' : isAudioSignal ? 'audio' : 'text');

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
            const parsed = audioMetadataSchema.safeParse(metaObj);
            if (!parsed.success) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['metadata'],
                message: parsed.error.errors[0]?.message || 'Invalid audio metadata',
              });
            }
          }
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
      messageId: z
        .string()
        .uuid({ message: 'Invalid messageId UUID format' })
        .optional()
        .nullable(),
      message_id: z
        .string()
        .uuid({ message: 'Invalid message_id UUID format' })
        .optional()
        .nullable(),
      last_read_message_id: z
        .string()
        .uuid({ message: 'Invalid last_read_message_id UUID format' })
        .optional()
        .nullable(),
      id: z
        .string()
        .uuid({ message: 'Invalid id UUID format' })
        .optional()
        .nullable(),
    })
    .optional(),
});

export const deliveryReceiptSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z
    .object({
      messageIds: z
        .array(
          z.string().uuid({ message: 'Every messageId must be a valid UUID' }),
          { required_error: 'messageIds array is required' }
        )
        .min(1, { message: 'messageIds array cannot be empty' })
        .max(100, { message: 'Cannot acknowledge more than 100 messages at once' })
        .optional(),
      deliveredMessageIds: z
        .array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
        .min(1)
        .max(100)
        .optional(),
      messageId: z
        .string()
        .uuid({ message: 'Invalid messageId UUID format' })
        .optional(),
      message_id: z
        .string()
        .uuid({ message: 'Invalid message_id UUID format' })
        .optional(),
    })
    .optional()
    .default({}),
});

export const conversationDeliveredSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
  }),
  body: z
    .object({
      messageIds: z
        .array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
        .min(1, { message: 'messageIds array cannot be empty' })
        .max(500, { message: 'Cannot acknowledge more than 500 messages at once' })
        .optional(),
      deliveredMessageIds: z
        .array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
        .min(1)
        .max(500)
        .optional(),
      messageId: z
        .string()
        .uuid({ message: 'Invalid messageId UUID format' })
        .optional(),
      message_id: z
        .string()
        .uuid({ message: 'Invalid message_id UUID format' })
        .optional(),
    })
    .optional()
    .default({}),
  query: z
    .object({
      messageId: z
        .string()
        .uuid({ message: 'Invalid messageId UUID format' })
        .optional(),
    })
    .optional()
    .default({}),
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
      scope: z.enum(['user', 'conversation']).optional().default('conversation'),
    })
    .optional()
    .default({ isPinned: true, scope: 'conversation' }),
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
  body: z
    .object({
      recipientId: optionalRecipientRef,
      userId: optionalRecipientRef,
      targetUserId: optionalRecipientRef,
      participantId: optionalRecipientRef,
      toUserId: optionalRecipientRef,
      otherUserId: optionalRecipientRef,
      profileUserId: optionalRecipientRef,
      profileId: optionalRecipientRef,
      recipientIds: z.preprocess(
        (val) => normalizeRecipientList(val),
        z.array(z.string().min(1).max(80)).optional()
      ),
      content: z.string().optional(),
      messageType: z.string().optional(),
      type: z.string().optional(),
    })
    .passthrough()
    .superRefine((data, ctx) => {
      const target =
        data.recipientId ||
        data.userId ||
        data.targetUserId ||
        data.participantId ||
        data.toUserId ||
        data.otherUserId ||
        data.profileUserId ||
        data.profileId ||
        (data.recipientIds && data.recipientIds.length > 0);
      if (!target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipientId'],
          message: 'recipientId is required',
        });
      }
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

export const deleteMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }),
  }),
  body: z
    .object({
      deleteType: z.enum(['me', 'everyone'], {
        errorMap: () => ({ message: 'deleteType must be either "me" or "everyone"' }),
      }).optional(),
    })
    .optional(),
  query: z
    .object({
      deleteType: z.enum(['me', 'everyone'], {
        errorMap: () => ({ message: 'deleteType must be either "me" or "everyone"' }),
      }).optional(),
    })
    .optional(),
});

export const editMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }),
  }),
  body: z.object({
    content: z
      .string({ required_error: 'Content is required' })
      .trim()
      .min(1, { message: 'Message content cannot be empty' })
      .max(5000, { message: 'Message content cannot exceed 5000 characters' }),
  }),
});

export const replyMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }).optional(),
  }),
  body: z.object({
    replyToMessageId: z.string().uuid({ message: 'Invalid replyToMessageId UUID format' }).optional(),
    parentMessageId: z.string().uuid({ message: 'Invalid parentMessageId UUID format' }).optional(),
    replyToId: z.string().uuid({ message: 'Invalid replyToId UUID format' }).optional(),
    content: z
      .string({ required_error: 'Message content is required' })
      .trim()
      .min(1, { message: 'Message content cannot be empty' })
      .max(5000000, { message: 'Message content cannot exceed maximum limit' })
      .optional(),
    imageUrl: z.string().trim().max(5000).optional(),
    image: z.string().trim().max(5000000).optional(),
    mediaUrl: z.string().trim().max(5000).optional(),
    imageKey: z.string().trim().max(5000).optional(),
    audioUrl: z.string().trim().max(5000).optional(),
    audio: z.string().trim().max(5000000).optional(),
    voiceUrl: z.string().trim().max(5000).optional(),
    url: z.string().trim().max(5000).optional(),
    fileUrl: z.string().trim().max(5000).optional(),
    images: z.union([z.array(z.any()), z.string()]).optional(),
    medias: z.union([z.array(z.any()), z.string()]).optional(),
    imageUrls: z.union([z.array(z.any()), z.string()]).optional(),
    mediaUrls: z.union([z.array(z.any()), z.string()]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    caption: z.string().trim().max(1000).optional(),
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
    clientMessageId: z.string().trim().max(100).optional(),
    metadata: z.union([z.string(), z.record(z.any()), z.null()]).optional().nullable(),
  }),
});

export type GetChatListQuery = z.infer<typeof getChatListSchema>['query'];
export type GetMessagesQuery = z.infer<typeof getMessagesSchema>['query'];
export type SendMessageInput = z.infer<typeof sendMessageSchema>['body'];
export type SendMultiMessageInput = z.infer<typeof sendMultiMessageSchema>['body'];
export type MarkReadInput = z.infer<typeof markReadSchema>['body'];
export type DeliveryReceiptInput = z.infer<typeof deliveryReceiptSchema>['body'];
export type ConversationDeliveredInput = z.infer<typeof conversationDeliveredSchema>['body'];
export type SyncDeliveredMessagesInput = z.infer<typeof syncDeliveredMessagesSchema>['body'];
export type GetUnreadCountQuery = z.infer<typeof getUnreadCountSchema>['query'];
export type PinConversationInput = z.infer<typeof pinConversationSchema>['body'];
export type PinMessageInput = z.infer<typeof pinMessageSchema>['body'];
export type GetPinnedMessagesQuery = z.infer<typeof getPinnedMessagesSchema>['query'];
export type StartConversationInput = z.infer<typeof startConversationSchema>['body'];
export type ArchiveConversationInput = z.infer<typeof archiveConversationSchema>['body'];
export type DeleteConversationInput = z.infer<typeof deleteConversationSchema>['body'];
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>['body'];
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>['body'];

export const ALLOWED_CHAT_REACTION_EMOJIS = [
  '❤️',
  '👍',
  '🔥',
  '😂',
  '😮',
  '😢',
  '👏',
  '😍',
  '🙏',
] as const;

export type AllowedChatReactionEmoji = string;

const EMOJI_ALIAS_MAP: Record<string, string> = {
  heart: '❤️',
  love: '❤️',
  like: '👍',
  thumbs_up: '👍',
  thumbsup: '👍',
  fire: '🔥',
  lit: '🔥',
  laugh: '😂',
  joy: '😂',
  surprised: '😮',
  wow: '😮',
  sad: '😢',
  cry: '😢',
  clap: '👏',
  applause: '👏',
  love_eyes: '😍',
  heart_eyes: '😍',
  pray: '🙏',
  thanks: '🙏',
};

export const normalizeReactionEmoji = (input?: string | null): string | null => {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (EMOJI_ALIAS_MAP[lower]) {
    return EMOJI_ALIAS_MAP[lower];
  }

  // Handle standard unicode variants: bare heart U+2764 to ❤️ (U+2764 U+FE0F)
  let normalized = trimmed.normalize('NFC');
  if (normalized === '\u2764') {
    normalized = '❤️';
  }

  return normalized;
};

export const reactMessageSchema = z.object({
  params: z.object({
    conversationId: z.string().uuid({ message: 'Invalid conversationId UUID format' }),
    messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }),
  }),
  body: z
    .object({
      emoji: z.string().trim().min(1, { message: 'Reaction emoji cannot be empty' }).max(32, { message: 'Reaction emoji cannot exceed 32 characters' }).optional(),
      reaction: z.string().trim().min(1, { message: 'Reaction emoji cannot be empty' }).max(32, { message: 'Reaction emoji cannot exceed 32 characters' }).optional(),
      reactionEmoji: z.string().trim().min(1, { message: 'Reaction emoji cannot be empty' }).max(32, { message: 'Reaction emoji cannot exceed 32 characters' }).optional(),
    })
    .refine(
      (data) => {
        const val = data.emoji || data.reaction || data.reactionEmoji;
        if (!val || typeof val !== 'string' || !val.trim()) return false;
        return normalizeReactionEmoji(val) !== null;
      },
      {
        message: 'Reaction emoji is required',
        path: ['emoji'],
      }
    ),
});

export type ReactMessageInput = z.infer<typeof reactMessageSchema>;

export const forwardMessagesSchema = z.object({
  body: z
    .object({
      messageIds: z
        .preprocess((val) => {
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return [];
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // Not JSON
            }
            if (trimmed.includes(',')) {
              return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
            }
            return [trimmed];
          }
          return val;
        }, z.array(z.string().uuid({ message: 'Every messageId must be a valid UUID' }))
          .min(1, { message: 'At least one messageId is required' })
          .max(20, { message: 'Cannot forward more than 20 messages at once' })
          .refine((items) => new Set(items).size === items.length, {
            message: 'messageIds must contain unique IDs with no duplicates',
          })
        )
        .optional(),
      messageId: z.string().uuid({ message: 'Invalid messageId UUID format' }).optional(),
      recipientIds: z
        .preprocess((val) => {
          if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return [];
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return parsed;
            } catch {
              // Not JSON
            }
            if (trimmed.includes(',')) {
              return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
            }
            return [trimmed];
          }
          return val;
        }, z.array(z.string().uuid({ message: 'Every recipientId must be a valid UUID' }))
          .min(1, { message: 'At least one recipientId is required' })
          .max(50, { message: 'Cannot forward messages to more than 50 recipients at once' })
          .refine((items) => new Set(items).size === items.length, {
            message: 'recipientIds must contain unique IDs with no duplicates',
          })
        )
        .optional(),
      recipientId: z.string().uuid({ message: 'Invalid recipientId UUID format' }).optional(),
      clientMessageId: z.string().trim().max(100).optional(),
      clientMessageIds: z.record(z.string()).optional(),
    })
    .refine(
      (data) => (data.messageIds && data.messageIds.length > 0) || !!data.messageId,
      {
        message: 'At least one messageId is required',
        path: ['messageIds'],
      }
    )
    .refine(
      (data) => (data.recipientIds && data.recipientIds.length > 0) || !!data.recipientId,
      {
        message: 'At least one recipientId is required',
        path: ['recipientIds'],
      }
    ),
});

export type ForwardMessagesInput = z.infer<typeof forwardMessagesSchema>['body'];

export const getForwardRecipientsSchema = z.object({
  query: z.object({
    search: z
      .string()
      .trim()
      .max(100, { message: 'Search query cannot exceed 100 characters' })
      .optional(),
    page: z
      .union([
        z.string().regex(/^\d+$/, { message: 'Page must be a positive integer' }).transform(Number),
        z.number(),
      ])
      .pipe(z.number().int().min(1))
      .optional()
      .default(1),
    limit: z
      .union([
        z.string().regex(/^\d+$/, { message: 'Limit must be a positive integer' }).transform(Number),
        z.number(),
      ])
      .pipe(z.number().int().min(1).max(100, { message: 'Limit cannot exceed 100' }))
      .optional()
      .default(20),
  }),
});

export type GetForwardRecipientsQuery = z.infer<typeof getForwardRecipientsSchema>['query'];

