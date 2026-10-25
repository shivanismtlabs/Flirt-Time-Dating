/**
 * FlirtTime Real-Time Socket Chat Event Handlers
 * Attaches real-time messaging listeners to authenticated socket connections.
 * Routes message persistence through the authoritative chatService.
 */

import { AppSocket, AppSocketServer } from './socket.types';
import { chatService, ChatServiceError, coerceMediaList } from '../services/chat.service';
import { audioReferenceFromPayload } from '../utils/chatMediaKind';
import { ChatMessage, Conversation, UserBlock } from '../models';
import { Op } from 'sequelize';
import { getUserRoomName, setConversationViewing } from './socket.lifecycle';
import { socketLogger } from './socket.errors';

const inflightChatSends = new Map<string, Promise<any>>();
const recentChatSends = new Map<string, { at: number; event: string; response: any }>();

/** Same payload fired on chat:send_message and message:send must not insert twice. */
const chatSendFingerprint = (userId: string, payload: any): string => {
  const clientId = String(payload?.clientMessageId || payload?.clientMsgId || '').trim();
  const conversationId = String(
    payload?.conversationId || payload?.conversation_id || payload?.chatId || ''
  ).trim();
  const recipient = String(
    payload?.recipientId ||
      payload?.receiverId ||
      payload?.targetUserId ||
      payload?.participantId ||
      payload?.userId ||
      ''
  ).trim();
  const content = String(
    payload?.content || payload?.body || payload?.text || payload?.message || ''
  ).trim();
  const type = String(payload?.messageType || payload?.type || '').trim();
  const media = JSON.stringify([
    payload?.imageUrl || payload?.image || '',
    payload?.audioUrl || payload?.audio || payload?.voiceUrl || '',
    payload?.images || payload?.imageUrls || payload?.mediaUrls || '',
  ]);
  return `${String(userId).toLowerCase()}|${clientId}|${conversationId}|${recipient}|${type}|${content}|${media}`;
};

