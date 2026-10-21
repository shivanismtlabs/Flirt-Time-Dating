import { Op } from 'sequelize';
import {
  User,
  Conversation,
  ChatMessage,
  Match,
  UserBlock,
  UserPhoto,
} from '../models';
import { notificationService } from './notification.service';
import { formatThumbnailUrl } from './s3.service';
import { resolveDisplayName } from './discovery.service';
import { SendMessageInput } from '../schemas/chat.schema';

export class ChatServiceError extends Error {
  public statusCode: number;
  public errorCode?: string;

  constructor(message: string, statusCode = 400, errorCode?: string) {
    super(message);
    this.name = 'ChatServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, ChatServiceError.prototype);
  }
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  messageType: 'text' | 'moment_reply' | 'moment_gift';
  metadata: string | null;
  isRead: boolean;
  isMine: boolean;
  createdAt: string;
}

export interface ConversationSummaryDTO {
  id: string;
  targetUser: {
    id: string;
    name: string;
    username: string;
    profilePhotoUrl: string | null;
    isVerified: boolean;
    isSubscribed: boolean;
  };
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isMatched: boolean;
}

export class ChatService {
  /**
   * Helper to resolve the primary approved profile photo URL
   */
  private resolvePrimaryPhoto(userProfilePicture?: string | null, photos?: any[] | null): string | null {
    let photo = userProfilePicture || null;
    if (!photo && photos && photos.length > 0) {
      const approvedPhotos = photos.filter((p) => p.status === 'approved');
      if (approvedPhotos.length > 0) {
        const primary = approvedPhotos.find((p) => p.isPrimary);
        photo = primary ? primary.imageUrl : approvedPhotos[0].imageUrl;
      }
    }
    return photo ? formatThumbnailUrl(photo) : null;
  }

