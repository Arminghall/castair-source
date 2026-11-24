// Standby info: time zone, and the chosen town and its weather, for the TV's idle screen.
// Uses the Task 2 place fixture, a fake weather client and a fixed clock.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadPlaces} from '../src/places.js';
import {createStandby} from '../src/standby.js';

const places = loadPlaces(new URL('./fixtures/places-sample.tsv', import.meta.url).pathname);
const NOW = new Date('2026-11-20T10:00:00Z');
const CAMBRIDGE_MA = '4839843';

function setup() {
  const calls = [];
  const weather = {
    current: async (lat, lon) => {
      calls.push([lat, lon]);
      return {tempC: 7, symbol: 'cloudy'};
    },
  };
  return {calls, standby: createStandby({places, weather, now: () => NOW})};
}
const q = (s = '') => new URLSearchParams(s);

test('a chosen place gives its location, time zone and weather', async () => {
  const {standby, calls} = setup();
  const info = await standby.standby(q(`place=${CAMBRIDGE_MA}`));
  assert.equal(info.location.name, 'Cambridge');
  assert.equal(info.location.region, 'Massachusetts');
  assert.equal(info.location.source, 'place');
  assert.equal(info.time.timeZone, 'America/New_York');
  assert.deepEqual(info.weather, {tempC: 7, symbol: 'cloudy'});
  assert.deepEqual(calls, [[42.3751, -71.10561]]);
});

test('no place: no town and no weather, whatever the IP (B12)', async () => {
  const {standby, calls} = setup();
  const info = await standby.standby(q());
  assert.deepEqual(info, {location: null, time: null, weather: null});
  assert.equal(calls.length, 0);
});

test('an unknown place id gives no town and no weather', async () => {
  const {standby, calls} = setup();
  const info = await standby.standby(q('place=nope&tz=Europe/London'));
  assert.equal(info.location, null);
  assert.equal(info.weather, null);
  assert.equal(info.time.timeZone, 'Europe/London');
  assert.equal(calls.length, 0);
});

test("uses the TV's own time zone when tz is given", async () => {
  const {standby} = setup();
  const info = await standby.standby(q('tz=America/Chicago'));
  assert.equal(info.time.timeZone, 'America/Chicago');
  assert.equal(info.location, null);
  const chosen = await standby.standby(q(`tz=Europe/London&place=${CAMBRIDGE_MA}`));
  assert.equal(chosen.time.timeZone, 'Europe/London');
  const bad = await standby.standby(q(`tz=Nope/Zone&place=${CAMBRIDGE_MA}`));
  assert.equal(bad.time.timeZone, 'America/New_York');
});

test('skips the weather lookup when weather=0', async () => {
  const {standby, calls} = setup();
  const info = await standby.standby(q(`weather=0&place=${CAMBRIDGE_MA}`));
  assert.equal(info.weather, null);
  assert.equal(calls.length, 0);
  assert.equal(info.location.name, 'Cambridge');
});

test('search returns id, name, region and country only', () => {
  const {standby} = setup();
  const hits = standby.search('camb');
  assert.ok(hits.length >= 3);
  for (const h of hits) assert.deepEqual(Object.keys(h).sort(), ['country', 'id', 'name', 'region']);
  assert.ok(hits.some((h) => h.id === CAMBRIDGE_MA && h.region === 'Massachusetts'));
});