export const registerChatSocketHandlers = (
  socket: AppSocket,
  io: AppSocketServer
): void => {
  const currentUserId = socket.data.user.userId;

  // 1. Event: chat:send_message & message:send
  const handleSendMessage = async (
    payload: any,
    callback?: Function,
    eventName = 'chat:send_message'
  ) => {
    const caller = callback;
    let settled = false;
    const finish = (response: any) => {
      socket.emit('chat:message:send:ack' as any, response);
      if (typeof caller === 'function') caller(response);
    };
    const complete = (response: any) => {
      if (settled) return;
      settled = true;
      finish(response);
    };

    const fingerprint =
      payload && typeof payload === 'object' ? chatSendFingerprint(currentUserId, payload) : '';
    if (fingerprint) {
      const recent = recentChatSends.get(fingerprint);
      if (recent && recent.event !== eventName && Date.now() - recent.at < 2500) {
        if (typeof caller === 'function') caller(recent.response);
        return;
      }
      const pending = inflightChatSends.get(fingerprint);
      if (pending) {
        try {
          const response = await pending;
          if (typeof caller === 'function') caller(response);
        } catch {
          complete({ success: false, error: 'Failed to send message over socket' });
        }
        return;
      }
    }

    let resolveInflight: (value: any) => void = () => undefined;
    const gate = fingerprint
      ? new Promise<any>((resolve) => {
          resolveInflight = resolve;
        })
      : null;
    if (fingerprint && gate) inflightChatSends.set(fingerprint, gate);

    callback = (response: any) => {
      if (fingerprint && response?.success) {
        recentChatSends.set(fingerprint, { at: Date.now(), event: eventName, response });
        const timer = setTimeout(() => {
          const current = recentChatSends.get(fingerprint);
          if (current && current.response === response) recentChatSends.delete(fingerprint);
        }, 2500);
        if (typeof timer.unref === 'function') timer.unref();
      }
      resolveInflight(response);
      if (fingerprint && gate && inflightChatSends.get(fingerprint) === gate) {
        inflightChatSends.delete(fingerprint);
      }
      complete(response);
    };

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

      const normalizedImages = [
        ...coerceMediaList(payload.images),
        ...coerceMediaList(payload.medias),
        ...coerceMediaList(payload.photos),
        ...coerceMediaList(payload.attachments),
        ...coerceMediaList(payload.metadata?.images),
        ...coerceMediaList(payload.metadata?.medias),
        ...coerceMediaList(payload.metadata?.photos),
        ...coerceMediaList(payload.metadata?.attachments),
      ];

      const normalizedImageUrls = [
        ...coerceMediaList(payload.imageUrls),
        ...coerceMediaList(payload.mediaUrls),
        ...coerceMediaList(payload.metadata?.imageUrls),
        ...coerceMediaList(payload.metadata?.mediaUrls),
      ];

      let msgType = payload.messageType || payload.type;
      if (!msgType) {
        const hasImage =
          payload.imageUrl ||
          payload.image ||
          normalizedImages.length > 0 ||
          normalizedImageUrls.length > 0;
        const audioRef = payload.audioUrl || payload.audio || payload.voiceUrl;
        if (hasImage) {
          msgType = 'image';
        } else if (audioRef && !/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)(\?|#|$)/i.test(String(audioRef))) {
          msgType = 'audio';
        } else {
          msgType = 'text';
        }
      }

      let content =
        payload.content ||
        payload.body ||
        payload.text ||
        payload.message ||
        payload.audioUrl ||
        payload.audio ||
        payload.voiceUrl ||
        payload.imageUrl ||
        payload.image ||
        payload.mediaUrl ||
        payload.imageKey ||
        payload.url ||
        payload.fileUrl;

      if (!content) {
        const audioRef = audioReferenceFromPayload(
          payload,
          payload.metadata,
          msgType === 'audio' || msgType === 'voice'
        );
        if (audioRef) content = audioRef;
      }
      if (!content && normalizedImages.length > 0) {
        const firstImg = normalizedImages[0];
        content =
          typeof firstImg === 'string'
            ? firstImg
            : firstImg?.url ||
              firstImg?.imageUrl ||
              firstImg?.uri ||
              firstImg?.path ||
              firstImg?.mediaUrl ||
              firstImg?.key ||
              '';
      }
      if (!content && normalizedImageUrls.length > 0) {
        content = normalizedImageUrls[0];
      }

      let normalizedRecipientIds: string[] = [];
      if (Array.isArray(payload.recipientIds)) {
        normalizedRecipientIds = payload.recipientIds;
      } else if (typeof payload.recipientIds === 'string' && payload.recipientIds.trim()) {
        const trimmed = payload.recipientIds.trim();
        normalizedRecipientIds = trimmed.includes(',')
          ? trimmed.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [trimmed];
      } else if (payload.recipientId) {
        normalizedRecipientIds = [payload.recipientId];
      } else if (payload.targetUserId) {
        normalizedRecipientIds = [payload.targetUserId];
      } else if (payload.userId) {
        normalizedRecipientIds = [payload.userId];
      } else if (payload.participantId) {
        normalizedRecipientIds = [payload.participantId];
      } else if (payload.receiverId) {
        normalizedRecipientIds = [payload.receiverId];
      } else if (payload.recipient_id) {
        normalizedRecipientIds = [payload.recipient_id];
      }

      const conversationId =
        payload.conversationId ||
        payload.conversation_id ||
        payload.chatId;

      if (conversationId) {
        socket.join(`conversation:${conversationId}`);
        socket.join(`chat:${conversationId}`);
      }

      // 1. If explicit multi-recipient array, delegate to sendMultiMessage
      if (Array.isArray(payload.recipientIds) && payload.recipientIds.length > 0) {
        const result = await chatService.sendMultiMessage(currentUserId, {
          recipientIds: normalizedRecipientIds,
          conversationId,
          content,
          type: msgType,
          messageType: msgType,
          clientMessageId: payload.clientMessageId || payload.clientMsgId,
          clientMessageIds: payload.clientMessageIds,
          metadata: payload.metadata,
          images: normalizedImages.length > 0 ? normalizedImages : undefined,
          imageUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
          mediaUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
          caption: payload.caption,
          duration: payload.duration,
          audioUrl: payload.audioUrl || payload.audio || payload.voiceUrl,
          imageUrl: payload.imageUrl || payload.image,
          mediaUrl: payload.mediaUrl,
        } as any);

        if (result.results && result.results.length > 0) {
          for (const item of result.results) {
            if (item.conversationId) {
              socket.join(`conversation:${item.conversationId}`);
              socket.join(`chat:${item.conversationId}`);
            }
          }
        }

        if (typeof callback === 'function') {
          let callbackData: any = result;
          if (
            result.results &&
            result.results.length === 1 &&
            result.results[0]?.status === 'success' &&
            result.results[0]?.message
          ) {
            callbackData = {
              ...result.results[0].message,
              ...result,
            };
          }
          callback({ success: true, data: callbackData });
        }
        return;
      }

      // 2. If conversationId is provided, authoritative single conversation path
      if (conversationId) {
        if (
          (msgType === 'text' || msgType === 'image' || msgType === 'audio') &&
          !content &&
          normalizedImages.length === 0 &&
          normalizedImageUrls.length === 0
        ) {
          if (typeof callback === 'function') {
            return callback({
              success: false,
              error: `content or media URL is required for ${msgType} messages`,
            });
          }
          return;
        }

        const replyToMessageId =
          payload.replyToMessageId ||
          payload.parentMessageId ||
          payload.replyToId;

        const messageDto = await chatService.sendMessage(
          currentUserId,
          conversationId,
          {
            content,
            messageType: msgType,
            clientMessageId: payload.clientMessageId || payload.clientMsgId,
            replyToMessageId,
            metadata: payload.metadata,
            images: normalizedImages.length > 0 ? normalizedImages : undefined,
            imageUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
            mediaUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
            caption: payload.caption,
            duration: payload.duration,
            audioUrl: payload.audioUrl || payload.audio || payload.voiceUrl,
            imageUrl: payload.imageUrl || payload.image,
            mediaUrl: payload.mediaUrl,
          } as any
        );

        if (messageDto.conversationId) {
          socket.join(`conversation:${messageDto.conversationId}`);
          socket.join(`chat:${messageDto.conversationId}`);
        }

        if (typeof callback === 'function') {
          callback({ success: true, data: messageDto });
        }
        return;
      }

      // 3. If single recipientId is provided without conversationId
      if (normalizedRecipientIds.length === 1) {
        const singleRecipientId = normalizedRecipientIds[0];
        const result = await chatService.sendMessageToRecipient(currentUserId, {
          recipientId: singleRecipientId,
          content,
          type: msgType,
          messageType: msgType,
          clientMessageId: payload.clientMessageId || payload.clientMsgId,
          metadata: payload.metadata,
          images: normalizedImages.length > 0 ? normalizedImages : undefined,
          imageUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
          mediaUrls: normalizedImageUrls.length > 0 ? normalizedImageUrls : undefined,
          caption: payload.caption,
          duration: payload.duration,
          audioUrl: payload.audioUrl || payload.audio || payload.voiceUrl,
          imageUrl: payload.imageUrl || payload.image,
          mediaUrl: payload.mediaUrl,
        } as any);

        if (result.conversationId) {
          socket.join(`conversation:${result.conversationId}`);
          socket.join(`chat:${result.conversationId}`);
        }

        if (typeof callback === 'function') {
          callback({ success: true, data: result });
        }
        return;
      }

      if (typeof callback === 'function') {
        return callback({
          success: false,
          error: 'conversationId or recipientIds is required',
        });
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
    } finally {
      if (!settled) {
        const response = { success: false, error: 'Failed to send message over socket' };
        resolveInflight(response);
        if (fingerprint && gate && inflightChatSends.get(fingerprint) === gate) {
          inflightChatSends.delete(fingerprint);
        }
        complete(response);
      }
    }
  };

  socket.on('chat:send_message', (payload: any, cb?: Function) => {
    void handleSendMessage(payload, cb, 'chat:send_message');
  });
  socket.on('message:send' as any, (payload: any, cb?: Function) => {
    void handleSendMessage(payload, cb, 'message:send');
  });
  socket.on('chat:message:send' as any, (payload: any, cb?: Function) => {
    void handleSendMessage(payload, cb, 'chat:message:send');
  });

  // 1b. Event: chat:forward_message & message:forward
  const handleForwardMessage = async (payload: any, callback?: Function) => {
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

      const result = await chatService.forwardMessages(currentUserId, payload);
      if (typeof callback === 'function') {
        callback({
          success: true,
          data: result,
        });
      }
    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to forward messages';
      socketLogger.error('Failed to forward message via socket', {
        userId: currentUserId,
        error: errorMessage,
      });
      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('chat:forward_message', handleForwardMessage);
  socket.on('message:forward' as any, handleForwardMessage);

  const collectMessageIds = (payload: any, conversationId?: string): string[] => {
    const out: string[] = [];
    const push = (value: unknown) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (conversationId && trimmed === conversationId) return;
      out.push(trimmed);
    };

    if (Array.isArray(payload?.messageIds)) payload.messageIds.forEach(push);
    else if (typeof payload?.messageIds === 'string') payload.messageIds.split(',').forEach(push);
    if (Array.isArray(payload?.deliveredMessageIds)) payload.deliveredMessageIds.forEach(push);
    else if (typeof payload?.deliveredMessageIds === 'string') {
      payload.deliveredMessageIds.split(',').forEach(push);
    }
    push(payload?.messageId);
    push(payload?.message_id);
    push(payload?.lastReadMessageId);
    push(payload?.last_read_message_id);
    push(payload?.id);
    if (payload?.message && typeof payload.message === 'object') {
      push(payload.message.id);
      push(payload.message.messageId);
    }
    if (Array.isArray(payload?.messages)) {
      for (const item of payload.messages) {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') {
          push(item.id);
          push(item.messageId);
        }
      }
    }
    return Array.from(new Set(out));
  };

  // 2. Event: chat:mark_read & message:read (Read Acknowledgement)
  const handleMarkRead = async (payload: any, callback?: Function) => {
    try {
      const conversationId =
        payload?.conversationId ||
        payload?.conversation_id ||
        payload?.chatId ||
        payload?.message?.conversationId;

      if (!conversationId) {
        if (typeof callback === 'function') {
          return callback({ success: false, error: 'conversationId is required' });
        }
        return;
      }

      const messageIds = collectMessageIds(payload, conversationId);
      const lastReadMessageId =
        payload?.lastReadMessageId ||
        payload?.messageId ||
        payload?.last_read_message_id ||
        payload?.message_id ||
        payload?.message?.id ||
        messageIds[messageIds.length - 1];

      const result = await chatService.markMessagesAsRead(
        currentUserId,
        conversationId,
        lastReadMessageId
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
  socket.on('chat:message:seen' as any, handleMarkRead);
  socket.on('chat:seen' as any, handleMarkRead);
  socket.on('message:seen' as any, handleMarkRead);

  // 2b. Event: chat:message_delivered & message:delivered (Delivery Acknowledgement)
  const handleMessageDelivered = async (payload: any, callback?: Function) => {
    try {
      let conversationId =
        payload?.conversationId ||
        payload?.conversation_id ||
        payload?.chatId ||
        payload?.message?.conversationId;

      let messageIds = collectMessageIds(payload, conversationId);
      if (!conversationId && messageIds.length > 0) {
        const row = await ChatMessage.findByPk(messageIds[0], {
          attributes: ['conversationId'],
        });
        conversationId = row?.conversationId;
      }

      if (!conversationId || messageIds.length === 0) {
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
        conversationId,
        messageIds
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
  socket.on('chat:message:delivered' as any, handleMessageDelivered);

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

  // 4b. Event: conversation:pin
  socket.on('conversation:pin', async (payload: any, callback?: Function) => {
    try {
      const rawPinned =
        typeof payload?.isPinned === 'boolean' ? payload.isPinned : payload?.pinned;

      if (
        !payload ||
        typeof payload !== 'object' ||
        !payload.conversationId ||
        typeof rawPinned !== 'boolean'
      ) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and boolean isPinned are required',
          });
        }
        return;
      }

      const result = await chatService.pinConversation(
        currentUserId,
        payload.conversationId,
        rawPinned
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling conversation:pin event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to update conversation pin status';

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

  // 6. Event: chat:pin_message / chat:message:pin (Message Pin / Unpin Synchronization)
  const handlePinMessage = async (payload: any, callback?: Function) => {
    const conversationId = payload?.conversationId || payload?.conversation_id;
    const messageId = payload?.messageId || payload?.message_id;
    try {
      if (!payload || typeof payload !== 'object' || !conversationId || !messageId) {
        const error = 'conversationId and messageId are required';
        if (typeof callback === 'function') {
          return callback({ success: false, error });
        }
        socket.emit('chat:message:pin:ack', {
          success: false,
          requestId: payload?.requestId || null,
          error,
        });
        return;
      }

      const rawPinned = payload.isPinned !== undefined ? payload.isPinned : payload.pinned;
      const isPinned = rawPinned !== undefined ? !!rawPinned : true;
      const scope = payload.scope === 'user' ? 'user' : 'conversation';

      const result = await chatService.pinMessage(
        currentUserId,
        conversationId,
        messageId,
        isPinned,
        scope
      );

      const ack = { success: true, requestId: payload.requestId || null, data: result };
      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
      socket.emit('chat:message:pin:ack', ack);
    } catch (err: any) {
      socketLogger.error('Error handling chat:pin_message event', err, {
        userId: currentUserId,
        conversationId,
        messageId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to update message pin status';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
      socket.emit('chat:message:pin:ack', {
        success: false,
        requestId: payload?.requestId || null,
        error: errorMessage,
      });
    }
  };

  socket.on('chat:pin_message', handlePinMessage);
  socket.on('chat:message:pin' as any, handlePinMessage);
  socket.on('message:pin' as any, handlePinMessage);

  // 7. Event: chat:edit_message & message:edit
  const handleEditMessage = async (payload: any, callback?: Function) => {
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

      if (!payload.conversationId || !payload.messageId || typeof payload.content !== 'string') {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId, messageId, and content are required',
          });
        }
        return;
      }

      const result = await chatService.editMessage(
        currentUserId,
        payload.conversationId,
        payload.messageId,
        payload.content
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling chat:edit_message event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
        messageId: payload?.messageId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to edit message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('chat:edit_message', handleEditMessage);
  socket.on('message:edit' as any, handleEditMessage);

  // 8. Event: chat:reply_message & message:reply
  const handleReplyMessage = async (payload: any, callback?: Function) => {
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

      const replyToMessageId =
        payload.replyToMessageId ||
        payload.parentMessageId ||
        payload.replyToId ||
        payload.messageId;

      if (!payload.conversationId || !replyToMessageId) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId and replyToMessageId are required',
          });
        }
        return;
      }

      const result = await chatService.replyMessage(
        currentUserId,
        payload.conversationId,
        replyToMessageId,
        payload
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling chat:reply_message event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
        replyToMessageId: payload?.replyToMessageId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to reply to message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('chat:reply_message', handleReplyMessage);
  socket.on('message:reply' as any, handleReplyMessage);

  // 9. Event: chat:delete_message & message:delete
  const handleDeleteMessage = async (payload: any, callback?: Function) => {
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

      if (
        !payload.conversationId ||
        !payload.messageId ||
        (payload.deleteType !== 'me' && payload.deleteType !== 'everyone')
      ) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId, messageId, and deleteType ("me" or "everyone") are required',
          });
        }
        return;
      }

      const result = await chatService.deleteMessage(
        currentUserId,
        payload.conversationId,
        payload.messageId,
        payload.deleteType
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      socketLogger.error('Error handling chat:delete_message event', err, {
        userId: currentUserId,
        conversationId: payload?.conversationId,
        messageId: payload?.messageId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to delete message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('chat:delete_message', handleDeleteMessage);
  socket.on('message:delete' as any, handleDeleteMessage);

  // 10. Event: conversation:get_list / chat:get_conversations / conversations:get
  const handleGetConversations = async (payload: any, callback?: Function) => {
    try {
      const query = (payload && typeof payload === 'object') ? payload : {};
      const result = await chatService.getChatList(currentUserId, query);

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      } else {
        socket.emit('conversation:list' as any, result);
        socket.emit('conversations:list' as any, result);
      }
    } catch (err: any) {
      socketLogger.error('Error handling conversation:get_list event', err, {
        userId: currentUserId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to fetch conversations';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('conversation:get_list' as any, handleGetConversations);
  socket.on('chat:get_conversations' as any, handleGetConversations);
  socket.on('conversations:get' as any, handleGetConversations);
  socket.on('chat:list' as any, handleGetConversations);

  // 11. Event: message:reaction & chat:message_reaction
  const handleMessageReaction = async (payload: any, callback?: Function) => {
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

      const conversationId = payload.conversationId || payload.conversation_id;
      const messageId = payload.messageId || payload.message_id;
      const emoji = payload.emoji || payload.reaction || payload.reactionEmoji;

      if (!conversationId || !messageId || !emoji) {
        if (typeof callback === 'function') {
          return callback({
            success: false,
            error: 'conversationId, messageId, and emoji are required',
          });
        }
        return;
      }

      const result = await chatService.reactToMessage(
        currentUserId,
        conversationId,
        messageId,
        emoji
      );

      if (typeof callback === 'function') {
        callback({ success: true, data: result });
      }
    } catch (err: any) {
      const convId = payload?.conversationId || payload?.conversation_id;
      const msgId = payload?.messageId || payload?.message_id;

      socketLogger.error('Error handling message:reaction event', err, {
        userId: currentUserId,
        conversationId: convId,
        messageId: msgId,
      });

      const errorMessage =
        err instanceof ChatServiceError
          ? err.message
          : 'Failed to react to message over socket';

      if (typeof callback === 'function') {
        callback({ success: false, error: errorMessage });
      }
    }
  };

  socket.on('message:reaction', handleMessageReaction);
  socket.on('chat:message_reaction' as any, handleMessageReaction);
  socket.on('chat:reaction' as any, handleMessageReaction);
  socket.on('message:react' as any, handleMessageReaction);
  socket.on('chat:react' as any, handleMessageReaction);
  socket.on('reaction:send' as any, handleMessageReaction);

  // 12. Event: conversation:join / chat:join / join_conversation
  const handleJoinConversation = async (payload: any, callback?: Function) => {
    try {
      const convId =
        payload?.conversationId ||
        payload?.conversation_id ||
        payload?.chatId ||
        (typeof payload === 'string' ? payload : null);
      if (!convId) {
        if (typeof callback === 'function') callback({ success: false, error: 'conversationId is required' });
        return;
      }
      const conv = await Conversation.findByPk(convId);
      if (!conv || (conv.user1Id !== currentUserId && conv.user2Id !== currentUserId)) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Unauthorized to join this conversation room' });
        }
        return;
      }
      socket.join(`conversation:${convId}`);
      socket.join(`chat:${convId}`);
      let partner: {
        conversationId: string;
        userId: string;
        isOnline: boolean;
        lastSeenAt: string | null;
      } | null = null;
      try {
        partner = await chatService.syncOpenChatPresence(currentUserId, conv.id, true);
      } catch {
        partner = null;
      }
      if (partner) {
        socket.emit('chat:presence', partner);
        socket.emit('chat:user:status', partner);
      }
      if (typeof callback === 'function') {
        callback({
          success: true,
          conversationId: conv.id,
          ...(partner ? { partner } : {}),
        });
      }
    } catch {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Failed to join conversation room' });
      }
    }
  };

  socket.on('conversation:join' as any, handleJoinConversation);
  socket.on('chat:join' as any, handleJoinConversation);
  socket.on('chat:conversation:join' as any, handleJoinConversation);
  socket.on('join_conversation' as any, handleJoinConversation);

  // Focused thread: blue ticks while the chat screen is open.
  socket.on('chat:conversation:viewing' as any, async (payload: any, callback?: Function) => {
    try {
      const conversationId =
        (typeof payload === 'string' ? payload : null) ||
        payload?.conversationId ||
        payload?.conversation_id ||
        payload?.chatId;
      if (!conversationId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'conversationId is required' });
        }
        return;
      }

      const active = !(payload && typeof payload === 'object' && (payload.active === false || payload.active === 0));
      setConversationViewing(currentUserId, conversationId, active);

      let partner: {
        conversationId: string;
        userId: string;
        isOnline: boolean;
        lastSeenAt: string | null;
      } | null = null;
      try {
        partner = await chatService.syncOpenChatPresence(currentUserId, conversationId, active);
      } catch {
        partner = null;
      }
      if (partner) {
        socket.emit('chat:presence', partner);
        socket.emit('chat:user:status', partner);
      }

      if (!active) {
        if (typeof callback === 'function') {
          callback({ success: true, data: { conversationId, active: false } });
        }
        return;
      }

      const lastReadMessageId =
        payload?.lastReadMessageId ||
        payload?.messageId ||
        payload?.message_id;
      const result = await chatService.markMessagesAsRead(
        currentUserId,
        conversationId,
        lastReadMessageId
      );
      const data = partner ? { ...result, partner } : result;
      socket.emit('chat:message:seen:ack' as any, { success: true, data });
      if (typeof callback === 'function') {
        callback({ success: true, data });
      }
    } catch (err: any) {
      if (typeof callback === 'function') {
        callback({ success: false, error: err?.message || 'Failed to mark conversation seen' });
      }
    }
  });
};

