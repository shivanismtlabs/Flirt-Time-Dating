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
    fullName: z
      .string({ required_error: 'fullName is required' })
      .trim()
      .min(1, 'fullName cannot be empty')
      .max(100, 'fullName must not exceed 100 characters'),

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
    // More About Me fields
    drinking: z.string().trim().max(100).optional().nullable(),
    education: z.string().trim().max(100).optional().nullable(),
    height: z.string().trim().max(50).optional().nullable(),
    religion: z.string().trim().max(50).optional().nullable(),
    sexuality: z.string().trim().max(50).optional().nullable(),
    smoking: z.string().trim().max(50).optional().nullable(),
    weight: z.string().trim().max(50).optional().nullable(),
    eyeColor: z.string().trim().max(50).optional().nullable(),
    eyecolor: z.string().trim().max(50).optional().nullable(),
    hairColor: z.string().trim().max(50).optional().nullable(),
    haircolor: z.string().trim().max(50).optional().nullable(),
    living: z.string().trim().max(100).optional().nullable(),
    relationship: z.string().trim().max(50).optional().nullable(),
    coverPicture: z.string().trim().max(500).optional().nullable(),
    coverPhoto: z.string().trim().max(500).optional().nullable(),
    moreAboutMe: z.record(z.any()).optional().nullable(),
  }),
});

export const updateMoreAboutMeSchema = z.object({
  body: z.object({
    drinking: z.string().trim().max(100).optional().nullable(),
    education: z.string().trim().max(100).optional().nullable(),
    height: z.string().trim().max(50).optional().nullable(),
    religion: z.string().trim().max(50).optional().nullable(),
    sexuality: z.string().trim().max(50).optional().nullable(),
    smoking: z.string().trim().max(50).optional().nullable(),
    weight: z.string().trim().max(50).optional().nullable(),
    eyeColor: z.string().trim().max(50).optional().nullable(),
    eyecolor: z.string().trim().max(50).optional().nullable(),
    hairColor: z.string().trim().max(50).optional().nullable(),
    haircolor: z.string().trim().max(50).optional().nullable(),
    living: z.string().trim().max(100).optional().nullable(),
    relationship: z.string().trim().max(50).optional().nullable(),
    moreAboutMe: z.record(z.any()).optional().nullable(),
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

export const getOtherUserProfileSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID format'),
  }),
});

export const blockUserSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID format'),
  }),
  body: z
    .object({
      reason: z
        .string()
        .trim()
        .max(255, 'Reason must not exceed 255 characters')
        .optional()
        .nullable(),
    })
    .optional(),
});

export const reportReasons = [
  'fake_profile',
  'harassment',
  'inappropriate_content',
  'spam',
  'scam',
  'underage',
  'other',
] as const;

export const reportReasonEnum = z.enum(reportReasons, {
  errorMap: () => ({
    message:
      'Invalid report reason. Allowed values: fake_profile, harassment, inappropriate_content, spam, scam, underage, other',
  }),
});

export const reportUserSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID format'),
  }),
  body: z.object({
    reason: reportReasonEnum,
    description: z
      .string()
      .trim()
      .max(1000, 'Description must not exceed 1000 characters')
      .optional()
      .nullable(),
  }),
});

// Profile Email OTP Schemas
export const requestProfileEmailOtpSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'email is required' })
      .trim()
      .min(1, 'email cannot be empty')
      .email('Invalid email address format'),
  }),
});

export const verifyProfileEmailOtpSchema = z.object({
  body: z
    .object({
      verificationId: z.string().trim().optional(),
      email: z.string().trim().email('Invalid email address format').optional(),
      otp: z
        .string({ required_error: 'otp is required' })
        .regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
    })
    .refine((data) => data.verificationId || data.email, {
      message: 'Either verificationId or email must be provided',
      path: ['verificationId'],
    }),
});

export const resendProfileEmailOtpSchema = z.object({
  body: z
    .object({
      verificationId: z.string().trim().optional(),
      email: z.string().trim().email('Invalid email address format').optional(),
    })
    .refine((data) => data.verificationId || data.email, {
      message: 'Either verificationId or email must be provided',
      path: ['verificationId'],
    }),
});

// Profile Phone OTP Schemas
export const requestProfilePhoneOtpSchema = z.object({
  body: z.object({
    countryCode: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{0,3}$/, 'Invalid country code format (e.g. +91, +1)')
      .optional(),
    phone: z
      .string({ required_error: 'phone is required' })
      .trim()
      .min(1, 'phone cannot be empty')
      .refine(
        (val) => {
          const digits = val.replace(/\D/g, '');
          return digits.length >= 4 && digits.length <= 15;
        },
        {
          message: 'Invalid phone number format (must contain 4-15 digits)',
        }
      ),
  }),
});

export const verifyProfilePhoneOtpSchema = z.object({
  body: z
    .object({
      verificationId: z.string().trim().optional(),
      phone: z.string().trim().optional(),
      countryCode: z.string().trim().optional(),
      otp: z
        .string({ required_error: 'otp is required' })
        .regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
    })
    .refine((data) => data.verificationId || data.phone, {
      message: 'Either verificationId or phone must be provided',
      path: ['verificationId'],
    }),
});

export const resendProfilePhoneOtpSchema = z.object({
  body: z
    .object({
      verificationId: z.string().trim().optional(),
      phone: z.string().trim().optional(),
      countryCode: z.string().trim().optional(),
    })
    .refine((data) => data.verificationId || data.phone, {
      message: 'Either verificationId or phone must be provided',
      path: ['verificationId'],
    }),
});


