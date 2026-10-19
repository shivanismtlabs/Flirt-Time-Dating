import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
  getChatListHandler,
  getConversationDetailHandler,
  getMessagesHandler,
  sendMessageHandler,
  markReadHandler,
  pinConversationHandler,
  startConversationHandler,
} from '../controllers/chat.controller';
import {
  getChatListSchema,
  getConversationDetailSchema,
  getMessagesSchema,
  sendMessageSchema,
  markReadSchema,
  pinConversationSchema,
  startConversationSchema,
} from '../schemas/chat.schema';

const router = Router();

// All chat routes require JWT authentication
router.use(authenticate);

// 1. GET /api/v1/chats - Chat list with search, pinned section, and unread counts
router.get('/', validate(getChatListSchema), getChatListHandler);

// 2. POST /api/v1/chats - Start or get 1-to-1 conversation with a recipient
router.post('/', validate(startConversationSchema), startConversationHandler);

// 3. GET /api/v1/chats/:conversationId - Conversation header details and shared interests
router.get('/:conversationId', validate(getConversationDetailSchema), getConversationDetailHandler);

// 4. GET /api/v1/chats/:conversationId/messages - Paginated message history
router.get('/:conversationId/messages', validate(getMessagesSchema), getMessagesHandler);

// 5. POST /api/v1/chats/:conversationId/messages - Send message (text, audio, image)
router.post('/:conversationId/messages', validate(sendMessageSchema), sendMessageHandler);

// 6. POST /api/v1/chats/:conversationId/read - Mark conversation messages as read
router.post('/:conversationId/read', validate(markReadSchema), markReadHandler);

// 7. POST /api/v1/chats/:conversationId/pin - Pin or unpin conversation
router.post('/:conversationId/pin', validate(pinConversationSchema), pinConversationHandler);

export default router;
