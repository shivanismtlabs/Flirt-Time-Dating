import { z } from 'zod';

export const verifySubscriptionPurchaseSchema = z
  .object({
    platform: z.enum(['ios', 'android'], {
      required_error: 'platform is required ("ios" or "android")',
    }),
    planId: z.coerce.number().int().positive().optional(),
    productId: z.string().trim().min(1).optional(),
    // iOS Proof fields
    transactionId: z.string().trim().optional(),
    signedTransactionInfo: z.string().trim().optional(),
    signedRenewalInfo: z.string().trim().optional(),
    receiptData: z.string().trim().optional(),
    // Android Proof fields
    purchaseToken: z.string().trim().optional(),
    orderId: z.string().trim().optional(),
    packageName: z.string().trim().optional(),
  })
  .refine((data) => data.planId !== undefined || data.productId !== undefined, {
    message: 'Either planId or productId is required to identify the subscription plan',
    path: ['productId'],
  })
  .refine(
    (data) => {
      if (data.platform === 'ios') {
        return !!(data.signedTransactionInfo || data.transactionId || data.receiptData);
      }
      return true;
    },
    {
      message: 'iOS purchase requires signedTransactionInfo, transactionId, or receiptData',
      path: ['signedTransactionInfo'],
    }
  )
  .refine(
    (data) => {
      if (data.platform === 'android') {
        return !!data.purchaseToken;
      }
      return true;
    },
    {
      message: 'Android purchase requires purchaseToken',
      path: ['purchaseToken'],
    }
  );

export type VerifySubscriptionPurchaseInput = z.infer<typeof verifySubscriptionPurchaseSchema>;

export const subscriptionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type SubscriptionHistoryQuery = z.infer<typeof subscriptionHistoryQuerySchema>;

export const restorePurchasesSchema = z.object({
  platform: z.enum(['ios', 'android']),
  receiptData: z.string().optional(),
  transactionIds: z.array(z.string()).optional(),
  purchaseTokens: z
    .array(
      z.object({
        productId: z.string(),
        purchaseToken: z.string(),
      })
    )
    .optional(),
});

export type RestorePurchasesInput = z.infer<typeof restorePurchasesSchema>;
