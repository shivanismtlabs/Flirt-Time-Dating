import { z } from 'zod';

export const sortFields = ['sort_order', 'price', 'coins', 'id', 'name'] as const;
export const sortOrders = ['asc', 'desc', 'ASC', 'DESC'] as const;

export const getCoinPackagesSchema = z.object({
  query: z
    .object({
      page: z
        .string()
        .optional()
        .refine((val) => val === undefined || (/^\d+$/.test(val.trim()) && parseInt(val, 10) >= 1), {
          message: 'page must be an integer greater than or equal to 1',
        })
        .transform((val) => (val !== undefined ? parseInt(val, 10) : 1)),

      limit: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (val === undefined) return true;
            if (!/^\d+$/.test(val.trim())) return false;
            const num = parseInt(val, 10);
            return num >= 1 && num <= 50;
          },
          {
            message: 'limit must be an integer between 1 and 50',
          }
        )
        .transform((val) => (val !== undefined ? parseInt(val, 10) : 10)),

      sortBy: z
        .string()
        .optional()
        .refine(
          (val) =>
            val === undefined ||
            sortFields.includes(val.toLowerCase() as (typeof sortFields)[number]),
          {
            message: `Invalid sortBy field. Allowed: ${sortFields.join(', ')}`,
          }
        )
        .transform((val) => (val ? (val.toLowerCase() as (typeof sortFields)[number]) : 'sort_order')),

      sortOrder: z
        .string()
        .optional()
        .refine(
          (val) =>
            val === undefined ||
            sortOrders.includes(val as (typeof sortOrders)[number]),
          {
            message: 'Invalid sortOrder direction. Allowed: asc, desc',
          }
        )
        .transform((val) => (val ? (val.toUpperCase() as 'ASC' | 'DESC') : 'ASC')),

      minPrice: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (val === undefined) return true;
            const trimmed = val.trim();
            if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
            const n = parseFloat(trimmed);
            return !isNaN(n) && n >= 0;
          },
          {
            message: 'minPrice must be a non-negative number',
          }
        )
        .transform((val) => (val !== undefined ? parseFloat(val) : undefined)),

      maxPrice: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (val === undefined) return true;
            const trimmed = val.trim();
            if (!/^\d+(\.\d+)?$/.test(trimmed)) return false;
            const n = parseFloat(trimmed);
            return !isNaN(n) && n >= 0;
          },
          {
            message: 'maxPrice must be a non-negative number',
          }
        )
        .transform((val) => (val !== undefined ? parseFloat(val) : undefined)),

      minCoins: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (val === undefined) return true;
            const trimmed = val.trim();
            if (!/^\d+$/.test(trimmed)) return false;
            const n = parseInt(trimmed, 10);
            return !isNaN(n) && n >= 0;
          },
          {
            message: 'minCoins must be a non-negative integer',
          }
        )
        .transform((val) => (val !== undefined ? parseInt(val, 10) : undefined)),

      maxCoins: z
        .string()
        .optional()
        .refine(
          (val) => {
            if (val === undefined) return true;
            const trimmed = val.trim();
            if (!/^\d+$/.test(trimmed)) return false;
            const n = parseInt(trimmed, 10);
            return !isNaN(n) && n >= 0;
          },
          {
            message: 'maxCoins must be a non-negative integer',
          }
        )
        .transform((val) => (val !== undefined ? parseInt(val, 10) : undefined)),
    })
    .refine(
      (data) => {
        if (data.minPrice !== undefined && data.maxPrice !== undefined) {
          return data.minPrice <= data.maxPrice;
        }
        return true;
      },
      {
        message: 'minPrice cannot be greater than maxPrice',
        path: ['minPrice'],
      }
    )
    .refine(
      (data) => {
        if (data.minCoins !== undefined && data.maxCoins !== undefined) {
          return data.minCoins <= data.maxCoins;
        }
        return true;
      },
      {
        message: 'minCoins cannot be greater than maxCoins',
        path: ['minCoins'],
      }
    ),
});

export type GetCoinPackagesQuery = z.infer<typeof getCoinPackagesSchema>['query'];
