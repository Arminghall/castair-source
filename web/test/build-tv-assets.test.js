// The TV page is one file with a classic script: the Vega WebView loads it
// from file:///pkg/assets, where Chromium refuses module scripts.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildTvAssets} from '../../scripts/build-tv-assets.mjs';

test('the TV page has no module scripts and contains the signaling URL', async () => {
  const out = join(await mkdtemp(join(tmpdir(), 'castair-')), 'receiver.html');
  await buildTvAssets({outFile: out, signalingUrl: 'wss://castair.app/signal'});
  const html = await readFile(out, 'utf8');
  assert.equal(/type=["']module["']/.test(html), false);
  assert.equal(/^\s*(import|export)\s/m.test(html), false);
  assert.ok(html.includes('wss://castair.app/signal'));
  assert.ok(html.includes('castairHost'));
});
