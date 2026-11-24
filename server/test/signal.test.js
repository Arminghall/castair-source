// The connection server: office-only, introduces laptops to TVs and relays
// WebRTC setup between them.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {after, before, test} from 'node:test';
import WebSocket from 'ws';
import {createSignalServer} from '../src/signal.js';

const OFFICE = '198.51.100.7';
const OTHER = '10.9.9.9';
const HOME_LAPTOP = '2a00:23c6:1:2:aaaa::1';
const HOME_TV = '2a00:23c6:1:2:bbbb::2';
const NEIGHBOUR = '2a00:23c6:1:3:cccc::3';
const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

let http;
let signal;
let base;

before(async () => {
  signal = createSignalServer({allowedIps: [OFFICE, OTHER, HOME_LAPTOP, HOME_TV, NEIGHBOUR]});
  http = createServer();
  http.on('upgrade', (req, socket, head) => signal.handleUpgrade(req, socket, head));
  await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
  base = `ws://127.0.0.1:${http.address().port}/signal`;
});

after(() => {
  signal.close();
  http.close();
});

// Opens a socket as if from `ip` (as CapRover's nginx reports it in
// X-Real-IP), and collects its messages.
function open(query, ip = OFFICE, url = base) {
  const ws = new WebSocket(`${url}?${new URLSearchParams(query)}`, {headers: {'X-Real-IP': ip}});
  const inbox = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    const i = waiters.findIndex((w) => w.match(msg));
    if (i >= 0) {
      waiters.splice(i, 1)[0].resolve(msg);
    } else {
      inbox.push(msg);
    }
  });
  const next = (type) =>
    new Promise((resolve, reject) => {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) {
        return resolve(inbox.splice(i, 1)[0]);
      }
      waiters.push({match: (m) => m.type === type, resolve});
      setTimeout(() => reject(new Error(`no ${type} message`)), 2000);
    });
  const send = (msg) => ws.send(JSON.stringify(msg));
  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(Object.assign(new Error('refused'), {status: res.statusCode})),
    );
  });
  const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  return {ws, next, send, ready, closed};
}

const tv = (sessionId, name, ip = OFFICE, secret = SECRET_A) =>
  open({role: 'receiver', sessionId, receiverSecret: secret, name}, ip);
const laptop = (name = 'Laptop', ip = OFFICE) =>
  open({role: 'sender', clientId: `client-${name.replace(/[^A-Za-z0-9]/g, '')}-1234`, name}, ip);

test('rejects connections from IPs outside the allowlist', async () => {
  const s = laptop('Outsider', '203.0.113.7');
  await assert.rejects(s.ready, (e) => e.status === 403);
});

test("lists only TVs behind the sender's public IP", async () => {
  const a = tv('AAAA1', 'CastAir-A');
  const b = tv('BBBB1', 'CastAir-B', OTHER, SECRET_B);
  await Promise.all([a.ready, b.ready]);
  const s = laptop();
  await s.ready;
  s.send({type: 'discover'});
  const {receivers} = await s.next('receivers');
  assert.deepEqual(receivers, [{sessionId: 'AAAA1', name: 'CastAir-A', codeRequired: false}]);
  [a, b, s].forEach((c) => c.ws.close());
});

test('discover lists a TV on the same IPv6 /64 with a different address', async () => {
  const home = tv('HOME61', 'CastAir-Home', HOME_TV, SECRET_A);
  const next = tv('NEXT61', 'CastAir-Neighbour', NEIGHBOUR, SECRET_B);
  await Promise.all([home.ready, next.ready]);
  const s = laptop('Home Laptop', HOME_LAPTOP);
  await s.ready;
  s.send({type: 'discover'});
  const {receivers} = await s.next('receivers');
  assert.deepEqual(receivers, [{sessionId: 'HOME61', name: 'CastAir-Home', codeRequired: false}]);
  [home, next, s].forEach((c) => c.ws.close());
});

