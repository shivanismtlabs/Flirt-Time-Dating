/**
 * Live moment updates for likes, comments, and gifts.
 * Clients join `moment:<id>` while a card or detail screen is open.
 * The moment owner also receives the same payload on their user room.
 */

import { Op } from 'sequelize';
import {
  ChatMessage,
  Match,
  Moment,
  MomentGift,
  MomentReaction,
  User,
  UserBlock,
} from '../models';
import { formatThumbnailUrl } from '../services/s3.service';
import { socketLogger } from './socket.errors';
import { getUserRoomName } from './socket.lifecycle';
import { getSocketServer } from './socket.server';
import {
  AppSocket,
  AppSocketServer,
  MomentLiveUpdate,
  ServerToClientEvents,
} from './socket.types';

const MOMENT_ROOM_PREFIX = 'moment:';
const MAX_WATCHED_MOMENTS = 30;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VIEWER_ONLY_FIELDS = [
  'isMyComment',
  'canDelete',
  'isLiked',
  'liked',
  'unliked',
  'myReaction',
  'viewerReaction',
  'hasLiked',
  'previousBalance',
  'newBalance',
  'coinsDeducted',
  'userBalance',
];

type MomentLiveEvent = keyof Pick<
  ServerToClientEvents,
  | 'moment:updated'
  | 'moment:like_updated'
  | 'moment:comment_created'
  | 'moment:comment_deleted'
  | 'moment:comment_like_updated'
  | 'moment:gift_sent'
  | 'moment:deleted'
>;

export interface MomentLiveUpdateInput {
  type: MomentLiveUpdate['type'];
  momentId: string;
  ownerId: string;
  actorId: string;
  actor?: Partial<MomentLiveUpdate['actor']>;
  notifyUserIds?: string[];
  likesCount?: number;
  commentsCount?: number;
  giftsCount?: number;
  reaction?: string | null;
  reactionCounts?: Record<string, number> | null;
  comment?: Record<string, unknown> | null;
  gift?: Record<string, unknown> | null;
  commentId?: string | null;
  replyId?: string | null;
  parentCommentId?: string | null;
  commentLikesCount?: number | null;
}

type WatchAccess =
  | { ok: true; momentId: string }
  | { ok: false; error: string };

export const getMomentRoomName = (momentId: string): string => {
  return `${MOMENT_ROOM_PREFIX}${momentId}`;
};

const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

const specificEventFor = (type: MomentLiveUpdate['type']): MomentLiveEvent => {
  switch (type) {
    case 'like':
    case 'unlike':
    case 'reaction':
      return 'moment:like_updated';
    case 'comment':
    case 'reply':
      return 'moment:comment_created';
    case 'comment_deleted':
      return 'moment:comment_deleted';
    case 'comment_like':
      return 'moment:comment_like_updated';
    case 'gift':
      return 'moment:gift_sent';
    case 'deleted':
      return 'moment:deleted';
    default:
      return 'moment:updated';
  }
};

const sanitizeRecord = (
  value: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') return null;
  const clone: Record<string, unknown> = { ...value };
  for (const key of VIEWER_ONLY_FIELDS) {
    delete clone[key];
  }
  if (clone.sender && typeof clone.sender === 'object') {
    const sender = { ...(clone.sender as Record<string, unknown>) };
    for (const key of VIEWER_ONLY_FIELDS) {
      delete sender[key];
    }
    clone.sender = sender;
  }
  return clone;
};

const resolveActor = async (
  actorId: string,
  provided?: Partial<MomentLiveUpdate['actor']>
): Promise<MomentLiveUpdate['actor']> => {
  if (provided?.name) {
    return {
      id: provided.id || actorId,
      name: provided.name,
      username: provided.username ?? null,
      profilePhoto: provided.profilePhoto ?? null,
    };
  }

  const user = await User.findByPk(actorId, {
    attributes: ['id', 'username', 'fullName', 'nickName', 'profilePicture'],
  });

  return {
    id: actorId,
    name: user?.fullName || user?.nickName || 'User',
    username: user?.username || null,
    profilePhoto: user?.profilePicture
      ? formatThumbnailUrl(user.profilePicture)
      : null,
  };
};

