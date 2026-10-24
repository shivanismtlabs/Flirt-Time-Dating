import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    username: z
      .string()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters'),
    email: z.string().email('Invalid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role: z.enum(['user', 'admin']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
  }),
});

export const requestPhoneOtpSchema = z.object({
  body: z.object({
    countryCode: z
      .string({ required_error: 'countryCode is required' })
      .regex(/^\+?[1-9]\d{0,3}$/, 'Invalid country code format (e.g. +91, +1)'),
    phone: z
      .string({ required_error: 'phone is required' })
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

export const requestEmailOtpSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'email is required' })
      .trim()
      .min(1, 'email cannot be empty')
      .email('Invalid email address format'),
  }),
});

export const verifyPhoneOtpSchema = z.object({
  body: z.object({
    verificationId: z
      .string({ required_error: 'verificationId is required' })
      .min(1, 'verificationId cannot be empty'),
    otp: z
      .string({ required_error: 'otp is required' })
      .regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
  }),
});

export const resendPhoneOtpSchema = z.object({
  body: z.object({
    verificationId: z
      .string({ required_error: 'verificationId is required' })
      .min(1, 'verificationId cannot be empty'),
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

export const verifyEmailOtpSchema = z.object({
  body: z.object({
    verificationId: z
      .string({ required_error: 'verificationId is required' })
      .min(1, 'verificationId cannot be empty'),
    otp: z
      .string({ required_error: 'otp is required' })
      .regex(/^\d{6}$/, 'OTP must be exactly 6 numeric digits'),
  }),
});

export const resendEmailOtpSchema = z.object({
  body: z.object({
    verificationId: z
      .string({ required_error: 'verificationId is required' })
      .min(1, 'verificationId cannot be empty'),
  }),
});

export const appleAuthSchema = z.object({
  body: z.object({
    identityToken: z
      .string({ required_error: 'identityToken is required' })
      .trim()
      .min(1, 'identityToken cannot be empty'),
    authorizationCode: z.string().optional(),
    nonce: z.string().optional(),
    user: z
      .object({
        name: z
          .object({
            firstName: z.string().optional(),
            lastName: z.string().optional(),
          })
          .optional(),
        email: z.string().optional(),
      })
      .optional(),
  }),
});

export const firebaseAuthSchema = z.object({
  body: z.object({
    idToken: z
      .string({ required_error: 'idToken is required' })
      .trim()
      .min(1, 'idToken cannot be empty'),
  }),
});

export const deleteAccountSchema = z.object({
  body: z
    .object({
      reason: z.string().trim().max(500, 'Reason cannot exceed 500 characters').optional(),
      feedback: z.string().trim().max(1000, 'Feedback cannot exceed 1000 characters').optional(),
    })
    .optional(),
});

export const checkUsernameAvailabilitySchema = z.object({
  query: z.object({
    username: z
      .string({ required_error: 'username is required' })
      .trim()
      .min(3, 'Username must be at least 3 characters')
      .max(50, 'Username must not exceed 50 characters'),
  }),
});

export const logoutSchema = z.object({
  body: z
    .object({
      deviceToken: z.string().trim().optional(),
      fcmToken: z.string().trim().optional(),
      allDevices: z.boolean().optional(),
    })
    .optional()
    .default({}),
});

export type LogoutInput = z.infer<typeof logoutSchema>;



