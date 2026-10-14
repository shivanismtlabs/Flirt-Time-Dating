import { Op } from 'sequelize';
import { sequelize, User, CoinPackage, CoinPurchase, CoinTransaction } from '../models';
import { iapService, IAPServiceError } from './iap.service';

export interface VerifyCoinPurchaseInput {
  platform: 'ios' | 'android';
  packageId?: number;
  productId?: string;
  // Apple fields
  transactionId?: string;
  signedTransactionInfo?: string;
  receiptData?: string;
  // Google fields
  purchaseToken?: string;
  orderId?: string;
  packageName?: string;
}

export interface VerifyPurchaseResult {
  success: boolean;
  alreadyProcessed: boolean;
  message: string;
  data: {
    purchaseId: string;
    platform: 'ios' | 'android';
    productId: string;
    packageName: string;
    coinsCredited: number;
    baseCoins: number;
    bonusCoins: number;
    previousBalance?: number;
    currentBalance: number;
    status: string;
    storeTransactionId: string;
    environment: string;
    isAcknowledged: boolean;
    verifiedAt: string;
  };
}

export interface PurchaseHistoryItem {
  id: string;
  platform: 'ios' | 'android';
  productId: string;
  packageName: string;
  coins: number;
  bonusCoins: number;
  totalCoins: number;
  price: string;
  currency: string;
  status: string;
  environment: string;
  storeTransactionId: string;
  isAcknowledged: boolean;
  verifiedAt: string;
  createdAt: string;
}

export interface PurchaseHistoryResult {
  data: PurchaseHistoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface WalletBalanceResult {
  userId: string;
  coins: number;
  currency: string;
  recentTransactions: Array<{
    id: string;
    type: string;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    description: string;
    referenceId: string | null;
    createdAt: string;
  }>;
}

export class CoinPurchaseServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'CoinPurchaseServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, CoinPurchaseServiceError.prototype);
  }
}

