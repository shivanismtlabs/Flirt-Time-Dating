import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import {
  sendMessageHandler,
  getConversationsHandler,
  getMessagesHandler,
} from '../controllers/chat.controller';

const router = Router();

// All chat routes require authentication
router.use(authenticate);

// 1. Send Message (POST /api/v1/chat/messages and /api/v1/chat/send)
router.post('/messages', sendMessageHandler);
router.post('/send', sendMessageHandler);

// 2. List Conversations (GET /api/v1/chat/conversations)
router.get('/conversations', getConversationsHandler);

// 3. Message History (GET /api/v1/chat/messages/:targetUserId and GET /api/v1/chat/:targetUserId)
router.get('/messages/:targetUserId', getMessagesHandler);
router.get('/:targetUserId', getMessagesHandler);

export default router;
