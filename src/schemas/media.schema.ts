import { z } from 'zod';

export const generatePresignedUrlSchema = z.object({
  body: z.object({
    folder: z
      .enum(['uploads', 'photos', 'moments', 'verifications', 'avatars', 'quick-moments', 'quick_moments', 'audio', 'chat'], {
        errorMap: () => ({
          message: 'Invalid folder. Allowed values: uploads, photos, moments, verifications, avatars, quick-moments, quick_moments, audio, chat',
        }),
      })
      .optional()
      .default('uploads'),
    mimeType: z
      .string()
      .regex(/^image\/(jpeg|png|webp|gif|avif)|video\/(mp4|quicktime)|audio\/(mpeg|wav|aac|ogg|mp4|m4a)$/, {
        message: 'Unsupported MIME type for upload',
      })
      .optional()
      .default('image/jpeg'),
    expiresInSeconds: z
      .number()
      .int()
      .min(60, { message: 'Expiry must be at least 60 seconds' })
      .max(3600, { message: 'Expiry cannot exceed 1 hour (3600 seconds)' })
      .optional()
      .default(900),
  }),
});

export type GeneratePresignedUrlInput = z.infer<typeof generatePresignedUrlSchema>['body'];
