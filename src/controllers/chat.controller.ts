import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { chatService, ChatServiceError } from '../services/chat.service';
import { sendMessageSchema, getMessagesSchema } from '../schemas/chat.schema';

/**
 * Send Message Endpoint
 * POST /api/v1/chat/messages (and /api/v1/chat/send)
 * Enforces Free Tier Rule: 403 MATCH_REQUIRED_TO_CHAT if sender is free and not matched.
 * Premium users (isSubscribed === true) are permitted to chat without a match.
 */
export const sendMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const parseResult = sendMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || 'Invalid message payload';
      return sendError(res, firstError, 400, 'VALIDATION_ERROR');
    }

    const message = await chatService.sendMessage(currentUserId, parseResult.data);
    return sendSuccess(res, 'Message sent successfully', message, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Chat Controller Send Error]:', error);
    return sendError(res, error.message || 'Error sending message', 500, 'INTERNAL_SERVER_ERROR');
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
 * Get Message History with a Target User
 * GET /api/v1/chat/messages/:targetUserId
 */
export const getMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const rawTarget = req.params.targetUserId || req.params.recipientId;
    const targetUserId = Array.isArray(rawTarget) ? rawTarget[0] : rawTarget;
    if (!targetUserId) {
      return sendError(res, 'Target user ID is required', 400, 'VALIDATION_ERROR');
    }

    const parseResult = getMessagesSchema.safeParse(req.query);
    const options = parseResult.success ? parseResult.data : {};

    const result = await chatService.getMessages(currentUserId, targetUserId, options);
    return sendSuccess(res, 'Messages fetched successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    console.error('[Chat Controller Messages Error]:', error);
    return sendError(res, error.message || 'Error fetching messages', 500, 'INTERNAL_SERVER_ERROR');
  }
};
