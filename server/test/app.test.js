// The HTTP request handler: a request line the URL parser rejects gets a 400,
// and the server keeps serving.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {test} from 'node:test';
import {createHandler} from '../src/app.js';

/** Sends `requestLine` as a raw HTTP/1.1 request and resolves with the status code. */
function rawRequest(port, requestLine) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(Number(data.split(' ')[1])));
    socket.on('error', reject);
    socket.setTimeout(2000, () => {
      socket.destroy();
      reject(new Error(`no answer to ${requestLine}`));
    });
    socket.write(`${requestLine}\r\nHost: castair.app\r\nConnection: close\r\n\r\n`);
  });
}

test('a URL the parser rejects gets 400, and the server keeps serving', async () => {
  const handler = createHandler({
    allowedIps: [],
    standby: {standby: async () => ({}), search: () => []},
    wallpaper: {current: async () => null},
    pageRoot: '/nonexistent',
    sharedRoot: '/nonexistent',
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    assert.equal(await rawRequest(port, 'GET // HTTP/1.1'), 400);
    assert.equal(await rawRequest(port, 'GET //x:y HTTP/1.1'), 400);
    assert.equal(await rawRequest(port, 'GET /api/places?q=x HTTP/1.1'), 200);
    assert.equal(await rawRequest(port, 'GET /health HTTP/1.1'), 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
