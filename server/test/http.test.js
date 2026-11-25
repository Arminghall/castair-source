// Who's asking: behind CapRover's nginx (which sets X-Real-IP to the real
// peer) and usually Cloudflare (which sets CF-Connecting-IP). Cloudflare's
// header only counts when the peer really is Cloudflare.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {dirname, join, resolve} from 'node:path';
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

test('routeStatic: / is the casting page on every host and /about is the marketing page', async () => {
  const {routeStatic} = await import('../src/http.js');
  for (const host of [
    'castair.app',
    'CastAir.app:443',
    'castair.arminghall.com',
    'localhost:3000',
    'beta.castair.app',
    undefined,
  ]) {
    assert.equal(routeStatic(host, '/'), 'index.html', String(host));
    assert.equal(routeStatic(host, '/about'), 'home.html', String(host));
    assert.equal(routeStatic(host, '/about/'), 'home.html', String(host));
  }
});

test('routeStatic: /connect is the casting page and the public pages have their own files', async () => {
  const {routeStatic} = await import('../src/http.js');
  for (const host of ['castair.app', 'castair.arminghall.com', 'localhost:3000']) {
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

test('castair.app/ serves the casting page, which links to /about', async () => {
  const res = await get('castair.app', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['Content-Type'], /^text\/html/);
  assert.match(res.body, /id="share"/);
  assert.match(res.body, /href="\/about">About</);
});

test('castair.app/about serves the marketing page, whose button goes to /', async () => {
  const res = await get('castair.app', '/about');
  assert.equal(res.status, 200);
  assert.match(res.body, /class="primary" href="\/">Share to a TV</);
  assert.match(res.body, /30 minutes of free casting every week/);
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

// Cloudflare keeps CSS and JS in browsers for hours whatever the origin says,
// so every asset link carries the site's version and a deploy changes the URL.
test('versionAssets stamps relative CSS, JS and SVG links and module imports', async () => {
  const {versionAssets} = await import('../src/http.js');
  const html = [
    '<link rel="stylesheet" href="style.css" />',
    '<img src="icons/cast.svg" alt="" />',
    '<script type="module" src="app.js"></script>',
    "import {showWallpaper} from './wallpaper.js';",
    "import {PEER_CONFIGURATION} from '../shared/config.js';",
  ].join('\n');
  const out = versionAssets(html, 'abc123');
  assert.match(out, /href="style\.css\?v=abc123"/);
  assert.match(out, /src="icons\/cast\.svg\?v=abc123"/);
  assert.match(out, /src="app\.js\?v=abc123"/);
  assert.match(out, /from '\.\/wallpaper\.js\?v=abc123'/);
  assert.match(out, /from '\.\.\/shared\/config\.js\?v=abc123'/);
});

test('versionAssets leaves page links, absolute URLs and mail links alone', async () => {
  const {versionAssets} = await import('../src/http.js');
  const html =
    '<a href="/about">About</a><a href="https://arminghall.com">x</a><a href="mailto:a@b.c">m</a><a href="#top">t</a>';
  assert.equal(versionAssets(html, 'abc123'), html);
});

test('siteVersion changes when any file under the roots changes', async () => {
  const {siteVersion} = await import('../src/http.js');
  const {mkdtempSync, writeFileSync, mkdirSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const a = mkdtempSync(join(tmpdir(), 'castair-v-'));
  const b = mkdtempSync(join(tmpdir(), 'castair-v-'));
  mkdirSync(join(a, 'icons'));
  writeFileSync(join(a, 'icons', 'x.svg'), '<svg/>');
  writeFileSync(join(b, 'config.js'), 'export const A = 1;');
  const first = siteVersion(a, b);
  assert.match(first, /^[0-9a-f]{10}$/);
  assert.equal(siteVersion(a, b), first);
  writeFileSync(join(b, 'config.js'), 'export const A = 2;');
  assert.notEqual(siteVersion(a, b), first);
});

test('serveStatic stamps asset links in pages when given a version', async () => {
  const {routeStatic, serveStatic} = await import('../src/http.js');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/sender');
  const res = {
    headers: {},
    body: '',
    writeHead(s, h = {}) {
      res.headers = h;
      return res;
    },
    end(b = '') {
      res.body = String(b);
      return res;
    },
  };
  await serveStatic({url: '/'}, res, root, '', routeStatic('castair.app', '/'), 'v42');
  assert.match(res.body, /href="style\.css\?v=v42"/);
  assert.match(res.body, /src="app\.js\?v=v42"/);
  await serveStatic({url: '/app.js'}, res, root, '', null, 'v42');
  assert.match(res.body, /from '\.\/sender\.js\?v=v42'/);
});