test('offer reaches a TV on the same /64', async () => {
  const t = tv('HOME62', 'CastAir-Home', HOME_TV, SECRET_A);
  const s = laptop('Home Laptop', HOME_LAPTOP);
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'HOME62', sdp: 'v=0 v6'});
  assert.equal((await t.next('offer')).sdp, 'v=0 v6');
  [t, s].forEach((c) => c.ws.close());
});

test('refuses a second TV claiming the same code with another secret', async () => {
  const first = tv('CLAIM1', 'First');
  await first.ready;
  const impostor = tv('CLAIM1', 'Impostor', OFFICE, SECRET_B);
  assert.equal(await impostor.closed, 4409);
  first.ws.close();
});

test("relays an offer to the TV with the sender's id and name, and the answer back", async () => {
  const t = tv('OFFER1', 'CastAir-Offer');
  const s = laptop('Sam PC');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'OFFER1', sdp: 'v=0 offer'});
  const offer = await t.next('offer');
  assert.equal(offer.sdp, 'v=0 offer');
  assert.equal(offer.senderName, 'Sam PC');
  assert.ok(offer.senderId);
  t.send({type: 'answer', to: offer.senderId, sdp: 'v=0 answer'});
  assert.equal((await s.next('answer')).sdp, 'v=0 answer');
  [t, s].forEach((c) => c.ws.close());
});

test('relays ICE both ways, and answers only to the sender named in "to"', async () => {
  const t = tv('ICE1', 'CastAir-Ice');
  const s1 = laptop('One');
  const s2 = laptop('Two');
  await Promise.all([t.ready, s1.ready, s2.ready]);
  s1.send({type: 'offer', sessionId: 'ICE1', sdp: 'o1'});
  const o1 = await t.next('offer');
  s2.send({type: 'offer', sessionId: 'ICE1', sdp: 'o2'});
  await t.next('offer');
  s1.send({type: 'ice', candidate: {candidate: 'c1'}});
  const ice = await t.next('ice');
  assert.equal(ice.senderId, o1.senderId);
  assert.deepEqual(ice.candidate, {candidate: 'c1'});
  t.send({type: 'ice', to: o1.senderId, candidate: {candidate: 'tv'}});
  assert.deepEqual((await s1.next('ice')).candidate, {candidate: 'tv'});
  await assert.rejects(s2.next('ice'));
  [t, s1, s2].forEach((c) => c.ws.close());
});

test('peer-left reaches the TV when a sender disconnects, and the sender when the TV does', async () => {
  const t = tv('LEFT1', 'CastAir-Left');
  const s = laptop('Leaver');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'LEFT1', sdp: 'o'});
  const offer = await t.next('offer');
  s.ws.close();
  assert.equal((await t.next('peer-left')).senderId, offer.senderId);

  const s2 = laptop('Stayer');
  await s2.ready;
  s2.send({type: 'offer', sessionId: 'LEFT1', sdp: 'o'});
  await t.next('offer');
  t.ws.close();
  await s2.next('peer-left');
  s2.ws.close();
});

test('rename updates discovery', async () => {
  const t = tv('NAME1', 'CastAir');
  await t.ready;
  t.send({type: 'rename', name: 'CastAir-Living Room'});
  await new Promise((r) => setTimeout(r, 50));
  const s = laptop();
  await s.ready;
  s.send({type: 'discover'});
  const {receivers} = await s.next('receivers');
  assert.ok(receivers.some((r) => r.sessionId === 'NAME1' && r.name === 'CastAir-Living Room'));
  [t, s].forEach((c) => c.ws.close());
});

test('relays a decline with its reason to the sender', async () => {
  const t = tv('BUSY1', 'CastAir-Busy');
  const s = laptop('Late');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'BUSY1', sdp: 'o'});
  const offer = await t.next('offer');
  t.send({type: 'decline', to: offer.senderId, reason: 'busy'});
  assert.equal((await s.next('decline')).reason, 'busy');
  [t, s].forEach((c) => c.ws.close());
});

