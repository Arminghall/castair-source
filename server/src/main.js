// CastAir server: the sharing page (web/sender) and the connection server
// (/signal). Laptops are only ever paired with TVs behind their own public IP.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHandler} from './app.js';
import {loadPlaces} from './places.js';
import {createSignalServer} from './signal.js';
import {createStandby} from './standby.js';
import {createWallpaper} from './wallpaper.js';
import {createWeather} from './weather.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 80);
const allowedIps = (process.env.ALLOWED_IPS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const webRoot = resolve(process.env.WEB_ROOT || resolve(here, '../../web'));
const pageRoot = resolve(webRoot, 'sender');
const sharedRoot = resolve(webRoot, 'shared');

// Open to anyone by default (B9): discovery and sharing only ever pair a
// laptop with TVs behind its own public IP. ALLOWED_IPS can still restrict it.

const signal = createSignalServer({allowedIps});

const {version} = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
const standby = createStandby({
  places: loadPlaces(resolve(here, '../data/places.tsv.gz')),
  weather: createWeather({
    fetch,
    now: Date.now,
    userAgent: `CastAir/${version} castair.app castair@arminghall.com`,
  }),
  now: () => new Date(),
});
// The key comes from the environment only; without it /api/wallpaper answers null.
const wallpaper = createWallpaper({fetch, now: Date.now, accessKey: process.env.UNSPLASH_ACCESS_KEY});

const server = createServer(createHandler({allowedIps, standby, wallpaper, pageRoot, sharedRoot}));
server.on('upgrade', (req, socket, head) => signal.handleUpgrade(req, socket, head));
server.listen(port, () =>
  console.log(`castair-server on :${port}, ${allowedIps.length ? `allowing ${allowedIps.join(', ')}` : 'open to all'}`),
);

const stop = () => {
  signal.close();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
