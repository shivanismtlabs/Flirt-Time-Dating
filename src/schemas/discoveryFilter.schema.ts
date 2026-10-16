import { z } from 'zod';

export const ALLOWED_GENDERS = [
  'women',
  'woman',
  'men',
  'man',
  'non_binary',
  'non-binary',
  'everyone',
  'all',
] as const;

export const ALLOWED_LOOKING_FOR = [
  'long_term',
  'relationship',
  'casual',
  'something_casual',
  'not_sure',
  'figuring_out',
  'we_ll_see',
] as const;

/**
 * Normalizes gender value to canonical representation
 */
export const normalizeGender = (val: string): string => {
  const lower = val.toLowerCase().trim();
  if (lower === 'woman' || lower === 'women') return 'women';
  if (lower === 'man' || lower === 'men') return 'men';
  if (lower === 'non-binary' || lower === 'non_binary') return 'non_binary';
  if (lower === 'all' || lower === 'everyone') return 'everyone';
  return lower;
};

/**
 * Normalizes lookingFor value to canonical representation
 */
export const normalizeLookingFor = (val: string): string => {
  const lower = val.toLowerCase().trim();
  if (lower === 'relationship' || lower === 'long_term') return 'long_term';
  if (lower === 'something_casual' || lower === 'casual') return 'casual';
  if (lower === 'figuring_out' || lower === 'we_ll_see' || lower === 'not_sure') return 'not_sure';
  return lower;
};

export const updateDiscoveryFiltersBodySchema = z
  .object({
    genders: z
      .array(
        z.enum(ALLOWED_GENDERS, {
          invalid_type_error: `Invalid gender. Allowed: Women, Men, Non-binary, Everyone`,
        })
      )
      .max(4, 'Cannot select more than 4 gender options')
      .transform((arr) => Array.from(new Set(arr.map(normalizeGender))))
      .optional(),
    ageMin: z
      .number({ invalid_type_error: 'ageMin must be a number' })
      .int('ageMin must be an integer')
      .min(18, 'Minimum age must be at least 18')
      .max(100, 'Minimum age must be at most 100')
      .optional(),
    ageMax: z
      .number({ invalid_type_error: 'ageMax must be a number' })
      .int('ageMax must be an integer')
      .min(18, 'Maximum age must be at least 18')
      .max(100, 'Maximum age must be at most 100')
      .optional(),
    maxDistanceKm: z
      .number({ invalid_type_error: 'maxDistanceKm must be a number or null' })
      .int('maxDistanceKm must be an integer')
      .min(1, 'maxDistanceKm must be at least 1 km')
      .max(500, 'maxDistanceKm cannot exceed 500 km')
      .nullable()
      .optional(),
    lookingFor: z
      .array(
        z.enum(ALLOWED_LOOKING_FOR, {
          invalid_type_error:
            'Invalid lookingFor option. Allowed: long_term, casual, not_sure',
        })
      )
      .transform((arr) => Array.from(new Set(arr.map(normalizeLookingFor))))
      .optional(),
    interestIds: z
      .array(z.string().uuid('Each interestId must be a valid UUID'))
      .transform((arr) => Array.from(new Set(arr)))
      .optional(),
    verifiedOnly: z.boolean({ invalid_type_error: 'verifiedOnly must be a boolean' }).optional(),
    onlineOnly: z.boolean({ invalid_type_error: 'onlineOnly must be a boolean' }).optional(),
  })
  .strict('Unknown fields are not allowed in filters update')
  .superRefine((data, ctx) => {
    if (data.ageMin !== undefined && data.ageMax !== undefined) {
      if (data.ageMin > data.ageMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ageMin'],
          message: 'ageMin cannot be greater than ageMax',
        });
      }
    }
  });

export const updateDiscoveryFiltersSchema = z.object({
  body: updateDiscoveryFiltersBodySchema,
});

export const discoverySearchBodySchema = z
  .object({
    genders: z
      .array(z.enum(ALLOWED_GENDERS))
      .transform((arr) => Array.from(new Set(arr.map(normalizeGender))))
      .optional(),
    ageMin: z
      .number()
      .int()
      .min(18, 'Minimum age must be at least 18')
      .max(100, 'Minimum age must be at most 100')
      .optional(),
    ageMax: z
      .number()
      .int()
      .min(18, 'Maximum age must be at least 18')
      .max(100, 'Maximum age must be at most 100')
      .optional(),
    maxDistanceKm: z.number().int().min(1).max(500).nullable().optional(),
    lookingFor: z
      .array(z.enum(ALLOWED_LOOKING_FOR))
      .transform((arr) => Array.from(new Set(arr.map(normalizeLookingFor))))
      .optional(),
    interestIds: z
      .array(z.string().uuid('Each interestId must be a valid UUID'))
      .transform((arr) => Array.from(new Set(arr)))
      .optional(),
    verifiedOnly: z.boolean().optional(),
    onlineOnly: z.boolean().optional(),
    query: z.string().trim().optional(),
    search: z.string().trim().optional(),
    q: z.string().trim().optional(),
    name: z.string().trim().optional(),
    city: z.string().trim().optional(),
    page: z.number().int().min(1).optional().default(1),
    limit: z.number().int().min(1).max(50).optional().default(20),
    cursor: z.string().optional(),
    countOnly: z.boolean().optional().default(false),
  })
  .strict('Unknown fields are not allowed in search body')
  .superRefine((data, ctx) => {
    if (data.ageMin !== undefined && data.ageMax !== undefined) {
      if (data.ageMin > data.ageMax) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ageMin'],
          message: 'ageMin cannot be greater than ageMax',
        });
      }
    }
  });

export const discoverySearchSchema = z.object({
  body: discoverySearchBodySchema.optional(),
  query: z
    .object({
      query: z.string().trim().optional(),
      search: z.string().trim().optional(),
      q: z.string().trim().optional(),
      name: z.string().trim().optional(),
      city: z.string().trim().optional(),
      page: z
        .string()
        .regex(/^\d+$/, 'page must be a positive integer')
        .transform((val) => parseInt(val, 10))
        .optional(),
      limit: z
        .string()
        .regex(/^\d+$/, 'limit must be a positive integer')
        .transform((val) => parseInt(val, 10))
        .optional(),
      countOnly: z
        .string()
        .transform((val) => val === 'true' || val === '1')
        .optional(),
    })
    .optional(),
});
