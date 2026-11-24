// Time zone offsets for the standby clock: the offset now, and the next
// change (daylight saving) within a year, so the TV can keep time offline.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LOOKAHEAD = 366 * 24 * HOUR;
const CACHE_MS = HOUR;

const formatters = new Map();
const cache = new Map();

// ICU takes zone names in any case, so 'asia/kolkata' and 'ASIA/Kolkata' would
// each get their own formatter and cache entry. Everything is keyed by the
// canonical name instead; this maps lower-case names to it.
const canonicalNames = new Map(Intl.supportedValuesOf('timeZone').map((z) => [z.toLowerCase(), z]));

// The canonical spelling of a zone name, or null if it isn't a zone.
function canonicalZone(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return null;
  const lower = name.toLowerCase();
  const known = canonicalNames.get(lower);
  if (known) return known;
  try {
    // Valid names missing from the list (aliases like 'UTC'); remembered so
    // other spellings of them are a lookup too. The set of zone names is finite.
    const canonical = new Intl.DateTimeFormat('en', {timeZone: name}).resolvedOptions().timeZone;
    canonicalNames.set(lower, canonical);
    canonicalNames.set(canonical.toLowerCase(), canonical);
    return canonical;
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

// Minutes east of UTC for `ms` in the zone ('GMT', 'GMT+05:30', 'GMT-03:30').
function offsetAt(timeZone, ms) {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en', {timeZone, timeZoneName: 'longOffset'});
    formatters.set(timeZone, fmt);
  }
  const name = fmt.formatToParts(ms).find((p) => p.type === 'timeZoneName').value;
  const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
  if (!m) throw new RangeError(`Unexpected offset ${name}`);
  return m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

// First minute after `now` (within a year) at which the offset differs.
function nextChange(timeZone, now, current) {
  const start = Math.floor(now / MINUTE) * MINUTE;
  for (let t = start + HOUR; t <= start + LOOKAHEAD; t += HOUR) {
    if (offsetAt(timeZone, t) === current) continue;
    let lo = t - HOUR; // offset is `current`
    let hi = t; // offset differs
    while (hi - lo > MINUTE) {
      const mid = lo + Math.floor((hi - lo) / 2 / MINUTE) * MINUTE;
      if (offsetAt(timeZone, mid) === current) lo = mid;
      else hi = mid;
    }
    return {at: new Date(hi).toISOString(), utcOffsetMinutes: offsetAt(timeZone, hi)};
  }
  return null;
}

/** The zone's UTC offset at `now` and its next offset change, or null for an unknown zone. */
export function zoneInfo(name, now) {
  const timeZone = canonicalZone(name);
  if (!timeZone) return null;
  const hit = cache.get(timeZone);
  const age = now.getTime() - (hit?.computedAt ?? 0);
  if (hit && age >= 0 && age < CACHE_MS && !(hit.info.next && now.getTime() >= Date.parse(hit.info.next.at))) {
    return hit.info;
  }
  cache.delete(timeZone);
  const current = offsetAt(timeZone, now.getTime());
  const info = {timeZone, utcOffsetMinutes: current, next: nextChange(timeZone, now.getTime(), current)};
  cache.set(timeZone, {computedAt: now.getTime(), info});
  return info;
}