const resolveCounts = async (
  momentId: string,
  input: MomentLiveUpdateInput
): Promise<Pick<MomentLiveUpdate, 'likesCount' | 'commentsCount' | 'giftsCount'>> => {
  if (!momentId || input.type === 'deleted') {
    return {
      likesCount: input.likesCount ?? 0,
      commentsCount: input.commentsCount ?? 0,
      giftsCount: input.giftsCount ?? 0,
    };
  }

  const likesCount =
    input.likesCount ??
    (await MomentReaction.count({ where: { momentId } }));

  const commentsCount =
    input.commentsCount ??
    (await ChatMessage.count({
      where: {
        messageType: 'moment_reply',
        metadata: {
          [Op.like]: `%"momentId":"${momentId}"%`,
          [Op.notLike]: '%"type":"gift"%',
        },
      },
    }));

  let giftsCount = input.giftsCount;
  if (giftsCount === undefined) {
    try {
      giftsCount = (await MomentGift.sum('quantity', { where: { momentId } })) || 0;
    } catch {
      giftsCount = 0;
    }
  }

  return { likesCount, commentsCount, giftsCount };
};

const emitToRooms = (
  io: AppSocketServer,
  rooms: string[],
  event: MomentLiveEvent,
  payload: MomentLiveUpdate
): void => {
  if (rooms.length === 0) return;
  let target = io.to(rooms[0]);
  for (let index = 1; index < rooms.length; index += 1) {
    target = target.to(rooms[index]);
  }
  target.emit(event, payload);
};

/**
 * Push a moment activity to viewers of that moment and to the owner.
 * Safe to call when Socket.IO is not running (API tests, scripts).
 */
export const publishMomentRealtime = async (
  input: MomentLiveUpdateInput
): Promise<void> => {
  try {
    const momentId = String(input.momentId || '').trim();
    const io = getSocketServer();
    const [actor, counts] = await Promise.all([
      resolveActor(input.actorId, input.actor),
      resolveCounts(momentId, input),
    ]);

    const payload: MomentLiveUpdate = {
      type: input.type,
      momentId,
      ownerId: input.ownerId,
      actor,
      likesCount: counts.likesCount,
      commentsCount: counts.commentsCount,
      giftsCount: counts.giftsCount,
      reaction: input.reaction ?? null,
      reactionCounts: input.reactionCounts ?? null,
      comment: sanitizeRecord(input.comment),
      gift: sanitizeRecord(input.gift),
      commentId: input.commentId ?? null,
      replyId: input.replyId ?? null,
      parentCommentId: input.parentCommentId ?? null,
      commentLikesCount: input.commentLikesCount ?? null,
      updatedAt: new Date().toISOString(),
    };

    const rooms = new Set<string>();
    if (momentId) rooms.add(getMomentRoomName(momentId));

    // Gift alerts are the push notification. Also pushing moment:gift_sent onto
    // the owner's user room makes the open app show a second banner.
    const userIds =
      input.type === 'gift'
        ? [input.actorId, ...(input.notifyUserIds || [])]
        : [input.ownerId, input.actorId, ...(input.notifyUserIds || [])];
    for (const userId of userIds) {
      const normalized = String(userId || '').trim();
      if (normalized) rooms.add(getUserRoomName(normalized));
    }

    const roomList = Array.from(rooms);
    const specificEvent = specificEventFor(input.type);
    if (specificEvent !== 'moment:updated') {
      emitToRooms(io, roomList, specificEvent, payload);
    }
    emitToRooms(io, roomList, 'moment:updated', payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('has not been initialized')) return;
    socketLogger.warn('Failed to publish moment realtime update', { message });
  }
};

