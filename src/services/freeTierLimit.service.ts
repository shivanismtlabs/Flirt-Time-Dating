import { Op } from 'sequelize';
import { User, SwipeAction } from '../models';

export const FREE_TIER_DAILY_LIKE_LIMIT = 10;
export const SUPER_LIKE_COIN_COST = 20;

/**
 * Returns the Date representing 00:00:00 IST for the current day.
 * IST is UTC+05:30.
 */
export const getStartOfTodayIST = (): Date => {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  istTime.setUTCHours(0, 0, 0, 0);
  return new Date(istTime.getTime() - istOffsetMs);
};

/**
 * Returns the Date representing the next 00:00:00 IST (midnight reset).
 */
export const getNextMidnightIST = (): Date => {
  const startOfToday = getStartOfTodayIST();
  return new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
};

export interface UserLimitsDTO {
  isSubscribed: boolean;
  likes: {
    limit: number | null;
    used: number;
    remaining: number | null;
    resetsAt: string;
  };
  nopes: {
    isUnlimited: boolean;
  };
  superLikes: {
    hasFree: boolean;
    freeRemaining: number;
    costInCoins: number;
    userCoins: number;
  };
  tabs: {
    likesTabLocked: boolean;
    complimentsTabLocked: boolean;
    youLikedTabLocked: boolean;
    matchesTabLocked: boolean;
  };
  chat: {
    canChatWithoutMatch: boolean;
  };
}

export class FreeTierLimitService {
  /**
   * Returns how many 'like' swipes the user has made today (since 00:00 IST)
   */
  public async getDailyLikesCount(userId: string): Promise<number> {
    const startOfToday = getStartOfTodayIST();
    return SwipeAction.count({
      where: {
        userId,
        action: 'like',
        createdAt: {
          [Op.gte]: startOfToday,
        },
      },
    });
  }

  /**
   * Returns whether the free user still has their 1 lifetime free Super Like available.
   * Free tier gets 1 free Super Like ever; subsequent ones cost 20 coins.
   */
  public async hasFreeSuperLike(userId: string): Promise<boolean> {
    const totalSuperLikes = await SwipeAction.count({
      where: {
        userId,
        action: 'super_like',
      },
    });
    return totalSuperLikes === 0;
  }

  /**
   * Retrieves comprehensive limits, quotas, and coin requirements for the user
   */
  public async getUserLimits(userId: string): Promise<UserLimitsDTO> {
    const user = await User.findByPk(userId);
    const isSubscribed = Boolean(user?.isSubscribed);
    const startOfToday = getStartOfTodayIST();
    const nextMidnight = getNextMidnightIST();

    const [likesToday, totalSuperLikesEver] = await Promise.all([
      SwipeAction.count({
        where: {
          userId,
          action: 'like',
          createdAt: { [Op.gte]: startOfToday },
        },
      }),
      SwipeAction.count({
        where: {
          userId,
          action: 'super_like',
        },
      }),
    ]);

    const remainingLikes = isSubscribed
      ? null
      : Math.max(0, FREE_TIER_DAILY_LIKE_LIMIT - likesToday);

    const hasFreeSuperLike = isSubscribed ? true : totalSuperLikesEver === 0;
    const userCoins = typeof user?.coins === 'number' ? user.coins : 0;

    return {
      isSubscribed,
      likes: {
        limit: isSubscribed ? null : FREE_TIER_DAILY_LIKE_LIMIT,
        used: likesToday,
        remaining: remainingLikes,
        resetsAt: nextMidnight.toISOString(),
      },
      nopes: {
        isUnlimited: true,
      },
      superLikes: {
        hasFree: hasFreeSuperLike,
        freeRemaining: hasFreeSuperLike ? 1 : 0,
        costInCoins: SUPER_LIKE_COIN_COST,
        userCoins,
      },
      tabs: {
        likesTabLocked: !isSubscribed,
        complimentsTabLocked: !isSubscribed,
        youLikedTabLocked: false,
        matchesTabLocked: false,
      },
      chat: {
        // Temporary: anyone can chat with anyone, including free users.
        canChatWithoutMatch: true,
      },
    };
  }
}

export const freeTierLimitService = new FreeTierLimitService();
