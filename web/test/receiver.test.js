// CastAir TV receiver page: accepts every allowed laptop (no approval
// prompt), says "busy" when told to, follows renames and reconnects.
// Adapted in part from Tandem's receiver tests (github.com/kevinl95/Tandem),
// Apache-2.0. Changes: Copyright (C) 2026 Arminghall.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CastAirReceiver} from '../receiver/receiver.js';
import {FakePeerConnection, FakeWebSocket, flushAsync, installFakes} from './fake-webrtc.js';

function setup(t) {
  installFakes(t);
  const states = [];
  const shares = [];
  const video = {srcObject: null};
  const receiver = new CastAirReceiver(video, {
    signalingEndpoint: 'wss://castair.example/signal',
    sessionId: 'K7P2QX',
    receiverSecret: 's'.repeat(40),
    receiverName: 'CastAir-Front Room',
    onStateChange: (state) => states.push(state),
    onShareChange: (active, senderName) => shares.push(active ? `on:${senderName}` : 'off'),
  });
  t.after(() => receiver.dispose());
  receiver.connectSignaling();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  return {receiver, socket, states, shares, video};
}

const offer = {type: 'offer', sdp: 'offer-sdp', senderId: 's1', senderName: "Sam's PC", sessionId: 'K7P2QX'};

test('connects as the TV with its code, secret and name', (t) => {
  const {socket} = setup(t);
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('role'), 'receiver');
  assert.equal(url.searchParams.get('sessionId'), 'K7P2QX');
  assert.equal(url.searchParams.get('name'), 'CastAir-Front Room');
});

test('answers an offer without asking', async (t) => {
  const {socket} = setup(t);
  socket.receive(offer);
  await flushAsync();
  const answer = socket.sent.find((m) => m.type === 'answer');
  assert.equal(answer.to, 's1');
  assert.equal(answer.sdp, 'answer-sdp');
  assert.equal(
    socket.sent.some((m) => m.type === 'pending' || m.type === 'decline'),
    false,
  );
});

test("reports the share with the sender's name, and its end", async (t) => {
  const {socket, shares} = setup(t);
  socket.receive(offer);
  await flushAsync();
  FakePeerConnection.instances[0].setConnectionState('connected');
  socket.receive({type: 'peer-left', senderId: 's1'});
  assert.deepEqual(shares, ["on:Sam's PC", 'off']);
});

test('declines with busy while setBusy(true)', async (t) => {
  const {receiver, socket} = setup(t);
  receiver.setBusy(true);
  socket.receive(offer);
  await flushAsync();
  assert.deepEqual(socket.sent.at(-1), {type: 'decline', to: 's1', reason: 'busy'});
  assert.equal(FakePeerConnection.instances.length, 0);
});

test('a new laptop takes over from the one sharing', async (t) => {
  const {socket} = setup(t);
  socket.receive(offer);
  await flushAsync();
  socket.receive({...offer, senderId: 's2', senderName: 'Other'});
  await flushAsync();
  assert.equal(FakePeerConnection.instances[0].closed, true);
  assert.equal(socket.sent.filter((m) => m.type === 'answer').at(-1).to, 's2');
});

test('sends rename when setName is called, and reconnects under the new name', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {receiver, socket} = setup(t);
  receiver.setName('CastAir-Living Room');
  assert.deepEqual(socket.sent.at(-1), {type: 'rename', name: 'CastAir-Living Room'});
  socket.close();
  t.mock.timers.tick(3000);
  assert.equal(new URL(FakeWebSocket.instances[1].url).searchParams.get('name'), 'CastAir-Living Room');
});

test('reconnects after the socket closes, backing off up to 60 s', (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket} = setup(t);
  const delays = [];
  let current = socket;
  for (let i = 0; i < 7; i++) {
    const before = FakeWebSocket.instances.length;
    current.close();
    let waited = 0;
    while (FakeWebSocket.instances.length === before) {
      t.mock.timers.tick(1000);
      waited += 1000;
    }
    delays.push(waited);
    current = FakeWebSocket.instances.at(-1);
  }
  assert.deepEqual(delays, [3000, 6000, 12000, 15000, 15000, 15000, 15000]);
});

test('pings the server every 30 s', (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket} = setup(t);
  t.mock.timers.tick(30000);
  assert.deepEqual(socket.sent, [{type: 'settings', codeRequired: true}, {type: 'ping'}]);
});

