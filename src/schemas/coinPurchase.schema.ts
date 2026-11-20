import { z } from 'zod';

export const verifyCoinPurchaseSchema = z.object({
  body: z
    .object({
      platform: z.enum(['ios', 'android'], {
        required_error: 'platform is required ("ios" or "android")',
      }),
      packageId: z.number().int().positive().optional(),
      productId: z.string().trim().min(1).optional(),
      // Apple StoreKit Proof
      transactionId: z.string().trim().min(1).optional(),
      signedTransactionInfo: z.string().trim().min(1).optional(),
      receiptData: z.string().trim().min(1).optional(),
      // Google Play Proof
      purchaseToken: z.string().trim().min(1).optional(),
      orderId: z.string().trim().min(1).optional(),
      packageName: z.string().trim().min(1).optional(),
      // App state
      isForeground: z.boolean().optional(),
      is_foreground: z.boolean().optional(),
    })
    .superRefine((val, ctx) => {
      // Must identify the intended package
      if (!val.packageId && !val.productId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Either packageId or productId is required to identify the coin package',
          path: ['packageId'],
        });
      }

      // iOS verification requires transactionId or signedTransactionInfo or receiptData
      if (val.platform === 'ios' && !val.transactionId && !val.signedTransactionInfo && !val.receiptData) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'iOS purchase verification requires signedTransactionInfo or transactionId',
          path: ['transactionId'],
        });
      }

      // Android verification requires purchaseToken
      if (val.platform === 'android' && !val.purchaseToken) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Google Play purchase verification requires purchaseToken',
          path: ['purchaseToken'],
        });
      }
    }),
});

export type VerifyCoinPurchaseBody = z.infer<typeof verifyCoinPurchaseSchema>['body'];

export const getPurchaseHistorySchema = z.object({
  query: z.object({
    page: z
      .string()
      .regex(/^\d+$/, 'page must be a positive integer')
      .transform(Number)
      .optional(),
    limit: z
      .string()
      .regex(/^\d+$/, 'limit must be a positive integer')
      .transform(Number)
      .optional(),
  }),
});

export type GetPurchaseHistoryQuery = z.infer<typeof getPurchaseHistorySchema>['query'];
