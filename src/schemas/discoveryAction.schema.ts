import { z } from 'zod';

export const discoveryActionSchema = z.object({
  targetUserId: z
    .string({ required_error: 'targetUserId is required' })
    .uuid('targetUserId must be a valid UUID'),
  action: z
    .string({ required_error: 'action is required' })
    .trim()
    .toLowerCase()
    .refine(
      (val) =>
        ['like', 'nope', 'super_like', 'connect', 'interested', 'not_interested'].includes(
          val
        ),
      {
        message: "Invalid action. Supported actions are: 'like', 'nope', 'super_like'",
      }
    )
    .transform((val) => {
      if (val === 'interested') return 'like';
      if (val === 'not_interested') return 'nope';
      if (val === 'connect') return 'super_like';
      return val as 'like' | 'nope' | 'super_like';
    }),
});

export type DiscoveryActionInput = z.infer<typeof discoveryActionSchema>;
