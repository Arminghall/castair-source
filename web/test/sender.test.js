// CastAir sharing page: the sender module.
// Adapted from Tandem's test/sender.test.js (github.com/kevinl95/Tandem),
// Apache-2.0. Changes: Copyright (C) 2026 Arminghall.
//
import test from 'node:test';
import assert from 'node:assert/strict';
import {CastAirSender, isTerminalShareState, preferCodec} from '../sender/sender.js';
import {FakePeerConnection, FakeWebSocket, flushAsync, installFakes} from './fake-webrtc.js';

function fakeTrack(kind) {
  return {
    kind,
    listeners: {},
    stopped: false,
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    stop() {
      this.stopped = true;
    },
  };
}

function fakeStream({audio = false} = {}) {
  const video = fakeTrack('video');
  const tracks = audio ? [video, fakeTrack('audio')] : [video];
  return {
    tracks,
    video,
    stream: {
      getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
      getTracks: () => tracks,
      getVideoTracks: () => [video],
    },
  };
}

async function connectSender(t) {
  installFakes(t);
  const states = [];
  const receiverLists = [];
  const signaling = [];
  const sender = new CastAirSender({
    clientId: 'client-laptop-1',
    name: "Kevin's laptop",
    onReceivers: (receivers) => receiverLists.push(receivers),
    onSignalingChange: (connected) => signaling.push(connected),
    onStateChange: (state, detail) => states.push(detail ? `${state}: ${detail}` : state),
    signalingEndpoint: 'wss://castair.example/signal',
  });
  t.after(() => sender.close());

  const connected = sender.connect();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await connected;

  return {receiverLists, sender, signaling, socket, states};
}

async function startShare(t, options) {
  const context = await connectSender(t);
  const media = fakeStream(options);
  await context.sender.share(media.stream, ' k7p-2qx ');
  return {...context, ...media, peerConnection: FakePeerConnection.instances[0]};
}

test('sender connects with its identity and no session', async (t) => {
  const {signaling, socket} = await connectSender(t);

  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('role'), 'sender');
  assert.equal(url.searchParams.get('clientId'), 'client-laptop-1');
  assert.equal(url.searchParams.get('name'), "Kevin's laptop");
  assert.equal(url.searchParams.has('sessionId'), false);
  assert.deepEqual(signaling, [true]);
});

test('sender discovers TVs on its network', async (t) => {
  const {receiverLists, sender, socket} = await connectSender(t);

  sender.discover();
  socket.receive({receivers: [{name: 'Living Room', sessionId: 'K7P2QX'}], type: 'receivers'});
  await flushAsync();

  assert.deepEqual(socket.sent, [{type: 'discover'}]);
  assert.deepEqual(receiverLists, [[{name: 'Living Room', sessionId: 'K7P2QX'}]]);
});

test('sender offers send-only media to the chosen TV', async (t) => {
  const {peerConnection, socket, states, video} = await startShare(t);

  assert.deepEqual(socket.sent, [{sdp: 'offer-sdp', sessionId: 'K7P2QX', type: 'offer'}]);
  assert.equal(peerConnection.transceivers[0].init.direction, 'sendonly');
  assert.equal(video.contentHint, 'detail');
  assert.deepEqual(states, ['offering']);
});

test('sender shares audio as music alongside the screen', async (t) => {
  const {peerConnection, tracks} = await startShare(t, {audio: true});

  assert.deepEqual(
    peerConnection.transceivers.map(({track}) => track.kind),
    ['video', 'audio'],
  );
  assert.equal(tracks[1].contentHint, 'music');
});

