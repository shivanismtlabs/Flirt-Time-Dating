/**
 * FlirtTime Real-Time Socket Chat Event Handlers
 * Attaches real-time messaging listeners to authenticated socket connections.
 * Routes message persistence through the authoritative chatService.
 */

import { AppSocket, AppSocketServer } from './socket.types';
import { chatService, ChatServiceError } from '../services/chat.service';
import { Conversation, UserBlock } from '../models';
import { Op } from 'sequelize';
import { getUserRoomName } from './socket.lifecycle';
import { socketLogger } from './socket.errors';

export const registerChatSocketHandlers = (
  socket: AppSocket,
  io: AppSocketServer
): void => {
  const currentUserId = socket.data.user.userId;

  // 1. Event: chat:send_message
  socket.on('chat:send_message', async (payload: any, callback?: Function) => {
    try {
      if (!payload || typeof payload !== 'object' || !payload.conversationId || !payload.content) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and content are required',
          });
        }
        return;
      }

      const messageDto = await chatService.sendMessage(
        currentUserId,
        payload.conversationId,
        {
          content: payload.content,
          messageType: payload.messageType || 'text',
          clientMessageId: payload.clientMessageId,
          metadata: payload.metadata,
        }
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: messageDto });
      }
    } catch (err: any) {
      socketLogger.error('Error handling chat:send_message event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to send message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  });

  // 2. Event: chat:mark_read
  socket.on('chat:mark_read', async (payload: any, callback?: Function) => {
    try {
      if (!payload?.conversationId) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'conversationId is required' });
        }
        return;
      }

      const result = await chatService.markMessagesAsRead(
        currentUserId,
        payload.conversationId
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to mark as read' });
      }
    }
  });

  // 3. Event: chat:typing
  socket.on('chat:typing', async (payload: any) => {
    try {
      if (!payload?.conversationId || typeof payload.isTyping !== 'boolean') {
        return;
      }

      const conversation = await Conversation.findByPk(payload.conversationId, {
        attributes: ['id', 'user1Id', 'user2Id'],
      });

      if (!conversation) return;
      if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
        return;
      }

      const otherUserId =
        conversation.user1Id === currentUserId
          ? conversation.user2Id
          : conversation.user1Id;

      // Ensure blocked users do not receive typing events
      const isBlocked = await UserBlock.findOne({
        where: {
          [Op.or]: [
            { userId: currentUserId, blockedUserId: otherUserId },
            { userId: otherUserId, blockedUserId: currentUserId },
          ],
        },
      });
      if (isBlocked) return;

      io.to(getUserRoomName(otherUserId)).emit('chat:typing', {
        conversationId: payload.conversationId,
        userId: currentUserId,
        isTyping: payload.isTyping,
      });
    } catch {}
  });
};
