// Unsplash wallpaper client: topic lookup, per-period cache, back-off, hourly
// cap. Uses a fake fetch and clock; never touches the network.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWallpaper} from '../src/wallpaper.js';

const KEY = 'test-key-not-real';
const T0 = Date.parse('2026-11-21T10:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const UTM = '?utm_source=castair&utm_medium=referral';
const RAW = 'https://images.unsplash.com/photo-1?ixid=abc&ixlib=rb-4.0';
const DOWNLOAD = 'https://api.unsplash.com/photos/p1/download?ixid=abc';
const TAIL = 'w=1920&h=1080&fit=crop&q=80&fm=jpg';

const ok = (body) => ({status: 200, ok: true, json: async () => body});
const bad = (status) => ({status, ok: false, json: async () => ({})});

function photo(over = {}) {
  return {
    urls: {raw: RAW},
    color: '#336699',
    user: {name: 'Ada Lens', links: {html: 'https://unsplash.com/@ada'}},
    links: {download_location: DOWNLOAD},
    ...over,
  };
}

// Answers by URL: topic lookups, /photos/random, download pings. `handler`
// may return a reply, throw, or return undefined to use the default.
function setup({handler, ...options} = {}) {
  const calls = [];
  const clock = {t: T0};
  const warnings = [];
  const fetch = async (url, init) => {
    calls.push({url, headers: init.headers});
    const custom = handler && (await handler(url, calls.length));
    if (custom) return custom;
    if (url.includes('/topics/')) return ok({id: `id-${url.split('/topics/')[1]}`});
    if (url.includes('/photos/random')) return ok(photo());
    return ok({url: 'https://images.unsplash.com/x'});
  };
  const wallpaper = createWallpaper({
    fetch,
    now: () => clock.t,
    accessKey: KEY,
    warn: (m) => warnings.push(m),
    ...options,
  });
  return {calls, clock, warnings, wallpaper};
}

const tick = () => new Promise((r) => setImmediate(r));
const randoms = (calls) => calls.filter((c) => c.url.includes('/photos/random'));

test('random daily: looks up the wallpapers topic once, then fetches /photos/random with topics=<id>&orientation=landscape&content_filter=high and the Client-ID header', async () => {
  const {calls, clock, wallpaper} = setup();
  await wallpaper.current('random', 'day');
  assert.equal(calls[0].url, 'https://api.unsplash.com/topics/wallpapers');
  assert.equal(calls[0].headers.Authorization, `Client-ID ${KEY}`);
  const u = new URL(calls[1].url);
  assert.equal(u.origin + u.pathname, 'https://api.unsplash.com/photos/random');
  assert.equal(u.searchParams.get('topics'), 'id-wallpapers');
  assert.equal(u.searchParams.get('orientation'), 'landscape');
  assert.equal(u.searchParams.get('content_filter'), 'high');
  assert.equal(u.searchParams.get('query'), null);
  assert.equal(calls[1].headers.Authorization, `Client-ID ${KEY}`);
  await tick();
  clock.t += 25 * HOUR; // new period: topic id must come from the cache
  await wallpaper.current('random', 'day');
  assert.equal(calls.filter((c) => c.url.includes('/topics/')).length, 1);
});

test('landscape uses query=landscape and no topics', async () => {
  const {calls, wallpaper} = setup();
  await wallpaper.current('landscape', 'day');
  assert.equal(calls.filter((c) => c.url.includes('/topics/')).length, 0);
  const u = new URL(randoms(calls)[0].url);
  assert.equal(u.searchParams.get('query'), 'landscape');
  assert.equal(u.searchParams.get('topics'), null);
  assert.equal(u.searchParams.get('orientation'), 'landscape');
  assert.equal(u.searchParams.get('content_filter'), 'high');
});

test('graphics asks for both topic ids comma-separated', async () => {
  const {calls, wallpaper} = setup();
  await wallpaper.current('graphics', 'day');
  assert.equal(calls[0].url, 'https://api.unsplash.com/topics/3d-renders');
  assert.equal(calls[1].url, 'https://api.unsplash.com/topics/textures-patterns');
  const u = new URL(randoms(calls)[0].url);
  assert.equal(u.searchParams.get('topics'), 'id-3d-renders,id-textures-patterns');
});

test('builds imageUrl from urls.raw plus &w=1920&h=1080&fit=crop&q=80&fm=jpg, and UTM links', async () => {
  const {wallpaper} = setup();
  assert.deepEqual(await wallpaper.current('landscape', 'day'), {
    imageUrl: `${RAW}&${TAIL}`,
    color: '#336699',
    photographer: 'Ada Lens',
    photographerUrl: `https://unsplash.com/@ada${UTM}`,
    unsplashUrl: `https://unsplash.com/${UTM}`,
    changesAt: '2026-11-22T00:00:00.000Z',
  });
});

test('photographer name: runs of spaces collapse to one and the ends are trimmed', async () => {
  const {wallpaper} = setup({
    handler: (url) =>
      url.includes('/photos/random') ? ok(photo({user: {name: ' pine  watt\t', links: {}}})) : undefined,
  });
  assert.equal((await wallpaper.current('landscape', 'day')).photographer, 'pine watt');
});

test('imageUrl uses ? when raw has no query, and color may be null', async () => {
  const {wallpaper} = setup({
    handler: (url) =>
      url.includes('/photos/random')
        ? ok(photo({urls: {raw: 'https://images.unsplash.com/p'}, color: undefined}))
        : undefined,
  });
  const w = await wallpaper.current('landscape', 'day');
  assert.equal(w.imageUrl, `https://images.unsplash.com/p?${TAIL}`);
  assert.equal(w.color, null);
});

test('same type and period: one Unsplash fetch, one download ping', async () => {
  const {calls, clock, wallpaper} = setup();
  const a = await wallpaper.current('landscape', 'day');
  await tick();
  clock.t += 5 * HOUR;
  const b = await wallpaper.current('landscape', 'day');
  await tick();
  assert.deepEqual(a, b);
  assert.equal(randoms(calls).length, 1);
  const pings = calls.filter((c) => c.url === DOWNLOAD);
  assert.equal(pings.length, 1);
  assert.equal(pings[0].headers.Authorization, `Client-ID ${KEY}`);
});

test('concurrent calls share one fetch', async () => {
  const {calls, wallpaper} = setup();
  const [a, b, c] = await Promise.all([
    wallpaper.current('random', 'day'),
    wallpaper.current('random', 'day'),
    wallpaper.current('random', 'day'),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(randoms(calls).length, 1);
});

test('next UTC day fetches a new photo; changesAt is the next midnight UTC', async () => {
  const {calls, clock, wallpaper} = setup();
  const a = await wallpaper.current('landscape', 'day');
  assert.equal(a.changesAt, '2026-11-22T00:00:00.000Z');
  clock.t = Date.parse('2026-11-22T00:00:01Z');
  const b = await wallpaper.current('landscape', 'day');
  assert.equal(b.changesAt, '2026-11-23T00:00:00.000Z');
  assert.equal(randoms(calls).length, 2);
});

test('hourly: changesAt is the next UTC hour', async () => {
  const {calls, clock, wallpaper} = setup();
  clock.t = Date.parse('2026-11-21T10:30:00Z');
  assert.equal((await wallpaper.current('landscape', 'hour')).changesAt, '2026-11-21T11:00:00.000Z');
  clock.t = Date.parse('2026-11-21T10:59:59Z');
  await wallpaper.current('landscape', 'hour');
  assert.equal(randoms(calls).length, 1);
  clock.t = Date.parse('2026-11-21T11:00:00Z');
  assert.equal((await wallpaper.current('landscape', 'hour')).changesAt, '2026-11-21T12:00:00.000Z');
  assert.equal(randoms(calls).length, 2);
});

test('unknown photos/every fall back to random/day', async () => {
  const {calls, wallpaper} = setup();
  const w = await wallpaper.current('bogus', 'fortnight');
  assert.equal(w.changesAt, '2026-11-22T00:00:00.000Z');
  assert.equal(new URL(randoms(calls)[0].url).searchParams.get('topics'), 'id-wallpapers');
  await wallpaper.current('random', 'day');
  assert.equal(randoms(calls).length, 1);
});

test('no key: returns null and never calls fetch', async () => {
  const {calls, wallpaper} = setup({accessKey: undefined});
  assert.equal(await wallpaper.current('random', 'day'), null);
  assert.equal(calls.length, 0);
});

test('failure: returns null, then no new request for 5 minutes, then retries', async () => {
  let fail = true;
  const {calls, clock, warnings, wallpaper} = setup({
    handler: (url) => (fail && url.includes('/photos/random') ? bad(500) : undefined),
  });
  assert.equal(await wallpaper.current('landscape', 'day'), null);
  assert.equal(warnings.length, 1);
  const n = calls.length;
  clock.t += 4 * MIN;
  assert.equal(await wallpaper.current('landscape', 'day'), null);
  assert.equal(calls.length, n);
  fail = false;
  clock.t += 1 * MIN;
  assert.ok(await wallpaper.current('landscape', 'day'));
  assert.equal(randoms(calls).length, 2);
});

test('a failed topic lookup is not cached', async () => {
  let fail = true;
  const {calls, clock, wallpaper} = setup({
    handler: (url) => (fail && url.includes('/topics/') ? bad(404) : undefined),
  });
  assert.equal(await wallpaper.current('random', 'day'), null);
  fail = false;
  clock.t += 5 * MIN;
  assert.ok(await wallpaper.current('random', 'day'));
  assert.equal(calls.filter((c) => c.url.includes('/topics/')).length, 2);
});

test('a photo missing user.name or urls.raw returns null', async () => {
  for (const broken of [
    photo({user: {links: {html: 'https://unsplash.com/@x'}}}),
    photo({user: {name: '   '}}),
    photo({urls: {}}),
  ]) {
    const {wallpaper} = setup({handler: (url) => (url.includes('/photos/random') ? ok(broken) : undefined)});
    assert.equal(await wallpaper.current('landscape', 'day'), null);
  }
});

test('timeout after the limit returns null', async () => {
  const {wallpaper, warnings} = setup({
    timeoutMs: 20,
    handler: (url) => (url.includes('/photos/random') ? new Promise(() => {}) : undefined),
  });
  assert.equal(await wallpaper.current('landscape', 'day'), null);
  assert.match(warnings[0], /timed out/);
});

test('cap: no more than 20 Unsplash requests in a rolling hour', async () => {
  const {calls, clock, wallpaper} = setup({handler: () => bad(500)});
  const combos = [];
  for (const p of ['random', 'landscape', 'graphics']) for (const e of ['day', 'hour']) combos.push([p, e]);
  for (let round = 0; round < 12; round++) {
    for (const [p, e] of combos) await wallpaper.current(p, e);
    clock.t += 5 * MIN;
  }
  assert.equal(calls.length, 20);
  clock.t = T0 + HOUR + MIN;
  await wallpaper.current('landscape', 'day');
  assert.equal(calls.length, 21);
});

test('cap reached: serves the cached photo for the current period, else null', async () => {
  const {calls, clock, wallpaper} = setup({maxPerHour: 2});
  const a = await wallpaper.current('landscape', 'hour'); // random + ping = 2 requests
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(await wallpaper.current('landscape', 'hour'), a);
  assert.equal(await wallpaper.current('landscape', 'day'), null);
  assert.equal(calls.length, 2);
  clock.t += 5 * MIN; // same hour period if still within it
  assert.deepEqual(await wallpaper.current('landscape', 'hour'), a);
});

test('the key never appears in a warn message', async () => {
  const {warnings, clock, wallpaper} = setup({
    handler: (url, n) => {
      if (n === 1) throw new Error(`boom ${url} Client-ID ${KEY}`);
      return bad(401);
    },
  });
  await wallpaper.current('landscape', 'day');
  clock.t += 5 * MIN;
  await wallpaper.current('landscape', 'day');
  assert.ok(warnings.length >= 2);
  for (const w of warnings) assert.ok(!w.includes(KEY), w);
});

test('a failed download ping only warns: the photo is served and there is no back-off', async () => {
  const {calls, warnings, wallpaper} = setup({handler: (url) => (url === DOWNLOAD ? bad(500) : undefined)});
  const w = await wallpaper.current('landscape', 'day');
  await tick();
  assert.ok(w);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /download ping failed/);
  assert.deepEqual(await wallpaper.current('landscape', 'day'), w);
  assert.equal(randoms(calls).length, 1);
});

test('a ping URL on another host is never fetched', async () => {
  const evil = 'https://evil.example.com/photos/p1/download';
  const {calls, warnings, wallpaper} = setup({
    handler: (url) => (url.includes('/photos/random') ? ok(photo({links: {download_location: evil}})) : undefined),
  });
  assert.ok(await wallpaper.current('landscape', 'day'));
  await tick();
  assert.equal(calls.filter((c) => !c.url.startsWith('https://api.unsplash.com/')).length, 0);
  assert.deepEqual(warnings, ['wallpaper: download ping skipped (unexpected host)']);
});

test('the key never appears in a warn from a failed ping', async () => {
  const {warnings, wallpaper} = setup({
    handler: (url) => {
      if (url === DOWNLOAD) throw new Error(`boom ${url} Client-ID ${KEY}`);
    },
  });
  await wallpaper.current('landscape', 'day');
  await tick();
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes(KEY), warnings[0]);
});

test('random:day and random:hour starting together make one topic lookup', async () => {
  const {calls, wallpaper} = setup();
  const [a, b] = await Promise.all([wallpaper.current('random', 'day'), wallpaper.current('random', 'hour')]);
  assert.ok(a && b);
  assert.equal(calls.filter((c) => c.url.includes('/topics/')).length, 1);
});

test('warnings say which request failed', async () => {
  const kinds = [
    ['/topics/', 'random', /topic lookup failed/],
    ['/photos/random', 'landscape', /random photo failed/],
  ];
  for (const [part, photos, re] of kinds) {
    const {warnings, wallpaper} = setup({handler: (url) => (url.includes(part) ? bad(500) : undefined)});
    await wallpaper.current(photos, 'day');
    assert.match(warnings[0], re);
  }
});
