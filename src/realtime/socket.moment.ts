/**
 * Live moment updates for create, likes, comments, gifts, and delete.
 * Every connected client joins `moments:feed`.
 * Public moments push `moment:updated` there so other users' feeds change
 * without opening the card. Detail screens still join `moment:<id>`.
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
const MOMENTS_FEED_ROOM = 'moments:feed';
const MAX_WATCHED_MOMENTS = 30;
const REACTION_KEYS = ['like', 'heart', 'love_eyes', 'fire', 'laugh', 'surprised', 'clap'] as const;
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
  | 'moment:created'
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
  momentCount?: number | null;
  reaction?: string | null;
  reactionCounts?: Record<string, number> | null;
  moment?: Record<string, unknown> | null;
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
    case 'created':
      return 'moment:created';
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

const toCount = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
};

const emptyReactionCounts = (): Record<string, number> => {
  const counts: Record<string, number> = { total: 0 };
  for (const key of REACTION_KEYS) counts[key] = 0;
  return counts;
};

/**
 * Same totals the moments feed returns: every reaction, every comment/reply,
 * and the sum of gift quantities. Values are always integers.
 */
const resolveCounts = async (
  momentId: string
): Promise<{
  likesCount: number;
  commentsCount: number;
  giftsCount: number;
  reactionCounts: Record<string, number>;
}> => {
  const reactionCounts = emptyReactionCounts();
  if (!momentId) {
    return { likesCount: 0, commentsCount: 0, giftsCount: 0, reactionCounts };
  }

  const [reactions, replyMessages, giftRecords] = await Promise.all([
    MomentReaction.findAll({
      where: { momentId },
      attributes: ['reaction'],
    }),
    ChatMessage.findAll({
      where: {
        messageType: 'moment_reply',
        metadata: { [Op.like]: `%"momentId":"${momentId}"%` },
      },
      attributes: ['metadata'],
    }),
    MomentGift.findAll({
      where: { momentId },
      attributes: ['quantity'],
    }).catch(() => []),
  ]);

  for (const reaction of reactions) {
    if (reactionCounts[reaction.reaction] !== undefined) {
      reactionCounts[reaction.reaction] += 1;
      reactionCounts.total += 1;
    }
  }

  let commentsCount = 0;
  for (const message of replyMessages) {
    if (!message.metadata) continue;
    try {
      const parsed =
        typeof message.metadata === 'string'
          ? JSON.parse(message.metadata)
          : message.metadata;
      if (parsed?.type === 'gift') continue;
      if (parsed?.momentId === momentId) commentsCount += 1;
    } catch {
      // Ignore malformed comment metadata.
    }
  }

  let giftsCount = 0;
  for (const gift of giftRecords) {
    giftsCount += toCount(gift.quantity) || 1;
  }

  return {
    likesCount: reactionCounts.total,
    commentsCount,
    giftsCount,
    reactionCounts,
  };
};

const resolveVisibleMomentCount = async (
  ownerId: string,
  audience: MomentLiveUpdate['audience']
): Promise<number> => {
  if (!ownerId) return 0;
  const now = new Date();
  const audienceFilter =
    audience === 'matches_only'
      ? { [Op.in]: ['everyone', 'matches_only'] }
      : 'everyone';

  return Moment.count({
    where: {
      userId: ownerId,
      status: 'active',
      audience: audienceFilter,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: now } }],
    },
  });
};

const blockedUserRooms = async (ownerId: string): Promise<string[]> => {
  if (!ownerId) return [];
  const blocks = await UserBlock.findAll({
    where: {
      [Op.or]: [{ userId: ownerId }, { blockedUserId: ownerId }],
    },
    attributes: ['userId', 'blockedUserId'],
  });

  const rooms = new Set<string>();
  for (const block of blocks) {
    const otherId = block.userId === ownerId ? block.blockedUserId : block.userId;
    if (!otherId || otherId === ownerId) continue;
    rooms.add(getUserRoomName(otherId));
    if (otherId.toLowerCase() !== otherId) {
      rooms.add(getUserRoomName(otherId.toLowerCase()));
    }
  }
  return Array.from(rooms);
};