test('endShare tells the laptop and returns to waiting', async (t) => {
  const {receiver, socket, states} = setup(t);
  socket.receive(offer);
  await flushAsync();
  assert.equal(receiver.endShare(), true);
  assert.deepEqual(socket.sent.at(-1), {type: 'decline', to: 's1', reason: 'ended'});
  assert.equal(states.at(-1), 'waiting');
});

test('gives up on a share 8 s after its connection drops', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket, shares, states} = setup(t);
  socket.receive(offer);
  await flushAsync();
  const pc = FakePeerConnection.instances[0];
  pc.setConnectionState('connected');
  pc.setConnectionState('disconnected');
  t.mock.timers.tick(7000);
  assert.deepEqual(shares, ["on:Sam's PC"]);
  t.mock.timers.tick(1000);
  assert.deepEqual(shares, ["on:Sam's PC", 'off']);
  assert.equal(states.at(-1), 'waiting');
});

test('keeps a share whose connection comes back within 8 s', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket, shares} = setup(t);
  socket.receive(offer);
  await flushAsync();
  const pc = FakePeerConnection.instances[0];
  pc.setConnectionState('connected');
  pc.setConnectionState('disconnected');
  t.mock.timers.tick(4000);
  pc.setConnectionState('connected');
  t.mock.timers.tick(10000);
  assert.deepEqual(shares, ["on:Sam's PC"]);
});

test('ends the share at once when the laptop closes the connection', async (t) => {
  const {socket, shares} = setup(t);
  socket.receive(offer);
  await flushAsync();
  const pc = FakePeerConnection.instances[0];
  pc.setConnectionState('connected');
  pc.setConnectionState('closed');
  assert.deepEqual(shares, ["on:Sam's PC", 'off']);
});

test('sends settings with codeRequired after connecting and after reconnecting', (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket} = setup(t);
  assert.deepEqual(socket.sent[0], {type: 'settings', codeRequired: true});
  socket.close();
  t.mock.timers.tick(3000);
  const again = FakeWebSocket.instances[1];
  again.open();
  assert.deepEqual(again.sent[0], {type: 'settings', codeRequired: true});
});

test('settings uses the given codeRequired and a call while connected re-sends it', (t) => {
  installFakes(t);
  const receiver = new CastAirReceiver(
    {srcObject: null},
    {signalingEndpoint: 'wss://castair.example/signal', sessionId: 'K7P2QX', codeRequired: false},
  );
  t.after(() => receiver.dispose());
  receiver.connectSignaling();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  assert.deepEqual(socket.sent[0], {type: 'settings', codeRequired: false});
  receiver.setCodeRequired(true);
  assert.deepEqual(socket.sent.at(-1), {type: 'settings', codeRequired: true});
  assert.equal(socket.sent.length, 2);
});

test('connects with codeRequired=1|0, and a later change is used on the next connect', (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {receiver, socket} = setup(t);
  assert.equal(new URL(socket.url).searchParams.get('codeRequired'), '1');
  receiver.setCodeRequired(false);
  socket.close();
  t.mock.timers.tick(3000);
  assert.equal(new URL(FakeWebSocket.instances[1].url).searchParams.get('codeRequired'), '0');
});

test('posts the code message to the app', (t) => {
  installFakes(t);
  const codes = [];
  const receiver = new CastAirReceiver(
    {srcObject: null},
    {signalingEndpoint: 'wss://castair.example/signal', sessionId: 'K7P2QX', onCode: (code) => codes.push(code)},
  );
  t.after(() => receiver.dispose());
  receiver.connectSignaling();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.receive({type: 'code', code: '4821'});
  socket.receive({type: 'code', code: null});
  assert.deepEqual(codes, ['4821', null]);
});

test('clears the code when the socket closes or signaling pauses', (t) => {
  installFakes(t);
  const codes = [];
  const receiver = new CastAirReceiver(
    {srcObject: null},
    {signalingEndpoint: 'wss://castair.example/signal', sessionId: 'K7P2QX', onCode: (code) => codes.push(code)},
  );
  t.after(() => receiver.dispose());
  receiver.connectSignaling();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.receive({type: 'code', code: '4821'});
  socket.close();
  assert.deepEqual(codes, ['4821', null]);
  receiver.connectSignaling();
  FakeWebSocket.instances.at(-1).open();
  FakeWebSocket.instances.at(-1).receive({type: 'code', code: '7310'});
  receiver.pauseSignaling();
  assert.deepEqual(codes, ['4821', null, '7310', null]);
});
