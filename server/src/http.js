// HTTP helpers: who's asking (behind Cloudflare and CapRover), whether
// they're allowed, and the sharing page's static files.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFile} from 'node:fs/promises';
import {BlockList, isIP} from 'node:net';
import {extname, join, normalize, sep} from 'node:path';

// Cloudflare's published edge ranges (cloudflare.com/ips, 2026). Its
// CF-Connecting-IP header is only believed from these addresses: anyone can
// reach the origin directly and send that header themselves.
const CLOUDFLARE = new BlockList();
for (const range of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]) {
  const [net, bits] = range.split('/');
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv4');
}
for (const range of [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [net, bits] = range.split('/');
  CLOUDFLARE.addSubnet(net, Number(bits), 'ipv6');
}

const header = (req, name) => {
  const v = req.headers[name];
  return typeof v === 'string' ? v.trim() : '';
};

function isCloudflare(ip) {
  const type = isIP(ip);
  return type !== 0 && CLOUDFLARE.check(ip, type === 6 ? 'ipv6' : 'ipv4');
}

// What CapRover's nginx saw (X-Real-IP, which it overwrites), or the socket.
const peerAddress = (req) => (header(req, 'x-real-ip') || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

/**
 * The client's public IP. The peer is what CapRover's nginx saw (X-Real-IP,
 * which it overwrites), or the socket when nothing is in front. When that
 * peer is Cloudflare, the client is Cloudflare's CF-Connecting-IP.
 */
export function clientIp(req) {
  const peer = peerAddress(req);
  const cf = header(req, 'cf-connecting-ip');
  return cf && isCloudflare(peer) ? cf : peer;
}

/** Whether `ip` may connect: anyone when there's no allowlist (B9). */
export function isAllowed(ip, allowedIps) {
  return !allowedIps || allowedIps.length === 0 || allowedIps.includes(ip);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PAGES = new Set(['/privacy', '/support', '/source']);

/**
 * The page file for a host and path, or null when the path is an ordinary static file.
 * Only castair.app shows the landing page at "/"; every other host shows the sharing page,
 * and "/connect" is the sharing page everywhere. `host` is the Host header (port allowed).
 */
export function routeStatic(host, pathname) {
  const name = String(host || '')
    .toLowerCase()
    .replace(/:\d+$/, '');
  if (pathname === '/') return name === 'castair.app' ? 'home.html' : 'index.html';
  if (pathname === '/connect') return 'index.html';
  if (PAGES.has(pathname)) return `${pathname.slice(1)}.html`;
  return null;
}

/**
 * Serves files under `root` (after removing `prefix`), with "/" as index.html; 404 for anything else.
 * `page` names a file under `root` to serve instead of the path (from routeStatic).
 */
export async function serveStatic(req, res, root, prefix = '', page = null) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(prefix.length) || '/';
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
    return;
  }
  const file = normalize(join(root, page ?? (path === '/' ? 'index.html' : path)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
  }
}
