/*
 * Tests for the weekly free allowance maths.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {ALLOWANCE_MS, currentState, leftLabel, remainingMs, settingsLabel, spend, weekStart} from '../src/Allowance';

const DAY = 24 * 3_600_000;

describe('weekStart', () => {
  it('is the previous Monday 05:00 just before the reset', () => {
    expect(weekStart(Date.UTC(2026, 10, 30, 4, 59), 0)).toBe(Date.UTC(2026, 10, 23, 5, 0));
  });
  it('is itself exactly at the reset', () => {
    expect(weekStart(Date.UTC(2026, 10, 30, 5, 0), 0)).toBe(Date.UTC(2026, 10, 30, 5, 0));
  });
  it('is the Monday before on a Sunday night', () => {
    expect(weekStart(Date.UTC(2026, 10, 29, 23, 0), 0)).toBe(Date.UTC(2026, 10, 23, 5, 0));
  });
  it('follows a positive offset', () => {
    expect(weekStart(Date.UTC(2026, 10, 30, 4, 30), 60)).toBe(Date.UTC(2026, 10, 30, 4, 0));
  });
  it('follows a negative offset', () => {
    expect(weekStart(Date.UTC(2026, 10, 30, 9, 59), -300)).toBe(Date.UTC(2026, 10, 23, 10, 0));
  });
  it('works across a year change', () => {
    expect(weekStart(Date.UTC(2027, 0, 1, 12, 0), 0)).toBe(Date.UTC(2026, 11, 28, 5, 0));
  });
});

describe('currentState', () => {
  const now = Date.UTC(2026, 10, 26, 12, 0);
  const fresh = {weekStart: weekStart(now, 0), usedMs: 0};

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a non-numeric weekStart', {weekStart: 'a', usedMs: 1}],
    ['negative usedMs', {weekStart: 1, usedMs: -5}],
    ['a NaN weekStart', {weekStart: NaN, usedMs: 0}],
  ])('treats %s as a fresh week', (_name, stored) => {
    expect(currentState(stored, now, 0)).toEqual(fresh);
  });

  it("keeps this week's stored state", () => {
    const stored = {weekStart: weekStart(now, 0), usedMs: 90_000};
    expect(currentState(stored, now, 0)).toEqual(stored);
  });
  it("gives a fresh week when stored is last week's", () => {
    const stored = {weekStart: weekStart(now - 7 * DAY, 0), usedMs: 90_000};
    expect(currentState(stored, now, 0)).toEqual(fresh);
  });
  it('keeps the state across a daylight-saving shift', () => {
    const stored = {weekStart: weekStart(now, 60), usedMs: 120_000};
    const later = now + 2 * DAY;
    expect(currentState(stored, later, 0)).toEqual(stored);
  });
  it('keeps the state when the clock has moved back', () => {
    const stored = {weekStart: now + 3 * DAY, usedMs: 60_000};
    expect(currentState(stored, now, 0)).toEqual(stored);
  });
});

describe('remainingMs', () => {
  it('is the whole allowance when nothing is used', () => {
    expect(remainingMs({weekStart: 0, usedMs: 0})).toBe(1_800_000);
    expect(ALLOWANCE_MS).toBe(1_800_000);
  });
  it('never goes below zero', () => {
    expect(remainingMs({weekStart: 0, usedMs: 2_000_000})).toBe(0);
  });
});

describe('spend', () => {
  it('adds the cast time inside one week', () => {
    const ws = Date.UTC(2026, 10, 23, 5, 0);
    const from = Date.UTC(2026, 10, 25, 10, 0);
    expect(spend({weekStart: ws, usedMs: 1000}, from, from + 5000, 0)).toEqual({weekStart: ws, usedMs: 6000});
  });
  it('drops time before a reset inside the span', () => {
    const oldWs = Date.UTC(2026, 10, 23, 5, 0);
    const newWs = Date.UTC(2026, 10, 30, 5, 0);
    const state = {weekStart: oldWs, usedMs: 20 * 60_000};
    const result = spend(state, Date.UTC(2026, 10, 30, 4, 50), Date.UTC(2026, 10, 30, 5, 10), 0);
    expect(result).toEqual({weekStart: newWs, usedMs: 600_000});
  });
  it('never makes usedMs negative when the span runs backwards', () => {
    const ws = Date.UTC(2026, 10, 23, 5, 0);
    const at = Date.UTC(2026, 10, 25, 10, 0);
    expect(spend({weekStart: ws, usedMs: 1000}, at, at - 5000, 0)).toEqual({weekStart: ws, usedMs: 1000});
  });
  it("starts the new week when the stored week is last week's and the whole span is in the new week", () => {
    const oldWs = Date.UTC(2026, 10, 23, 5, 0);
    const newWs = Date.UTC(2026, 10, 30, 5, 0);
    const state = {weekStart: oldWs, usedMs: 25 * 60_000};
    const from = Date.UTC(2026, 11, 1, 10, 0);
    expect(spend(state, from, from + 90_000, 0)).toEqual({weekStart: newWs, usedMs: 90_000});
  });
  it('keeps a state dated in the future (clock moved back) and adds the span to it', () => {
    const futureWs = Date.UTC(2026, 11, 7, 5, 0);
    const state = {weekStart: futureWs, usedMs: 5000};
    const from = Date.UTC(2026, 11, 2, 10, 0);
    expect(spend(state, from, from + 3000, 0)).toEqual({weekStart: futureWs, usedMs: 8000});
  });
});

describe('leftLabel', () => {
  it('rounds minutes down', () => {
    expect(leftLabel(1_440_000)).toBe('24 min left this week');
    expect(leftLabel(119_999)).toBe('1 min left this week');
  });
  it('says under a minute for 1 ms to 59 999 ms', () => {
    expect(leftLabel(59_999)).toBe('under a minute left this week');
    expect(leftLabel(1)).toBe('under a minute left this week');
  });
  it('says none left at zero', () => {
    expect(leftLabel(0)).toBe('no free time left until Monday');
  });
});

describe('settingsLabel', () => {
  it('shows minutes of the allowance and the reset', () => {
    expect(settingsLabel(1_440_000)).toBe('Free · 24 of 30 min left · resets Monday 05:00');
  });
  it('says under a minute for 1 ms to 59 999 ms', () => {
    expect(settingsLabel(59_999)).toBe('Free · under a minute left · resets Monday 05:00');
    expect(settingsLabel(1)).toBe('Free · under a minute left · resets Monday 05:00');
  });
  it('says none left at zero', () => {
    expect(settingsLabel(0)).toBe('Free · none left · resets Monday 05:00');
  });
});
