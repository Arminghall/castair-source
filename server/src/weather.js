// Current weather from MET Norway's locationforecast API, cached per ~1 km
// area so we obey their terms: no request before Expires, If-Modified-Since
// on refresh, and a User-Agent that identifies us. This is the only file
// that knows api.met.no.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later

const ENDPOINT = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // when Expires is missing or unreadable
const FAILURE_BACKOFF_MS = 5 * 60 * 1000; // before asking MET again after a failure
const MAX_STALE_MS = 3 * 60 * 60 * 1000; // how long past Expires an old value may still be shown

const round2 = (n) => Number(n.toFixed(2));

function httpDate(value, fallback) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? fallback : ms;
}

function parseForecast(body) {
  const data = body.properties.timeseries[0].data;
  const temp = data.instant.details.air_temperature;
  if (typeof temp !== 'number') throw new Error('no air_temperature');
  const symbol = data.next_1_hours?.summary?.symbol_code ?? data.next_6_hours?.summary?.symbol_code ?? 'unknown';
  return {tempC: Math.round(temp) || 0, symbol}; // `|| 0` turns -0 into 0
}

export function createWeather({
  fetch,
  now,
  userAgent,
  timeoutMs = 5000,
  warn = console.warn,
  maxFetchesPerMinute = 60, // global cap on requests to MET, however many areas are asked for
  maxEntries = 2000, // cache size; the least recently used area is dropped first
}) {
  // key -> {value, expires, validUntil, lastModified}. `expires` is when we
  // may next ask MET (MET's Expires, or a short back-off after a failure);
  // `validUntil` is MET's own Expires, which the 3-hour stale limit counts from.
  const cache = new Map();
  const inflight = new Map(); // key -> Promise
  const fetchTimes = []; // start times of MET requests in the last minute

  // Insert or update, as the most recently used entry; evict the oldest over the cap.
  function store(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function fetchAllowed() {
    const t = now();
    while (fetchTimes.length && t - fetchTimes[0] >= 60_000) fetchTimes.shift();
    if (fetchTimes.length >= maxFetchesPerMinute) return false;
    fetchTimes.push(t);
    return true;
  }

  const fresh = (entry) => (entry.value && now() - entry.validUntil <= MAX_STALE_MS ? entry.value : null);

  // Runs fetch and `handle(res)` (which reads the body) under one timeout.
  // setTimeout, not AbortSignal.timeout: that timer doesn't keep the event
  // loop alive. The race also covers a fetch or body that ignores the signal.
  async function request(url, headers, handle) {
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`MET request timed out after ${timeoutMs} ms`);
        err.name = 'TimeoutError';
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const work = fetch(url, {headers, signal: controller.signal}).then(handle);
      work.catch(() => {}); // if the timeout wins, don't leave this unhandled
      return await Promise.race([work, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(key, lat, lon) {
    const entry = cache.get(key);
    const headers = {'User-Agent': userAgent};
    if (entry?.lastModified) headers['If-Modified-Since'] = entry.lastModified;
    try {
      return await request(`${ENDPOINT}?lat=${lat}&lon=${lon}`, headers, async (res) => {
        const expires = httpDate(res.headers.get('expires'), now() + DEFAULT_TTL_MS);
        if (res.status === 304 && entry?.value) {
          entry.expires = entry.validUntil = expires;
          return entry.value;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const value = parseForecast(await res.json());
        store(key, {
          value,
          expires,
          validUntil: expires,
          lastModified: res.headers.get('last-modified') ?? undefined,
        });
        return value;
      });
    } catch (err) {
      warn(`weather: MET request failed (${err.message})`);
      // Back off, so an outage or a 403 isn't hammered on every call.
      const retryAt = now() + FAILURE_BACKOFF_MS;
      if (!entry) {
        store(key, {value: null, expires: retryAt, validUntil: 0});
        return null;
      }
      entry.expires = retryAt;
      return fresh(entry);
    }
  }

  return {
    async current(lat, lon) {
      const la = round2(lat);
      const lo = round2(lon);
      const key = `${la},${lo}`;
      const entry = cache.get(key);
      if (entry) store(key, entry); // most recently used
      if (entry && now() < entry.expires) return fresh(entry);
      if (!inflight.has(key)) {
        if (!fetchAllowed()) return entry ? fresh(entry) : null;
        inflight.set(
          key,
          refresh(key, la, lo).finally(() => inflight.delete(key)),
        );
      }
      return inflight.get(key);
    },
  };
}
