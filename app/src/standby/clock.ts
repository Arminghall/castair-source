/*
 * Standby clock: time-zone and offset helpers; formats from offsets, never Intl.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {StandbyInfo} from './data';

/** The stick's own time-zone setting (B10), or null if unreadable or only a generic zone. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === 'UTC' || zone === 'GMT' || zone === 'Universal' || zone.startsWith('Etc/')) {
      return null;
    }
    return zone;
  } catch {
    return null;
  }
}

/** The region of the stick's locale (en-GB gives GB), or null if the locale has none. */
export function deviceCountry(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const region = locale
      .split('-')
      .slice(1)
      .find((part) => /^[A-Za-z]{2}$/.test(part));
    return region ? region.toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Minutes east of UTC at nowMs, from the server's offset and its next change. */
export function offsetAt(nowMs: number, time: StandbyInfo['time']): number {
  if (!time) {
    return 0;
  }
  if (time.next && nowMs >= Date.parse(time.next.at)) {
    return time.next.utcOffsetMinutes;
  }
  return time.utcOffsetMinutes;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function formatTime(nowMs: number, offsetMin: number, hour12: boolean): string {
  const d = new Date(nowMs + offsetMin * 60_000);
  const h = d.getUTCHours();
  const m = pad2(d.getUTCMinutes());
  if (!hour12) {
    return `${pad2(h)}:${m}`;
  }
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatDate(nowMs: number, offsetMin: number, countryCode: string | null): string {
  const d = new Date(nowMs + offsetMin * 60_000);
  const weekday = WEEKDAYS[d.getUTCDay()];
  const month = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  return countryCode === 'US' ? `${weekday}, ${month} ${day}` : `${weekday} ${day} ${month}`;
}
