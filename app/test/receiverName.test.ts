/*
 * The name each TV advertises, from the Fire TV's own device name.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {receiverNameFor} from '../src/DeviceName';

const MODEL = 'Fire TV Stick 4K Select';

it('prefixes a custom Fire TV name with CastAir-', () => {
  expect(receiverNameFor('Living Room', MODEL)).toBe('CastAir-Living Room');
});

it('keeps a name that already starts with CastAir', () => {
  expect(receiverNameFor('CastAir-Living Room', MODEL)).toBe('CastAir-Living Room');
  expect(receiverNameFor('castair boardroom', MODEL)).toBe('castair boardroom');
});

it('falls back to CastAir when the Fire TV still has its model name', () => {
  expect(receiverNameFor(MODEL, MODEL)).toBe('CastAir');
  expect(receiverNameFor('fire tv stick 4k select ', MODEL)).toBe('CastAir');
});

it('falls back to CastAir when there is no name', () => {
  expect(receiverNameFor(null, MODEL)).toBe('CastAir');
  expect(receiverNameFor('   ', null)).toBe('CastAir');
});

it('trims spaces', () => {
  expect(receiverNameFor('  Living Room  ', MODEL)).toBe('CastAir-Living Room');
});

// The AirPlay (RAOP) record is "<12 hex digits>@<name>", and an mDNS label
// holds 63 bytes, so the name itself gets at most 50.
it('keeps the name within 50 bytes so the RAOP record still fits', () => {
  const long = receiverNameFor('x'.repeat(100), MODEL);
  expect(Buffer.byteLength(long, 'utf8')).toBeLessThanOrEqual(50);
  expect(long.startsWith('CastAir-xxx')).toBe(true);
  expect(Buffer.byteLength(receiverNameFor('é'.repeat(40), MODEL), 'utf8')).toBeLessThanOrEqual(50);
});

// The mDNS responder splits names on dots, so a dotted name would break.
it('replaces dots, which would split the mDNS name', () => {
  expect(receiverNameFor('D.S. Room', MODEL)).toBe('CastAir-D S Room');
  expect(receiverNameFor('...', MODEL)).toBe('CastAir');
});
