import { subscriptionDateService } from '../src/services/subscriptionDate.service';

describe('SubscriptionDateService — Strict UTC Intervals & Validity Rules', () => {
  describe('1. Weekly Plans (7-Day Billing Interval)', () => {
    it('should calculate exactly 7 days (7 * 86,400,000 ms) for weekly subscriptions', () => {
      const startsAt = new Date('2026-10-15T12:00:06.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'weekly');

      expect(expiry.toISOString()).toBe('2026-10-22T12:00:06.000Z');
      expect(expiry.getTime() - startsAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should resolve weekly billing cycle from product id or name heuristics', () => {
      const cycle1 = subscriptionDateService.resolveCanonicalCycle('weekly', 7, 'one_week_subscription');
      const cycle2 = subscriptionDateService.resolveCanonicalCycle('monthly', 7, 'com.flirttime.weekly');
      const cycle3 = subscriptionDateService.resolveCanonicalCycle(null, null, 'weekly_vip_pack');

      expect(cycle1).toBe('weekly');
      expect(cycle2).toBe('weekly');
      expect(cycle3).toBe('weekly');
    });
  });

  describe('2. Monthly Plans (Calendar-Month Interval, Month-End & Leap-Year Rules)', () => {
    it('should calculate standard calendar-month interval for mid-month dates', () => {
      const startsAt = new Date('2026-03-15T10:30:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'monthly');

      expect(expiry.toISOString()).toBe('2026-04-15T10:30:00.000Z');
    });

    it('should roll over year boundary from December to January', () => {
      const startsAt = new Date('2026-12-15T08:00:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'monthly');

      expect(expiry.toISOString()).toBe('2027-01-15T08:00:00.000Z');
    });

    it('should respect month-end for 31-day month transitioning to 30-day month (Mar 31 -> Apr 30)', () => {
      const startsAt = new Date('2026-03-31T14:20:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'monthly');

      expect(expiry.toISOString()).toBe('2026-04-30T14:20:00.000Z');
    });

    it('should respect month-end for May 31 -> Jun 30 and Aug 31 -> Sep 30', () => {
      const may31 = new Date('2026-05-31T12:00:00.000Z');
      expect(subscriptionDateService.calculateIntervalExpiry(may31, 'monthly').toISOString()).toBe(
        '2026-06-30T12:00:00.000Z'
      );

      const aug31 = new Date('2026-08-31T12:00:00.000Z');
      expect(subscriptionDateService.calculateIntervalExpiry(aug31, 'monthly').toISOString()).toBe(
        '2026-09-30T12:00:00.000Z'
      );
    });

    it('should respect non-leap-year February month-end (Jan 31 -> Feb 28 in 2025)', () => {
      const startsAt = new Date('2025-01-31T12:00:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'monthly');

      expect(expiry.toISOString()).toBe('2025-02-28T12:00:00.000Z');
    });

    it('should respect leap-year February month-end (Jan 31 -> Feb 29 in 2024)', () => {
      const startsAt = new Date('2024-01-31T12:00:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'monthly');

      expect(expiry.toISOString()).toBe('2024-02-29T12:00:00.000Z');
    });

    it('should clamp Jan 30 to Feb 28 in non-leap year and Feb 29 in leap year', () => {
      const jan30NonLeap = new Date('2025-01-30T15:00:00.000Z');
      expect(subscriptionDateService.calculateIntervalExpiry(jan30NonLeap, 'monthly').toISOString()).toBe(
        '2025-02-28T15:00:00.000Z'
      );

      const jan30Leap = new Date('2024-01-30T15:00:00.000Z');
      expect(subscriptionDateService.calculateIntervalExpiry(jan30Leap, 'monthly').toISOString()).toBe(
        '2024-02-29T15:00:00.000Z'
      );
    });
  });

  describe('3. Yearly Plans (Calendar-Year Interval & Leap-Year Rules)', () => {
    it('should calculate standard calendar-year interval', () => {
      const startsAt = new Date('2026-10-15T12:00:06.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'yearly');

      expect(expiry.toISOString()).toBe('2027-10-15T12:00:06.000Z');
    });

    it('should correctly clamp leap-day start (Feb 29, 2024) to Feb 28, 2025 in non-leap year', () => {
      const startsAt = new Date('2024-02-29T12:00:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'yearly');

      expect(expiry.toISOString()).toBe('2025-02-28T12:00:00.000Z');
    });

    it('should preserve Feb 28 start across years (Feb 28, 2023 -> Feb 28, 2024)', () => {
      const startsAt = new Date('2023-02-28T12:00:00.000Z');
      const expiry = subscriptionDateService.calculateIntervalExpiry(startsAt, 'yearly');

      expect(expiry.toISOString()).toBe('2024-02-28T12:00:00.000Z');
    });

    it('should resolve yearly billing cycle from product id or name heuristics', () => {
      const cycle1 = subscriptionDateService.resolveCanonicalCycle('yearly', 365, 'annual_plan');
      const cycle2 = subscriptionDateService.resolveCanonicalCycle('annual', 365, 'com.flirttime.yearly');
      const cycle3 = subscriptionDateService.resolveCanonicalCycle(null, 365, 'flirttime_1year_pass');

      expect(cycle1).toBe('yearly');
      expect(cycle2).toBe('yearly');
      expect(cycle3).toBe('yearly');
    });
  });

  describe('4. Dynamic Remaining Validity & Expiry Boundary Scenarios', () => {
    it('should calculate exact days, hours, minutes for active subscription', () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      const expiresAt = new Date('2026-10-22T16:45:00.000Z'); // 6 days, 4 hours, 45 minutes

      const validity = subscriptionDateService.calculateRemainingValidity(expiresAt, now);
      expect(validity).toEqual({
        days: 6,
        hours: 4,
        minutes: 45,
      });
      expect(subscriptionDateService.isExpired(expiresAt, now)).toBe(false);
    });

    it('should return 0 remaining validity exactly at the expiration boundary (now === expiresAt)', () => {
      const expiry = new Date('2026-10-16T12:00:06.000Z');
      const now = new Date('2026-10-16T12:00:06.000Z');

      expect(subscriptionDateService.isExpired(expiry, now)).toBe(true);
      expect(subscriptionDateService.calculateRemainingValidity(expiry, now)).toEqual({
        days: 0,
        hours: 0,
        minutes: 0,
      });
    });

    it('should return positive validity 1 millisecond before expiration', () => {
      const expiry = new Date('2026-10-16T12:00:06.000Z');
      const now = new Date(expiry.getTime() - 1); // 1 ms before

      expect(subscriptionDateService.isExpired(expiry, now)).toBe(false);
      const validity = subscriptionDateService.calculateRemainingValidity(expiry, now);
      expect(validity.days).toBe(0);
      expect(validity.hours).toBe(0);
      expect(validity.minutes).toBe(0); // Under 1 minute
    });

    it('should return 0 remaining validity 1 millisecond after expiration', () => {
      const expiry = new Date('2026-10-16T12:00:06.000Z');
      const now = new Date(expiry.getTime() + 1); // 1 ms after

      expect(subscriptionDateService.isExpired(expiry, now)).toBe(true);
      expect(subscriptionDateService.calculateRemainingValidity(expiry, now)).toEqual({
        days: 0,
        hours: 0,
        minutes: 0,
      });
    });

    it('should never return negative values for long-expired subscriptions', () => {
      const expiry = new Date('2026-01-01T00:00:00.000Z');
      const now = new Date('2026-10-16T12:00:00.000Z');

      expect(subscriptionDateService.isExpired(expiry, now)).toBe(true);
      expect(subscriptionDateService.calculateRemainingValidity(expiry, now)).toEqual({
        days: 0,
        hours: 0,
        minutes: 0,
      });
    });
  });

  describe('5. Next Renewal Date Calculation', () => {
    it('should return expiresAt ISO string when active, auto-renewing, and not expired', () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      const expiresAt = new Date('2026-10-23T12:00:00.000Z');

      const renewal = subscriptionDateService.calculateNextRenewalDate(
        { autoRenewing: true, status: 'active', expiresAt },
        now
      );
      expect(renewal).toBe('2026-10-23T12:00:00.000Z');
    });

    it('should return null when autoRenewing is false (user cancelled)', () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      const expiresAt = new Date('2026-10-23T12:00:00.000Z');

      const renewal = subscriptionDateService.calculateNextRenewalDate(
        { autoRenewing: false, status: 'canceled', expiresAt },
        now
      );
      expect(renewal).toBeNull();
    });

    it('should return null when subscription is expired, even if autoRenewing flag is true', () => {
      const now = new Date('2026-10-24T12:00:00.000Z');
      const expiresAt = new Date('2026-10-23T12:00:00.000Z');

      const renewal = subscriptionDateService.calculateNextRenewalDate(
        { autoRenewing: true, status: 'expired', expiresAt },
        now
      );
      expect(renewal).toBeNull();
    });

    it('should return null when status is not active (e.g. revoked, refunded, in_grace_period)', () => {
      const now = new Date('2026-10-16T12:00:00.000Z');
      const expiresAt = new Date('2026-10-23T12:00:00.000Z');

      expect(
        subscriptionDateService.calculateNextRenewalDate(
          { autoRenewing: true, status: 'revoked', expiresAt },
          now
        )
      ).toBeNull();

      expect(
        subscriptionDateService.calculateNextRenewalDate(
          { autoRenewing: true, status: 'in_grace_period', expiresAt },
          now
        )
      ).toBeNull();
    });
  });

  describe('6. Store Timestamp Parsing & UTC ISO Formatting', () => {
    it('should correctly parse 13-digit millisecond epoch numbers and strings', () => {
      const ms = 1729000000000;
      const d = subscriptionDateService.parseStoreTimestamp(ms);
      expect(d?.getTime()).toBe(ms);

      const dStr = subscriptionDateService.parseStoreTimestamp(String(ms));
      expect(dStr?.getTime()).toBe(ms);
    });

    it('should correctly parse 10-digit second epoch numbers and strings into milliseconds', () => {
      const sec = 1729000000;
      const d = subscriptionDateService.parseStoreTimestamp(sec);
      expect(d?.getTime()).toBe(sec * 1000);

      const dStr = subscriptionDateService.parseStoreTimestamp(String(sec));
      expect(dStr?.getTime()).toBe(sec * 1000);
    });

    it('should parse ISO 8601 UTC strings accurately', () => {
      const iso = '2026-10-15T12:00:06.000Z';
      const d = subscriptionDateService.parseStoreTimestamp(iso);
      expect(d?.toISOString()).toBe(iso);
    });

    it('should safely return null for missing, null, undefined, or invalid inputs without throwing', () => {
      expect(subscriptionDateService.parseStoreTimestamp(null)).toBeNull();
      expect(subscriptionDateService.parseStoreTimestamp(undefined)).toBeNull();
      expect(subscriptionDateService.parseStoreTimestamp('')).toBeNull();
      expect(subscriptionDateService.parseStoreTimestamp('invalid-date-string')).toBeNull();
      expect(subscriptionDateService.parseStoreTimestamp(NaN)).toBeNull();
    });

    it('should format all dates consistently in UTC ISO 8601 with Z suffix', () => {
      const res = subscriptionDateService.formatUtcIso('2026-10-15T12:00:06.000Z');
      expect(res).toBe('2026-10-15T12:00:06.000Z');
      expect(res?.endsWith('Z')).toBe(true);
    });
  });
});
