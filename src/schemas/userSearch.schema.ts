import { z } from 'zod';

const booleanParam = z.union([
  z.boolean(),
  z.enum(['true', 'false', '1', '0']).transform((val) => val === 'true' || val === '1'),
]);

const numberParam = z.union([
  z.number(),
  z.string().regex(/^\d+$/).transform((val) => parseInt(val, 10)),
]);

export const userSearchQuerySchema = z
  .object({
    query: z.string().trim().max(100).optional(),
    search: z.string().trim().max(100).optional(),
    q: z.string().trim().max(100).optional(),
    name: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    page: numberParam.pipe(z.number().int().min(1)).optional().default(1),
    limit: numberParam.pipe(z.number().int().min(1).max(50)).optional().default(10),
    gender: z.string().trim().optional(),
    minAge: numberParam.pipe(z.number().int().min(18).max(100)).optional(),
    maxAge: numberParam.pipe(z.number().int().min(18).max(100)).optional(),
    onlineOnly: booleanParam.optional(),
    verifiedOnly: booleanParam.optional(),
    includeSwiped: booleanParam.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.minAge !== undefined && data.maxAge !== undefined && data.minAge > data.maxAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minAge'],
        message: 'minAge cannot be greater than maxAge',
      });
    }
  });

export const userSearchSchema = z.object({
  query: userSearchQuerySchema.optional(),
  body: userSearchQuerySchema.optional(),
});

export type UserSearchQueryInput = z.infer<typeof userSearchQuerySchema>;
