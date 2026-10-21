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

  // 1. Event: chat:send_message & message:send
  const handleSendMessage = async (payload: any, callback?: Function) => {
    try {
      if (!payload || typeof payload !== 'object') {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'Payload must be an object',
          });
        }
        return;
      }

      const hasRecipients =
        (Array.isArray(payload.recipientIds) && payload.recipientIds.length > 0) ||
        !!payload.recipientId;

      if (hasRecipients) {
        // Multi / Selected recipients send
        const result = await chatService.sendMultiMessage(currentUserId, {
          recipientIds: payload.recipientIds,
          recipientId: payload.recipientId,
          conversationId: payload.conversationId,
          content: payload.content,
          type: payload.type,
          messageType: payload.messageType,
          clientMessageId: payload.clientMessageId,
          clientMessageIds: payload.clientMessageIds,
          metadata: payload.metadata,
        });

        if (typeof callback === 'function') {
          callback({ success: true, data: result });
        }
        return;
      }

      if (!payload.conversationId) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId, recipientId, or recipientIds is required',
          });
        }
        return;
      }

      const msgType = payload.messageType || payload.type || 'text';
      if ((msgType === 'text' || msgType === 'image') && !payload.content) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'content is required for text and image messages',
          });
        }
        return;
      }

      const messageDto = await chatService.sendMessage(
        currentUserId,
        payload.conversationId,
        {
          content: payload.content,
          messageType: msgType,
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
        recipientIds: payload?.recipientIds,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to send message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('chat:send_message', handleSendMessage);
  socket.on('message:send' as any, handleSendMessage);

  // 2. Event: chat:mark_read & message:read (Read Acknowledgement)
  const handleMarkRead = async (payload: any, callback?: Function) => {
    try {
      if (!payload?.conversationId) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'conversationId is required' });
        }
        return;
      }

      const result = await chatService.markMessagesAsRead(
        currentUserId,
        payload.conversationId,
        payload.lastReadMessageId
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to mark as read' });
      }
    }
  };

  socket.on('chat:mark_read', handleMarkRead);
  socket.on('message:read' as any, handleMarkRead);

  // 2b. Event: chat:message_delivered & message:delivered (Delivery Acknowledgement)
  const handleMessageDelivered = async (payload: any, callback?: Function) => {
    try {
      if (!payload?.conversationId || !Array.isArray(payload.messageIds)) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and messageIds array are required',
          });
        }
        return;
      }

      const result = await chatService.acknowledgeDelivery(
        currentUserId,
        payload.conversationId,
        payload.messageIds
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to acknowledge delivery' });
      }
    }
  };

  socket.on('chat:message_delivered', handleMessageDelivered);
  socket.on('message:delivered' as any, handleMessageDelivered);

  // 2c. Event: chat:delivered_sync & message:delivered_sync
  const handleDeliveredSync = async (payload: any, callback?: Function) => {
    try {
      const conversationId = payload?.conversationId || undefined;
      let messageIds: string[] | undefined;
      if (Array.isArray(payload?.messageIds)) {
        messageIds = payload.messageIds;
      } else if (Array.isArray(payload?.deliveredMessageIds)) {
        messageIds = payload.deliveredMessageIds;
      } else if (typeof payload?.messageId === 'string') {
        messageIds = [payload.messageId];
      }

      const result = await chatService.syncDeliveredMessages(currentUserId, {
        conversationId,
        messageIds,
      });

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err.message || 'Failed to sync delivery' });
      }
    }
  };

  socket.on('chat:delivered_sync', handleDeliveredSync);
  socket.on('message:delivered_sync' as any, handleDeliveredSync);

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

  // 4. Event: conversation:archive
  socket.on('conversation:archive', async (payload: any, callback?: Function) => {
    try {
      if (!payload || typeof payload !== 'object' || !payload.conversationId || typeof payload.isArchived !== 'boolean') {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and boolean isArchived are required',
          });
        }
        return;
      }

      const result = await chatService.archiveConversation(
        currentUserId,
        payload.conversationId,
        payload.isArchived
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling conversation:archive event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to update conversation archive status';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  });

  // 5. Event: conversation:delete
  socket.on('conversation:delete', async (payload: any, callback?: Function) => {
    try {
      if (
        !payload ||
        typeof payload !== 'object' ||
        !payload.conversationId ||
        (payload.deleteType !== 'me' && payload.deleteType !== 'everyone')
      ) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and deleteType ("me" or "everyone") are required',
          });
        }
        return;
      }

      const result = await chatService.deleteConversation(
        currentUserId,
        payload.conversationId,
        payload.deleteType
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling conversation:delete event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to delete conversation';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  });

  // 6. Event: chat:pin_message (Message Pin / Unpin Synchronization)
  socket.on('chat:pin_message', async (payload: any, callback?: Function) => {
    try {
      if (!payload || typeof payload !== 'object' || !payload.conversationId || !payload.messageId) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and messageId are required',
          });
        }
        return;
      }

      const isPinned = payload.isPinned !== undefined ? !!payload.isPinned : true;
      const scope = payload.scope === 'conversation' ? 'conversation' : 'user';

      const result = await chatService.pinMessage(
        currentUserId,
        payload.conversationId,
        payload.messageId,
        isPinned,
        scope
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling chat:pin_message event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
        messageId: payload?.messageId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to update message pin status';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  });
};

