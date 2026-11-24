// A daily or hourly Unsplash photo for the standby screen's background. The
// photo is picked and cached here so the Unsplash access key never ships in
// the TV app. This is the only file that knows api.unsplash.com.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later

const API = 'https://api.unsplash.com';
const UTM = 'utm_source=castair&utm_medium=referral';
const UNSPLASH_URL = `https://unsplash.com/?${UTM}`;
const IMAGE_PARAMS = 'w=1920&h=1080&fit=crop&q=80&fm=jpg';
const FAILURE_BACKOFF_MS = 5 * 60 * 1000; // before asking Unsplash again after a failure
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// What each photos= value asks Unsplash for. Topic slugs are looked up to ids.
const SOURCES = {
  random: {topics: ['wallpapers']},
  landscape: {query: 'landscape'},
  graphics: {topics: ['3d-renders', 'textures-patterns']},
};

export function createWallpaper({
  fetch,
  now,
  accessKey,
  timeoutMs = 5000,
  warn = console.warn,
  maxPerHour = 20, // global cap on requests to Unsplash (lookups and download pings included)
}) {
  const cache = new Map(); // `${photos}:${every}` -> {period, value}
  const inflight = new Map(); // key -> Promise
  const backoffUntil = new Map(); // key -> ms
  const topicIds = new Map(); // slug -> id
  const requestTimes = []; // start times of Unsplash requests in the last hour

  function requestAllowed() {
    const t = now();
    while (requestTimes.length && t - requestTimes[0] >= HOUR_MS) requestTimes.shift();
    if (requestTimes.length >= maxPerHour) return false;
    requestTimes.push(t);
    return true;
  }

  // The period a photo lasts for: its id, and when the next one starts.
  function periodOf(every) {
    const t = now();
    const len = every === 'hour' ? HOUR_MS : DAY_MS;
    const start = Math.floor(t / len) * len;
    return {id: `${every}:${start}`, changesAt: new Date(start + len).toISOString()};
  }

  const cachedFor = (key, period) => {
    const entry = cache.get(key);
    return entry && entry.period === period.id ? entry.value : null;
  };

  function scrub(message) {
    return String(message).split(accessKey).join('[key]');
  }

  // setTimeout, not AbortSignal.timeout: that timer doesn't keep the event
  // loop alive. The race also covers a fetch or body that ignores the signal.
  async function request(url, handle) {
    const controller = new AbortController();
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`Unsplash request timed out after ${timeoutMs} ms`);
        err.name = 'TimeoutError';
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const work = fetch(url, {
        headers: {Authorization: `Client-ID ${accessKey}`},
        signal: controller.signal,
      }).then(handle);
      work.catch(() => {}); // if the timeout wins, don't leave this unhandled
      return await Promise.race([work, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  // `what` names the request in warnings: "topic lookup" or "random photo".
  async function getJson(url, what) {
    if (!requestAllowed()) return undefined; // cap reached
    try {
      return await request(url, async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
    } catch (err) {
      throw new Error(`${what} failed (${err.message})`);
    }
  }

  // Cached as a promise, so keys that start together share one lookup. A
  // failure, or a lookup the cap stopped, is dropped so the next call retries.
  function topicId(slug) {
    if (!topicIds.has(slug)) {
      const lookup = getJson(`${API}/topics/${encodeURIComponent(slug)}`, 'topic lookup').then((body) => {
        if (body === undefined) return undefined;
        if (!body?.id) throw new Error(`topic lookup failed (no id for ${slug})`);
        return body.id;
      });
      topicIds.set(slug, lookup);
      lookup.then(
        (id) => id === undefined && topicIds.get(slug) === lookup && topicIds.delete(slug),
        () => topicIds.get(slug) === lookup && topicIds.delete(slug),
      );
    }
    return topicIds.get(slug);
  }

  // Counts toward the cap and only warns on failure: Unsplash asks for it
  // when a photo is used, but the photo is shown either way.
  function ping(downloadLocation) {
    if (typeof downloadLocation !== 'string') return;
    if (!downloadLocation.startsWith(`${API}/`)) {
      warn('wallpaper: download ping skipped (unexpected host)'); // the key must only go to Unsplash's API
      return;
    }
    if (!requestAllowed()) return;
    request(downloadLocation, async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }).catch((err) => warn(`wallpaper: download ping failed (${scrub(err.message)})`));
  }

  // Returns the Wallpaper, undefined when the cap stops us, or throws.
  async function pick(photos, period) {
    const source = SOURCES[photos];
    const params = ['orientation=landscape', 'content_filter=high'];
    if (source.query) params.push(`query=${encodeURIComponent(source.query)}`);
    if (source.topics) {
      const ids = [];
      for (const slug of source.topics) {
        const id = await topicId(slug);
        if (id === undefined) return undefined;
        ids.push(encodeURIComponent(id));
      }
      params.push(`topics=${ids.join(',')}`);
    }
    const p = await getJson(`${API}/photos/random?${params.join('&')}`, 'random photo');
    if (p === undefined) return undefined;
    const raw = p?.urls?.raw;
    // Unsplash names sometimes carry doubled or trailing spaces ("pine  watt").
    const name = typeof p?.user?.name === 'string' ? p.user.name.replace(/\s+/g, ' ').trim() : undefined;
    const profile = p?.user?.links?.html;
    if (typeof raw !== 'string' || !raw || typeof name !== 'string' || !name) {
      throw new Error('random photo failed (no urls.raw or user.name)');
    }
    const value = {
      imageUrl: `${raw}${raw.includes('?') ? '&' : '?'}${IMAGE_PARAMS}`,
      color: typeof p.color === 'string' ? p.color : null,
      photographer: name,
      photographerUrl: typeof profile === 'string' && profile ? `${profile}?${UTM}` : UNSPLASH_URL,
      unsplashUrl: UNSPLASH_URL,
      changesAt: period.changesAt,
    };
    ping(p.links?.download_location);
    return value;
  }

  async function refresh(key, photos, period) {
    try {
      const value = await pick(photos, period);
      if (value === undefined) return cachedFor(key, period);
      cache.set(key, {period: period.id, value}); // replaces any earlier period
      return value;
    } catch (err) {
      warn(`wallpaper: ${scrub(err.message)}`);
      backoffUntil.set(key, now() + FAILURE_BACKOFF_MS);
      return cachedFor(key, period);
    }
  }

  return {
    async current(photos, every) {
      if (!accessKey) return null;
      if (!Object.hasOwn(SOURCES, photos)) photos = 'random';
      if (every !== 'hour') every = 'day';
      const key = `${photos}:${every}`;
      const period = periodOf(every);
      const hit = cachedFor(key, period);
      if (hit) return hit;
      if (inflight.has(key)) return inflight.get(key);
      if (now() < (backoffUntil.get(key) ?? 0)) return null;
      const job = refresh(key, photos, period).finally(() => inflight.delete(key));
      inflight.set(key, job);
      return job;
    },
  };
}
