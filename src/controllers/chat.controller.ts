import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { chatService, ChatServiceError } from '../services/chat.service';

/**
 * 1. GET /api/v1/chats
 * Fetches user chat list with search, pinned chats, and latest message previews.
 */
export const getChatListHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const result = await chatService.getChatList(currentUserId, req.query as any);
    return sendSuccess(res, 'Chats fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to fetch chats', 500);
  }
};

/**
 * List Conversations Endpoint
 * GET /api/v1/chat/conversations
 */
export const getConversationsHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const conversations = await chatService.getConversations(currentUserId);
    return sendSuccess(res, 'Conversations fetched successfully', conversations, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Chat Controller Conversations Error]:', error);
    return sendError(res, error.message || 'Error fetching conversations', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 2. GET /api/v1/chats/:conversationId
 * Fetches conversation header details, target participant info, and common interests.
 */
export const getConversationDetailHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const result = await chatService.getConversationDetail(currentUserId, conversationId);
    return sendSuccess(res, 'Conversation details fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to fetch conversation details', 500);
  }
};

/**
 * 3. GET Message History
 * Supports both:
 * - GET /api/v1/chats/:conversationId/messages
 * - GET /api/v1/chat/messages/:targetUserId and GET /api/v1/chat/:targetUserId
 */
export const getMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const conversationId = req.params.conversationId as string | undefined;
    const rawTarget = req.params.targetUserId || req.params.recipientId;
    const targetUserId = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;

    if (conversationId) {
      const result = await chatService.getMessages(currentUserId, conversationId, req.query as any);
      return sendSuccess(res, 'Messages fetched successfully', result, 200);
    }

    if (targetUserId) {
      const result = await chatService.getMessagesByUserId(currentUserId, targetUserId, req.query as any);
      return sendSuccess(res, 'Messages fetched successfully', result, 200);
    }

    return sendError(res, 'Conversation ID or Target User ID is required', 400, 'VALIDATION_ERROR');
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Chat Controller Messages Error]:', error);
    return sendError(res, error.message || 'Error fetching messages', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 4. Send Message Endpoint
 * Supports both:
 * - POST /api/v1/chats/:conversationId/messages
 * - POST /api/v1/chat/messages and /api/v1/chat/send (with recipientId in body)
 * Enforces Free Tier Rule: 403 MATCH_REQUIRED_TO_CHAT if sender is free and not matched.
 * Premium users (isSubscribed === true) are permitted to chat without a match.
 */
export const sendMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    // If multiple recipients are provided, delegate to multi-message handler
    if (Array.isArray(req.body?.recipientIds) && req.body.recipientIds.length > 1) {
      return sendMultiMessageHandler(req, res);
    }

    const conversationId = req.params.conversationId as string | undefined;

    if (conversationId) {
      const result = await chatService.sendMessage(currentUserId, conversationId, req.body);
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    if (req.body?.recipientId) {
      const result = await chatService.sendMessageToRecipient(currentUserId, req.body);
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    if (req.body?.conversationId) {
      const result = await chatService.sendMessage(currentUserId, req.body.conversationId, req.body);
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    return sendError(res, 'Conversation ID in URL or recipientId in body is required', 400, 'VALIDATION_ERROR');
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Chat Controller Send Error]:', error);
    return sendError(res, error.message || 'Error sending message', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 4b. POST /api/v1/chat/messages & /api/v1/chats/messages
 * Sends a message to one person or multiple selected recipients (WhatsApp style multi-send).
 */
export const sendMultiMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const result = await chatService.sendMultiMessage(currentUserId, req.body);
    const message =
      result.failureCount === 0
        ? 'Messages sent successfully'
        : result.successCount > 0
          ? 'Messages sent with some delivery failures'
          : 'Failed to deliver messages to all recipients';
    return sendSuccess(res, message, result, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to send message', 500);
  }
};

/**
 * 5. POST / PATCH /api/v1/chats/:conversationId/read
 * Marks unread messages in the conversation as read up to lastReadMessageId (or all if omitted).
 */
export const markReadHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const lastReadMessageId = req.body?.lastReadMessageId;
    const result = await chatService.markMessagesAsRead(currentUserId, conversationId, lastReadMessageId);
    return sendSuccess(res, 'Messages marked as read', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to mark messages as read', 500);
  }
};

/**
 * 5b. POST / PATCH /api/v1/chats/:conversationId/delivery
 * Acknowledges receipt of delivered messages for the recipient.
 */
export const deliveryReceiptHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const { messageIds } = req.body;
    const result = await chatService.acknowledgeDelivery(currentUserId, conversationId, messageIds);
    return sendSuccess(res, 'Delivery receipts updated successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to update delivery receipts', 500);
  }
};

