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

export const coordinateSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .refine((val) => val === '' || !isNaN(Number(val)), {
        message: 'Coordinate must be a valid number',
      })
      .transform((val) => (val === '' ? null : Number(val))),
  ])
  .optional()
  .nullable();

export const locationInputSchema = z
  .union([
    z.string().trim().max(255),
    z.object({
      city: z.string().trim().max(100).optional().nullable(),
      state: z.string().trim().max(100).optional().nullable(),
      country: z.string().trim().max(100).optional().nullable(),
      county: z.string().trim().max(100).optional().nullable(),
      name: z.string().trim().max(255).optional().nullable(),
      label: z.string().trim().max(255).optional().nullable(),
      fullLocation: z.string().trim().max(255).optional().nullable(),
      formattedLocation: z.string().trim().max(255).optional().nullable(),
      address: z.string().trim().max(255).optional().nullable(),
      latitude: coordinateSchema,
      longitude: coordinateSchema,
      longitutute: coordinateSchema,
      lat: coordinateSchema,
      lng: coordinateSchema,
    }),
  ])
  .optional()
  .nullable();

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .trim()
      .min(1, 'fullName cannot be empty')
      .max(100, 'fullName must not exceed 100 characters')
      .optional(),
    firstName: z
      .string()
      .trim()
      .min(1, 'firstName cannot be empty')
      .max(50, 'firstName must not exceed 50 characters')
      .optional()
      .nullable(),
    lastName: z
      .string()
      .trim()
      .max(50, 'lastName must not exceed 50 characters')
      .optional()
      .nullable(),
    username: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters')
      .optional(),
    userName: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters')
      .optional(),
    user_name: z
      .string()
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters')
      .optional(),
    profile: z.record(z.any()).optional(),
    user: z.record(z.any()).optional(),
    nickName: z
      .string()
      .trim()
      .min(1, 'nickName cannot be empty')
      .max(50, 'nickName must not exceed 50 characters')
      .optional(),
    dateOfBirth: dateOfBirthSchema.optional(),
    location: locationInputSchema,
    city: z.string().trim().max(100).optional().nullable(),
    state: z.string().trim().max(100).optional().nullable(),
    country: z.string().trim().max(100).optional().nullable(),
    county: z.string().trim().max(100).optional().nullable(),
    latitude: coordinateSchema,
    longitude: coordinateSchema,
    longitutute: coordinateSchema,
    lat: coordinateSchema,
    lng: coordinateSchema,
    gender: z
      .string()
      .trim()
      .min(1, 'gender cannot be empty')
      .transform((val) => val.toLowerCase())
      .refine((val) => ['male', 'female', 'non-binary', 'other'].includes(val), {
        message: 'Invalid gender. Allowed values: male, female, non-binary, other',
      })
      .optional(),
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
    children: z.string().trim().max(100).optional().nullable(),
    coverPicture: z.string().trim().max(500).optional().nullable(),
    coverPhoto: z.string().trim().max(500).optional().nullable(),
    moreAboutMe: z.record(z.any()).optional().nullable(),
    notify_settings: z.record(z.any()).optional().nullable(),
    notificationSettings: z.record(z.any()).optional().nullable(),
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
    children: z.string().trim().max(100).optional().nullable(),
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
    conversationId: z
      .string()
      .uuid('Invalid conversation ID format')
      .optional()
      .nullable(),
    momentId: z
      .string()
      .uuid('Invalid moment ID format')
      .optional()
      .nullable(),
    targetType: z
      .enum(['user', 'moment', 'chat'])
      .optional()
      .nullable(),
  }),
});

export const getBlockedUsersSchema = z.object({
  query: z
    .object({
      page: z
        .string()
        .regex(/^\d+$/, 'Page must be a positive integer')
        .transform(Number)
        .optional()
        .default('1'),
      limit: z
        .string()
        .regex(/^\d+$/, 'Limit must be a positive integer')
        .transform(Number)
        .optional()
        .default('20'),
    })
    .optional(),
});

export const unblockUserSchema = z.object({
  params: z.object({
    userId: z.string().uuid('Invalid user ID format'),
  }),
});

