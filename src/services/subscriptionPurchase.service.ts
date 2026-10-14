import { Op } from 'sequelize';
import {
  sequelize,
  User,
  SubscriptionPlan,
  SubscriptionFeature,
  UserSubscription,
  SubscriptionEventLog,
  CoinTransaction,
} from '../models';
import { iapService, IAPServiceError, VerifiedSubscriptionDetails } from './iap.service';
import {
  VerifySubscriptionPurchaseInput,
  SubscriptionHistoryQuery,
  RestorePurchasesInput,
} from '../schemas/subscriptionPurchase.schema';

export class SubscriptionPurchaseServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'SubscriptionPurchaseServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, SubscriptionPurchaseServiceError.prototype);
  }
}

export class SubscriptionPurchaseService {
  /**
   * Resolves a subscription plan from database by planId or store productId
   */
  public async resolvePlan(planId?: number, productId?: string): Promise<SubscriptionPlan> {
    let plan: SubscriptionPlan | null = null;

    if (planId) {
      plan = await SubscriptionPlan.findByPk(planId, {
        include: [
          {
            model: SubscriptionFeature,
            as: 'features',
            through: { attributes: ['sort_order'] },
            required: false,
          },
        ],
      });
    } else if (productId) {
      plan = await SubscriptionPlan.findOne({
        where: {
          [Op.or]: [
            { google_product_id: productId },
            { apple_product_id: productId },
            { id: isNaN(Number(productId)) ? -1 : Number(productId) },
          ],
        },
        include: [
          {
            model: SubscriptionFeature,
            as: 'features',
            through: { attributes: ['sort_order'] },
            required: false,
          },
        ],
      });
    }

    if (!plan) {
      throw new SubscriptionPurchaseServiceError('Requested subscription plan does not exist', 404, 'PLAN_NOT_FOUND');
    }

    if (!plan.is_active) {
      throw new SubscriptionPurchaseServiceError(
        'Requested subscription plan is inactive and unavailable for purchase',
        400,
        'PLAN_INACTIVE'
      );
    }

    return plan;
  }