/**
 * 5c. POST / PATCH / PUT / GET /api/v1/chats/delivered/sync & /delivery/sync
 * Synchronizes delivery status for pending or specified messages for the recipient.
 */
export const syncDeliveredMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const body = req.body || {};
    const query = req.query || {};

    const conversationId = (body.conversationId || query.conversationId) as string | undefined;

    let messageIds: string[] | undefined;
    if (Array.isArray(body.messageIds)) {
      messageIds = body.messageIds;
    } else if (Array.isArray(body.deliveredMessageIds)) {
      messageIds = body.deliveredMessageIds;
    } else if (Array.isArray(body.messages)) {
      messageIds = body.messages.map((m: any) => (typeof m === 'string' ? m : m?.id)).filter(Boolean);
    } else if (typeof body.messageId === 'string') {
      messageIds = [body.messageId];
    }

    const result = await chatService.syncDeliveredMessages(currentUserId, {
      conversationId: conversationId || null,
      messageIds,
    });

    return sendSuccess(res, 'Delivery status synchronized successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to synchronize delivery status', 500);
  }
};

/**
 * 5d. GET /api/v1/chats/unread-count
 * Retrieves unread message count for a specific conversation or total across all conversations.
 */
export const getUnreadCountHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.query.conversationId as string | undefined;

    if (conversationId) {
      const unreadCount = await chatService.getConversationUnreadCount(currentUserId, conversationId);
      return sendSuccess(res, 'Unread count retrieved successfully', { conversationId, unreadCount }, 200);
    }

    const result = await chatService.getTotalUnreadCount(currentUserId);
    return sendSuccess(res, 'Total unread count retrieved successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to retrieve unread count', 500);
  }
};

/**
 * 6. POST /api/v1/chats/:conversationId/pin
 * Pins or unpins a conversation (or message if messageId provided) for the current user.
 */
export const pinConversationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const { isPinned, messageId, scope } = req.body;

    if (messageId) {
      const result = await chatService.pinMessage(currentUserId, conversationId, messageId, isPinned, scope);
      const message = isPinned ? 'Message pinned successfully' : 'Message unpinned successfully';
      return sendSuccess(res, message, result, 200);
    }

    const result = await chatService.pinConversation(currentUserId, conversationId, isPinned);
    const message = isPinned ? 'Conversation pinned successfully' : 'Conversation unpinned successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to update pin status', 500);
  }
};

/**
 * 6b. POST / PATCH /api/v1/chats/:conversationId/messages/:messageId/pin
 * Pins or unpins a message inside a conversation.
 */
export const pinMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const messageId = req.params.messageId as string;
    const isPinned = req.body?.isPinned !== undefined ? req.body.isPinned : true;
    const scope = req.body?.scope || 'user';
    const result = await chatService.pinMessage(currentUserId, conversationId, messageId, isPinned, scope);
    const message = isPinned ? 'Message pinned successfully' : 'Message unpinned successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to update message pin status', 500);
  }
};

/**
 * 6c. GET /api/v1/chats/:conversationId/messages/pinned
 * Fetches pinned messages for the authorized conversation.
 */
export const getPinnedMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const result = await chatService.getPinnedMessages(currentUserId, conversationId, req.query as any);
    return sendSuccess(res, 'Pinned messages fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to fetch pinned messages', 500);
  }
};

/**
 * 7. POST /api/v1/chats
 * Initiates or returns an existing conversation with the recipient.
 */
export const startConversationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const { recipientId } = req.body;
    const result = await chatService.startConversation(currentUserId, recipientId);
    const message = result.isNew ? 'Conversation created successfully' : 'Conversation retrieved successfully';
    return sendSuccess(res, message, result, result.isNew ? 201 : 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to initiate conversation', 500);
  }
};

/**
 * 8. PATCH /api/v1/chats/:conversationId/archive or /api/v1/chat/conversations/:conversationId/archive
 * Archives or unarchives a conversation for the authenticated user.
 */
export const archiveConversationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const { isArchived } = req.body;
    const result = await chatService.archiveConversation(currentUserId, conversationId, isArchived);
    const message = isArchived ? 'Conversation archived successfully' : 'Conversation unarchived successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to update conversation archive status', 500);
  }
};

/**
 * 9. DELETE /api/v1/chats/:conversationId or /api/v1/chat/conversations/:conversationId
 * Deletes conversation for requesting user ('me') or for all participants ('everyone').
 */
export const deleteConversationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const { deleteType } = req.body;
    const result = await chatService.deleteConversation(currentUserId, conversationId, deleteType);
    const message = deleteType === 'everyone' ? 'Conversation deleted for everyone successfully' : 'Conversation deleted successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to delete conversation', 500);
  }
};
