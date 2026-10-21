import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handleUploadChatMedia } from '../middlewares/upload.middleware';
import {
  getChatListHandler,
  getConversationDetailHandler,
  getMessagesHandler,
  sendMessageHandler,
  sendMultiMessageHandler,
  uploadChatMediaHandler,
  markReadHandler,
  deliveryReceiptHandler,
  syncDeliveredMessagesHandler,
  getUnreadCountHandler,
  pinConversationHandler,
  pinMessageHandler,
  getPinnedMessagesHandler,
  startConversationHandler,
  archiveConversationHandler,
  deleteConversationHandler,
} from '../controllers/chat.controller';
import {
  getChatListSchema,
  getConversationDetailSchema,
  getMessagesSchema,
  sendMessageSchema,
  sendMultiMessageSchema,
  markReadSchema,
  deliveryReceiptSchema,
  syncDeliveredMessagesSchema,
  getUnreadCountSchema,
  pinConversationSchema,
  pinMessageSchema,
  getPinnedMessagesSchema,
  startConversationSchema,
  archiveConversationSchema,
  deleteConversationSchema,
} from '../schemas/chat.schema';

const router = Router();

// All chat routes require JWT authentication
router.use(authenticate);

// 1. GET /api/v1/chats - Chat list with search, pinned section, and unread counts
router.get('/', validate(getChatListSchema), getChatListHandler);

// 1b. GET /api/v1/chats/unread-count - Total or per-conversation unread message counts
router.get('/unread-count', validate(getUnreadCountSchema), getUnreadCountHandler);

// 1c. POST, PATCH, PUT, GET /api/v1/chats/delivered/sync & /delivery/sync - Synchronize delivered messages
router.post('/delivered/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.patch('/delivered/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.put('/delivered/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.get('/delivered/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);

router.post('/delivery/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.patch('/delivery/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.put('/delivery/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);
router.get('/delivery/sync', validate(syncDeliveredMessagesSchema), syncDeliveredMessagesHandler);

// 2. POST /api/v1/chats - Start or get 1-to-1 conversation with a recipient
router.post('/', validate(startConversationSchema), startConversationHandler);

// 2b. POST /api/v1/chats/messages - Send message to one or multiple recipients (WhatsApp-style broadcast/multi-send)
// Supports JSON payload and direct multipart/form-data media file upload to AWS S3
router.post('/messages', handleUploadChatMedia, validate(sendMultiMessageSchema), sendMultiMessageHandler);

// 2c. Dedicated S3 Chat Media Upload & Presigned URL Endpoints
// Supports POST /api/v1/chats/upload, POST /api/v1/chats/media
router.post('/upload', handleUploadChatMedia, uploadChatMediaHandler);
router.post('/media', handleUploadChatMedia, uploadChatMediaHandler);

// 3. GET /api/v1/chats/:conversationId - Conversation header details and shared interests
router.get('/:conversationId', validate(getConversationDetailSchema), getConversationDetailHandler);

// 3b. POST /api/v1/chats/:conversationId/upload & media - Conversation-scoped S3 media upload
router.post('/:conversationId/upload', handleUploadChatMedia, uploadChatMediaHandler);
router.post('/:conversationId/media', handleUploadChatMedia, uploadChatMediaHandler);

// 4. GET /api/v1/chats/:conversationId/messages - Paginated message history
router.get('/:conversationId/messages', validate(getMessagesSchema), getMessagesHandler);

// 4b. GET /api/v1/chats/:conversationId/messages/pinned - Paginated pinned messages history
router.get('/:conversationId/messages/pinned', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);
router.get('/:conversationId/pinned-messages', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);

// 4c. POST & PATCH /api/v1/chats/:conversationId/messages/:messageId/pin - Pin or unpin message
router.post('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);
router.patch('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);

// 5. POST /api/v1/chats/:conversationId/messages - Send message (text, audio, image)
// Supports JSON payload, base64 payload, and direct multipart/form-data media file upload to AWS S3
router.post('/:conversationId/messages', handleUploadChatMedia, validate(sendMessageSchema), sendMessageHandler);

// 6. POST & PATCH /api/v1/chats/:conversationId/read - Mark conversation messages as read
router.post('/:conversationId/read', validate(markReadSchema), markReadHandler);
router.patch('/:conversationId/read', validate(markReadSchema), markReadHandler);

// 6b. POST & PATCH /api/v1/chats/:conversationId/delivery - Acknowledge delivery receipts
router.post('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.patch('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);

// 7. POST /api/v1/chats/:conversationId/pin - Pin or unpin conversation (or message if messageId provided)
router.post('/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);

// 8. PATCH /api/v1/chats/:conversationId/archive - Archive or unarchive conversation
router.patch('/:conversationId/archive', validate(archiveConversationSchema), archiveConversationHandler);

// 9. DELETE /api/v1/chats/:conversationId - Delete for Me or Delete for Everyone
router.delete('/:conversationId', validate(deleteConversationSchema), deleteConversationHandler);

export default router;