  /**
   * Verifies an in-app subscription purchase from Apple App Store or Google Play,
   * performs strict store verification, grants entitlements, awards bonus coins once,
   * and persists subscription state atomically.
   */
  public async verifyAndProcessSubscription(
    userId: string,
    input: VerifySubscriptionPurchaseInput
  ): Promise<{
    alreadyProcessed: boolean;
    subscription: UserSubscription;
    plan: SubscriptionPlan;
    isEntitled: boolean;
    currentBalance: number;
    bonusCoinsCredited: number;
  }> {
    const { platform, planId, productId } = input;

    if (!platform || (platform !== 'ios' && platform !== 'android')) {
      throw new SubscriptionPurchaseServiceError('Invalid platform. Supported platforms: "ios", "android"', 400, 'INVALID_PLATFORM');
    }

    // 1. Resolve active SubscriptionPlan from DB
    const plan = await this.resolvePlan(planId, productId);

    // 2. Early Idempotency Fast Check
    const fastTxId = platform === 'ios' ? input.transactionId : input.orderId || input.purchaseToken;
    if (fastTxId) {
      const existingFast = await UserSubscription.findOne({
        where: {
          [Op.or]: [
            { storeTransactionId: fastTxId },
            ...(input.purchaseToken ? [{ purchaseToken: input.purchaseToken }] : []),
          ],
        },
        include: [{ model: SubscriptionPlan, as: 'plan' }],
      });

      if (existingFast && existingFast.userId === userId) {
        const currentUser = await User.findByPk(userId);
        return {
          alreadyProcessed: true,
          subscription: existingFast,
          plan: existingFast.plan || plan,
          isEntitled: existingFast.isEntitled,
          currentBalance: typeof currentUser?.coins === 'number' ? currentUser.coins : 500,
          bonusCoinsCredited: 0,
        };
      }
    }

    // 3. Independent Store Verification
    let storeDetails: VerifiedSubscriptionDetails;
    try {
      if (platform === 'ios') {
        const expectedStoreProductId = plan.apple_product_id || plan.google_product_id || String(plan.id);
        storeDetails = await iapService.verifyAppleSubscription({
          transactionId: input.transactionId,
          signedTransactionInfo: input.signedTransactionInfo,
          signedRenewalInfo: input.signedRenewalInfo,
          receiptData: input.receiptData,
          expectedProductId: expectedStoreProductId,
        });

        // Validate product ID match
        const verifiedProduct = storeDetails.productId;
        const matchesApple = plan.apple_product_id && plan.apple_product_id === verifiedProduct;
        const matchesGoogle = plan.google_product_id && plan.google_product_id === verifiedProduct;
        const matchesId = String(plan.id) === verifiedProduct;

        if (!matchesApple && !matchesGoogle && !matchesId) {
          throw new SubscriptionPurchaseServiceError(
            `Purchased store product (${verifiedProduct}) does not match plan (${plan.apple_product_id || plan.name})`,
            400,
            'PRODUCT_MISMATCH'
          );
        }
      } else {
        const expectedStoreProductId = plan.google_product_id || plan.apple_product_id || String(plan.id);
        storeDetails = await iapService.verifyGoogleSubscription({
          productId: input.productId || expectedStoreProductId,
          purchaseToken: input.purchaseToken!,
          packageName: input.packageName,
          orderId: input.orderId,
        });

        // Validate product ID match
        const verifiedProduct = storeDetails.productId;
        const matchesGoogle = plan.google_product_id && plan.google_product_id === verifiedProduct;
        const matchesApple = plan.apple_product_id && plan.apple_product_id === verifiedProduct;
        const matchesId = String(plan.id) === verifiedProduct;

        if (!matchesGoogle && !matchesApple && !matchesId) {
          throw new SubscriptionPurchaseServiceError(
            `Purchased store product (${verifiedProduct}) does not match plan (${plan.google_product_id || plan.name})`,
            400,
            'PRODUCT_MISMATCH'
          );
        }
      }
    } catch (verifyErr: any) {
      if (verifyErr instanceof IAPServiceError || verifyErr instanceof SubscriptionPurchaseServiceError) {
        throw verifyErr;
      }
      throw new SubscriptionPurchaseServiceError(
        'Store subscription verification failed: ' + (verifyErr?.message || 'Unknown store error'),
        400,
        'STORE_VERIFICATION_FAILED'
      );
    }

    // 4. Reject revoked transactions
    if (storeDetails.status === 'revoked') {
      throw new SubscriptionPurchaseServiceError('Subscription was revoked or refunded by the App Store', 400, 'SUBSCRIPTION_REVOKED');
    }

    // 5. In an Atomic Database Transaction, persist subscription, grant entitlements, and award bonus coins
    const isPostgres = sequelize.getDialect() === 'postgres';
    let txResult: {
      alreadyProcessed: boolean;
      subscription: UserSubscription;
      currentBalance: number;
      bonusCoinsCredited: number;
    };

    try {
      txResult = await sequelize.transaction(async (t) => {
        // Re-check unique store transaction inside row lock
        const duplicateInTx = await UserSubscription.findOne({
          where: {
            [Op.or]: [
              { storeTransactionId: storeDetails.storeTransactionId },
              ...(storeDetails.purchaseToken ? [{ purchaseToken: storeDetails.purchaseToken }] : []),
            ],
          },
          transaction: t,
          lock: isPostgres ? t.LOCK.UPDATE : undefined,
        });

        if (duplicateInTx) {
          const userNow = await User.findByPk(userId, { transaction: t });
          return {
            alreadyProcessed: true,
            subscription: duplicateInTx,
            currentBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
            bonusCoinsCredited: 0,
          };
        }

        // Fetch authenticated user with row lock to serialize balance & status updates
        const user = await User.findByPk(userId, {
          transaction: t,
          lock: isPostgres ? t.LOCK.UPDATE : undefined,
        });

        if (!user) {
          throw new SubscriptionPurchaseServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
        }

        const bonusCoinsToCredit = Number(plan.bonus_coins || 0);
        let balanceBefore = typeof user.coins === 'number' ? user.coins : 500;
        let balanceAfter = balanceBefore;
        let awardedBonus = 0;

        // Create subscription record
        const subscription = await UserSubscription.create(
          {
            userId: user.id,
            planId: plan.id,
            platform: storeDetails.platform,
            productId: storeDetails.productId,
            storeTransactionId: storeDetails.storeTransactionId,
            originalTransactionId: storeDetails.originalTransactionId,
            purchaseToken: storeDetails.purchaseToken || null,
            status: storeDetails.status,
            isEntitled: storeDetails.isEntitled,
            startsAt: storeDetails.purchaseDate,
            expiresAt: storeDetails.expiresDate,
            gracePeriodExpiresAt: storeDetails.gracePeriodExpiresDate || null,
            autoRenewing: storeDetails.autoRenewing,
            cancelReason: storeDetails.cancelReason || null,
            price: plan.getDataValue('price'),
            currency: plan.currency || 'USD',
            environment: storeDetails.environment,
            acknowledged: storeDetails.isAcknowledged,
            acknowledgedAt: storeDetails.isAcknowledged ? new Date() : null,
            bonusCoinsCredited: bonusCoinsToCredit > 0,
            bonusCoinsAmount: bonusCoinsToCredit,
            rawVerificationData: storeDetails.rawResponse || null,
          },
          { transaction: t }
        );

        // Credit bonus coins only once per eligible subscription purchase
        if (bonusCoinsToCredit > 0) {
          balanceAfter = balanceBefore + bonusCoinsToCredit;
          awardedBonus = bonusCoinsToCredit;

          await CoinTransaction.create(
            {
              userId: user.id,
              type: 'purchase',
              amount: bonusCoinsToCredit,
              balanceBefore: balanceBefore,
              balanceAfter: balanceAfter,
              referenceId: subscription.id,
              referenceType: 'subscription_bonus',
              description: `Bonus coins for subscribing to ${plan.name} (${bonusCoinsToCredit} coins)`,
            },
            { transaction: t }
          );

          user.coins = balanceAfter;
        }

        // Update user subscription entitlement fields
        user.isSubscribed = storeDetails.isEntitled;
        user.subscriptionExpiresAt = storeDetails.expiresDate;
        user.activeSubscriptionPlanId = plan.id;
        await user.save({ transaction: t });

        return {
          alreadyProcessed: false,
          subscription,
          currentBalance: balanceAfter,
          bonusCoinsCredited: awardedBonus,
        };
      });
    } catch (txErr: any) {
      // Gracefully handle concurrency race collisions on unique index
      const isLockOrUniqueError =
        txErr?.name === 'SequelizeUniqueConstraintError' ||
        txErr?.name === 'UniqueConstraintError' ||
        txErr?.message?.includes('unique') ||
        txErr?.message?.includes('UNIQUE') ||
        txErr?.message?.includes('SQLITE_BUSY') ||
        txErr?.message?.includes('database is locked') ||
        txErr?.message?.includes('deadlock') ||
        txErr?.message?.includes('could not serialize');

      if (isLockOrUniqueError) {
        await new Promise((resolve) => setTimeout(resolve, 80));

        const existingAfterRace = await UserSubscription.findOne({
          where: {
            [Op.or]: [
              { storeTransactionId: storeDetails.storeTransactionId },
              ...(storeDetails.purchaseToken ? [{ purchaseToken: storeDetails.purchaseToken }] : []),
            ],
          },
          include: [{ model: SubscriptionPlan, as: 'plan' }],
        });

        if (existingAfterRace) {
          const userNow = await User.findByPk(userId);
          txResult = {
            alreadyProcessed: true,
            subscription: existingAfterRace,
            currentBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
            bonusCoinsCredited: 0,
          };
        } else {
          throw txErr;
        }
      } else {
        throw txErr;
      }
    }

    return {
      alreadyProcessed: txResult.alreadyProcessed,
      subscription: txResult.subscription,
      plan,
      isEntitled: txResult.subscription.isEntitled,
      currentBalance: txResult.currentBalance,
      bonusCoinsCredited: txResult.bonusCoinsCredited,
    };
  }

