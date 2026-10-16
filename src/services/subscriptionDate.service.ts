/**
 * FlirtTime Subscription Date & Interval Calculation Service
 *
 * Implements strict UTC date arithmetic for subscription intervals:
 * - Weekly: 7-day exact interval (7 * 24 * 60 * 60 * 1000 ms)
 * - Monthly: Calendar-month interval respecting month-end (28/29/30/31) and leap-year rules
 * - Yearly: Calendar-year interval respecting leap-year rules (Feb 29 -> Feb 28 in non-leap years)
 * - Dynamic remaining validity breakdown (days, hours, minutes)
 * - Safe parsing and formatting of store timestamps in UTC ISO 8601
 */

export interface RemainingValidity {
  days: number;
  hours: number;
  minutes: number;
}

export class SubscriptionDateService {
  /**
   * Determines if a given year is a leap year in the Gregorian calendar
   */
  public isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  }

  /**
   * Returns the number of days in a given UTC month (1-indexed: 1 = Jan, 12 = Dec)
   */
  public getDaysInUtcMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  /**
   * Safely parses any store timestamp (millisecond number, second number, ISO string, or Date)
   * into a valid UTC Date object. Returns null if invalid or missing.
   */
  public parseStoreTimestamp(val: unknown): Date | null {
    if (val === null || val === undefined || val === '') {
      return null;
    }

    if (val instanceof Date) {
      return isNaN(val.getTime()) ? null : val;
    }

    if (typeof val === 'number') {
      if (isNaN(val) || !isFinite(val)) return null;
      // If 10 digits (epoch seconds), convert to milliseconds
      const ms = val < 1e11 ? val * 1000 : val;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }

    if (typeof val === 'string') {
      const trimmed = val.trim();
      const num = Number(trimmed);
      if (!isNaN(num) && isFinite(num) && /^\d+$/.test(trimmed)) {
        const ms = num < 1e11 ? num * 1000 : num;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  /**
   * Safely converts any valid Date / timestamp to ISO 8601 UTC string (e.g. 2026-10-15T12:00:06.000Z).
   * Returns null if input is missing or invalid.
   */
  public formatUtcIso(val: unknown): string | null {
    const d = this.parseStoreTimestamp(val);
    return d ? d.toISOString() : null;
  }

  /**
   * Resolves canonical billing cycle string: 'weekly' | 'monthly' | 'yearly' | 'custom'
   */
  public resolveCanonicalCycle(
    billingCycle?: string | null,
    durationDays?: number | null,
    identifier?: string | null
  ): 'weekly' | 'monthly' | 'yearly' | 'custom' {
    const rawCycle = (billingCycle || '').toLowerCase().trim();
    const rawId = (identifier || '').toLowerCase();
    const days = typeof durationDays === 'number' ? durationDays : 0;

    // Check duration matches first
    if (days === 7) return 'weekly';
    if (days >= 28 && days <= 31) return 'monthly';
    if (days >= 360 && days <= 366) return 'yearly';

    // Check keyword heuristics on identifier
    if (rawId.includes('week')) return 'weekly';
    if (rawId.includes('year') || rawId.includes('annual')) return 'yearly';
    if (rawId.includes('month')) return 'monthly';

    // Check cycle strings
    if (rawCycle === 'weekly' || rawCycle === 'week') return 'weekly';
    if (rawCycle === 'yearly' || rawCycle === 'year' || rawCycle === 'annual') return 'yearly';
    if (rawCycle === 'monthly' || rawCycle === 'month') return 'monthly';

    if (days > 0) return 'custom';
    return 'monthly'; // default fallback
  }

  /**
   * Calculates the exact subscription expiry date from startsAt based on billing interval rules:
   * 1. Weekly: 7 days exact billing interval (UTC)
   * 2. Monthly: Calendar-month interval, respecting month-end (28/29/30/31) and leap-year rules
   * 3. Yearly: Calendar-year interval, respecting leap years (Feb 29 -> Feb 28)
   * 4. Custom: exact durationDays in days
   */
  public calculateIntervalExpiry(
    startsAt: Date | string,
    billingCycle: string,
    durationDays?: number | null,
    identifier?: string | null
  ): Date {
    const parsedStart = this.parseStoreTimestamp(startsAt);
    const start = parsedStart || new Date();

    const canonical = this.resolveCanonicalCycle(billingCycle, durationDays, identifier);

    if (canonical === 'weekly') {
      // Rule 1: Weekly plans: exactly 7-day billing interval
      return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    if (canonical === 'monthly') {
      // Rule 2: Monthly plans: calendar-month interval respecting month-end and leap-year rules
      const startYear = start.getUTCFullYear();
      const startMonth = start.getUTCMonth(); // 0 to 11
      const startDate = start.getUTCDate();
      const hours = start.getUTCHours();
      const minutes = start.getUTCMinutes();
      const seconds = start.getUTCSeconds();
      const ms = start.getUTCMilliseconds();

      const targetYear = startMonth === 11 ? startYear + 1 : startYear;
      const targetMonth = (startMonth + 1) % 12; // 0 to 11

      // Days in target month (1-indexed month passed to getDaysInUtcMonth: targetMonth + 1)
      const maxDaysInTarget = this.getDaysInUtcMonth(targetYear, targetMonth + 1);
      const targetDate = Math.min(startDate, maxDaysInTarget);

      return new Date(Date.UTC(targetYear, targetMonth, targetDate, hours, minutes, seconds, ms));
    }

    if (canonical === 'yearly') {
      // Rule 3: Yearly plans: calendar-year interval respecting leap years
      const startYear = start.getUTCFullYear();
      const startMonth = start.getUTCMonth(); // 0 to 11
      const startDate = start.getUTCDate();
      const hours = start.getUTCHours();
      const minutes = start.getUTCMinutes();
      const seconds = start.getUTCSeconds();
      const ms = start.getUTCMilliseconds();

      const targetYear = startYear + 1;
      let targetDate = startDate;

      // Leap day adjustment: Feb 29 in startYear -> Feb 28 in non-leap targetYear
      if (startMonth === 1 && startDate === 29 && !this.isLeapYear(targetYear)) {
        targetDate = 28;
      }

      return new Date(Date.UTC(targetYear, startMonth, targetDate, hours, minutes, seconds, ms));
    }

    // Custom duration days
    const days = typeof durationDays === 'number' && durationDays > 0 ? durationDays : 7;
    return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Dynamically calculates remaining validity on every request.
   * If the subscription is expired (expiresAt <= now), it returns { days: 0, hours: 0, minutes: 0 }.
   * Expired subscriptions NEVER show positive remaining validity.
   */
  public calculateRemainingValidity(
    expiresAt: Date | string | null | undefined,
    nowDate: Date = new Date()
  ): RemainingValidity {
    const exp = this.parseStoreTimestamp(expiresAt);
    if (!exp) {
      return { days: 0, hours: 0, minutes: 0 };
    }

    const diffMs = exp.getTime() - nowDate.getTime();
    if (diffMs <= 0) {
      return { days: 0, hours: 0, minutes: 0 };
    }

    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    return { days, hours, minutes };
  }

  /**
   * Authoritatively determines whether a subscription has expired based on expiresAt and now.
   */
  public isExpired(
    expiresAt: Date | string | null | undefined,
    nowDate: Date = new Date()
  ): boolean {
    const exp = this.parseStoreTimestamp(expiresAt);
    if (!exp) return true;
    return exp.getTime() <= nowDate.getTime();
  }

  /**
   * Computes consistent nextRenewalDate ISO string.
   * Only returns an ISO 8601 UTC date string when autoRenewing is true, status is 'active',
   * and the subscription has not expired. Returns null for canceled, expired, revoked, or non-renewing states.
   */
  public calculateNextRenewalDate(
    sub: {
      autoRenewing?: boolean | null;
      status?: string | null;
      expiresAt?: Date | string | null;
      isEntitled?: boolean | null;
    },
    nowDate: Date = new Date()
  ): string | null {
    if (!sub.autoRenewing) return null;
    if (sub.status !== 'active') return null;
    if (this.isExpired(sub.expiresAt, nowDate)) return null;

    const exp = this.parseStoreTimestamp(sub.expiresAt);
    return exp ? exp.toISOString() : null;
  }
}

export const subscriptionDateService = new SubscriptionDateService();