test('sender adds ICE that overtakes the answer once the TV answers', async (t) => {
  const {peerConnection, socket, states} = await startShare(t);
  const candidate = {candidate: 'candidate:1 1 udp 1 a1b2.local 5000 typ host'};

  socket.receive({candidate, sessionId: 'K7P2QX', type: 'ice'});
  await flushAsync();
  assert.deepEqual(peerConnection.addedIceCandidates, []);

  socket.receive({sdp: 'answer-sdp', sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  assert.deepEqual(peerConnection.remoteDescription, {sdp: 'answer-sdp', type: 'answer'});
  assert.deepEqual(peerConnection.addedIceCandidates, [candidate]);
  assert.equal(states.at(-1), 'connecting');

  peerConnection.setConnectionState('connected');
  assert.equal(states.at(-1), 'streaming');
});

test('sender holds its own ICE until the TV answers', async (t) => {
  const {peerConnection, socket} = await startShare(t);
  const hostCandidate = {candidate: 'candidate:1 1 udp 1 192.168.2.119 5000 typ host'};

  peerConnection.emit('icecandidate', {candidate: {toJSON: () => hostCandidate}});
  peerConnection.emit('icecandidate', {candidate: null});
  assert.deepEqual(socket.sent, [{sdp: 'offer-sdp', sessionId: 'K7P2QX', type: 'offer'}]);

  socket.receive({sdp: 'answer-sdp', sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  assert.deepEqual(socket.sent.slice(1), [
    {candidate: hostCandidate, type: 'ice'},
    {candidate: null, type: 'ice'},
  ]);
});

test('sender sends an offer with no ICE servers configured', async (t) => {
  const {peerConnection} = await startShare(t);
  assert.deepEqual(peerConnection.configuration.iceServers, []);
});

test('sender pings the server every 30 s', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {socket} = await connectSender(t);
  t.mock.timers.tick(30000);
  assert.deepEqual(socket.sent, [{type: 'ping'}]);
});

test('sender gives up when the TV answered but the connection never completes', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {peerConnection, socket, states} = await startShare(t);

  socket.receive({sdp: 'answer-sdp', sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  t.mock.timers.tick(20000);

  assert.equal(states.at(-1), 'failed: The TV answered but the connection never completed.');
  assert.equal(peerConnection.closed, true);
});

test('sender ignores messages about a TV it no longer shares to', async (t) => {
  const {peerConnection, socket, states} = await startShare(t);

  socket.receive({sdp: 'stale', sessionId: 'OLD111', type: 'answer'});
  socket.receive({from: 'receiver', sessionId: 'OLD111', type: 'peer-left'});
  await flushAsync();

  assert.equal(peerConnection.remoteDescription, null);
  assert.deepEqual(states, ['offering']);
});

for (const [message, expectedState] of [
  [{type: 'decline'}, 'declined'],
  [{reason: 'busy', type: 'decline'}, 'declined: The TV is busy with another request. Try again in a moment.'],
  [{reason: 'no-peer', type: 'error'}, 'no-receiver'],
  [{reason: 'rate-limited', type: 'error'}, 'rate-limited'],
  [{from: 'receiver', type: 'peer-left'}, 'receiver-left'],
  [{reason: 'ended', type: 'decline'}, 'receiver-left'],
]) {
  test(`sender ends the share on ${JSON.stringify(message)}`, async (t) => {
    const {peerConnection, sender, socket, states, video} = await startShare(t);

    socket.receive({...message, sessionId: 'K7P2QX'});
    await flushAsync();

    assert.equal(states.at(-1), expectedState);
    assert.equal(isTerminalShareState(expectedState.split(':')[0]), true);
    assert.equal(peerConnection.closed, true);
    assert.equal(video.stopped, true);
    assert.equal(sender.isSharing, false);
    assert.equal(socket.readyState, FakeWebSocket.OPEN, 'signaling stays up for the next share');
  });
}

test('offer includes the code', async (t) => {
  const {sender, socket} = await connectSender(t);
  await sender.share(fakeStream().stream, 'K7P2QX', '4821');

  assert.deepEqual(socket.sent, [{code: '4821', sdp: 'offer-sdp', sessionId: 'K7P2QX', type: 'offer'}]);
});

test('TV without codeRequired shares on click, no box', async (t) => {
  const {receiverLists, sender, socket} = await connectSender(t);
  socket.receive({receivers: [{codeRequired: false, name: 'Hall', sessionId: 'K7P2QX'}], type: 'receivers'});
  await flushAsync();
  await sender.share(fakeStream().stream, 'K7P2QX');

  assert.equal(receiverLists[0][0].codeRequired, false);
  assert.equal(Object.hasOwn(socket.sent[0], 'code'), false);
});

test('bad-code shows the wrong-code message and keeps the box', async (t) => {
  const {sender, socket, states} = await startShare(t);

  socket.receive({reason: 'bad-code', sessionId: 'K7P2QX', type: 'error'});
  await flushAsync();

  assert.equal(states.at(-1), "bad-code: That code doesn't match the TV. Check the code on the TV screen.");
  assert.equal(isTerminalShareState('bad-code'), true);
  assert.equal(sender.isSharing, false);
});

test('code-locked message', async (t) => {
  const {socket, states} = await startShare(t);

  socket.receive({reason: 'code-locked', sessionId: 'K7P2QX', type: 'error'});
  await flushAsync();

  assert.equal(states.at(-1), 'code-locked: Too many wrong codes. Wait a minute and try again.');
});

test('code-required asks for the code', async (t) => {
  const {socket, states} = await startShare(t);

  socket.receive({reason: 'code-required', sessionId: 'K7P2QX', type: 'error'});
  await flushAsync();

  assert.equal(states.at(-1), 'code-required');
  assert.equal(isTerminalShareState('code-required'), true);
});

test('sender stops when the user ends the capture from the browser', async (t) => {
  const {states, video} = await startShare(t);

  video.listeners.ended();

  assert.equal(states.at(-1), 'stopped');
});

test('sender needs a TV and a live connection to share', async (t) => {
  const {sender} = await connectSender(t);
  await assert.rejects(sender.share(fakeStream().stream, ''), /Pick a TV/);

  const offline = new CastAirSender({clientId: 'client-x-123', signalingEndpoint: 'wss://x'});
  await assert.rejects(offline.share(fakeStream().stream, 'K7P2QX'), /Not connected/);
});

test('sender reconnects signaling after it drops', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const {signaling, socket} = await connectSender(t);

  socket.close();
  assert.deepEqual(signaling, [true, false]);

  t.mock.timers.tick(3000);
  assert.equal(FakeWebSocket.instances.length, 2);
});

test('preferCodec moves the requested codec to the front', (t) => {
  const original = globalThis.RTCRtpReceiver;
  t.after(() => {
    globalThis.RTCRtpReceiver = original;
  });
  globalThis.RTCRtpReceiver = {
    getCapabilities: () => ({
      codecs: [{mimeType: 'video/VP8'}, {mimeType: 'video/H264'}, {mimeType: 'video/rtx'}],
    }),
  };
  let preferences;
  const transceiver = {setCodecPreferences: (codecs) => (preferences = codecs)};

  assert.equal(preferCodec(transceiver, 'video/H264'), true);
  assert.deepEqual(
    preferences.map((codec) => codec.mimeType),
    ['video/H264', 'video/VP8', 'video/rtx'],
  );
});

test("stopping tells the server, so the TV doesn't keep the last frame", async (t) => {
  const {sender, socket} = await startShare(t);
  sender.stopSharing('stopped');
  assert.deepEqual(socket.sent.at(-1), {type: 'bye'});
});