test('rate-limits a flood of offers', async () => {
  const t = tv('RATE1', 'CastAir-Rate', OTHER, SECRET_B);
  const s = laptop('Flood', OTHER);
  await Promise.all([t.ready, s.ready]);
  for (let i = 0; i < 30; i++) {
    s.send({type: 'offer', sessionId: 'RATE1', sdp: `o${i}`});
  }
  for (let i = 0; i < 30; i++) {
    await t.next('offer');
  }
  s.send({type: 'offer', sessionId: 'RATE1', sdp: 'one too many'});
  assert.equal((await s.next('error')).reason, 'rate-limited');
  [t, s].forEach((c) => c.ws.close());
});

test('bye from a sender reaches the TV as peer-left and unbinds the sender', async () => {
  const t = tv('BYE1', 'CastAir-Bye');
  const s = laptop('Stopper');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'BYE1', sdp: 'o'});
  const offer = await t.next('offer');
  s.send({type: 'bye'});
  assert.equal((await t.next('peer-left')).senderId, offer.senderId);
  s.send({type: 'ice', candidate: {candidate: 'late'}});
  await assert.rejects(t.next('ice'));
  [t, s].forEach((c) => c.ws.close());
});

test('a malformed upgrade request is refused without crashing', () => {
  let written = '';
  const socket = {end: (s) => (written = s), destroy: () => undefined};
  assert.doesNotThrow(() =>
    signal.handleUpgrade({url: '//', headers: {}, socket: {remoteAddress: '198.51.100.7'}}, socket, Buffer.alloc(0)),
  );
  assert.match(written, /^HTTP\/1\.1 400/);
});

test('refuses a share to a TV on another public IP, even with its code', async () => {
  const t = tv('AWAY1', 'CastAir-Elsewhere', OTHER, SECRET_B);
  const s = laptop('Stranger');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'AWAY1', sdp: 'o'});
  assert.equal((await s.next('error')).reason, 'no-peer');
  await assert.rejects(t.next('offer'));
  [t, s].forEach((c) => c.ws.close());
});

