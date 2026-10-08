import { z } from 'zod';

export const dateOfBirthSchema = z
  .string({ required_error: 'dateOfBirth is required' })
  .trim()
  .min(1, 'dateOfBirth cannot be empty')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be in YYYY-MM-DD format')
  .superRefine((val, ctx) => {
    const [yearStr, monthStr, dayStr] = val.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);

    const dob = new Date(Date.UTC(year, month - 1, day));

    if (
      dob.getUTCFullYear() !== year ||
      dob.getUTCMonth() !== month - 1 ||
      dob.getUTCDate() !== day
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid calendar date for dateOfBirth',
      });
      return;
    }

    const today = new Date();
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    if (dob > todayUTC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date of birth cannot be in the future',
      });
      return;
    }

    let age = todayUTC.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = todayUTC.getUTCMonth() - dob.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && todayUTC.getUTCDate() < dob.getUTCDate())) {
      age--;
    }

    if (age < 18) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'User must be at least 18 years old',
      });
    }
  });

export const updateProfileSchema = z.object({
  body: z.object({
    firstName: z
      .string({ required_error: 'firstName is required' })
      .trim()
      .min(1, 'firstName cannot be empty')
      .max(50, 'firstName must not exceed 50 characters'),
    lastName: z
      .string({ required_error: 'lastName is required' })
      .trim()
      .min(1, 'lastName cannot be empty')
      .max(50, 'lastName must not exceed 50 characters'),
    nickName: z
      .string({ required_error: 'nickName is required' })
      .trim()
      .min(1, 'nickName cannot be empty')
      .max(50, 'nickName must not exceed 50 characters'),
    dateOfBirth: dateOfBirthSchema,
    gender: z
      .string({ required_error: 'gender is required' })
      .trim()
      .min(1, 'gender cannot be empty')
      .transform((val) => val.toLowerCase())
      .refine((val) => ['male', 'female', 'non-binary', 'other'].includes(val), {
        message: 'Invalid gender. Allowed values: male, female, non-binary, other',
      }),
    about: z
      .string()
      .trim()
      .max(500, 'About text must not exceed 500 characters')
      .optional()
      .nullable(),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(50).optional(),
    email: z.string().email().optional(),
    role: z.enum(['user', 'admin']).optional(),
    isActive: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
});

export const getUserByIdSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid user ID format'),
  }),
});