  /**
   * Returns current subscription and entitlement status for the authenticated user
   */
  public async getMySubscription(userId: string): Promise<{
    isSubscribed: boolean;
    subscription: any | null;
    plan: any | null;
    features: any[];
    expiresAt: Date | null;
    autoRenewing: boolean;
  }> {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new SubscriptionPurchaseServiceError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Find the latest subscription record for this user
    const sub = await UserSubscription.findOne({
      where: { userId },
      order: [['created_at', 'DESC']],
      include: [
        {
          model: SubscriptionPlan,
          as: 'plan',
          include: [
            {
              model: SubscriptionFeature,
              as: 'features',
              through: { attributes: ['sort_order'] },
              required: false,
            },
          ],
        },
      ],
    });

    if (!sub) {
      return {
        isSubscribed: false,
        subscription: null,
        plan: null,
        features: [],
        expiresAt: null,
        autoRenewing: false,
      };
    }

    const now = new Date();
    const hasNotExpired = new Date(sub.expiresAt) > now;
    const isEntitledNow = sub.isEntitled && (hasNotExpired || sub.status === 'in_grace_period');

    // Reconcile user flag if expired
    if (!isEntitledNow && user.isSubscribed) {
      user.isSubscribed = false;
      await user.save();
      await sub.update({ isEntitled: false, status: 'expired' });
    }

    const plan = sub.plan;
    const features = plan?.features ? (plan.features as any[]).map((f) => ({
      id: f.id,
      text: f.text,
      image: f.image,
      sort_order: f.PlanFeature?.sort_order ?? f.sort_order ?? 0,
    })) : [];

    return {
      isSubscribed: isEntitledNow,
      subscription: {
        id: sub.id,
        platform: sub.platform,
        productId: sub.productId,
        status: isEntitledNow ? sub.status : 'expired',
        startsAt: sub.startsAt,
        expiresAt: sub.expiresAt,
        autoRenewing: sub.autoRenewing,
        cancelReason: sub.cancelReason,
        acknowledged: sub.acknowledged,
      },
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            price: plan.price,
            duration_days: plan.duration_days,
            billing_cycle: plan.billing_cycle,
          }
        : null,
      features,
      expiresAt: sub.expiresAt,
      autoRenewing: sub.autoRenewing,
    };
  }

  /**
   * Retrieves paginated subscription history for the authenticated user
   */
  public async getSubscriptionHistory(
    userId: string,
    query: SubscriptionHistoryQuery
  ): Promise<{
    subscriptions: any[];
    pagination: {
      currentPage: number;
      totalPages: number;
      totalSubscriptions: number;
      limit: number;
    };
  }> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(50, Number(query.limit || 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await UserSubscription.findAndCountAll({
      where: { userId },
      include: [{ model: SubscriptionPlan, as: 'plan' }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const subscriptions = rows.map((sub) => ({
      id: sub.id,
      platform: sub.platform,
      productId: sub.productId,
      status: sub.status,
      isEntitled: sub.isEntitled,
      startsAt: sub.startsAt,
      expiresAt: sub.expiresAt,
      autoRenewing: sub.autoRenewing,
      price: sub.price,
      currency: sub.currency,
      bonusCoinsAmount: sub.bonusCoinsAmount,
      plan: sub.plan
        ? {
            id: sub.plan.id,
            name: sub.plan.name,
          }
        : null,
      createdAt: sub.createdAt,
    }));

    return {
      subscriptions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(count / limit) || 1,
        totalSubscriptions: count,
        limit,
      },
    };
  }

  /**
   * Handles Apple App Store Server Notifications V2
   */
  public async handleAppleNotification(signedPayload: string): Promise<{ success: boolean; eventType: string }> {
    if (!signedPayload) {
      throw new SubscriptionPurchaseServiceError('Missing signedPayload in Apple notification', 400, 'MISSING_PAYLOAD');
    }

    const decoded = iapService.decodeAndVerifyAppleJWS(signedPayload);
    const notificationUUID = decoded.notificationUUID || `apple_${Date.now()}`;
    const notificationType = decoded.notificationType || 'UNKNOWN';
    const subtype = decoded.subtype || null;

    // 1. Deduplicate in SubscriptionEventLog
    const existingLog = await SubscriptionEventLog.findOne({ where: { eventId: notificationUUID } });
    if (existingLog) {
      return { success: true, eventType: notificationType };
    }

    const eventLog = await SubscriptionEventLog.create({
      platform: 'ios',
      eventId: notificationUUID,
      eventType: notificationType,
      subtype,
      eventTimestamp: new Date(decoded.data?.signedDate || Date.now()),
      rawPayload: decoded,
      processed: false,
    });

    // 2. Decode inner transaction info if available
    const transactionInfo = decoded.data?.signedTransactionInfo
      ? iapService.decodeAndVerifyAppleJWS(decoded.data.signedTransactionInfo)
      : null;

    if (transactionInfo) {
      const origTxId = String(transactionInfo.originalTransactionId || transactionInfo.transactionId);
      const sub = await UserSubscription.findOne({
        where: {
          [Op.or]: [{ originalTransactionId: origTxId }, { storeTransactionId: origTxId }],
        },
      });

      if (sub) {
        let isEntitled = true;
        let newStatus = sub.status;

        if (notificationType === 'EXPIRED') {
          newStatus = 'expired';
          isEntitled = false;
        } else if (notificationType === 'DID_RENEW') {
          newStatus = 'active';
          isEntitled = true;
          if (transactionInfo.expiresDate) {
            sub.expiresAt = new Date(Number(transactionInfo.expiresDate) || transactionInfo.expiresDate);
          }
        } else if (notificationType === 'DID_CHANGE_RENEWAL_STATUS') {
          if (subtype === 'AUTO_RENEW_DISABLED') {
            sub.autoRenewing = false;
            newStatus = 'canceled';
            // Canceled remains entitled until expiresAt!
            isEntitled = new Date(sub.expiresAt) > new Date();
          } else if (subtype === 'AUTO_RENEW_ENABLED') {
            sub.autoRenewing = true;
            newStatus = 'active';
            isEntitled = true;
          }
        } else if (notificationType === 'REVOKE' || notificationType === 'REFUND') {
          newStatus = 'revoked';
          isEntitled = false;
        }

        sub.status = newStatus;
        sub.isEntitled = isEntitled;
        sub.latestEventId = notificationUUID;
        sub.latestEventType = notificationType;
        sub.latestEventTimestamp = new Date();
        await sub.save();

        // Update user record
        await User.update(
          { isSubscribed: isEntitled, subscriptionExpiresAt: sub.expiresAt },
          { where: { id: sub.userId } }
        );
      }
    }

    await eventLog.update({ processed: true, processingResult: 'SUCCESS' });
    return { success: true, eventType: notificationType };
  }

  /**
   * Handles Google Play Real-time Developer Notifications (Cloud Pub/Sub)
   */
  public async handleGoogleNotification(body: any): Promise<{ success: boolean; eventType: string }> {
    const message = body?.message;
    if (!message || !message.data) {
      throw new SubscriptionPurchaseServiceError('Invalid Google Pub/Sub message body', 400, 'INVALID_PUBSUB_BODY');
    }

    const messageId = message.messageId || `google_${Date.now()}`;

    // Deduplicate in SubscriptionEventLog
    const existingLog = await SubscriptionEventLog.findOne({ where: { eventId: messageId } });
    if (existingLog) {
      return { success: true, eventType: 'ALREADY_PROCESSED' };
    }

    let decodedData: any = {};
    try {
      const decodedString = Buffer.from(message.data, 'base64').toString('utf8');
      decodedData = JSON.parse(decodedString);
    } catch (_parseErr) {
      throw new SubscriptionPurchaseServiceError('Failed to parse Google Pub/Sub message data', 400, 'PARSE_ERROR');
    }

    const subNotif = decodedData.subscriptionNotification;
    const notificationType = subNotif ? `TYPE_${subNotif.notificationType}` : 'UNKNOWN';

    const eventLog = await SubscriptionEventLog.create({
      platform: 'android',
      eventId: messageId,
      eventType: notificationType,
      purchaseToken: subNotif?.purchaseToken || null,
      eventTimestamp: new Date(decodedData.eventTimeMillis ? parseInt(decodedData.eventTimeMillis, 10) : Date.now()),
      rawPayload: decodedData,
      processed: false,
    });

    if (subNotif?.purchaseToken && subNotif?.subscriptionId) {
      const sub = await UserSubscription.findOne({
        where: { purchaseToken: subNotif.purchaseToken },
      });

      if (sub) {
        let isEntitled = sub.isEntitled;
        let newStatus = sub.status;

        if (subNotif.notificationType === 13) {
          // SUBSCRIPTION_EXPIRED
          newStatus = 'expired';
          isEntitled = false;
        } else if (subNotif.notificationType === 12) {
          // SUBSCRIPTION_REVOKED
          newStatus = 'revoked';
          isEntitled = false;
        } else if (subNotif.notificationType === 3) {
          // SUBSCRIPTION_CANCELED
          newStatus = 'canceled';
          sub.autoRenewing = false;
          isEntitled = new Date(sub.expiresAt) > new Date();
        } else {
          // Query authoritative state from Google Play API for renewals / recoveries
          try {
            const freshDetails = await iapService.verifyGoogleSubscription({
              productId: subNotif.subscriptionId,
              purchaseToken: subNotif.purchaseToken,
            });

            newStatus = freshDetails.status;
            isEntitled = freshDetails.isEntitled;
            sub.expiresAt = freshDetails.expiresDate;
            sub.autoRenewing = freshDetails.autoRenewing;
          } catch (_fetchErr) {}
        }

        sub.status = newStatus;
        sub.isEntitled = isEntitled;
        sub.latestEventId = messageId;
        sub.latestEventType = notificationType;
        sub.latestEventTimestamp = new Date();
        await sub.save();

        await User.update(
          { isSubscribed: isEntitled, subscriptionExpiresAt: sub.expiresAt },
          { where: { id: sub.userId } }
        );
      }
    }

    await eventLog.update({ processed: true, processingResult: 'SUCCESS' });
    return { success: true, eventType: notificationType };
  }
}

export const subscriptionPurchaseService = new SubscriptionPurchaseService();
