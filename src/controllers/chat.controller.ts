import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/auth.middleware';
import { sendSuccess, sendError } from '../utils/response';
import { chatService, ChatServiceError } from '../services/chat.service';
import { s3Service } from '../services/s3.service';

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

    // If recipientIds is provided, delegate to multi-message handler
    if (
      (Array.isArray(req.body?.recipientIds) && req.body.recipientIds.length > 0) ||
      (typeof req.body?.recipientIds === 'string' && req.body.recipientIds.trim())
    ) {
      return sendMultiMessageHandler(req, res);
    }

    const conversationId = req.params.conversationId as string | undefined;

    const messagePayload = {
      ...req.body,
      file: req.file,
      files: req.files,
    };

    if (conversationId) {
      const result = await chatService.sendMessage(currentUserId, conversationId, messagePayload);
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    const recipientId =
      (Array.isArray(req.body?.recipientIds) && req.body.recipientIds.length > 0 ? req.body.recipientIds[0] : undefined) ||
      (typeof req.body?.recipientIds === 'string' ? req.body.recipientIds : undefined) ||
      req.body?.recipientId ||
      req.body?.userId ||
      req.body?.targetUserId ||
      req.body?.participantId;

    if (recipientId) {
      const result = await chatService.sendMessageToRecipient(currentUserId, {
        ...messagePayload,
        recipientId,
      });
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    if (req.body?.conversationId) {
      const result = await chatService.sendMessage(currentUserId, req.body.conversationId, messagePayload);
      return sendSuccess(res, 'Message sent successfully', result, 201);
    }

    return sendError(res, 'Conversation ID or recipientIds is required', 400, 'VALIDATION_ERROR');
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
 * Supports direct multipart/form-data image/audio file upload to S3.
 */
export const sendMultiMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const result = await chatService.sendMultiMessage(currentUserId, {
      ...req.body,
      file: req.file,
      files: req.files,
    });
    const message =
      result.failureCount === 0
        ? 'Messages sent successfully'
        : result.successCount > 0
          ? 'Messages sent with some delivery failures'
          : 'Failed to deliver messages to all recipients';

    let responseData: any = result;
    if (result.results && result.results.length === 1 && result.results[0]?.status === 'success' && result.results[0]?.message) {
      responseData = {
        ...result.results[0].message,
        ...result,
      };
    }

    return sendSuccess(res, message, responseData, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to send message', 500);
  }
};

/**
 * 4d. POST /api/v1/chats/messages/forward
 * Forward single or multiple messages to single or multiple recipients.
 * Enforces authentication, source message ownership, recipient validation,
 * transaction safety, and 8-pillar Global API Response Standard.
 */
export const forwardMessagesHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const result = await chatService.forwardMessages(currentUserId, req.body);

    const message =
      result.failureCount === 0
        ? 'Messages forwarded successfully'
        : result.successCount > 0
          ? 'Messages forwarded with some delivery failures'
          : 'Failed to forward messages to all recipients';

    let responseData: any = {
      totalCount: result.totalCount,
      successCount: result.successCount,
      failureCount: result.failureCount,
      results: result.results,
    };

    if (result.results && result.results.length === 1 && result.results[0]?.status === 'success') {
      responseData = {
        ...responseData,
        conversationId: result.results[0].conversationId,
        messageId: result.results[0].messageId,
        isForwarded: true,
      };
    }

    return sendSuccess(res, message, responseData, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to forward messages', 500);
  }
};


/**
 * 4c. POST /api/v1/chats/upload, POST /api/v1/chats/media, POST /api/v1/chats/:conversationId/upload
 * S3 image/media upload handler specifically for chat attachments.
 * Accepts direct multipart file upload to S3 or presigned PUT URL generation.
 */
