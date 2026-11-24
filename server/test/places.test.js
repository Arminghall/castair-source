// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {loadPlaces} from '../src/places.js';

const sample = fileURLToPath(new URL('./fixtures/places-sample.tsv', import.meta.url));
const real = fileURLToPath(new URL('../data/places.tsv.gz', import.meta.url));
const CAMBRIDGE_GB = '2653941';
const places = loadPlaces(sample);

test('search puts the larger Cambridge first and caps results', () => {
  const found = places.search('camb');
  const names = found.map((p) => `${p.name}, ${p.region}, ${p.country}`);
  assert.equal(names[0], 'Cambridge, England, United Kingdom');
  assert.ok(names.indexOf('Cambridge, Massachusetts, United States') > 0);
  assert.ok(found.length <= 8);
  assert.equal(places.search('nor', 2).length, 2);
  assert.ok(places.search('nor').length <= 8);
});

test('search matches name or ASCII name, case-insensitively', () => {
  assert.equal(places.search('krak')[0].name, 'Kraków');
  assert.equal(places.search('kraków')[0].name, 'Kraków');
  assert.equal(places.search('REYKJAV')[0].name, 'Reykjavík');
});

test('search needs at least two characters', () => {
  assert.deepEqual(places.search(''), []);
  assert.deepEqual(places.search('a'), []);
});

test('byId returns the place or null', () => {
  const p = places.byId(CAMBRIDGE_GB);
  assert.equal(p.timeZone, 'Europe/London');
  assert.equal(p.countryCode, 'GB');
  assert.equal(typeof p.lat, 'number');
  assert.equal(typeof p.population, 'number');
  assert.equal(places.byId('nope'), null);
});

test('nearest finds the closest place', () => {
  assert.equal(places.nearest(52.21, 0.12).name, 'Cambridge');
  assert.equal(places.nearest(50.0, 19.9).name, 'Kraków');
});

test('loads the real gzipped data file', () => {
  const all = loadPlaces(real);
  assert.ok(all.byId(CAMBRIDGE_GB));
  assert.ok(all.search('camb').length > 1);
});
