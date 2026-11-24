// MET Norway client: cache rules (Expires, If-Modified-Since), failure
// fallbacks. Uses a fake fetch and clock; never touches the network.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {createWeather} from '../src/weather.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/met-compact.json', import.meta.url), 'utf8'));
const UA = 'CastAir/1.0.0 castair.app castair@arminghall.com';
const T0 = Date.parse('2026-11-20T10:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

const httpDate = (ms) => new Date(ms).toUTCString();

function reply(status, {body, expires, lastModified} = {}) {
  const headers = new Map();
  if (expires !== undefined) headers.set('expires', httpDate(expires));
  if (lastModified !== undefined) headers.set('last-modified', httpDate(lastModified));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {get: (name) => headers.get(name.toLowerCase()) ?? null},
    json: async () => body,
  };
}

// A fetch that plays back responses (or throws Errors) in order and records calls.
function setup(...script) {
  const calls = [];
  const clock = {t: T0};
  const fetch = async (url, init) => {
    calls.push({url, headers: init.headers});
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const weather = createWeather({fetch, now: () => clock.t, userAgent: UA, warn: () => {}});
  return {calls, clock, weather};
}

test('fetches once and serves from cache until Expires', async () => {
  const {calls, clock, weather} = setup(reply(200, {body: fixture, expires: T0 + 10 * MIN}));
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  clock.t = T0 + 5 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.21&lon=0.12');
  assert.equal(calls[0].headers['User-Agent'], UA);
  assert.equal(calls[0].headers['If-Modified-Since'], undefined);
});

test('rounds nearby coordinates into one cache entry', async () => {
  const {calls, weather} = setup(reply(200, {body: fixture, expires: T0 + 10 * MIN}));
  await weather.current(52.211, 0.121);
  await weather.current(52.214, 0.119);
  assert.equal(calls.length, 1);
});

test('shares one request between concurrent calls for the same area', async () => {
  const {calls, weather} = setup(reply(200, {body: fixture, expires: T0 + 10 * MIN}));
  const [a, b] = await Promise.all([weather.current(52.21, 0.12), weather.current(52.21, 0.12)]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
});

test('sends If-Modified-Since after Expires and keeps the value on 304', async () => {
  const lastModified = T0 - 2 * MIN;
  const {calls, clock, weather} = setup(
    reply(200, {body: fixture, expires: T0 + 10 * MIN, lastModified}),
    reply(304, {expires: T0 + 25 * MIN}),
  );
  await weather.current(52.21, 0.12);
  clock.t = T0 + 11 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['If-Modified-Since'], httpDate(lastModified));
  // The 304's Expires took effect: no third request at +20 min.
  clock.t = T0 + 20 * MIN;
  await weather.current(52.21, 0.12);
  assert.equal(calls.length, 2);
});

test('returns null on 403', async () => {
  const {weather} = setup(reply(403));
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('serves the cached value when a refresh fails', async () => {
  const {clock, weather} = setup(
    reply(200, {body: fixture, expires: T0 + 10 * MIN}),
    reply(503),
    new Error('network down'),
  );
  await weather.current(52.21, 0.12);
  clock.t = T0 + 11 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  clock.t = T0 + 12 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
});

test('drops a cached value more than 3 hours past Expires', async () => {
  const {clock, weather} = setup(reply(200, {body: fixture, expires: T0 + 10 * MIN}), reply(503));
  await weather.current(52.21, 0.12);
  clock.t = T0 + 10 * MIN + 3 * HOUR + 1;
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('times out and resolves null when fetch never answers', async () => {
  const fetch = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  const weather = createWeather({fetch, now: () => T0, userAgent: UA, timeoutMs: 20, warn: () => {}});
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('times out even when fetch ignores the abort signal', async () => {
  const fetch = () => new Promise(() => {});
  const weather = createWeather({fetch, now: () => T0, userAgent: UA, timeoutMs: 20, warn: () => {}});
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('falls back to next_6_hours, then "unknown", for the symbol', async () => {
  const body = (summary) => ({
    properties: {timeseries: [{data: {instant: {details: {air_temperature: -0.4}}, ...summary}}]},
  });
  const six = {next_6_hours: {summary: {symbol_code: 'fog'}}};
  const a = setup(reply(200, {body: body(six), expires: T0 + MIN}));
  assert.deepEqual(await a.weather.current(1, 1), {tempC: 0, symbol: 'fog'});
  const b = setup(reply(200, {body: body({}), expires: T0 + MIN}));
  assert.equal((await b.weather.current(1, 1)).symbol, 'unknown');
});

test('treats a malformed body as a failure', async () => {
  const {weather} = setup(reply(200, {body: {properties: {}}, expires: T0 + MIN}));
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('treats a missing Expires as fresh for 10 minutes', async () => {
  const {calls, clock, weather} = setup(reply(200, {body: fixture}), reply(200, {body: fixture}));
  await weather.current(52.21, 0.12);
  clock.t = T0 + 9 * MIN;
  await weather.current(52.21, 0.12);
  assert.equal(calls.length, 1);
  clock.t = T0 + 10 * MIN;
  await weather.current(52.21, 0.12);
  assert.equal(calls.length, 2);
});

test('backs off 5 minutes after a failure, then retries', async () => {
  const {calls, clock, weather} = setup(reply(403), reply(200, {body: fixture, expires: T0 + 60 * MIN}));
  assert.equal(await weather.current(52.21, 0.12), null);
  assert.equal(await weather.current(52.21, 0.12), null);
  assert.equal(calls.length, 1);
  clock.t = T0 + 5 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  assert.equal(calls.length, 2);
});

test('backs off after a failed refresh of a cached value, keeping the 3 hour limit', async () => {
  const {calls, clock, weather} = setup(reply(200, {body: fixture, expires: T0 + 10 * MIN}), reply(503));
  await weather.current(52.21, 0.12);
  clock.t = T0 + 11 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  clock.t = T0 + 14 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  assert.equal(calls.length, 2);
  // Backed off, but the value is now more than 3 hours past MET's Expires.
  clock.t = T0 + 10 * MIN + 3 * HOUR + 1;
  assert.equal(await weather.current(52.21, 0.12), null);
});

test('times out when the body stalls after the headers, and can fetch again', async () => {
  const stalled = {...reply(200, {expires: T0 + MIN}), json: () => new Promise(() => {})};
  const script = [stalled, reply(200, {body: fixture, expires: T0 + 60 * MIN})];
  const clock = {t: T0};
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return script.shift();
  };
  const weather = createWeather({fetch, now: () => clock.t, userAgent: UA, timeoutMs: 20, warn: () => {}});
  assert.equal(await weather.current(52.21, 0.12), null);
  clock.t = T0 + 5 * MIN;
  assert.deepEqual(await weather.current(52.21, 0.12), {tempC: 7, symbol: 'cloudy'});
  assert.equal(fetches, 2);
});

test('warns once per failure without coordinates', async () => {
  const messages = [];
  const fetch = async () => reply(403);
  const weather = createWeather({fetch, now: () => T0, userAgent: UA, warn: (m) => messages.push(m)});
  await weather.current(52.21, 0.12);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /403/);
  assert.doesNotMatch(messages[0], /52\.63|1\.3/);
});

test('caps new MET requests per minute; over the cap it answers from cache or null', async () => {
  const script = [];
  for (let i = 0; i < 3; i++) script.push(reply(200, {body: fixture, expires: T0 + 10 * MIN}));
  const calls = [];
  const clock = {t: T0};
  const fetch = async (url) => {
    calls.push(url);
    return script.shift();
  };
  const weather = createWeather({fetch, now: () => clock.t, userAgent: UA, warn: () => {}, maxFetchesPerMinute: 3});
  for (let i = 0; i < 3; i++) await weather.current(50 + i, 1);
  assert.equal(calls.length, 3);
  assert.equal(await weather.current(60, 1), null); // new area over the cap
  assert.equal(calls.length, 3);
  assert.deepEqual(await weather.current(50, 1), {tempC: 7, symbol: 'cloudy'}); // cached still served
  clock.t = T0 + MIN;
  script.push(reply(200, {body: fixture, expires: T0 + 20 * MIN}));
  assert.deepEqual(await weather.current(60, 1), {tempC: 7, symbol: 'cloudy'});
  assert.equal(calls.length, 4);
});

test('the cache holds at most maxEntries areas and drops the least recently used', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return reply(200, {body: fixture, expires: T0 + 10 * MIN});
  };
  const weather = createWeather({
    fetch,
    now: () => T0,
    userAgent: UA,
    warn: () => {},
    maxEntries: 2,
    maxFetchesPerMinute: 100,
  });
  await weather.current(1, 1); // A
  await weather.current(2, 2); // B
  await weather.current(1, 1); // A used again, so B is the oldest
  await weather.current(3, 3); // C evicts B
  assert.equal(calls.length, 3);
  await weather.current(1, 1);
  assert.equal(calls.length, 3); // A kept
  await weather.current(2, 2);
  assert.equal(calls.length, 4); // B was dropped, fetched again
});
