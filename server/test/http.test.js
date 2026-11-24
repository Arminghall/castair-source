// Who's asking: behind CapRover's nginx (which sets X-Real-IP to the real
// peer) and usually Cloudflare (which sets CF-Connecting-IP). Cloudflare's
// header only counts when the peer really is Cloudflare.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {clientIp} from '../src/http.js';

const req = (headers, remoteAddress = '10.0.1.5') => ({headers, socket: {remoteAddress}});

test("uses Cloudflare's header when the request came through Cloudflare", () => {
  assert.equal(clientIp(req({'x-real-ip': '172.68.1.20', 'cf-connecting-ip': '198.51.100.7'})), '198.51.100.7');
  assert.equal(
    clientIp(req({'x-real-ip': '2606:4700:10::ac43:1', 'cf-connecting-ip': '198.51.100.7'})),
    '198.51.100.7',
  );
});

test('ignores a Cloudflare header from anyone who bypassed Cloudflare', () => {
  assert.equal(clientIp(req({'x-real-ip': '203.0.113.9', 'cf-connecting-ip': '198.51.100.7'})), '203.0.113.9');
});

test('ignores a forged X-Forwarded-For and uses the peer nginx saw', () => {
  assert.equal(
    clientIp(req({'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.7, 203.0.113.9'})),
    '203.0.113.9',
  );
});

test('without a proxy in front, uses the socket address', () => {
  assert.equal(clientIp(req({'cf-connecting-ip': '198.51.100.7'}, '::ffff:127.0.0.1')), '127.0.0.1');
});

test('serveStatic answers 404 to a malformed URL instead of throwing', async () => {
  const {serveStatic} = await import('../src/http.js');
  let status = 0;
  const res = {writeHead: (s) => ((status = s), res), end: () => res};
  await assert.doesNotReject(serveStatic({url: '/%E0%A4%A'}, res, '/tmp'));
  assert.equal(status, 404);
});

test('routeStatic: castair.app gets the landing page, other hosts the sharing page', async () => {
  const {routeStatic} = await import('../src/http.js');
  assert.equal(routeStatic('castair.app', '/'), 'home.html');
  assert.equal(routeStatic('CastAir.app:443', '/'), 'home.html');
  assert.equal(routeStatic('castair.arminghall.com', '/'), 'index.html');
  assert.equal(routeStatic('localhost:3000', '/'), 'index.html');
  assert.equal(routeStatic(undefined, '/'), 'index.html');
  assert.equal(routeStatic('beta.castair.app', '/'), 'index.html');
});

test('routeStatic: /connect is the sharing page and the public pages have their own files', async () => {
  const {routeStatic} = await import('../src/http.js');
  for (const host of ['castair.app', 'castair.arminghall.com']) {
    assert.equal(routeStatic(host, '/connect'), 'index.html');
    assert.equal(routeStatic(host, '/privacy'), 'privacy.html');
    assert.equal(routeStatic(host, '/support'), 'support.html');
    assert.equal(routeStatic(host, '/source'), 'source.html');
  }
  assert.equal(routeStatic('castair.app', '/app.js'), null);
});

// Serves the real web/sender folder, as main.js does.
async function get(host, url) {
  const {routeStatic, serveStatic} = await import('../src/http.js');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/sender');
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(s, h = {}) {
      res.status = s;
      res.headers = h;
      return res;
    },
    end(b = '') {
      res.body = String(b);
      return res;
    },
  };
  const pathname = new URL(url, 'http://x').pathname;
  await serveStatic({url}, res, root, '', routeStatic(host, pathname));
  return res;
}

test('castair.app/ serves home.html', async () => {
  const res = await get('castair.app', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  assert.match(res.body, /href="\/connect"/);
});

test('castair.app/connect serves the sharing page', async () => {
  const res = await get('castair.app', '/connect');
  assert.equal(res.status, 200);
  assert.match(res.body, /id="share"/);
});

test('castair.arminghall.com/ still serves the sharing page', async () => {
  const res = await get('castair.arminghall.com', '/');
  assert.equal(res.status, 200);
  assert.match(res.body, /id="share"/);
});

test('/privacy, /support and /source serve their pages as HTML', async () => {
  for (const page of ['privacy', 'support', 'source']) {
    const res = await get('castair.app', `/${page}`);
    assert.equal(res.status, 200, page);
    assert.match(res.headers['Content-Type'], /^text\/html/);
  }
  assert.match((await get('castair.app', '/privacy')).body, /Privacy/);
});

test('encoded /../ paths are still refused', async () => {
  for (const url of ['/..%2f..%2fpackage.json', '/%2e%2e%2fsender%2f..%2f..%2fserver']) {
    const res = await get('castair.app', url);
    assert.ok(res.status === 404, `${url} -> ${res.status}`);
  }
});
