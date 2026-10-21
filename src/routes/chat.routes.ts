import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getChatListHandler,
  getConversationsHandler,
  getConversationDetailHandler,
  getMessagesHandler,
  sendMessageHandler,
  sendMultiMessageHandler,
  markReadHandler,
  deliveryReceiptHandler,
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

// 2. GET /api/v1/chat/conversations - List conversations (backward compatibility)
router.get('/conversations', getConversationsHandler);

// 3. POST /api/v1/chats - Start or get 1-to-1 conversation with a recipient
router.post('/', validate(startConversationSchema), startConversationHandler);

// 4. Send Message Endpoints
// Single message / recipient send: POST /messages and POST /send
router.post('/messages', sendMessageHandler);
router.post('/send', sendMessageHandler);
router.post('/bulk-messages', validate(sendMultiMessageSchema), sendMultiMessageHandler);

// 5. Message History by Target User (backward compatibility):
// GET /api/v1/chat/messages/:targetUserId
router.get('/messages/:targetUserId', getMessagesHandler);

// 6. GET /api/v1/chats/:conversationId - Conversation header details and shared interests
router.get('/:conversationId', validate(getConversationDetailSchema), getConversationDetailHandler);

// 7. GET /api/v1/chats/:conversationId/messages - Paginated message history
router.get('/:conversationId/messages', validate(getMessagesSchema), getMessagesHandler);

// 7b. GET /api/v1/chats/:conversationId/messages/pinned - Paginated pinned messages history
router.get('/:conversationId/messages/pinned', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);
router.get('/:conversationId/pinned-messages', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);

// 7c. POST & PATCH /api/v1/chats/:conversationId/messages/:messageId/pin - Pin or unpin message
router.post('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);
router.patch('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);

// 8. POST /api/v1/chats/:conversationId/messages - Send message (text, audio, image)
router.post('/:conversationId/messages', validate(sendMessageSchema), sendMessageHandler);

// 9. POST & PATCH /api/v1/chats/:conversationId/read - Mark conversation messages as read
router.post('/:conversationId/read', validate(markReadSchema), markReadHandler);
router.patch('/:conversationId/read', validate(markReadSchema), markReadHandler);

// 9b. POST & PATCH /api/v1/chats/:conversationId/delivery - Acknowledge delivery receipts
router.post('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);
router.patch('/:conversationId/delivery', validate(deliveryReceiptSchema), deliveryReceiptHandler);

// 10. POST /api/v1/chats/:conversationId/pin - Pin or unpin conversation (or message if messageId provided)
router.post('/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);

// 11. PATCH /api/v1/chats/:conversationId/archive - Archive or unarchive conversation
router.patch('/:conversationId/archive', validate(archiveConversationSchema), archiveConversationHandler);

// 12. DELETE /api/v1/chats/:conversationId - Delete for Me or Delete for Everyone
router.delete('/:conversationId', validate(deleteConversationSchema), deleteConversationHandler);

export default router;
