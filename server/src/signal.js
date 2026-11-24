// Connection server: introduces laptops (senders) to CastAir TVs (receivers)
// on the same public IP, and relays WebRTC setup between them. Video never
// passes through here. Ported from Tandem's signaling Lambda
// (github.com/kevinl95/Tandem, Apache-2.0), with state held in memory and
// no approval step: every allowed sender is accepted.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {createHash, randomUUID} from 'node:crypto';
import {WebSocketServer} from 'ws';
import {clientIp, isAllowed} from './http.js';
import {createCodes} from './codes.js';
import {networkKey} from './network.js';

const SESSION_ID = /^[A-Z0-9]{4,16}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const RECEIVER_SECRET = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_RECEIVER_NAME = 50;
const MAX_SENDER_NAME = 40;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_OFFERS = 30;
const IDLE_MS = 120 * 1000;
const CLOSE_CODE_TAKEN = 4409;
const CLOSE_CODE_BAD_REQUEST = 4400;

const ALLOWED = {
  receiver: new Set(['answer', 'decline', 'ice', 'rename', 'settings', 'ping']),
  sender: new Set(['discover', 'offer', 'ice', 'bye', 'ping']),
};

const hash = (s) => createHash('sha256').update(s).digest('hex');

function cleanName(value, fallback, max) {
  const name = [...String(value ?? '')]
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join('')
    .trim()
    .slice(0, max);
  return name || fallback;
}

/**
 * The connection server. `handleUpgrade` takes Node's HTTP 'upgrade' event
 * for /signal; anything from an IP outside `allowedIps` gets 403.
 */
