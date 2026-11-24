// Smoke test: connects to a CastAir connection server as a laptop and
// expects a list of TVs back. Usage: node scripts/smoke.mjs wss://host/signal
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import WebSocket from 'ws';

const url = new URL(process.argv[2] || 'ws://localhost/signal');
url.searchParams.set('role', 'sender');
url.searchParams.set('clientId', 'smoke-test-0001');
url.searchParams.set('name', 'Smoke test');
const fail = (why) => {
  console.error(`FAIL: ${why}`);
  process.exit(1);
};

// The standby API shares the host; print what it says for this machine.
const http = new URL(url);
http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
http.pathname = '/api/standby';
http.search = '';
try {
  const res = await fetch(http);
  console.log(`standby: HTTP ${res.status} ${JSON.stringify(await res.json())}`);
} catch (e) {
  fail(`standby: ${e.message}`);
}

const ws = new WebSocket(url);
setTimeout(() => fail('no reply in 5 s'), 5000);
ws.on('unexpected-response', (_req, res) => fail(`HTTP ${res.statusCode}`));
ws.on('error', (e) => fail(e.message));
ws.on('open', () => ws.send(JSON.stringify({type: 'discover'})));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'receivers') {
    console.log(`ok: ${msg.receivers.length} TV(s): ${msg.receivers.map((r) => r.name).join(', ') || 'none'}`);
    process.exit(0);
  }
});