  /**
   * Sends a chat message.
   * Enforces Free Tier Rule 4: Free users can ONLY send messages to mutual matches.
   * Premium users (isSubscribed === true) are permitted to chat without a prior match.
   */
  public async sendMessage(
    senderId: string,
    input: SendMessageInput
  ): Promise<ChatMessageDTO> {
    const { recipientId, content, messageType = 'text', metadata = null } = input;

    // 1. Prevent self-messaging
    if (senderId === recipientId) {
      throw new ChatServiceError('You cannot send a message to yourself', 400, 'SELF_CHAT_NOT_ALLOWED');
    }

    // 2. Fetch sender and recipient
    const [sender, recipient] = await Promise.all([
      User.findByPk(senderId),
      User.findByPk(recipientId),
    ]);

    if (!sender || !sender.isActive) {
      throw new ChatServiceError('Sender account is invalid or unavailable', 401, 'UNAUTHORIZED');
    }

    if (!recipient || !recipient.isActive) {
      throw new ChatServiceError('Recipient does not exist or is unavailable', 404, 'RECIPIENT_NOT_FOUND');
    }

    // 3. Bidirectional block check
    const blockRecord = await UserBlock.findOne({
      where: {
        [Op.or]: [
          { userId: senderId, blockedUserId: recipientId },
          { userId: recipientId, blockedUserId: senderId },
        ],
      },
    });

    if (blockRecord) {
      throw new ChatServiceError(
        'Cannot send message due to block restrictions',
        403,
        'CHAT_FORBIDDEN'
      );
    }

    // 4. Free Tier Match Guard
    // Free users can ONLY chat if an active mutual match exists.
    // Premium users (isSubscribed === true) bypass this check.
    const isPremium = Boolean(sender.isSubscribed);

    if (!isPremium) {
      const [u1, u2] = [senderId, recipientId].sort();
      const match = await Match.findOne({
        where: {
          user1Id: u1,
          user2Id: u2,
          isActive: true,
        },
      });

      if (!match) {
        throw new ChatServiceError(
          'You can only chat after a mutual match. Upgrade to Premium to chat directly.',
          403,
          'MATCH_REQUIRED_TO_CHAT'
        );
      }
    }

    // 5. Find or create canonical conversation thread
    const [u1, u2] = [senderId, recipientId].sort();
    const now = new Date();

    const [conversation] = await Conversation.findOrCreate({
      where: {
        user1Id: u1,
        user2Id: u2,
      },
      defaults: {
        user1Id: u1,
        user2Id: u2,
        lastMessage: content,
        lastMessageAt: now,
      },
    });

    // 6. Create ChatMessage record
    const message = await ChatMessage.create({
      conversationId: conversation.id,
      senderId,
      recipientId,
      content,
      messageType,
      metadata,
      isRead: false,
    });

    // Update conversation last message pointers
    conversation.lastMessage = content;
    conversation.lastMessageAt = now;
    await conversation.save();

    // 7. Dispatch push notification to recipient
    try {
      const senderName = resolveDisplayName(sender);
      await notificationService.dispatchNotification(recipientId, {
        type: 'match',
        title: `Message from ${senderName}`,
        body: content.length > 60 ? `${content.substring(0, 60)}...` : content,
        senderId,
        entityId: conversation.id,
        navigation: { type: 'chat', targetId: conversation.id },
        data: {
          conversationId: conversation.id,
          senderId,
          senderName,
          messageId: message.id,
        },
      });
    } catch (_notifErr) {
      // Safe to ignore push failure
    }

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      recipientId: message.recipientId,
      content: message.content,
      messageType: message.messageType,
      metadata: message.metadata || null,
      isRead: message.isRead,
      isMine: true,
      createdAt: message.createdAt.toISOString(),
    };
  }

  /**
   * Retrieves conversation threads for the authenticated user
   */
  public async getConversations(userId: string): Promise<ConversationSummaryDTO[]> {
    const conversations = await Conversation.findAll({
      where: {
        [Op.or]: [{ user1Id: userId }, { user2Id: userId }],
      },
      include: [
        {
          model: User,
          as: 'user1',
          include: [{ model: UserPhoto, as: 'photos', where: { status: 'approved' }, required: false }],
        },
        {
          model: User,
          as: 'user2',
          include: [{ model: UserPhoto, as: 'photos', where: { status: 'approved' }, required: false }],
        },
      ],
      order: [['lastMessageAt', 'DESC NULLS LAST']],
    });

    const results: ConversationSummaryDTO[] = [];

    for (const conv of conversations) {
      const partner = conv.user1Id === userId ? (conv as any).user2 : (conv as any).user1;
      if (!partner || !partner.isActive) continue;

      const unreadCount = await ChatMessage.count({
        where: {
          conversationId: conv.id,
          recipientId: userId,
          isRead: false,
        },
      });

      const [u1, u2] = [userId, partner.id].sort();
      const match = await Match.findOne({
        where: { user1Id: u1, user2Id: u2, isActive: true },
        attributes: ['id'],
      });

      results.push({
        id: conv.id,
        targetUser: {
          id: partner.id,
          name: resolveDisplayName(partner),
          username: partner.username || partner.nickName || '',
          profilePhotoUrl: this.resolvePrimaryPhoto(partner.profilePicture, partner.photos),
          isVerified: Boolean(partner.isFaceVerified),
          isSubscribed: Boolean(partner.isSubscribed),
        },
        lastMessage: conv.lastMessage || null,
        lastMessageAt: conv.lastMessageAt ? conv.lastMessageAt.toISOString() : null,
        unreadCount,
        isMatched: Boolean(match),
      });
    }

    return results;
  }

  /**
   * Retrieves paginated messages in a conversation with a specific user
   */
  public async getMessages(
    userId: string,
    targetUserId: string,
    options: { limit?: number; cursor?: string }
  ): Promise<{
    messages: ChatMessageDTO[];
    conversationId: string | null;
    pagination: { limit: number; hasMore: boolean; nextCursor: string | null };
  }> {
    const limit = Math.min(100, Math.max(1, options.limit || 30));
    const [u1, u2] = [userId, targetUserId].sort();

    const conversation = await Conversation.findOne({
      where: { user1Id: u1, user2Id: u2 },
    });

    if (!conversation) {
      return {
        messages: [],
        conversationId: null,
        pagination: { limit, hasMore: false, nextCursor: null },
      };
    }

    const whereClause: any = {
      conversationId: conversation.id,
    };

    if (options.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
        if (decoded.createdAt) {
          whereClause.createdAt = { [Op.lt]: new Date(decoded.createdAt) };
        }
      } catch {
        // Ignore malformed cursor
      }
    }

    const rows = await ChatMessage.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: limit + 1,
    });

    const hasMore = rows.length > limit;
    const itemsToReturn = hasMore ? rows.slice(0, limit) : rows;

    // Mark unread messages as read
    await ChatMessage.update(
      { isRead: true },
      {
        where: {
          conversationId: conversation.id,
          recipientId: userId,
          isRead: false,
        },
      }
    );

    const messages: ChatMessageDTO[] = itemsToReturn.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      recipientId: m.recipientId,
      content: m.content,
      messageType: m.messageType as any,
      metadata: m.metadata || null,
      isRead: m.isRead,
      isMine: m.senderId === userId,
      createdAt: m.createdAt.toISOString(),
    }));

    const nextCursor =
      hasMore && itemsToReturn.length > 0
        ? Buffer.from(
            JSON.stringify({
              createdAt: itemsToReturn[itemsToReturn.length - 1].createdAt.toISOString(),
            })
          ).toString('base64url')
        : null;

    return {
      messages,
      conversationId: conversation.id,
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    };
  }
}

export const chatService = new ChatService();