test('with no allowlist, anyone can connect (TVs are still only listed to their own IP)', async () => {
  const open = createSignalServer({allowedIps: null});
  const h = createServer();
  h.on('upgrade', (req, socket, head) => open.handleUpgrade(req, socket, head));
  await new Promise((resolve) => h.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${h.address().port}/signal?role=sender&clientId=anyone-1234&name=Anyone`;
  const ws = new WebSocket(url, {headers: {'X-Real-IP': '203.0.113.50'}});
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('unexpected-response', () => reject(new Error('refused')));
  });
  ws.close();
  open.close();
  h.close();
});

// Share codes.
const codeTv = async (sessionId, name = 'CastAir-Code', secret = SECRET_A, ip = OFFICE) => {
  const t = tv(sessionId, name, ip, secret);
  await t.ready;
  t.send({type: 'settings', codeRequired: true});
  const {code} = await t.next('code');
  return {t, code};
};

test('a TV that sends settings codeRequired gets a code', async () => {
  const {t, code} = await codeTv('CODE1');
  assert.match(code, /^\d{4}$/);
  t.ws.close();
});

test('offer without code to a code TV → code-required', async () => {
  const {t} = await codeTv('CODE2');
  const s = laptop('NoCode');
  await s.ready;
  s.send({type: 'offer', sessionId: 'CODE2', sdp: 'v=0'});
  assert.equal((await s.next('error')).reason, 'code-required');
  [t, s].forEach((c) => c.ws.close());
});

test('wrong code → bad-code; right code → offer delivered with no code field forwarded', async () => {
  const {t, code} = await codeTv('CODE3');
  const s = laptop('Typist');
  await s.ready;
  const wrong = code === '0000' ? '0001' : '0000';
  s.send({type: 'offer', sessionId: 'CODE3', sdp: 'v=0', code: wrong});
  assert.equal((await s.next('error')).reason, 'bad-code');
  s.send({type: 'offer', sessionId: 'CODE3', sdp: 'v=0 ok', code});
  const offer = await t.next('offer');
  assert.equal(offer.sdp, 'v=0 ok');
  assert.equal('code' in offer, false);
  [t, s].forEach((c) => c.ws.close());
});

test('code changes after the share ends, and the old code works for 60 s', async () => {
  const {t, code} = await codeTv('CODE4');
  const s = laptop('Sharer');
  await s.ready;
  s.send({type: 'offer', sessionId: 'CODE4', sdp: 'v=0', code});
  await t.next('offer');
  s.send({type: 'bye'});
  const next = (await t.next('code')).code;
  assert.notEqual(next, code);
  // TV-side end: decline with reason ended also issues a new code.
  s.send({type: 'offer', sessionId: 'CODE4', sdp: 'v=0', code: next});
  const offer = await t.next('offer');
  t.send({type: 'decline', to: offer.senderId, reason: 'ended'});
  const third = (await t.next('code')).code;
  assert.notEqual(third, next);
  // The code the laptop user was typing before the change is still accepted.
  s.send({type: 'offer', sessionId: 'CODE4', sdp: 'v=0', code: next});
  await t.next('offer');
  [t, s].forEach((c) => c.ws.close());
});

test('a sender closing ends the share and changes the code', async () => {
  const {t, code} = await codeTv('CODE5');
  const s = laptop('Closer');
  await s.ready;
  s.send({type: 'offer', sessionId: 'CODE5', sdp: 'v=0', code});
  await t.next('offer');
  s.ws.close();
  assert.notEqual((await t.next('code')).code, code);
  t.ws.close();
});

test('a TV that reconnects gets a fresh code and the old one stops working', async () => {
  const {t, code} = await codeTv('CODE6');
  t.ws.close();
  await t.closed;
  const {t: again, code: fresh} = await codeTv('CODE6');
  const s = laptop('Late');
  await s.ready;
  if (fresh !== code) {
    s.send({type: 'offer', sessionId: 'CODE6', sdp: 'v=0', code});
    assert.equal((await s.next('error')).reason, 'bad-code');
  }
  s.send({type: 'offer', sessionId: 'CODE6', sdp: 'v=0', code: fresh});
  await again.next('offer');
  [again, s].forEach((c) => c.ws.close());
});

test('turning the code off sends code null and offers need no code', async () => {
  const {t} = await codeTv('CODE7');
  t.send({type: 'settings', codeRequired: false});
  assert.equal((await t.next('code')).code, null);
  const s = laptop('Free');
  await s.ready;
  s.send({type: 'offer', sessionId: 'CODE7', sdp: 'v=0'});
  await t.next('offer');
  [t, s].forEach((c) => c.ws.close());
});

test('a TV with no settings message accepts offers without a code', async () => {
  const t = tv('OLD1', 'Older build');
  const s = laptop('Plain');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'OLD1', sdp: 'v=0 old'});
  assert.equal((await t.next('offer')).sdp, 'v=0 old');
  [t, s].forEach((c) => c.ws.close());
});

test('discover shows codeRequired per TV', async () => {
  const {t: a} = await codeTv('DISC1', 'With code');
  const b = tv('DISC2', 'Without code', OFFICE, SECRET_B);
  await b.ready;
  const s = laptop('Looker');
  await s.ready;
  s.send({type: 'discover'});
  const {receivers} = await s.next('receivers');
  const by = Object.fromEntries(receivers.map((r) => [r.sessionId, r.codeRequired]));
  assert.equal(by.DISC1, true);
  assert.equal(by.DISC2, false);
  [a, b, s].forEach((c) => c.ws.close());
});

test('wrong codes for TV A do not lock TV B', async () => {
  const {t: a, code: codeA} = await codeTv('LOCKA', 'A');
  const {t: b, code: codeB} = await codeTv('LOCKB', 'B', SECRET_B);
  const s = laptop('Guesser');
  await s.ready;
  const wrong = (c) => (c === '0000' ? '0001' : '0000');
  for (let i = 0; i < 5; i++) {
    s.send({type: 'offer', sessionId: 'LOCKA', sdp: 'v=0', code: wrong(codeA)});
    assert.equal((await s.next('error')).reason, 'bad-code');
  }
  s.send({type: 'offer', sessionId: 'LOCKA', sdp: 'v=0', code: codeA});
  assert.equal((await s.next('error')).reason, 'code-locked');
  s.send({type: 'offer', sessionId: 'LOCKB', sdp: 'v=0', code: codeB});
  await b.next('offer');
  [a, b, s].forEach((c) => c.ws.close());
});

test('the sweep issues a new code to a TV whose code is 10 minutes old', async () => {
  const clock = {t: 5_000_000};
  const local = createSignalServer({allowedIps: [OFFICE], now: () => clock.t});
  const server = createServer();
  server.on('upgrade', (req, socket, head) => local.handleUpgrade(req, socket, head));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const ws = new WebSocket(
    `ws://127.0.0.1:${server.address().port}/signal?${new URLSearchParams({
      role: 'receiver',
      sessionId: 'TICK1',
      receiverSecret: SECRET_A,
    })}`,
    {headers: {'X-Real-IP': OFFICE}},
  );
  const codes = [];
  ws.on('message', (d) => codes.push(JSON.parse(String(d))));
  await new Promise((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({type: 'settings', codeRequired: true}));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(codes.length, 1);
  local.tick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(codes.length, 1);
  clock.t += 600_000;
  ws.send(JSON.stringify({type: 'ping'})); // keeps the TV from being swept as idle
  await new Promise((resolve) => setTimeout(resolve, 50));
  local.tick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(codes.length, 2);
  assert.equal(codes[1].type, 'code');
  ws.close();
  local.close();
  server.close();
});

// A server of its own, on a clock the test moves.
async function clockedServer(allowedIps = null) {
  const clock = {t: 5_000_000};
  const local = createSignalServer({allowedIps, now: () => clock.t});
  const server = createServer();
  server.on('upgrade', (req, socket, head) => local.handleUpgrade(req, socket, head));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `ws://127.0.0.1:${server.address().port}/signal`;
  return {
    clock,
    local,
    open: (query, ip) => open(query, ip, url),
    close: () => {
      local.close();
      server.close();
    },
  };
}