export class CoinPurchaseService {
  /**
   * Verifies an in-app coin purchase from Apple App Store or Google Play,
   * performs strict validation, calculates base+bonus coins from database,
   * checks idempotency, and credits the user wallet in an atomic database transaction.
   */
  public async verifyAndCreditPurchase(
    userId: string,
    input: VerifyCoinPurchaseInput
  ): Promise<VerifyPurchaseResult> {
    const { platform, packageId, productId } = input;

    if (!platform || (platform !== 'ios' && platform !== 'android')) {
      throw new CoinPurchaseServiceError('Invalid platform. Supported platforms: "ios", "android"', 400, 'INVALID_PLATFORM');
    }

    if (!packageId && !productId) {
      throw new CoinPurchaseServiceError('Either packageId or productId is required to identify the coin package', 400, 'MISSING_PACKAGE_IDENTIFIER');
    }

    // 1. Resolve coin package from database
    let pkg: CoinPackage | null = null;
    if (packageId) {
      pkg = await CoinPackage.findByPk(packageId);
    } else if (productId) {
      pkg = await CoinPackage.findOne({
        where: {
          [Op.or]: [
            { google_product_id: productId },
            { apple_product_id: productId },
            { id: isNaN(Number(productId)) ? -1 : Number(productId) },
          ],
        },
      });
    }

    if (!pkg) {
      throw new CoinPurchaseServiceError('Requested coin package does not exist', 404, 'PACKAGE_NOT_FOUND');
    }

    if (!pkg.is_active) {
      throw new CoinPurchaseServiceError('Requested coin package is inactive and unavailable for purchase', 400, 'PACKAGE_INACTIVE');
    }

    // 2. Exact Coin Calculation from Database Record (Base + Bonus)
    // baseCoins comes from pkg.coins, bonusCoins comes from pkg.bonus_coins
    const baseCoins = Number(pkg.coins);
    const bonusCoins = Number(pkg.bonus_coins || 0);
    const totalCoins = baseCoins + bonusCoins;
    const price = pkg.getDataValue('price');
    const currency = pkg.currency || 'INR';

    // 3. Early Idempotency Check before calling external store APIs
    const fastCheckId = platform === 'ios'
      ? input.transactionId
      : input.orderId || input.purchaseToken;

    if (fastCheckId) {
      const existingFast = await CoinPurchase.findOne({
        where: {
          [Op.or]: [
            { storeTransactionId: fastCheckId },
            ...(input.purchaseToken ? [{ purchaseToken: input.purchaseToken }] : []),
          ],
        },
        include: [{ model: CoinPackage, as: 'package' }],
      });

      if (existingFast && existingFast.status === 'completed') {
        const user = await User.findByPk(userId);
        return {
          success: true,
          alreadyProcessed: true,
          message: 'Purchase has already been verified and credited to your wallet',
          data: {
            purchaseId: existingFast.id,
            platform: existingFast.platform,
            productId: existingFast.productId,
            packageName: (existingFast as any).package?.name || pkg.name,
            coinsCredited: existingFast.totalCoins,
            baseCoins: existingFast.coins,
            bonusCoins: existingFast.bonusCoins,
            currentBalance: typeof user?.coins === 'number' ? user.coins : 500,
            status: existingFast.status,
            storeTransactionId: existingFast.storeTransactionId,
            environment: existingFast.environment,
            isAcknowledged: Boolean(existingFast.acknowledged),
            verifiedAt: existingFast.verifiedAt ? existingFast.verifiedAt.toISOString() : new Date().toISOString(),
          },
        };
      }
    }

    // 4. Perform Store Verification with Apple App Store or Google Play
    let storeDetails: any;
    try {
      if (platform === 'ios') {
        const expectedStoreProductId = pkg.apple_product_id || pkg.google_product_id || String(pkg.id);
        storeDetails = await iapService.verifyAppleTransaction({
          transactionId: input.transactionId,
          signedTransactionInfo: input.signedTransactionInfo,
          receiptData: input.receiptData,
          expectedProductId: expectedStoreProductId,
        });

        // Validate product ID match
        const verifiedProduct = storeDetails.productId;
        const matchesApple = pkg.apple_product_id && pkg.apple_product_id === verifiedProduct;
        const matchesGoogle = pkg.google_product_id && pkg.google_product_id === verifiedProduct;
        const matchesId = String(pkg.id) === verifiedProduct;

        if (!matchesApple && !matchesGoogle && !matchesId) {
          throw new CoinPurchaseServiceError(
            `Purchased product (${verifiedProduct}) does not match package product ID (${pkg.apple_product_id || pkg.name})`,
            400,
            'PRODUCT_MISMATCH'
          );
        }
      } else {
        const expectedStoreProductId = pkg.google_product_id || pkg.apple_product_id || String(pkg.id);
        storeDetails = await iapService.verifyGooglePurchase({
          productId: input.productId || expectedStoreProductId,
          purchaseToken: input.purchaseToken!,
          packageName: input.packageName,
          orderId: input.orderId,
        });

        // Validate product ID match
        const verifiedProduct = storeDetails.productId;
        const matchesGoogle = pkg.google_product_id && pkg.google_product_id === verifiedProduct;
        const matchesApple = pkg.apple_product_id && pkg.apple_product_id === verifiedProduct;
        const matchesId = String(pkg.id) === verifiedProduct;

        if (!matchesGoogle && !matchesApple && !matchesId) {
          throw new CoinPurchaseServiceError(
            `Purchased product (${verifiedProduct}) does not match package product ID (${pkg.google_product_id || pkg.name})`,
            400,
            'PRODUCT_MISMATCH'
          );
        }
      }
    } catch (verifyErr: any) {
      if (verifyErr instanceof IAPServiceError || verifyErr instanceof CoinPurchaseServiceError) {
        throw verifyErr;
      }
      throw new CoinPurchaseServiceError(
        'Store verification failed: ' + (verifyErr?.message || 'Unknown store error'),
        400,
        'STORE_VERIFICATION_FAILED'
      );
    }

    // 5. In a Database Transaction, credit coins and record purchase with Row-Level Lock
    const isPostgres = sequelize.getDialect() === 'postgres';
    let txResult: {
      alreadyProcessed: boolean;
      purchase: CoinPurchase;
      currentBalance: number;
      previousBalance: number;
    };

    try {
      txResult = await sequelize.transaction(async (t) => {
        // Re-check unique transaction within row lock to prevent race conditions
        const duplicateInTx = await CoinPurchase.findOne({
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
            purchase: duplicateInTx,
            currentBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
            previousBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
          };
        }

        // Fetch user with row lock in postgres to serialize balance increment
        const user = await User.findByPk(userId, {
          transaction: t,
          lock: isPostgres ? t.LOCK.UPDATE : undefined,
        });
        if (!user) {
          throw new CoinPurchaseServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
        }

        const balanceBefore = typeof user.coins === 'number' ? user.coins : 500;
        const balanceAfter = balanceBefore + totalCoins;

        // Create purchase record
        const purchase = await CoinPurchase.create(
          {
            userId: user.id,
            packageId: pkg.id,
            platform: storeDetails.platform,
            productId: storeDetails.productId,
            storeTransactionId: storeDetails.storeTransactionId,
            purchaseToken: storeDetails.purchaseToken || null,
            coins: baseCoins,
            bonusCoins: bonusCoins,
            totalCoins: totalCoins,
            price: price,
            currency: currency,
            status: 'completed',
            environment: storeDetails.environment || 'production',
            rawVerificationData: storeDetails.rawResponse || null,
            acknowledged: storeDetails.isAcknowledged,
            acknowledgedAt: storeDetails.isAcknowledged ? new Date() : null,
            verifiedAt: storeDetails.purchaseDate || new Date(),
          },
          { transaction: t }
        );

        // Create wallet ledger transaction entry
        await CoinTransaction.create(
          {
            userId: user.id,
            type: 'purchase',
            amount: totalCoins,
            balanceBefore: balanceBefore,
            balanceAfter: balanceAfter,
            referenceId: purchase.id,
            referenceType: 'coin_purchase',
            description: `Purchased ${pkg.name} (${baseCoins} base + ${bonusCoins} bonus coins)`,
          },
          { transaction: t }
        );

        // Update user wallet balance atomically
        user.coins = balanceAfter;
        await user.save({ transaction: t });

        return {
          alreadyProcessed: false,
          purchase,
          currentBalance: balanceAfter,
          previousBalance: balanceBefore,
        };
      });
    } catch (txErr: any) {
      // If a concurrent request created the record at the same instant (race condition caught by unique index or lock contention)
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
        // Wait briefly for the concurrent transaction to finish committing
        await new Promise((resolve) => setTimeout(resolve, 80));

        const existingAfterRace = await CoinPurchase.findOne({
          where: {
            [Op.or]: [
              { storeTransactionId: storeDetails.storeTransactionId },
              ...(storeDetails.purchaseToken ? [{ purchaseToken: storeDetails.purchaseToken }] : []),
            ],
          },
          include: [{ model: CoinPackage, as: 'package' }],
        });

        if (existingAfterRace) {
          const userNow = await User.findByPk(userId);
          txResult = {
            alreadyProcessed: true,
            purchase: existingAfterRace,
            currentBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
            previousBalance: typeof userNow?.coins === 'number' ? userNow.coins : 500,
          };
        } else {
          // If still not found after transient lock, retry the transaction once
          txResult = await sequelize.transaction(async (retryTx) => {
            const dupRetry = await CoinPurchase.findOne({
              where: {
                [Op.or]: [
                  { storeTransactionId: storeDetails.storeTransactionId },
                  ...(storeDetails.purchaseToken ? [{ purchaseToken: storeDetails.purchaseToken }] : []),
                ],
              },
              transaction: retryTx,
            });

            if (dupRetry) {
              const uNow = await User.findByPk(userId, { transaction: retryTx });
              return {
                alreadyProcessed: true,
                purchase: dupRetry,
                currentBalance: typeof uNow?.coins === 'number' ? uNow.coins : 500,
                previousBalance: typeof uNow?.coins === 'number' ? uNow.coins : 500,
              };
            }

            const retryUser = await User.findByPk(userId, { transaction: retryTx });
            if (!retryUser) {
              throw new CoinPurchaseServiceError('Authenticated user not found', 404, 'USER_NOT_FOUND');
            }

            const balBefore = typeof retryUser.coins === 'number' ? retryUser.coins : 500;
            const balAfter = balBefore + totalCoins;

            const newPurch = await CoinPurchase.create(
              {
                userId: retryUser.id,
                packageId: pkg.id,
                platform: storeDetails.platform,
                productId: storeDetails.productId,
                storeTransactionId: storeDetails.storeTransactionId,
                purchaseToken: storeDetails.purchaseToken || null,
                coins: baseCoins,
                bonusCoins: bonusCoins,
                totalCoins: totalCoins,
                price: price,
                currency: currency,
                status: 'completed',
                environment: storeDetails.environment || 'production',
                rawVerificationData: storeDetails.rawResponse || null,
                acknowledged: storeDetails.isAcknowledged,
                acknowledgedAt: storeDetails.isAcknowledged ? new Date() : null,
                verifiedAt: storeDetails.purchaseDate || new Date(),
              },
              { transaction: retryTx }
            );

            await CoinTransaction.create(
              {
                userId: retryUser.id,
                type: 'purchase',
                amount: totalCoins,
                balanceBefore: balBefore,
                balanceAfter: balAfter,
                referenceId: newPurch.id,
                referenceType: 'coin_purchase',
                description: `Purchased ${pkg.name} (${baseCoins} base + ${bonusCoins} bonus coins)`,
              },
              { transaction: retryTx }
            );

            retryUser.coins = balAfter;
            await retryUser.save({ transaction: retryTx });

            return {
              alreadyProcessed: false,
              purchase: newPurch,
              currentBalance: balAfter,
              previousBalance: balBefore,
            };
          });
        }
      } else {
        throw txErr;
      }
    }

