// Share codes: rotation, the 60 s grace period and the wrong-guess lockout.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createCodes} from '../src/codes.js';

function setup(values = [0.0042, 0.5]) {
  const clock = {t: 1_000_000};
  let i = 0;
  const codes = createCodes({now: () => clock.t, random: () => values[i++ % values.length]});
  return {codes, clock};
}

test('issue gives 4 zero-padded digits', () => {
  const {codes} = setup([0.0042, 0.9999, 0]);
  assert.equal(codes.issue('S1'), '0042');
  assert.equal(codes.issue('S1'), '9999');
  assert.equal(codes.issue('S1'), '0000');
});

test('previous code accepted for 60 s after a new issue, then bad', () => {
  const {codes, clock} = setup([0.1111, 0.2222]);
  const first = codes.issue('S1');
  const second = codes.issue('S1');
  assert.equal(codes.check('S1', 'n', second), 'ok');
  clock.t += 59_999;
  assert.equal(codes.check('S1', 'n', first), 'ok');
  clock.t += 1;
  assert.equal(codes.check('S1', 'n', first), 'bad');
  assert.equal(codes.check('S1', 'n', second), 'ok');
});

test('due after 10 minutes', () => {
  const {codes, clock} = setup();
  assert.equal(codes.due('S1'), false);
  codes.issue('S1');
  clock.t += 599_999;
  assert.equal(codes.due('S1'), false);
  clock.t += 1;
  assert.equal(codes.due('S1'), true);
  codes.issue('S1');
  assert.equal(codes.due('S1'), false);
});

test('5 bad codes lock that network for 1 minute; another network is unaffected', () => {
  const {codes, clock} = setup([0.1234]);
  const good = codes.issue('S1');
  for (let i = 0; i < 4; i++) {
    assert.equal(codes.check('S1', 'a', '0000'), 'bad');
    clock.t += 1000;
  }
  assert.equal(codes.check('S1', 'a', '0000'), 'bad'); // the 5th
  assert.equal(codes.check('S1', 'a', good), 'locked');
  assert.equal(codes.check('S1', 'b', good), 'ok');
  clock.t += 59_999;
  assert.equal(codes.check('S1', 'a', good), 'locked');
  clock.t += 1;
  assert.equal(codes.check('S1', 'a', good), 'ok');
});

test('a correct code resets the count', () => {
  const {codes} = setup([0.1234]);
  const good = codes.issue('S1');
  for (let i = 0; i < 4; i++) {
    codes.check('S1', 'a', '0000');
  }
  assert.equal(codes.check('S1', 'a', good), 'ok');
  for (let i = 0; i < 4; i++) {
    assert.equal(codes.check('S1', 'a', '0000'), 'bad');
  }
  assert.equal(codes.check('S1', 'a', good), 'ok');
});

test('forget drops the code and the lockout', () => {
  const {codes} = setup([0.1234]);
  const good = codes.issue('S1');
  codes.forget('S1');
  assert.equal(codes.check('S1', 'a', good), 'bad');
  assert.equal(codes.due('S1'), false);
});

test('the integer source maps exactly to every code 0000-9999', () => {
  let k = 0;
  const codes = createCodes({digits: () => k});
  for (k = 0; k < 10000; k++) {
    assert.equal(codes.issue('S1'), String(k).padStart(4, '0'));
  }
});

test('the default generator issues 4 digits and is not skewed by float rounding', () => {
  const codes = createCodes();
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = codes.issue('S1');
    assert.match(code, /^\d{4}$/);
    seen.add(code);
  }
  assert.ok(seen.size > 1500); // 2000 draws from 10000 values: expect about 1810 distinct
});

test('a new code never repeats the current one', () => {
  const {codes} = setup([0.1234, 0.1234, 0.5678]);
  assert.equal(codes.issue('S1'), '1234');
  assert.equal(codes.issue('S1'), '5678');
});

test('current is the code a TV shows, or null', () => {
  const {codes} = setup([0.1234]);
  assert.equal(codes.current('S1'), null);
  codes.issue('S1');
  assert.equal(codes.current('S1'), '1234');
  codes.forget('S1');
  assert.equal(codes.current('S1'), null);
});

test('prune forgets wrong-code records once they can no longer count or lock', () => {
  const {codes, clock} = setup([0.1234]);
  const good = codes.issue('S1');
  codes.check('S1', 'a', '0000');
  for (let i = 0; i < 5; i++) {
    codes.check('S1', 'b', '0000');
  }
  assert.equal(codes.remembered(), 2);
  clock.t += 59_999;
  codes.prune();
  // 'b' is still locked out, and 'a' has a wrong code inside the last minute.
  assert.equal(codes.remembered(), 2);
  assert.equal(codes.check('S1', 'b', good), 'locked');
  clock.t += 1;
  codes.prune();
  assert.equal(codes.remembered(), 0);
  assert.equal(codes.check('S1', 'b', good), 'ok');
});