export const uploadChatMediaHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const attachedFiles: Express.Multer.File[] = [];

    if (Array.isArray(req.files) && req.files.length > 0) {
      attachedFiles.push(...req.files);
    } else if (req.files && typeof req.files === 'object') {
      const filesObj = req.files as Record<string, Express.Multer.File[]>;
      for (const list of Object.values(filesObj)) {
        if (Array.isArray(list)) attachedFiles.push(...list);
      }
    }
    if (attachedFiles.length === 0 && req.file) {
      attachedFiles.push(req.file);
    }

    if (attachedFiles.length > 0) {
      const uploadedFiles: Array<{
        key: string;
        imageKey: string;
        url: string;
        imageUrl: string;
        audioUrl?: string;
        voiceUrl?: string;
        mediaUrl: string;
        thumbnailUrl?: string;
        publicUrl: string;
        mimeType: string;
        size: number;
        isAudio: boolean;
      }> = [];

      const uploadedImages: any[] = [];
      let firstAudioUrl: string | undefined;

      for (const file of attachedFiles) {
        const mime = (file.mimetype || '').toLowerCase();
        const origName = (file.originalname || '').toLowerCase();
        const field = (file.fieldname || '').toLowerCase();
        const isAudio =
          mime.startsWith('audio/') ||
          ['audio', 'voice', 'voicenote', 'recording', 'sound'].includes(field) ||
          /\.(mp3|m4a|wav|aac|ogg|webm|caf|3gp|amr|flac|opus)$/i.test(origName);

        let mimeType = file.mimetype || (isAudio ? 'audio/mpeg' : 'image/jpeg');
        if (isAudio && (!mime || mime === 'application/octet-stream' || mime.startsWith('application/'))) {
          if (origName.endsWith('.m4a')) mimeType = 'audio/m4a';
          else if (origName.endsWith('.mp3')) mimeType = 'audio/mpeg';
          else if (origName.endsWith('.wav')) mimeType = 'audio/wav';
          else if (origName.endsWith('.aac')) mimeType = 'audio/aac';
          else if (origName.endsWith('.caf')) mimeType = 'audio/x-caf';
          else if (origName.endsWith('.ogg')) mimeType = 'audio/ogg';
          else if (origName.endsWith('.webm')) mimeType = 'audio/webm';
          else if (origName.endsWith('.3gp') || origName.endsWith('.3gpp')) mimeType = 'audio/3gpp';
          else if (origName.endsWith('.amr')) mimeType = 'audio/amr';
          else if (origName.endsWith('.flac')) mimeType = 'audio/flac';
          else if (origName.endsWith('.opus')) mimeType = 'audio/opus';
          else mimeType = 'audio/m4a';
        }

        const s3Key = await s3Service.uploadMedia(file.buffer, currentUserId, mimeType, 'chat');
        let thumbnailUrl: string | undefined;
        if (mimeType.startsWith('image/')) {
          s3Service.generateAndUploadThumbnail(s3Key, file.buffer).catch(() => {});
          thumbnailUrl = s3Service.getThumbnailUrl(s3Key);
        }

        const publicUrl = s3Service.getPublicUrl(s3Key);
        const item = {
          key: s3Key,
          imageKey: s3Key,
          url: publicUrl,
          imageUrl: publicUrl,
          audioUrl: isAudio ? publicUrl : undefined,
          voiceUrl: isAudio ? publicUrl : undefined,
          mediaUrl: publicUrl,
          thumbnailUrl,
          publicUrl,
          mimeType,
          size: file.size,
          isAudio,
        };

        uploadedFiles.push(item);
        if (!isAudio) {
          uploadedImages.push(item);
        } else if (!firstAudioUrl) {
          firstAudioUrl = publicUrl;
        }
      }

      const primary = uploadedFiles[0];
      return sendSuccess(
        res,
        'Chat media uploaded successfully',
        {
          key: primary.key,
          imageKey: primary.key,
          url: primary.url,
          imageUrl: primary.imageUrl,
          audioUrl: primary.audioUrl || firstAudioUrl,
          voiceUrl: primary.voiceUrl || firstAudioUrl,
          mediaUrl: primary.mediaUrl,
          thumbnailUrl: primary.thumbnailUrl,
          publicUrl: primary.publicUrl,
          mimeType: primary.mimeType,
          size: primary.size,
          files: uploadedFiles,
          images: uploadedImages,
          imageUrls: uploadedImages.map((img) => img.url),
          urls: uploadedFiles.map((f) => f.url),
        },
        201
      );
    }

    // If no file attached, generate presigned S3 upload URL for folder "chat"
    const { mimeType = 'image/jpeg', expiresInSeconds = 900 } = req.body || req.query || {};
    const presignedData = await s3Service.generatePresignedUploadUrl(
      currentUserId,
      mimeType,
      'chat',
      Number(expiresInSeconds) || 900
    );

    return sendSuccess(res, 'Presigned upload URL generated successfully', presignedData, 200);
  } catch (error: any) {
    return sendError(res, error.message || 'Failed to upload chat media', 500);
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
    const body = req.body || {};
    const query = req.query || {};

    const lastReadMessageId =
      body.lastReadMessageId ||
      body.messageId ||
      body.last_read_message_id ||
      body.message_id ||
      (body.id && body.id !== conversationId ? body.id : undefined) ||
      (query.messageId as string) ||
      (query.lastReadMessageId as string);

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
 * 5b. POST / PATCH / PUT / GET /api/v1/chats/:conversationId/delivery & /api/v1/chats/:conversationId/delivered
 * Acknowledges receipt of delivered messages for the recipient.
 */
export const deliveryReceiptHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const conversationId = req.params.conversationId as string;
    const body = req.body || {};
    const query = req.query || {};

    let messageIds: string[] | undefined;
    if (Array.isArray(body.messageIds) && body.messageIds.length > 0) {
      messageIds = body.messageIds;
    } else if (Array.isArray(body.deliveredMessageIds) && body.deliveredMessageIds.length > 0) {
      messageIds = body.deliveredMessageIds;
    } else if (typeof body.messageId === 'string' && body.messageId.trim()) {
      messageIds = [body.messageId.trim()];
    } else if (typeof body.message_id === 'string' && body.message_id.trim()) {
      messageIds = [body.message_id.trim()];
    } else if (typeof query.messageId === 'string' && query.messageId.trim()) {
      messageIds = [query.messageId.trim()];
    } else if (typeof query.message_id === 'string' && query.message_id.trim()) {
      messageIds = [query.message_id.trim()];
    }

    if (messageIds && messageIds.length > 0) {
      const result = await chatService.acknowledgeDelivery(currentUserId, conversationId, messageIds);
      return sendSuccess(res, 'Delivery receipts updated successfully', result, 200);
    } else {
      // If messageIds not specified (e.g. empty body or delivered conversation sync), sync all pending messages in this conversation
      const result = await chatService.syncDeliveredMessages(currentUserId, {
        conversationId,
      });
      return sendSuccess(
        res,
        'Delivery receipts updated successfully',
        {
          conversationId,
          messageIds: result.messageIds,
          deliveredCount: result.deliveredCount,
        },
        200
      );
    }
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
    const recipientId =
      (Array.isArray(req.body.recipientIds) && req.body.recipientIds.length > 0 ? req.body.recipientIds[0] : undefined) ||
      (typeof req.body.recipientIds === 'string' ? req.body.recipientIds : undefined) ||
      req.body.recipientId ||
      req.body.userId ||
      req.body.targetUserId ||
      req.body.participantId;
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

/**
 * 10. PATCH & PUT /api/v1/chats/:conversationId/messages/:messageId
 * Edits a previously sent text message within the allowed 15-minute window.
 */
export const editMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const conversationId = req.params.conversationId as string;
    const messageId = req.params.messageId as string;
    const { content } = req.body;

    const result = await chatService.editMessage(
      currentUserId,
      conversationId,
      messageId,
      content
    );

    return sendSuccess(res, 'Message edited successfully', result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to edit message', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 11. POST /api/v1/chats/:conversationId/messages/:messageId/reply
 * Sends a reply to an existing message in the conversation.
 */
export const replyMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const conversationId = req.params.conversationId as string;
    const replyToMessageId =
      req.params.messageId ||
      req.body?.replyToMessageId ||
      req.body?.parentMessageId ||
      req.body?.replyToId;

    if (!replyToMessageId) {
      return sendError(res, 'Original message ID is required in URL or body', 400, 'VALIDATION_ERROR');
    }

    const messagePayload = {
      ...req.body,
      file: req.file,
      files: req.files,
      replyToMessageId,
    };

    const result = await chatService.replyMessage(
      currentUserId,
      conversationId,
      replyToMessageId,
      messagePayload
    );

    return sendSuccess(res, 'Reply sent successfully', result, 201);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to send reply', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 12. DELETE /api/v1/chats/:conversationId/messages/:messageId
 * Deletes an individual message for requesting user ('me') or recalls it for all participants ('everyone').
 */
export const deleteMessageHandler = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      return sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
    }

    const conversationId = req.params.conversationId as string;
    const messageId = req.params.messageId as string;
    const rawDeleteType = req.body?.deleteType || req.query?.deleteType;
    if (!rawDeleteType || (rawDeleteType !== 'me' && rawDeleteType !== 'everyone')) {
      return sendError(res, 'deleteType must be either "me" or "everyone"', 400, 'VALIDATION_ERROR');
    }
    const deleteType = rawDeleteType as 'me' | 'everyone';

    const result = await chatService.deleteMessage(currentUserId, conversationId, messageId, deleteType);
    const message =
      deleteType === 'everyone'
        ? 'Message deleted for everyone successfully'
        : 'Message deleted successfully';
    return sendSuccess(res, message, result, 200);
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      return sendError(res, error.message, error.statusCode, error.errorCode);
    }
    return sendError(res, error.message || 'Failed to delete message', 500, 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * 18. POST /api/v1/chats/:conversationId/messages/:messageId/reactions
 * Add, change, or remove (toggle) an emoji reaction on a message.
 */
export const reactMessageHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const currentUserId = (req as any).user?.id || (req as any).userId;
    if (!currentUserId) {
      sendError(res, 'Authentication token missing or invalid', 401, 'UNAUTHORIZED');
      return;
    }

    const conversationId = req.params.conversationId as string;
    const messageId = req.params.messageId as string;
    const emoji = req.body?.emoji || req.body?.reaction || req.body?.reactionEmoji;

    if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
      sendError(res, 'Reaction emoji is required', 400, 'VALIDATION_ERROR');
      return;
    }

    const result = await chatService.reactToMessage(
      currentUserId,
      conversationId,
      messageId,
      emoji
    );

    const message =
      result.action === 'added'
        ? 'Reaction added successfully'
        : result.action === 'updated'
        ? 'Reaction updated successfully'
        : 'Reaction removed successfully';

    sendSuccess(res, message, result, 200);
    return;
  } catch (error: any) {
    if (error instanceof ChatServiceError) {
      sendError(res, error.message, error.statusCode, error.errorCode);
      return;
    }
    sendError(res, error.message || 'Failed to update reaction', 500, 'INTERNAL_SERVER_ERROR');
    return;
  }
};