const canWatchMoment = async (
  userId: string,
  momentId: string
): Promise<WatchAccess> => {
  const moment = await Moment.findByPk(momentId, {
    attributes: ['id', 'userId', 'status', 'audience', 'expiresAt'],
  });

  if (!moment || moment.status === 'deleted') {
    return { ok: false, error: 'Moment not found' };
  }

  if (moment.userId === userId) {
    return { ok: true, momentId: moment.id };
  }

  if (moment.status !== 'active') {
    return { ok: false, error: 'Moment not available' };
  }

  if (moment.expiresAt && new Date(moment.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'Moment not available' };
  }

  const blockRecord = await UserBlock.findOne({
    where: {
      [Op.or]: [
        { userId, blockedUserId: moment.userId },
        { userId: moment.userId, blockedUserId: userId },
      ],
    },
  });
  if (blockRecord) {
    return { ok: false, error: 'Moment not available' };
  }

  if (moment.audience === 'close_friends') {
    return { ok: false, error: 'Moment not available' };
  }

  if (moment.audience === 'matches_only') {
    const [user1Id, user2Id] = [userId, moment.userId].sort();
    const match = await Match.findOne({
      where: { user1Id, user2Id, isActive: true },
    });
    if (!match) {
      return { ok: false, error: 'Moment not available' };
    }
  }

  return { ok: true, momentId: moment.id };
};

export const registerMomentSocketHandlers = (
  socket: AppSocket,
  _io: AppSocketServer
): void => {
  const userId = socket.data.user.userId;

  socket.on('moment:join', async (data, callback) => {
    try {
      const momentId = typeof data?.momentId === 'string' ? data.momentId.trim() : '';
      if (!isUuid(momentId)) {
        callback?.({ success: false, error: 'Invalid moment id' });
        return;
      }

      const access = await canWatchMoment(userId, momentId);
      if (!access.ok) {
        callback?.({ success: false, error: access.error, momentId });
        return;
      }

      socket.join(getMomentRoomName(access.momentId));
      callback?.({ success: true, momentId: access.momentId });
    } catch (error) {
      socketLogger.error('moment:join failed', error);
      callback?.({ success: false, error: 'Unable to join moment' });
    }
  });

  socket.on('moment:leave', (data, callback) => {
    const momentId = typeof data?.momentId === 'string' ? data.momentId.trim() : '';
    if (!isUuid(momentId)) {
      callback?.({ success: false, error: 'Invalid moment id' });
      return;
    }
    socket.leave(getMomentRoomName(momentId));
    callback?.({ success: true, momentId });
  });

  socket.on('moment:watch', async (data, callback) => {
    try {
      const requested = Array.isArray(data?.momentIds) ? data.momentIds : [];
      const uniqueIds = Array.from(
        new Set(
          requested
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => isUuid(id))
        )
      ).slice(0, MAX_WATCHED_MOMENTS);

      const joined: string[] = [];
      const rejected: string[] = [];

      for (const momentId of uniqueIds) {
        const access = await canWatchMoment(userId, momentId);
        if (access.ok) {
          socket.join(getMomentRoomName(access.momentId));
          joined.push(access.momentId);
        } else {
          rejected.push(momentId);
        }
      }

      callback?.({ success: true, joined, rejected });
    } catch (error) {
      socketLogger.error('moment:watch failed', error);
      callback?.({ success: false, error: 'Unable to watch moments' });
    }
  });

  socket.on('moment:unwatch', (data, callback) => {
    const requested = Array.isArray(data?.momentIds) ? data.momentIds : null;
    const left: string[] = [];

    if (requested && requested.length > 0) {
      for (const rawId of requested) {
        const momentId = typeof rawId === 'string' ? rawId.trim() : '';
        if (!isUuid(momentId)) continue;
        socket.leave(getMomentRoomName(momentId));
        left.push(momentId);
      }
    } else {
      for (const room of socket.rooms) {
        if (!room.startsWith(MOMENT_ROOM_PREFIX)) continue;
        socket.leave(room);
        left.push(room.slice(MOMENT_ROOM_PREFIX.length));
      }
    }

    callback?.({ success: true, left });
  });
};
