// The HTTP request handler: health and diagnostics, the standby, places and
// wallpaper APIs, and the sharing page's static files.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {clientIp, isAllowed, routeStatic, serveStatic} from './http.js';

function sendJson(res, status, body) {
  res
    .writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'})
    .end(JSON.stringify(body));
}

/**
 * The request handler. `standby` and `wallpaper` come from createStandby and
 * createWallpaper; `pageRoot` and `sharedRoot` are web/sender and web/shared.
 */
export function createHandler({allowedIps, standby, wallpaper, pageRoot, sharedRoot}) {
  // GET /api/standby, /api/places and /api/wallpaper; false when the path isn't one of them.
  function handleApi(res, pathname, searchParams) {
    if (pathname === '/api/standby') {
      standby.standby(searchParams).then(
        (info) => sendJson(res, 200, info),
        (e) => {
          console.error(`standby: ${e.message}`);
          sendJson(res, 200, {location: null, time: null, weather: null});
        },
      );
      return true;
    }
    if (pathname === '/api/places') {
      sendJson(res, 200, {places: standby.search(searchParams.get('q') || '')});
      return true;
    }
    if (pathname === '/api/wallpaper') {
      wallpaper.current(searchParams.get('photos'), searchParams.get('every')).then(
        (w) => sendJson(res, 200, w ?? {wallpaper: null}),
        (e) => {
          console.error(`wallpaper: ${e.message}`);
          sendJson(res, 200, {wallpaper: null});
        },
      );
      return true;
    }
    return false;
  }

  return (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {'Content-Type': 'text/plain'}).end('ok');
      return;
    }
    const ip = clientIp(req);
    if (req.url === '/whoami') {
      // Diagnostics: what the server sees and decides (no secrets in here).
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
      res.end(
        JSON.stringify({
          ip,
          allowed: isAllowed(ip, allowedIps),
          realIp: req.headers['x-real-ip'] ?? null,
          forwardedFor: req.headers['x-forwarded-for'] ?? null,
          cfConnectingIp: req.headers['cf-connecting-ip'] ?? null,
        }),
      );
      return;
    }
    if (!isAllowed(ip, allowedIps)) {
      res
        .writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'})
        .end('CastAir sharing is not available from this network.');
      return;
    }
    // Parsed once, here: a request line like "//" throws, and must not take the server down.
    let url;
    try {
      url = new URL(req.url, 'http://x');
    } catch {
      res.writeHead(400, {'Content-Type': 'text/plain'}).end('Bad request');
      return;
    }
    const {pathname, searchParams} = url;
    if (req.method === 'GET' && handleApi(res, pathname, searchParams)) return;
    const done = pathname.startsWith('/shared/')
      ? serveStatic(req, res, sharedRoot, '/shared')
      : serveStatic(req, res, pageRoot, '', routeStatic(req.headers.host, pathname));
    done.catch((e) => {
      console.error(`static: ${e.message}`);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  };
}
