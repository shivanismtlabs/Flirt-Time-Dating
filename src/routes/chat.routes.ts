import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handleUploadChatMedia } from '../middlewares/upload.middleware';
import {
  getChatListHandler,
  getConversationsHandler,
  getConversationDetailHandler,
  getMessagesHandler,
  sendMessageHandler,
  sendMultiMessageHandler,
  forwardMessagesHandler,
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
  editMessageHandler,
  replyMessageHandler,
  deleteMessageHandler,
  reactMessageHandler,
} from '../controllers/chat.controller';
import {
  getChatListSchema,
  getConversationDetailSchema,
  getMessagesSchema,
  sendMessageSchema,
  sendMultiMessageSchema,
  forwardMessagesSchema,
  markReadSchema,
  deliveryReceiptSchema,
  conversationDeliveredSchema,
  syncDeliveredMessagesSchema,
  getUnreadCountSchema,
  pinConversationSchema,
  pinMessageSchema,
  getPinnedMessagesSchema,
  startConversationSchema,
  archiveConversationSchema,
  deleteConversationSchema,
  deleteMessageSchema,
  editMessageSchema,
  replyMessageSchema,
  reactMessageSchema,
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

// 2. GET /api/v1/chat/conversations - List conversations (backward compatibility)
router.get('/conversations', getConversationsHandler);

// 3. POST /api/v1/chats - Start or get 1-to-1 conversation with a recipient
router.post('/', validate(startConversationSchema), startConversationHandler);

// 4. Send Message Endpoints
// Single or multi-recipient send with multipart/form-data S3 upload support:
router.post('/messages', handleUploadChatMedia, validate(sendMultiMessageSchema), sendMultiMessageHandler);
router.post('/send', handleUploadChatMedia, sendMessageHandler);
router.post('/bulk-messages', handleUploadChatMedia, validate(sendMultiMessageSchema), sendMultiMessageHandler);

// 4a. Forward Single/Multiple Messages to Single/Multiple Recipients
router.post('/messages/forward', validate(forwardMessagesSchema), forwardMessagesHandler);

// 4b. Dedicated S3 Chat Media Upload & Presigned URL Endpoints
// Supports POST /api/v1/chats/upload, POST /api/v1/chats/media
router.post('/upload', handleUploadChatMedia, uploadChatMediaHandler);
router.post('/media', handleUploadChatMedia, uploadChatMediaHandler);

// 5. Message History by Target User (backward compatibility):
// GET /api/v1/chat/messages/:targetUserId
router.get('/messages/:targetUserId', getMessagesHandler);

// 6. GET /api/v1/chats/:conversationId - Conversation header details and shared interests
router.get('/:conversationId', validate(getConversationDetailSchema), getConversationDetailHandler);

// 6b. POST /api/v1/chats/:conversationId/upload & media - Conversation-scoped S3 media upload
router.post('/:conversationId/upload', handleUploadChatMedia, uploadChatMediaHandler);
router.post('/:conversationId/media', handleUploadChatMedia, uploadChatMediaHandler);

// 7. GET /api/v1/chats/:conversationId/messages - Paginated message history
router.get('/:conversationId/messages', validate(getMessagesSchema), getMessagesHandler);

// 7b. GET /api/v1/chats/:conversationId/messages/pinned - Paginated pinned messages history
router.get('/:conversationId/messages/pinned', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);
router.get('/:conversationId/pinned-messages', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);

// 7c. POST & PATCH /api/v1/chats/:conversationId/messages/:messageId/pin - Pin or unpin message
router.post('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);
router.patch('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);

// 8. POST /api/v1/chats/:conversationId/messages - Send message (text, audio, image)
// Supports JSON payload, base64 payload, and direct multipart/form-data media file upload to AWS S3
router.post('/:conversationId/messages', handleUploadChatMedia, validate(sendMessageSchema), sendMessageHandler);
router.post('/conversations/:conversationId/messages', handleUploadChatMedia, validate(sendMessageSchema), sendMessageHandler);

// 8b. PATCH & PUT /api/v1/chats/:conversationId/messages/:messageId - Edit message
router.patch('/:conversationId/messages/:messageId', validate(editMessageSchema), editMessageHandler);
router.put('/:conversationId/messages/:messageId', validate(editMessageSchema), editMessageHandler);

// 8c. POST /api/v1/chats/:conversationId/messages/:messageId/reply - Reply to message
router.post(
  '/:conversationId/messages/:messageId/reply',
  handleUploadChatMedia,
  validate(replyMessageSchema),
  replyMessageHandler
);

// 8d. DELETE /api/v1/chats/:conversationId/messages/:messageId - Delete for Me or Delete for Everyone
router.delete('/:conversationId/messages/:messageId', validate(deleteMessageSchema), deleteMessageHandler);

// 8e. POST /api/v1/chats/:conversationId/messages/:messageId/reactions - Add, change, or remove (toggle) emoji reaction
router.post(
  '/:conversationId/messages/:messageId/reactions',
  validate(reactMessageSchema),
  reactMessageHandler
);
router.post(
  '/:conversationId/messages/:messageId/react',
  validate(reactMessageSchema),
  reactMessageHandler
);
router.post(
  '/:conversationId/messages/:messageId/reaction',
  validate(reactMessageSchema),
  reactMessageHandler
);
router.put(
  '/:conversationId/messages/:messageId/reactions',
  validate(reactMessageSchema),
  reactMessageHandler
);
router.patch(
  '/:conversationId/messages/:messageId/reactions',
  validate(reactMessageSchema),
  reactMessageHandler
);

// 9. POST & PATCH /api/v1/chats/:conversationId/read - Mark conversation messages as read
router.post('/:conversationId/read', validate(markReadSchema), markReadHandler);
router.patch('/:conversationId/read', validate(markReadSchema), markReadHandler);
router.post('/conversations/:conversationId/read', validate(markReadSchema), markReadHandler);
router.patch('/conversations/:conversationId/read', validate(markReadSchema), markReadHandler);

// 9b. POST, PATCH, PUT, GET /api/v1/chats/:conversationId/delivery - Acknowledge delivery receipts
router.post('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.patch('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.put('/:conversationId/delivery', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.get('/:conversationId/delivery', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.post('/conversations/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.patch('/conversations/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.put('/conversations/:conversationId/delivery', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.get('/conversations/:conversationId/delivery', validate(conversationDeliveredSchema), deliveryReceiptHandler);

// 9c. POST, PATCH, PUT, GET /api/v1/chats/:conversationId/delivered - Acknowledge delivery receipts (canonical alias)
router.post('/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.patch('/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.put('/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.get('/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.post('/conversations/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.patch('/conversations/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.put('/conversations/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);
router.get('/conversations/:conversationId/delivered', validate(conversationDeliveredSchema), deliveryReceiptHandler);

// 10. PATCH & POST /api/v1/chat/conversations/:conversationId/pin & /api/v1/chats/:conversationId/pin - Pin or unpin conversation
router.patch('/conversations/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);
router.patch('/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);
router.post('/conversations/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);
router.post('/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);

// 11. PATCH /api/v1/chats/:conversationId/archive - Archive or unarchive conversation
router.patch('/conversations/:conversationId/archive', validate(archiveConversationSchema), archiveConversationHandler);
router.patch('/:conversationId/archive', validate(archiveConversationSchema), archiveConversationHandler);

// 12. DELETE /api/v1/chats/:conversationId - Delete for Me or Delete for Everyone
router.delete('/conversations/:conversationId', validate(deleteConversationSchema), deleteConversationHandler);
router.delete('/:conversationId', validate(deleteConversationSchema), deleteConversationHandler);

export default router;