test('offers from rotating addresses in one IPv6 /64 share one rate limit', async () => {
  const srv = await clockedServer();
  const t = srv.open({role: 'receiver', sessionId: 'ROT1', receiverSecret: SECRET_A, name: 'TV'}, HOME_TV);
  const one = srv.open({role: 'sender', clientId: 'rotating-one-1', name: 'One'}, '2a00:23c6:1:2:1::1');
  const two = srv.open({role: 'sender', clientId: 'rotating-two-1', name: 'Two'}, '2a00:23c6:1:2:2::2');
  await Promise.all([t.ready, one.ready, two.ready]);
  for (let i = 0; i < 30; i++) {
    one.send({type: 'offer', sessionId: 'ROT1', sdp: `o${i}`});
    await t.next('offer');
  }
  two.send({type: 'offer', sessionId: 'ROT1', sdp: 'from a new address'});
  assert.equal((await two.next('error')).reason, 'rate-limited');
  [t, one, two].forEach((c) => c.ws.close());
  srv.close();
});

test('the sweep forgets rate-limit records once the window has passed', async () => {
  const srv = await clockedServer();
  const t = srv.open({role: 'receiver', sessionId: 'PRUNE1', receiverSecret: SECRET_A, name: 'TV'}, OFFICE);
  const s = srv.open({role: 'sender', clientId: 'pruned-sender-1', name: 'S'}, OFFICE);
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'PRUNE1', sdp: 'o'});
  await t.next('offer');
  assert.equal(srv.local.stats().offers, 1);
  srv.clock.t += 10 * 60 * 1000 - 1;
  srv.local.tick();
  assert.equal(srv.local.stats().offers, 1);
  srv.clock.t += 1;
  // Keep both from being swept as idle; the record is what's being tested.
  [t, s].forEach((c) => c.send({type: 'ping'}));
  await new Promise((resolve) => setTimeout(resolve, 50));
  srv.local.tick();
  assert.equal(srv.local.stats().offers, 0);
  [t, s].forEach((c) => c.ws.close());
  srv.close();
});

