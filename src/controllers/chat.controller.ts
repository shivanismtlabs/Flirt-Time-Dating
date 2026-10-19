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
 * 5. POST /api/v1/chats/:conversationId/read
 * Marks unread messages in the conversation as read.
 */
export const markReadHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const result = await chatService.markMessagesAsRead(currentUserId, conversationId);
    return sendSuccess(res, 'Messages marked as read', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to mark messages as read', 500);
  }
};

/**
 * 6. POST /api/v1/chats/:conversationId/pin
 * Pins or unpins a conversation for the current user.
 */
export const pinConversationHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const { isPinned } = req.body;
    const result = await chatService.pinConversation(currentUserId, conversationId, isPinned);
    const message = isPinned ? 'Conversation pinned successfully' : 'Conversation unpinned successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode);
    }
    return sendError(res, error.message || 'Failed to update pin status', 500);
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
