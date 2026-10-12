import { z } from 'zod';

export const getDiscoveryInterestsSchema = z.object({
  query: z.object({
    selectedInterestId: z
      .string()
      .uuid('Invalid selected interest ID format')
      .optional(),
    search: z.string().optional(),
  }),
});

export const getInterestUsersSchema = z.object({
  params: z.object({
    interestId: z
      .string({
        required_error: 'Interest ID parameter is required',
      })
      .uuid('Invalid interest ID format'),
  }),
  query: z.object({
    limit: z
      .string()
      .regex(/^\d+$/, 'Limit must be a positive integer')
      .optional(),
    cursor: z.string().optional(),
    page: z
      .string()
      .regex(/^\d+$/, 'Page must be a positive integer')
      .optional(),
    gender: z
      .string()
      .optional(),
    minAge: z
      .string()
      .regex(/^\d+$/, 'minAge must be a positive integer')
      .optional(),
    maxAge: z
      .string()
      .regex(/^\d+$/, 'maxAge must be a positive integer')
      .optional(),
  }),
});

export const getFeaturedInterestsSchema = z.object({
  query: z.object({
    userLimit: z
      .string()
      .regex(/^\d+$/, 'userLimit must be a positive integer')
      .optional(),
  }),
});