test('the sweep forgets wrong-code records once they can no longer count or lock', async () => {
  const srv = await clockedServer();
  const t = srv.open({role: 'receiver', sessionId: 'PRUNE2', receiverSecret: SECRET_A, name: 'TV'}, OFFICE);
  await t.ready;
  t.send({type: 'settings', codeRequired: true});
  const {code} = await t.next('code');
  const s = srv.open({role: 'sender', clientId: 'wrong-code-sender-1', name: 'S'}, OFFICE);
  await s.ready;
  s.send({type: 'offer', sessionId: 'PRUNE2', sdp: 'o', code: code === '0000' ? '0001' : '0000'});
  assert.equal((await s.next('error')).reason, 'bad-code');
  assert.equal(srv.local.stats().codeAttempts, 1);
  srv.clock.t += 60_000;
  [t, s].forEach((c) => c.send({type: 'ping'}));
  await new Promise((resolve) => setTimeout(resolve, 50));
  srv.local.tick();
  assert.equal(srv.local.stats().codeAttempts, 0);
  [t, s].forEach((c) => c.ws.close());
  srv.close();
});

test('settings repeated while the code is on keep the same code; turning it back on changes it', async () => {
  const {t, code} = await codeTv('SAME1');
  t.send({type: 'settings', codeRequired: true});
  assert.equal((await t.next('code')).code, code);
  t.send({type: 'settings', codeRequired: false});
  assert.equal((await t.next('code')).code, null);
  t.send({type: 'settings', codeRequired: true});
  const fresh = (await t.next('code')).code;
  assert.match(fresh, /^\d{4}$/);
  // The old code was forgotten when the code went off.
  const s = laptop('Old code');
  await s.ready;
  if (fresh !== code) {
    s.send({type: 'offer', sessionId: 'SAME1', sdp: 'v=0', code});
    assert.equal((await s.next('error')).reason, 'bad-code');
  }
  [t, s].forEach((c) => c.ws.close());
});

test('a TV connecting with codeRequired=1 needs the code from the start, before any settings', async () => {
  const t = open({role: 'receiver', sessionId: 'START1', receiverSecret: SECRET_A, name: 'TV', codeRequired: '1'});
  const s = laptop('Quick');
  await Promise.all([t.ready, s.ready]);
  const {code} = await t.next('code');
  assert.match(code, /^\d{4}$/);
  s.send({type: 'offer', sessionId: 'START1', sdp: 'v=0'});
  assert.equal((await s.next('error')).reason, 'code-required');
  s.send({type: 'discover'});
  const {receivers} = await s.next('receivers');
  assert.equal(receivers.find((r) => r.sessionId === 'START1').codeRequired, true);
  // The settings message that follows on connect keeps that code.
  t.send({type: 'settings', codeRequired: true});
  assert.equal((await t.next('code')).code, code);
  s.send({type: 'offer', sessionId: 'START1', sdp: 'v=0 ok', code});
  assert.equal((await t.next('offer')).sdp, 'v=0 ok');
  [t, s].forEach((c) => c.ws.close());
});

test('a TV connecting with codeRequired=0 is code-free', async () => {
  const t = open({role: 'receiver', sessionId: 'START2', receiverSecret: SECRET_A, name: 'TV', codeRequired: '0'});
  const s = laptop('Free start');
  await Promise.all([t.ready, s.ready]);
  s.send({type: 'offer', sessionId: 'START2', sdp: 'v=0 free'});
  assert.equal((await t.next('offer')).sdp, 'v=0 free');
  await assert.rejects(t.next('code'));
  [t, s].forEach((c) => c.ws.close());
});
