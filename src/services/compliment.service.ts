import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import {
  ConnectionRequest,
  User,
  UserBlock,
  Match,
  SwipeAction,
  Conversation,
  ChatMessage,
  UserSubscription,
} from '../models';
import { ConnectionRequestStatus } from '../models/connectionRequest.model';
import { notificationService } from './notification.service';

export interface SendComplimentResult {
  complimentId: string;
  targetUserId: string;
  message: string;
  reason: string | null;
  status: ConnectionRequestStatus;
  isMatched: boolean;
  matchId: string | null;
  createdAt: string;
  conversationId?: string;
  chatMessageId?: string;
  isNewMatch?: boolean;
}

export class ComplimentServiceError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number = 400, errorCode: string = 'BAD_REQUEST') {
    super(message);
    this.name = 'ComplimentServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ComplimentServiceError.prototype);
  }
}

export class ComplimentService {
  /**
   * Validates whether a user has an active, entitled subscription.
   * Checks UserSubscription records (verifying expiration and grace period)
   * and falls back to user.isSubscribed flag for unit/integration tests and manual grants.
   */
  public async isUserSubscribed(user: User): Promise<boolean> {
    const now = new Date();
    const latestSub = await UserSubscription.findOne({
      where: { userId: user.id },
      order: [['created_at', 'DESC']],
    });

    if (latestSub) {
      const hasNotExpired = new Date(latestSub.expiresAt) > now;
      const isEntitledNow =
        latestSub.isEntitled &&
        (hasNotExpired || latestSub.status === 'in_grace_period');

      // Reconcile user flag if expired or newly entitled
      if (!isEntitledNow && user.isSubscribed) {
        user.isSubscribed = false;
        await user.save();
      } else if (isEntitledNow && !user.isSubscribed) {
        user.isSubscribed = true;
        await user.save();
      }

      return isEntitledNow;
    }

    return !!user.isSubscribed;
  }

