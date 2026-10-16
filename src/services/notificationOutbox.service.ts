import { Op, Transaction } from 'sequelize';
import { NotificationOutbox } from '../models/notificationOutbox.model';
import { notificationService, PushNotificationResult } from './notification.service';

export interface CreateOutboxEntryInput {
  recipientId: string;
  type?: string;
  title: string;
  body: string;
  entityId?: string | null;
  data?: Record<string, any> | null;
  idempotencyKey: string;
  maxAttempts?: number;
}

export interface ProcessOutboxResult {
  success: boolean;
  outboxId: string;
  status: 'sent' | 'pending' | 'failed';
  attempts: number;
  pushResult?: PushNotificationResult;
  error?: string;
}

export class NotificationOutboxService {
  private workerInterval: NodeJS.Timeout | null = null;

  /**
   * Creates a pending notification outbox entry within an optional database transaction.
   * Enforces idempotency via the unique idempotencyKey.
   */
  public async createOutboxEntry(
    input: CreateOutboxEntryInput,
    transaction?: Transaction
  ): Promise<NotificationOutbox | null> {
    const {
      recipientId,
      type = 'coin_purchase',
      title,
      body,
      entityId = null,
      data = null,
      idempotencyKey,
      maxAttempts = 5,
    } = input;

    try {
      const [record] = await NotificationOutbox.findOrCreate({
        where: { idempotencyKey },
        defaults: {
          recipientId,
          type,
          title,
          body,
          entityId,
          data,
          idempotencyKey,
          status: 'pending',
          attempts: 0,
          maxAttempts,
          nextRetryAt: null,
        },
        transaction,
      });

      return record;
    } catch (err: any) {
      // In case of race conditions caught by unique index
      const isUniqueConstraint =
        err?.name === 'SequelizeUniqueConstraintError' ||
        err?.message?.includes('unique') ||
        err?.message?.includes('UNIQUE');

      if (isUniqueConstraint) {
        return NotificationOutbox.findOne({
          where: { idempotencyKey },
          transaction,
        });
      }
      throw err;
    }
  }

  /**
   * Processes a single notification outbox item:
   * 1. Verifies item exists and is not already 'sent'.
   * 2. Checks maximum retry attempts.
   * 3. Dispatches notification via notificationService (In-App DB record + Firebase push).
   * 4. Updates outbox status to 'sent' on success, or schedules exponential backoff retry on failure.
   * Notification failures NEVER throw upwards to ensure caller flows are not disrupted.
   */
  public async processOutboxItem(outboxId: string): Promise<ProcessOutboxResult> {
    const outboxItem = await NotificationOutbox.findByPk(outboxId);
    if (!outboxItem) {
      return {
        success: false,
        outboxId,
        status: 'failed',
        attempts: 0,
        error: 'Outbox entry not found',
      };
    }

    // Already delivered idempotently
    if (outboxItem.status === 'sent') {
      return {
        success: true,
        outboxId,
        status: 'sent',
        attempts: outboxItem.attempts,
      };
    }

    // Exceeded maximum retry attempts
    if (outboxItem.attempts >= outboxItem.maxAttempts) {
      outboxItem.status = 'failed';
      await outboxItem.save();
      return {
        success: false,
        outboxId,
        status: 'failed',
        attempts: outboxItem.attempts,
        error: `Exceeded max attempts (${outboxItem.maxAttempts})`,
      };
    }

    // Increment attempt count
    outboxItem.attempts += 1;

    try {
      let pushResult: PushNotificationResult;

      if (outboxItem.type === 'coin_purchase') {
        const payloadData = outboxItem.data || {};
        pushResult = await notificationService.sendCoinPurchaseNotification(
          outboxItem.recipientId,
          {
            purchaseId: outboxItem.entityId || payloadData.purchaseId || outboxItem.id,
            packageName: payloadData.packageName || 'Coin Package',
            coinsCredited: Number(payloadData.coinsCredited || 0),
            currentBalance: Number(payloadData.currentBalance || 0),
            idempotencyKey: outboxItem.idempotencyKey,
          }
        );
      } else {
        pushResult = await notificationService.dispatchNotification(
          outboxItem.recipientId,
          {
            type: outboxItem.type,
            title: outboxItem.title,
            body: outboxItem.body,
            entityId: outboxItem.entityId,
            idempotencyKey: outboxItem.idempotencyKey,
            data: outboxItem.data,
          }
        );
      }

      // Check if notification reached at least DB in-app record or FCM or was intentionally suppressed by user settings
      if (
        pushResult.inAppCreated ||
        pushResult.pushStatus === 'sent_to_fcm' ||
        pushResult.pushStatus === 'no_device_tokens' ||
        pushResult.pushStatus === 'suppressed_by_settings'
      ) {
        outboxItem.status = 'sent';
        outboxItem.processedAt = new Date();
        outboxItem.lastError = null;
        outboxItem.nextRetryAt = null;
        await outboxItem.save();

        return {
          success: true,
          outboxId,
          status: 'sent',
          attempts: outboxItem.attempts,
          pushResult,
        };
      } else {
        throw new Error(pushResult.message || 'Notification dispatch failed');
      }
    } catch (dispatchErr: any) {
      const errorMessage = dispatchErr?.message || 'Unknown dispatch error';
      outboxItem.lastError = errorMessage;

      if (outboxItem.attempts >= outboxItem.maxAttempts) {
        outboxItem.status = 'failed';
        outboxItem.nextRetryAt = null;
      } else {
        outboxItem.status = 'pending';
        // Exponential backoff: 5s, 10s, 20s, 40s... capped at 1 hour
        const delaySeconds = Math.min(3600, Math.pow(2, outboxItem.attempts) * 5);
        outboxItem.nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
      }

      await outboxItem.save();

      return {
        success: false,
        outboxId,
        status: outboxItem.status,
        attempts: outboxItem.attempts,
        error: errorMessage,
      };
    }
  }

  /**
   * Scans and processes pending outbox notifications that are due for retry.
   */
  public async processPendingOutbox(batchSize = 20): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const now = new Date();

    const pendingItems = await NotificationOutbox.findAll({
      where: {
        status: 'pending',
        attempts: { [Op.lt]: 5 },
        [Op.or]: [
          { nextRetryAt: null },
          { nextRetryAt: { [Op.lte]: now } },
        ],
      },
      order: [['createdAt', 'ASC']],
      limit: batchSize,
    });

    let succeeded = 0;
    let failed = 0;

    for (const item of pendingItems) {
      const res = await this.processOutboxItem(item.id);
      if (res.success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      processed: pendingItems.length,
      succeeded,
      failed,
    };
  }

  /**
   * Starts periodic background worker to retry pending notifications
   */
  public startOutboxWorker(intervalMs = 30000): void {
    if (this.workerInterval) return;

    this.workerInterval = setInterval(async () => {
      try {
        await this.processPendingOutbox(20);
      } catch (err: any) {
        console.error('[NotificationOutboxWorker Error]:', err?.message);
      }
    }, intervalMs);

    // Prevent worker from keeping node process active during shutdown or tests
    if (this.workerInterval.unref) {
      this.workerInterval.unref();
    }
  }

  /**
   * Stops periodic background worker
   */
  public stopOutboxWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }
}

export const notificationOutboxService = new NotificationOutboxService();
