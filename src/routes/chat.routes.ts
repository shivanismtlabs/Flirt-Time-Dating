import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getChatListHandler,
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

// 2. POST /api/v1/chats - Start or get 1-to-1 conversation with a recipient
router.post('/', validate(startConversationSchema), startConversationHandler);

// 2b. POST /api/v1/chats/messages - Send message to one or multiple recipients (WhatsApp-style broadcast/multi-send)
router.post('/messages', validate(sendMultiMessageSchema), sendMultiMessageHandler);

// 3. GET /api/v1/chats/:conversationId - Conversation header details and shared interests
router.get('/:conversationId', validate(getConversationDetailSchema), getConversationDetailHandler);

// 4. GET /api/v1/chats/:conversationId/messages - Paginated message history
router.get('/:conversationId/messages', validate(getMessagesSchema), getMessagesHandler);

// 4b. GET /api/v1/chats/:conversationId/messages/pinned - Paginated pinned messages history
router.get('/:conversationId/messages/pinned', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);
router.get('/:conversationId/pinned-messages', validate(getPinnedMessagesSchema), getPinnedMessagesHandler);

// 4c. POST & PATCH /api/v1/chats/:conversationId/messages/:messageId/pin - Pin or unpin message
router.post('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);
router.patch('/:conversationId/messages/:messageId/pin', validate(pinMessageSchema), pinMessageHandler);

// 5. POST /api/v1/chats/:conversationId/messages - Send message (text, audio, image)
router.post('/:conversationId/messages', validate(sendMessageSchema), sendMessageHandler);

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
