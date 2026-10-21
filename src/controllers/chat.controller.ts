import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { chatService, ChatServiceError } from '../services/chat.service';
import { sendSuccess, sendError } from '../utils/response';

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
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to fetch chats', 500);
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
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to fetch conversation details', 500);
  }
};

/**
 * 3. GET /api/v1/chats/:conversationId/messages
 * Fetches message history with chronological ordering and pagination.
 */
export const getMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const result = await chatService.getMessages(currentUserId, conversationId, req.query as any);
    return sendSuccess(res, 'Messages fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to fetch messages', 500);
  }
};

/**
 * 4. POST /api/v1/chats/:conversationId/messages
 * Sends a message (text, audio, or image) with idempotency protection.
 */
export const sendMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const result = await chatService.sendMessage(currentUserId, conversationId, req.body);
    return sendSuccess(res, 'Message sent successfully', result, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode);
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
      return sendError(res, error.message, error.statusCode);
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
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to update delivery receipts', 500);
  }
};

/**
 * 5c. GET /api/v1/chats/unread-count
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
      return sendError(res, error.message, error.statusCode);
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
      return sendError(res, error.message, error.statusCode);
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
      return sendError(res, error.message, error.statusCode);
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
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to delete conversation', 500);
  }
};