export function createSignalServer({allowedIps, now = () => Date.now(), random}) {
  const wss = new WebSocketServer({noServer: true, maxPayload: 256 * 1024});
  const claims = new Map(); // sessionId → hash(secret)
  const receivers = new Map(); // sessionId → connection
  const offers = new Map(); // network (IPv4 address or IPv6 /64) → [timestamps]
  const conns = new Set();
  const codes = createCodes({now, random});

  const send = (conn, msg) => {
    if (conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(JSON.stringify(msg));
    }
  };

  // Per network, not per address: an IPv6 device can rotate addresses inside its /64.
  const rateLimited = (net) => {
    const t = now();
    const recent = (offers.get(net) || []).filter((x) => t - x < RATE_WINDOW_MS);
    recent.push(t);
    offers.set(net, recent);
    return recent.length > MAX_OFFERS;
  };

  // Gives a code-required TV a fresh code (the old one still works for 60 s).
  const rotate = (tv) => {
    if (tv?.codeRequired) {
      send(tv, {type: 'code', code: codes.issue(tv.sessionId)});
    }
  };

  // The TV shows its current code; a new one only when the code turns on or it has none.
  const showCode = (tv) => {
    const code = codes.current(tv.sessionId);
    if (code === null) {
      rotate(tv);
    } else {
      send(tv, {type: 'code', code});
    }
  };

  function onReceiverMessage(conn, msg) {
    if (msg.type === 'settings') {
      const wasRequired = conn.codeRequired;
      conn.codeRequired = msg.codeRequired === true;
      if (conn.codeRequired && wasRequired) {
        showCode(conn);
      } else if (conn.codeRequired) {
        rotate(conn);
      } else {
        codes.forget(conn.sessionId);
        send(conn, {type: 'code', code: null});
      }
      return;
    }
    if (msg.type === 'decline' && msg.reason === 'ended') {
      rotate(conn);
    }
    if (msg.type === 'rename') {
      conn.name = cleanName(msg.name, conn.name, MAX_RECEIVER_NAME);
      return;
    }
    // answer, ice and decline go only to the sender the TV names.
    const target = [...conns].find((c) => c.role === 'sender' && c.id === msg.to && c.sessionId === conn.sessionId);
    if (!target) {
      return;
    }
    const rest = {...msg};
    delete rest.to;
    send(target, {...rest, from: 'receiver', sessionId: conn.sessionId});
  }

  function onSenderMessage(conn, msg) {
    if (msg.type === 'discover') {
      const list = [...receivers.values()]
        .filter((r) => r.net === conn.net)
        .map((r) => ({sessionId: r.sessionId, name: r.name, codeRequired: r.codeRequired}))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      send(conn, {type: 'receivers', receivers: list});
      return;
    }
    if (msg.type === 'offer') {
      const sessionId = String(msg.sessionId ?? '').toUpperCase();
      if (rateLimited(conn.net)) {
        send(conn, {type: 'error', reason: 'rate-limited', sessionId});
        return;
      }
      // Only TVs on the laptop's own network (IPv4 address or IPv6 /64), as discovery shows: a code
      // alone must not put a stranger's screen on someone's TV (B9).
      const tv = receivers.get(sessionId);
      if (!tv || tv.net !== conn.net) {
        send(conn, {type: 'error', reason: 'no-peer', sessionId});
        return;
      }
      if (tv.codeRequired) {
        const reason = msg.code
          ? {ok: null, bad: 'bad-code', locked: 'code-locked'}[codes.check(sessionId, conn.net, msg.code)]
          : 'code-required';
        if (reason) {
          send(conn, {type: 'error', reason, sessionId});
          return;
        }
      }
      conn.sessionId = sessionId;
      send(tv, {
        type: 'offer',
        sdp: String(msg.sdp ?? ''),
        sessionId,
        senderId: conn.id,
        senderName: conn.name,
        clientId: conn.clientId,
      });
      return;
    }
    if (msg.type === 'bye') {
      // The laptop stopped sharing: tell the TV now (it would otherwise
      // wait for the WebRTC connection to time out) and unbind.
      const tv = conn.sessionId && receivers.get(conn.sessionId);
      if (tv) {
        send(tv, {type: 'peer-left', from: 'sender', senderId: conn.id, sessionId: conn.sessionId});
        rotate(tv);
      }
      conn.sessionId = null;
      return;
    }
    if (msg.type === 'ice') {
      const tv = conn.sessionId && receivers.get(conn.sessionId);
      if (tv) {
        send(tv, {type: 'ice', candidate: msg.candidate, senderId: conn.id, sessionId: conn.sessionId, from: 'sender'});
      }
    }
  }

  function onClose(conn) {
    conns.delete(conn);
    if (conn.role === 'receiver') {
      if (receivers.get(conn.sessionId) === conn) {
        receivers.delete(conn.sessionId);
        codes.forget(conn.sessionId);
      }
      for (const c of conns) {
        if (c.role === 'sender' && c.sessionId === conn.sessionId) {
          send(c, {type: 'peer-left', from: 'receiver', sessionId: conn.sessionId});
        }
      }
    } else if (conn.sessionId) {
      const tv = receivers.get(conn.sessionId);
      if (tv) {
        send(tv, {type: 'peer-left', from: 'sender', senderId: conn.id, sessionId: conn.sessionId});
        rotate(tv);
      }
    }
  }

  function accept(ws, req, ip, params) {
    const role = params.get('role');
    const conn = {ws, ip, net: networkKey(ip), role, id: randomUUID(), lastSeen: now(), codeRequired: false};
    if (role === 'receiver') {
      const sessionId = String(params.get('sessionId') ?? '').toUpperCase();
      const secret = params.get('receiverSecret') ?? '';
      if (!SESSION_ID.test(sessionId) || !RECEIVER_SECRET.test(secret)) {
        ws.close(CLOSE_CODE_BAD_REQUEST, 'receivers need a valid sessionId and receiverSecret');
        return;
      }
      const claimed = claims.get(sessionId);
      if (claimed && claimed !== hash(secret)) {
        ws.close(CLOSE_CODE_TAKEN, 'this code belongs to another TV');
        return;
      }
      claims.set(sessionId, hash(secret));
      // A TV reconnecting replaces its previous connection.
      receivers.get(sessionId)?.ws.close(1000, 'replaced');
      codes.forget(sessionId); // a reconnected TV starts afresh: old codes stop working
      Object.assign(conn, {
        sessionId,
        name: cleanName(params.get('name'), `TV ${sessionId}`, MAX_RECEIVER_NAME),
        // From the first moment, so there's no code-free window before its settings message.
        // Older builds send neither this nor settings, and stay code-free.
        codeRequired: params.get('codeRequired') === '1',
      });
      receivers.set(sessionId, conn);
    } else if (role === 'sender') {
      const clientId = params.get('clientId') ?? '';
      if (!CLIENT_ID.test(clientId)) {
        ws.close(CLOSE_CODE_BAD_REQUEST, 'senders need a valid clientId');
        return;
      }
      Object.assign(conn, {clientId, name: cleanName(params.get('name'), 'A laptop', MAX_SENDER_NAME)});
    } else {
      ws.close(CLOSE_CODE_BAD_REQUEST, 'role must be receiver or sender');
      return;
    }
    conns.add(conn);
    rotate(conn);
    ws.on('message', (data) => {
      conn.lastSeen = now();
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || !ALLOWED[role].has(msg.type) || msg.type === 'ping') {
        return;
      }
      (role === 'receiver' ? onReceiverMessage : onSenderMessage)(conn, msg);
    });
    ws.on('close', () => onClose(conn));
  }

  // Drops connections that have gone silent (the TV pings every 30 s), rotates
  // 10-minute-old codes, and forgets rate-limit and wrong-code records that
  // no longer count, so nothing about a laptop outlives what it's needed for.
  const tick = () => {
    const t = now();
    for (const [net, times] of offers) {
      if (times.every((x) => t - x >= RATE_WINDOW_MS)) {
        offers.delete(net);
      }
    }
    codes.prune();
    for (const c of conns) {
      if (t - c.lastSeen > IDLE_MS) {
        c.ws.terminate();
      } else if (c.role === 'receiver' && c.codeRequired && codes.due(c.sessionId)) {
        rotate(c);
      }
    }
  };
  const sweep = setInterval(tick, 30 * 1000);
  sweep.unref();

  return {
    tick, // one sweep, exposed for tests
    // How many rate-limit and wrong-code records are held (for tests).
    stats: () => ({offers: offers.size, codeAttempts: codes.remembered()}),
    handleUpgrade(req, socket, head) {
      const ip = clientIp(req);
      let url;
      try {
        url = new URL(req.url, 'http://x');
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }
      if (url.pathname !== '/signal' || !isAllowed(ip, allowedIps)) {
        socket.end(
          `HTTP/1.1 ${url.pathname !== '/signal' ? '404 Not Found' : '403 Forbidden'}\r\nConnection: close\r\n\r\n`,
        );
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => accept(ws, req, ip, url.searchParams));
    },
    close() {
      clearInterval(sweep);
      for (const c of conns) {
        c.ws.terminate();
      }
      wss.close();
    },
  };
}