    const isAlready = txResult.alreadyProcessed;
    const finalPurchase = txResult.purchase;

    // 6. Safe Store Consumption / Acknowledgement for Android
    let acknowledgedNow = finalPurchase.acknowledged;
    if (!isAlready && platform === 'android' && !acknowledgedNow && storeDetails.purchaseToken) {
      try {
        const consumeOk = await iapService.consumeGooglePurchase(
          input.packageName || iapService.getGooglePackageName(),
          storeDetails.productId,
          storeDetails.purchaseToken
        );
        if (consumeOk) {
          acknowledgedNow = true;
          await finalPurchase.update({
            acknowledged: true,
            acknowledgedAt: new Date(),
          });
        }
      } catch (_consumeErr) {
        // Safe to swallow: coins are already safely credited in the database.
        // Acknowledged flag remains false for safe background or manual retry.
      }
    }

    return {
      success: true,
      alreadyProcessed: isAlready,
      message: isAlready
        ? 'Purchase has already been verified and credited'
        : `Successfully credited ${totalCoins} coins (${baseCoins} + ${bonusCoins} bonus) to your wallet`,
      data: {
        purchaseId: finalPurchase.id,
        platform: finalPurchase.platform,
        productId: finalPurchase.productId,
        packageName: pkg.name,
        coinsCredited: finalPurchase.totalCoins,
        baseCoins: finalPurchase.coins,
        bonusCoins: finalPurchase.bonusCoins,
        previousBalance: txResult.previousBalance,
        currentBalance: txResult.currentBalance,
        status: finalPurchase.status,
        storeTransactionId: finalPurchase.storeTransactionId,
        environment: finalPurchase.environment,
        isAcknowledged: acknowledgedNow,
        verifiedAt: finalPurchase.verifiedAt ? finalPurchase.verifiedAt.toISOString() : new Date().toISOString(),
      },
    };
  }

  /**
   * Retrieves paginated purchase history for an authenticated user
   */
  public async getPurchaseHistory(
    userId: string,
    query: { page?: number; limit?: number }
  ): Promise<PurchaseHistoryResult> {
    const page = Math.max(1, parseInt(String(query.page || 1), 10));
    const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || 10), 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await CoinPurchase.findAndCountAll({
      where: { userId },
      include: [{ model: CoinPackage, as: 'package', attributes: ['name', 'price', 'currency'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    const data: PurchaseHistoryItem[] = rows.map((p: any) => ({
      id: p.id,
      platform: p.platform,
      productId: p.productId,
      packageName: p.package?.name || 'Coin Pack',
      coins: Number(p.coins),
      bonusCoins: Number(p.bonusCoins || 0),
      totalCoins: Number(p.totalCoins),
      price: typeof p.price === 'number' ? p.price.toFixed(2) : String(p.price),
      currency: p.currency || 'INR',
      status: p.status,
      environment: p.environment,
      storeTransactionId: p.storeTransactionId,
      isAcknowledged: Boolean(p.acknowledged),
      verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : p.createdAt.toISOString(),
      createdAt: p.createdAt ? p.createdAt.toISOString() : new Date().toISOString(),
    }));

    const totalPages = Math.ceil(count / limit) || 1;

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  /**
   * Retrieves wallet balance and recent ledger transactions for the authenticated user
   */
  public async getWalletBalance(userId: string): Promise<WalletBalanceResult> {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new CoinPurchaseServiceError('User not found', 404, 'USER_NOT_FOUND');
    }

    const recentLedger = await CoinTransaction.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 10,
    });

    return {
      userId: user.id,
      coins: typeof user.coins === 'number' ? user.coins : 500,
      currency: 'INR',
      recentTransactions: recentLedger.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        description: t.description,
        referenceId: t.referenceId,
        createdAt: t.createdAt ? t.createdAt.toISOString() : new Date().toISOString(),
      })),
    };
  }

  /**
   * Safe retry for store acknowledgement or consumption without crediting coins again
   */
  public async retryAcknowledgement(userId: string, purchaseId: string): Promise<any> {
    const purchase = await CoinPurchase.findOne({
      where: { id: purchaseId, userId },
    });

    if (!purchase) {
      throw new CoinPurchaseServiceError('Purchase record not found', 404, 'PURCHASE_NOT_FOUND');
    }

    if (purchase.acknowledged) {
      return {
        success: true,
        message: 'Purchase was already acknowledged',
        acknowledged: true,
      };
    }

    if (purchase.platform === 'android' && purchase.purchaseToken) {
      const ok = await iapService.consumeGooglePurchase(
        iapService.getGooglePackageName(),
        purchase.productId,
        purchase.purchaseToken
      );
      if (ok) {
        await purchase.update({
          acknowledged: true,
          acknowledgedAt: new Date(),
        });
        return {
          success: true,
          message: 'Google Play purchase successfully consumed and acknowledged',
          acknowledged: true,
        };
      }
    }

    return {
      success: false,
      message: 'Could not acknowledge purchase at this time. Please retry later.',
      acknowledged: false,
    };
  }
}

export const coinPurchaseService = new CoinPurchaseService();