const emitToRooms = (
  io: AppSocketServer,
  rooms: string[],
  event: MomentLiveEvent,
  payload: MomentLiveUpdate,
  exceptRooms: string[] = []
): void => {
  const uniqueRooms = Array.from(new Set(rooms.filter(Boolean)));
  if (uniqueRooms.length === 0) return;

  let target = io.to(uniqueRooms[0]);
  for (let index = 1; index < uniqueRooms.length; index += 1) {
    target = target.to(uniqueRooms[index]);
  }

  const excluded = Array.from(new Set(exceptRooms.filter(Boolean)));
  if (excluded.length > 0) {
    target = target.except(excluded);
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
    const ownerId = String(input.ownerId || '').trim();
    const io = getSocketServer();
    const moment = momentId
      ? await Moment.findByPk(momentId, {
          attributes: ['id', 'userId', 'audience', 'status'],
        })
      : null;
    const audience = (moment?.audience || null) as MomentLiveUpdate['audience'];

    const [actor, counts, hiddenRooms] = await Promise.all([
      resolveActor(input.actorId, input.actor),
      resolveCounts(input.type === 'deleted' ? '' : momentId),
      blockedUserRooms(ownerId),
    ]);

    const momentCount =
      input.type === 'created' || input.type === 'deleted'
        ? await resolveVisibleMomentCount(ownerId, audience)
        : input.momentCount ?? null;

    const payload: MomentLiveUpdate = {
      type: input.type,
      momentId,
      ownerId,
      audience,
      actor,
      likesCount: counts.likesCount,
      commentsCount: counts.commentsCount,
      giftsCount: counts.giftsCount,
      momentCount,
      reaction: input.reaction ?? null,
      reactionCounts: counts.reactionCounts,
      moment: sanitizeRecord(input.moment),
      comment: sanitizeRecord(input.comment),
      gift: sanitizeRecord(input.gift),
      commentId: input.commentId ?? null,
      replyId: input.replyId ?? null,
      parentCommentId: input.parentCommentId ?? null,
      commentLikesCount:
        input.commentLikesCount === undefined || input.commentLikesCount === null
          ? null
          : toCount(input.commentLikesCount),
      updatedAt: new Date().toISOString(),
    };

    if (payload.moment && momentCount !== null) {
      payload.moment.momentCount = momentCount;
      payload.moment.likesCount = payload.likesCount;
      payload.moment.commentsCount = payload.commentsCount;
      payload.moment.giftsCount = payload.giftsCount;
    }

    const detailRooms = new Set<string>();
    if (momentId) detailRooms.add(getMomentRoomName(momentId));

    // Gift alerts are the push notification. Also pushing moment:gift_sent onto
    // the owner's user room makes the open app show a second banner.
    const userIds =
      input.type === 'gift'
        ? [input.actorId, ...(input.notifyUserIds || [])]
        : [ownerId, input.actorId, ...(input.notifyUserIds || [])];
    for (const userId of userIds) {
      const normalized = String(userId || '').trim();
      if (normalized) detailRooms.add(getUserRoomName(normalized));
    }

    const feedRooms = new Set<string>(detailRooms);
    if (audience === 'everyone') {
      feedRooms.add(MOMENTS_FEED_ROOM);
    } else if (audience === 'matches_only' && ownerId) {
      const matches = await Match.findAll({
        where: {
          [Op.or]: [{ user1Id: ownerId }, { user2Id: ownerId }],
          isActive: true,
        },
        attributes: ['user1Id', 'user2Id'],
      });
      for (const match of matches) {
        const otherId = match.user1Id === ownerId ? match.user2Id : match.user1Id;
        if (otherId) feedRooms.add(getUserRoomName(otherId));
      }
    }

    const specificEvent = specificEventFor(input.type);
    const shareSpecificWithFeed =
      specificEvent === 'moment:created' || specificEvent === 'moment:deleted';

    if (specificEvent !== 'moment:updated') {
      const specificRooms = shareSpecificWithFeed
        ? Array.from(feedRooms)
        : Array.from(detailRooms);
      emitToRooms(io, specificRooms, specificEvent, payload, hiddenRooms);
    }
    emitToRooms(io, Array.from(feedRooms), 'moment:updated', payload, hiddenRooms);
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
  socket.join(MOMENTS_FEED_ROOM);

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
