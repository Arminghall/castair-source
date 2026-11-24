// Offset lookups for the standby clock: current UTC offset plus the next change.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {zoneInfo} from '../src/timezone.js';

const NOW = new Date('2026-11-20T12:00:00Z');
// The name ICU reports for a zone: 'Asia/Calcutta' on some Node versions, 'Asia/Kolkata' on newer ones.
const KOLKATA = new Intl.DateTimeFormat('en', {timeZone: 'Asia/Kolkata'}).resolvedOptions().timeZone;

test('Europe/London: GMT now, BST at the March change', () => {
  assert.deepEqual(zoneInfo('Europe/London', NOW), {
    timeZone: 'Europe/London',
    utcOffsetMinutes: 0,
    next: {at: '2027-03-28T01:00:00.000Z', utcOffsetMinutes: 60},
  });
});

test('America/New_York: EST now, EDT at the March change', () => {
  assert.deepEqual(zoneInfo('America/New_York', NOW), {
    timeZone: 'America/New_York',
    utcOffsetMinutes: -300,
    next: {at: '2027-03-14T07:00:00.000Z', utcOffsetMinutes: -240},
  });
});

test('Asia/Kolkata has a half-hour offset and no change', () => {
  assert.deepEqual(zoneInfo('Asia/Kolkata', NOW), {timeZone: KOLKATA, utcOffsetMinutes: 330, next: null});
});

test('an unknown zone is null', () => {
  assert.equal(zoneInfo('Not/AZone', NOW), null);
});

test('case variants return the canonical name and share one cache entry', () => {
  const a = zoneInfo('asia/kolkata', NOW);
  const b = zoneInfo('ASIA/Kolkata', NOW);
  assert.equal(a.timeZone, KOLKATA);
  assert.equal(b, a);
  assert.equal(zoneInfo('Asia/Kolkata', NOW), a);
  assert.equal(zoneInfo('europe/LONDON', NOW).timeZone, 'Europe/London');
});

test('an entry is recomputed once the next change has passed', () => {
  const first = zoneInfo('Europe/London', new Date('2027-03-28T00:30:00Z'));
  assert.equal(first.utcOffsetMinutes, 0);
  const later = zoneInfo('Europe/London', new Date('2027-03-28T01:10:00Z'));
  assert.equal(later.utcOffsetMinutes, 60);
  assert.notEqual(later, first);
});

test('empty and non-string names are null', () => {
  assert.equal(zoneInfo('', NOW), null);
  assert.equal(zoneInfo(undefined, NOW), null);
});
