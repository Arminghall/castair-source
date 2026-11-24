// Network keys: which devices count as "on the same network".
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {networkKey} from '../src/network.js';

test('an IPv4 address is its own network', () => {
  assert.equal(networkKey('198.51.100.7'), '4:198.51.100.7');
});

test('an IPv4-mapped IPv6 address keys like the IPv4 address', () => {
  assert.equal(networkKey('::ffff:198.51.100.7'), '4:198.51.100.7');
});

test('an IPv6 address keys on its first four hextets, expanded and lower-case', () => {
  assert.equal(networkKey('2a00:23c6:1:2:aaaa::1'), '6:2a00:23c6:0001:0002');
  assert.equal(networkKey('2A00:23C6:1:2::'), '6:2a00:23c6:0001:0002');
  assert.equal(networkKey('2a00:23c6::5'), '6:2a00:23c6:0000:0000');
});

test('two addresses in one /64 share a key', () => {
  assert.equal(networkKey('2a00:23c6:1:2:aaaa::1'), networkKey('2a00:23c6:1:2:bbbb:cccc:dddd:eeee'));
});

test('addresses in different /64s differ', () => {
  assert.notEqual(networkKey('2a00:23c6:1:2::1'), networkKey('2a00:23c6:1:3::1'));
});

test('garbage keys only to itself', () => {
  assert.equal(networkKey('not-an-ip'), '?:not-an-ip');
  assert.equal(networkKey(''), '?:');
});
