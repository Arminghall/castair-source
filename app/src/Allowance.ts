/*
 * The weekly free allowance: week boundaries, time spent and display strings. Pure; no timers or storage.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const ALLOWANCE_MS = 30 * 60_000;
export const RESET_WEEKDAY = 1; // Monday; 0 is Sunday
export const RESET_HOUR = 5;
export const WARN_AT_MS: readonly number[] = [5 * 60_000, 60_000];
export const SAVE_EVERY_MS = 15_000;

export type AllowanceState = {weekStart: number; usedMs: number};

const DAY_MS = 24 * 3_600_000;
const MINUTE_MS = 60_000;

/** Epoch ms of the latest Monday 05:00 (local, at this offset) that is not after nowMs. */
export function weekStart(nowMs: number, offsetMin: number): number {
  const local = new Date(nowMs + offsetMin * MINUTE_MS);
  const daysSinceReset = (local.getUTCDay() - RESET_WEEKDAY + 7) % 7;
  const resetToday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), RESET_HOUR);
  let start = resetToday - daysSinceReset * DAY_MS - offsetMin * MINUTE_MS;
  if (start > nowMs) {
    start -= 7 * DAY_MS;
  }
  return start;
}

function isState(value: unknown): value is AllowanceState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const {weekStart: start, usedMs} = value as Record<string, unknown>;
  return (
    typeof start === 'number' &&
    Number.isFinite(start) &&
    typeof usedMs === 'number' &&
    Number.isFinite(usedMs) &&
    usedMs >= 0
  );
}

/** The state to use now: `stored` if it is this week's (or dated in the future), else a fresh week. */
export function currentState(stored: unknown, nowMs: number, offsetMin: number): AllowanceState {
  const start = weekStart(nowMs, offsetMin);
  if (isState(stored) && start - stored.weekStart < DAY_MS) {
    return {weekStart: stored.weekStart, usedMs: stored.usedMs};
  }
  return {weekStart: start, usedMs: 0};
}

export function remainingMs(state: AllowanceState): number {
  return Math.min(ALLOWANCE_MS, Math.max(0, ALLOWANCE_MS - state.usedMs));
}

/** Adds the cast time fromMs..toMs; time before a reset inside the span is dropped with the old week. */
export function spend(state: AllowanceState, fromMs: number, toMs: number, offsetMin: number): AllowanceState {
  if (!(toMs > fromMs)) {
    return state;
  }
  const resetAt = weekStart(toMs, offsetMin);
  const counted = toMs - Math.max(fromMs, resetAt);
  if (resetAt - state.weekStart >= DAY_MS) {
    return {weekStart: resetAt, usedMs: counted};
  }
  return {weekStart: state.weekStart, usedMs: state.usedMs + counted};
}

export function leftLabel(remaining: number): string {
  if (remaining <= 0) {
    return 'no free time left until Monday';
  }
  if (remaining < MINUTE_MS) {
    return 'under a minute left this week';
  }
  return `${Math.floor(remaining / MINUTE_MS)} min left this week`;
}

export function settingsLabel(remaining: number): string {
  if (remaining <= 0) {
    return 'Free · none left · resets Monday 05:00';
  }
  if (remaining < MINUTE_MS) {
    return 'Free · under a minute left · resets Monday 05:00';
  }
  return `Free · ${Math.floor(remaining / MINUTE_MS)} of ${ALLOWANCE_MS / MINUTE_MS} min left · resets Monday 05:00`;
}