export const getUserReportsSchema = z.object({
  query: z
    .object({
      page: z
        .string()
        .regex(/^\d+$/, 'Page must be a positive integer')
        .transform(Number)
        .optional()
        .default('1'),
      limit: z
        .string()
        .regex(/^\d+$/, 'Limit must be a positive integer')
        .transform(Number)
        .optional()
        .default('20'),
      status: z.enum(['pending', 'reviewed', 'dismissed', 'resolved']).optional(),
      targetType: z.enum(['user', 'moment']).optional(),
    })
    .optional(),
});

export const getAllReportsSchema = z.object({
  query: z
    .object({
      page: z
        .string()
        .regex(/^\d+$/, 'Page must be a positive integer')
        .transform(Number)
        .optional()
        .default('1'),
      limit: z
        .string()
        .regex(/^\d+$/, 'Limit must be a positive integer')
        .transform(Number)
        .optional()
        .default('20'),
      status: z.enum(['pending', 'reviewed', 'dismissed', 'resolved']).optional(),
      targetType: z.enum(['user', 'moment']).optional(),
      search: z.string().optional(),
    })
    .optional(),
});

export const updateReportStatusSchema = z.object({
  params: z.object({
    reportId: z.string().uuid('Invalid report ID format'),
  }),
  body: z.object({
    status: z.enum(['pending', 'reviewed', 'dismissed', 'resolved'], {
      errorMap: () => ({
        message: 'Invalid status. Allowed: pending, reviewed, dismissed, resolved',
      }),
    }),
    reviewNotes: z.string().trim().max(1000).optional().nullable(),
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
    recaptchaToken: z.string().trim().min(1).optional(),
    playIntegrityToken: z.string().trim().min(1).optional(),
    iosReceipt: z.string().trim().min(1).optional(),
    iosSecret: z.string().trim().min(1).optional(),
    iosBundleId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{1,200}$/, 'Invalid iOS bundle id')
      .optional(),
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
      recaptchaToken: z.string().trim().min(1).optional(),
      playIntegrityToken: z.string().trim().min(1).optional(),
      iosReceipt: z.string().trim().min(1).optional(),
      iosSecret: z.string().trim().min(1).optional(),
      iosBundleId: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{1,200}$/, 'Invalid iOS bundle id')
        .optional(),
    })
    .refine((data) => data.verificationId || data.phone, {
      message: 'Either verificationId or phone must be provided',
      path: ['verificationId'],
    }),
});

export const notifySettingsObjectSchema = z.object({
  new_message: z.boolean().optional(),
  new_messages: z.boolean().optional(),
  new_matches: z.boolean().optional(),
  likes_comments_calls: z.boolean().optional(),
  like_comments: z.boolean().optional(),
  profile_visit: z.boolean().optional(),
  profile_visits: z.boolean().optional(),
  dating_tips: z.boolean().optional(),
  new_tips_available: z.boolean().optional(),
  push: z.boolean().optional(),
  push_notifications: z.boolean().optional(),
  email: z.boolean().optional(),
  app_updates: z.boolean().optional(),
  promotions: z.boolean().optional(),
  discounts: z.boolean().optional(),
});

export const notificationSettingsSchema = z.object({
  body: z.object({
    notify_settings: notifySettingsObjectSchema.optional(),
    notificationSettings: notifySettingsObjectSchema.optional(),
    new_message: z.boolean().optional(),
    new_messages: z.boolean().optional(),
    new_matches: z.boolean().optional(),
    likes_comments_calls: z.boolean().optional(),
    like_comments: z.boolean().optional(),
    profile_visit: z.boolean().optional(),
    profile_visits: z.boolean().optional(),
    dating_tips: z.boolean().optional(),
    new_tips_available: z.boolean().optional(),
    push: z.boolean().optional(),
    push_notifications: z.boolean().optional(),
    email: z.boolean().optional(),
    app_updates: z.boolean().optional(),
    promotions: z.boolean().optional(),
    discounts: z.boolean().optional(),
  }),
});