  /**
   * Sends a profile compliment from the authenticated user to a target user.
   * Rules:
   * 1. Subscribed users: unlimited compliments (unmatched or matched).
   * 2. Already matched users: deliver via chat conversation and ConnectionRequest.
   * 3. Unmatched users: 1 compliment per target profile for unsubscribed users (prevent duplicate).
   * 4. Mutual connect: automatically forms a match and delivers compliment to chat.
   */
  public async sendCompliment(
    requesterId: string,
    targetUserId: string,
    options: {
      message: string;
      reason?: string | null;
      momentId?: string | null;
    }
  ): Promise<SendComplimentResult> {
    const finalMessage = options.message.trim();
    const finalReason = options.reason?.trim() || 'Compliment';
    const momentId = options.momentId || null;

    if (!finalMessage) {
      throw new ComplimentServiceError('Compliment message cannot be empty', 400, 'EMPTY_MESSAGE');
    }

    // 1. Prevent self-compliment
    if (requesterId === targetUserId) {
      throw new ComplimentServiceError(
        'You cannot compliment your own profile',
        400,
        'SELF_COMPLIMENT_NOT_ALLOWED'
      );
    }

    // 2. Validate requester and target user status
    const [requester, targetUser] = await Promise.all([
      User.findByPk(requesterId),
      User.findByPk(targetUserId),
    ]);

    if (!requester || !requester.isActive) {
      throw new ComplimentServiceError(
        'Requester account is invalid or unavailable',
        401,
        'UNAUTHORIZED'
      );
    }

    if (!targetUser || !targetUser.isActive) {
      throw new ComplimentServiceError(
        'Target user does not exist or is unavailable',
        404,
        'TARGET_USER_NOT_FOUND'
      );
    }

    // 3. Bidirectional block check
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: requesterId, blockedUserId: targetUserId },
          { userId: targetUserId, blockedUserId: requesterId },
        ],
      },
    });

    if (blockRecord) {
      throw new ComplimentServiceError(
        'Compliment cannot be sent due to privacy or block restrictions',
        403,
        'ACTION_FORBIDDEN'
      );
    }

    const requesterName =
      requester.nickName ||
      requester.firstName ||
      requester.fullName ||
      requester.username ||
      'Someone';

    // 4. Validate subscription status of both people.
    // A premium recipient must actually receive the compliment in chat, not only
    // as a pending request the sender can see.
    const [isSubscribed, targetIsSubscribed] = await Promise.all([
      this.isUserSubscribed(requester),
      this.isUserSubscribed(targetUser),
    ]);

    // 5. Check if already matched
    const [u1, u2] = [requesterId, targetUserId].sort();
    const existingMatch = await Match.findOne({
      where: {
        user1Id: u1,
        user2Id: u2,
        isActive: true,
      },
    });

    if (existingMatch) {
      // Rule 2: If users are matched, allow communication through chat.
      // Deliver compliment into chat thread and persist accepted ConnectionRequest.
      const now = new Date();
      const t = await sequelize.transaction();
      let savedRequest: ConnectionRequest;
      let conversation: Conversation;
      let chatMessage: ChatMessage;

      try {
        const [conv] = await Conversation.findOrCreate({
          where: { user1Id: u1, user2Id: u2 },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            lastMessage: finalMessage,
            lastMessageAt: now,
          },
          transaction: t,
        });
        conversation = conv;

        const metadata = JSON.stringify({
          type: 'compliment',
          reason: finalReason,
          momentId,
        });

        chatMessage = await ChatMessage.create(
          {
            conversationId: conversation.id,
            senderId: requesterId,
            recipientId: targetUserId,
            content: finalMessage,
            messageType: 'text',
            metadata,
            isRead: false,
          },
          { transaction: t }
        );

        conversation.lastMessage = finalMessage;
        conversation.lastMessageAt = now;
        await conversation.save({ transaction: t });

        savedRequest = await ConnectionRequest.create(
          {
            requesterId,
            targetUserId,
            status: 'accepted',
            message: finalMessage,
            reason: finalReason,
            momentId,
            respondedAt: now,
          },
          { transaction: t }
        );

        await t.commit();
      } catch (err: any) {
        await t.rollback();
        throw err;
      }

      // Dispatch compliment notification to targetUser
      try {
        await notificationService.sendComplimentNotification(targetUserId, {
          requesterId,
          requesterName,
          complimentId: savedRequest.id,
          message: finalMessage,
        });
      } catch (notifErr: any) {
        console.error('[Send Compliment Notification Error]:', notifErr.message);
      }

      return {
        complimentId: savedRequest.id,
        targetUserId,
        message: finalMessage,
        reason: finalReason,
        status: 'accepted',
        isMatched: true,
        matchId: existingMatch.id,
        createdAt: savedRequest.createdAt
          ? savedRequest.createdAt.toISOString()
          : new Date().toISOString(),
        conversationId: conversation.id,
        chatMessageId: chatMessage.id,
        isNewMatch: false,
      };
    }

    // 6. Rule 3: Unmatched users check
    // If not subscribed, only one compliment per target profile is permitted.
    if (!isSubscribed) {
      const existingCompliment = await ConnectionRequest.findOne({
        where: {
          requesterId,
          targetUserId,
        },
      });

      if (existingCompliment) {
        if (existingCompliment.status === 'pending') {
          throw new ComplimentServiceError(
            'A compliment is already pending for this user',
            409,
            'COMPLIMENT_ALREADY_PENDING'
          );
        }
        throw new ComplimentServiceError(
          'You have already sent a compliment to this profile',
          409,
          'DUPLICATE_COMPLIMENT'
        );
      }
    }

    // 7. Check if target user has ALREADY sent a pending request to requester (Mutual Connect -> Instant Match)
    const reversePendingRequest = await ConnectionRequest.findOne({
      where: {
        requesterId: targetUserId,
        targetUserId: requesterId,
        status: 'pending',
      },
    });

    if (reversePendingRequest) {
      const t = await sequelize.transaction();
      let match: Match;
      let conversation: Conversation;
      let chatMessage: ChatMessage;

      try {
        reversePendingRequest.status = 'accepted';
        reversePendingRequest.respondedAt = new Date();
        await reversePendingRequest.save({ transaction: t });

        const [createdMatch] = await Match.findOrCreate({
          where: { user1Id: u1, user2Id: u2 },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            matchedBy: 'super_like',
            isActive: true,
          },
          transaction: t,
        });
        if (!createdMatch.isActive) {
          createdMatch.isActive = true;
          createdMatch.matchedBy = 'super_like';
          await createdMatch.save({ transaction: t });
        }
        match = createdMatch;

        await SwipeAction.upsert(
          { userId: requesterId, targetUserId, action: 'super_like' },
          { transaction: t }
        );

        // Deliver compliment to chat conversation for new match
        const now = new Date();
        const [conv] = await Conversation.findOrCreate({
          where: { user1Id: u1, user2Id: u2 },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            lastMessage: finalMessage,
            lastMessageAt: now,
          },
          transaction: t,
        });
        conversation = conv;

        const metadata = JSON.stringify({
          type: 'compliment',
          reason: finalReason,
          momentId,
        });

        chatMessage = await ChatMessage.create(
          {
            conversationId: conversation.id,
            senderId: requesterId,
            recipientId: targetUserId,
            content: finalMessage,
            messageType: 'text',
            metadata,
            isRead: false,
          },
          { transaction: t }
        );

        conversation.lastMessage = finalMessage;
        conversation.lastMessageAt = now;
        await conversation.save({ transaction: t });

        await t.commit();

        // Dispatch compliment notification to targetUser
        try {
          await notificationService.sendComplimentNotification(targetUserId, {
            requesterId,
            requesterName,
            complimentId: reversePendingRequest.id,
            message: finalMessage,
          });

          // Dispatch match notifications to both users
          const targetUserDisplayName =
            targetUser.nickName ||
            targetUser.firstName ||
            targetUser.fullName ||
            'Someone';

          await notificationService.dispatchNotification(targetUserId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${requesterName} connected! Say hi!`,
            senderId: requesterId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: requesterName },
          });

          await notificationService.dispatchNotification(requesterId, {
            type: 'match',
            title: "It's a match!",
            body: `You and ${targetUserDisplayName} connected! Say hi!`,
            senderId: targetUserId,
            entityId: match.id,
            navigation: { type: 'match', targetId: match.id },
            data: { matchId: match.id, partnerName: targetUserDisplayName },
          });
        } catch (_notifErr) {
          // Notifications fail-safe
        }

        return {
          complimentId: reversePendingRequest.id,
          targetUserId,
          message: finalMessage,
          reason: finalReason,
          status: 'accepted',
          isMatched: true,
          matchId: match.id,
          createdAt: reversePendingRequest.createdAt
            ? reversePendingRequest.createdAt.toISOString()
            : new Date().toISOString(),
          conversationId: conversation.id,
          chatMessageId: chatMessage.id,
          isNewMatch: true,
        };
      } catch (err: any) {
        await t.rollback();
        throw err;
      }
    }

    // 8. Atomic transaction for new ConnectionRequest persistence.
    // Premium-to-premium also drops the compliment into the chat thread so the
    // other premium user receives it without needing a prior match.
    const deliverToChat = isSubscribed && targetIsSubscribed;
    const t = await sequelize.transaction();
    let savedRequest: ConnectionRequest;
    let deliveredConversationId: string | undefined;
    let deliveredChatMessageId: string | undefined;
    try {
      savedRequest = await ConnectionRequest.create(
        {
          requesterId,
          targetUserId,
          status: 'pending',
          message: finalMessage,
          reason: finalReason,
          momentId,
        },
        { transaction: t }
      );

      // Record discovery swipe action as super_like
      await SwipeAction.upsert(
        { userId: requesterId, targetUserId, action: 'super_like' },
        { transaction: t }
      );

      if (deliverToChat) {
        const now = new Date();
        const [conv] = await Conversation.findOrCreate({
          where: { user1Id: u1, user2Id: u2 },
          defaults: {
            user1Id: u1,
            user2Id: u2,
            lastMessage: finalMessage,
            lastMessageAt: now,
          },
          transaction: t,
        });

        const chatMessage = await ChatMessage.create(
          {
            conversationId: conv.id,
            senderId: requesterId,
            recipientId: targetUserId,
            content: finalMessage,
            messageType: 'text',
            metadata: JSON.stringify({
              type: 'compliment',
              reason: finalReason,
              momentId,
              complimentId: savedRequest.id,
            }),
            isRead: false,
          },
          { transaction: t }
        );

        conv.lastMessage = finalMessage;
        conv.lastMessageAt = now;
        await conv.save({ transaction: t });
        deliveredConversationId = conv.id;
        deliveredChatMessageId = chatMessage.id;
      }

      await t.commit();
    } catch (dbErr: any) {
      await t.rollback();
      throw dbErr;
    }

    // 9. Dispatch In-App & Push Notification to target user
    try {
      await notificationService.sendComplimentNotification(targetUserId, {
        requesterId,
        requesterName,
        complimentId: savedRequest.id,
        message: finalMessage,
      });
    } catch (notifErr: any) {
      console.error('[Send Compliment Notification Error]:', notifErr.message);
    }

    return {
      complimentId: savedRequest.id,
      targetUserId,
      message: savedRequest.message || finalMessage,
      reason: savedRequest.reason,
      status: savedRequest.status,
      isMatched: false,
      matchId: null,
      createdAt: savedRequest.createdAt
        ? savedRequest.createdAt.toISOString()
        : new Date().toISOString(),
      isNewMatch: false,
      ...(deliveredConversationId
        ? {
            conversationId: deliveredConversationId,
            chatMessageId: deliveredChatMessageId,
          }
        : {}),
    };
  }
}

export const complimentService = new ComplimentService();
