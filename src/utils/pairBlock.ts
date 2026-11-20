import { Op } from 'sequelize';
import { UserBlock } from '../models';

const PAIR_BLOCK_TTL_MS = 20_000;
const pairBlockCache = new Map<string, { blocked: boolean; expiresAt: number }>();

const pairKey = (userA: string, userB: string): string => {
  const a = String(userA || '').trim().toLowerCase();
  const b = String(userB || '').trim().toLowerCase();
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

export const forgetPairBlock = (userA: string, userB: string): void => {
  pairBlockCache.delete(pairKey(userA, userB));
};

/**
 * Bidirectional block check. Typing, open-chat, and send retries hit this
 * constantly, so a short cache keeps the same pair off the database.
 */
export const areUsersBlocked = async (userA: string, userB: string): Promise<boolean> => {
  if (!userA || !userB) return false;
  const key = pairKey(userA, userB);
  const now = Date.now();
  const cached = pairBlockCache.get(key);
  if (cached && cached.expiresAt > now) return cached.blocked;

  const row = await UserBlock.findOne({
    where: {
      [Op.or]: [
        { userId: userA, blockedUserId: userB },
        { userId: userB, blockedUserId: userA },
      ],
    },
    attributes: ['id'],
  });
  const blocked = !!row;
  pairBlockCache.set(key, { blocked, expiresAt: now + PAIR_BLOCK_TTL_MS });
  if (pairBlockCache.size > 2000) {
    for (const [cachedKey, value] of pairBlockCache) {
      if (value.expiresAt <= now) pairBlockCache.delete(cachedKey);
    }
  }
  return blocked;
};
