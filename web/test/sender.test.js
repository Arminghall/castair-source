// CastAir sharing page: the sender module.
// Adapted from Tandem's test/sender.test.js (github.com/kevinl95/Tandem),
// Apache-2.0. Changes: Copyright (C) 2026 Arminghall.
//
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CastAirSender,
  boostVideoBitrate,
  captureConstraints,
  isTerminalShareState,
  preferCodec,
  qualityName,
} from '../sender/sender.js';
import {formatConnection} from '../sender/connection.js';
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

// Quality, start bitrate, reconnecting and the connection line.

async function goLive(context) {
  context.socket.receive({sdp: 'answer-sdp', sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  context.peerConnection.setConnectionState('connected');
  await flushAsync();
}

test('sharp text is the default: detail, 15 fps, 8 Mbit/s, resolution kept', async (t) => {
  const {peerConnection, video} = await startShare(t);

  assert.equal(video.contentHint, 'detail');
  assert.deepEqual(peerConnection.transceivers[0].sender.parameters, {
    degradationPreference: 'maintain-resolution',
    encodings: [{maxBitrate: 8_000_000, maxFramerate: 15}],
  });
});

test('smooth video can be chosen mid-share without a new offer', async (t) => {
  const context = await startShare(t);
  const constraints = [];
  context.video.applyConstraints = async (c) => constraints.push(c);

  assert.equal(await context.sender.setQuality('video'), true);

  assert.equal(context.video.contentHint, 'motion');
  assert.deepEqual(context.peerConnection.transceivers[0].sender.parameters, {
    degradationPreference: 'balanced',
    encodings: [{maxBitrate: 12_000_000, maxFramerate: 30}],
  });
  // The size limit goes with it: applyConstraints replaces the whole set.
  assert.deepEqual(constraints, [{frameRate: {ideal: 30, max: 30}, height: {max: 1080}, width: {max: 1920}}]);
  assert.equal(FakePeerConnection.instances.length, 1);
});

test('a browser that refuses encoder settings still shares', async (t) => {
  const context = await connectSender(t);
  const media = fakeStream();
  const original = FakePeerConnection.prototype.addTransceiver;
  FakePeerConnection.prototype.addTransceiver = function (track, init) {
    const transceiver = original.call(this, track, init);
    transceiver.sender.setParameters = async () => {
      throw new Error('InvalidModificationError');
    };
    return transceiver;
  };
  t.after(() => {
    FakePeerConnection.prototype.addTransceiver = original;
  });

  await context.sender.share(media.stream, 'K7P2QX');

  assert.equal(context.socket.sent.at(-1).type, 'offer');
});

test('capture is asked for at 1080p at most and the quality frame rate', () => {
  assert.deepEqual(captureConstraints('text'), {
    frameRate: {ideal: 15, max: 15},
    height: {max: 1080},
    width: {max: 1920},
  });
  assert.equal(captureConstraints('video').frameRate.max, 30);
  assert.equal(qualityName('nonsense'), 'text');
});

const ANSWER_SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 102 103',
  'a=rtpmap:102 H264/90000',
  'a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
  'a=rtpmap:103 rtx/90000',
  'a=fmtp:103 apt=102',
  '',
].join('\r\n');

test('boostVideoBitrate raises the start bitrate on video codecs only', () => {
  const tuned = boostVideoBitrate(ANSWER_SDP, {startKbps: 3000});
  const extra = 'x-google-start-bitrate=3000;x-google-min-bitrate=800;x-google-max-bitrate=12000';

  assert.equal(tuned, ANSWER_SDP.replace('profile-level-id=42e01f', `profile-level-id=42e01f;${extra}`));
  // Running it twice changes nothing more, and no start bitrate leaves the SDP alone.
  assert.equal(boostVideoBitrate(tuned, {startKbps: 3000}), tuned);
  assert.equal(boostVideoBitrate(ANSWER_SDP), ANSWER_SDP);
});

test('only Chrome and Edge get the tuned answer', async (t) => {
  const plain = await startShare(t);
  plain.socket.receive({sdp: ANSWER_SDP, sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  assert.equal(plain.peerConnection.remoteDescription.sdp, ANSWER_SDP);

  plain.sender.stopSharing();
  plain.sender.tuneBitrate = true;
  await plain.sender.share(fakeStream().stream, 'K7P2QX');
  plain.socket.receive({sdp: ANSWER_SDP, sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  assert.match(FakePeerConnection.instances[1].remoteDescription.sdp, /x-google-start-bitrate=3000/);
});

test('a tuned answer the browser rejects falls back to the plain one', async (t) => {
  const context = await startShare(t);
  context.sender.tuneBitrate = true;
  const set = context.peerConnection.setRemoteDescription.bind(context.peerConnection);
  context.peerConnection.setRemoteDescription = async (description) => {
    if (description.sdp.includes('x-google')) {
      throw new Error('rejected');
    }
    return set(description);
  };

  context.socket.receive({sdp: ANSWER_SDP, sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();

  assert.equal(context.peerConnection.remoteDescription.sdp, ANSWER_SDP);
  assert.equal(context.states.at(-1), 'connecting');
});

test('a live share that drops is offered again with the same stream', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  context.peerConnection.setConnectionState('failed');
  assert.equal(context.states.at(-1), 'reconnecting');
  assert.equal(context.video.stopped, false);
  assert.equal(context.peerConnection.closed, true);
  // No "bye": that would tell the TV the share ended and change its code.
  assert.equal(
    context.socket.sent.some((m) => m.type === 'bye'),
    false,
  );

  t.mock.timers.tick(1000);
  await flushAsync();
  const second = FakePeerConnection.instances[1];
  assert.equal(second.transceivers[0].track, context.video);
  assert.deepEqual(context.socket.sent.at(-1), {sdp: 'offer-sdp', sessionId: 'K7P2QX', type: 'offer'});

  context.socket.receive({sdp: 'answer-sdp', sessionId: 'K7P2QX', type: 'answer'});
  await flushAsync();
  assert.equal(context.states.at(-1), 'reconnecting');
  second.setConnectionState('connected');
  assert.equal(context.states.at(-1), 'streaming');
});

test('a brief "disconnected" that heals does not reconnect', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  context.peerConnection.setConnectionState('disconnected');
  t.mock.timers.tick(3000);
  context.peerConnection.setConnectionState('connected');
  t.mock.timers.tick(10000);

  assert.equal(FakePeerConnection.instances.length, 1);
  assert.equal(context.states.at(-1), 'streaming');
});

test('"disconnected" for 5 s starts a reconnect', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  context.peerConnection.setConnectionState('disconnected');
  t.mock.timers.tick(5000);
  assert.equal(context.states.at(-1), 'reconnecting');
  t.mock.timers.tick(1000);
  await flushAsync();

  assert.equal(FakePeerConnection.instances.length, 2);
});

test('reconnecting gives up after its last wait and frees the capture', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  context.peerConnection.setConnectionState('failed');
  for (const wait of [1000, 3000, 6000, 10000, 15000, 20000]) {
    t.mock.timers.tick(wait);
    await flushAsync();
    // Each new offer is refused: the TV isn't there.
    context.socket.receive({reason: 'no-peer', sessionId: 'K7P2QX', type: 'error'});
    await flushAsync();
  }

  assert.match(context.states.at(-1), /^failed: Lost the connection to the TV/);
  assert.equal(context.video.stopped, true);
  assert.equal(context.sender.isSharing, false);
});

test('reconnecting waits for the CastAir server to come back', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  // The laptop slept: both the server connection and the share went.
  context.socket.close();
  context.peerConnection.setConnectionState('failed');
  assert.equal(context.states.at(-1), 'reconnecting');
  t.mock.timers.tick(1000);
  await flushAsync();
  assert.equal(FakePeerConnection.instances.length, 1);

  // The server connection is back at 3 s; the next try, at 4 s, goes out on it.
  t.mock.timers.tick(2000);
  FakeWebSocket.instances[1].open();
  t.mock.timers.tick(1000);
  await flushAsync();

  assert.equal(FakePeerConnection.instances.length, 2);
  assert.equal(FakeWebSocket.instances[1].sent.at(-1).type, 'offer');
});

test("a reconnect the TV's new code blocks keeps the capture and asks for the code", async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await connectSender(t);
  const media = fakeStream();
  await context.sender.share(media.stream, 'K7P2QX', '4821');
  const first = FakePeerConnection.instances[0];
  await goLive({...context, peerConnection: first});

  first.setConnectionState('failed');
  t.mock.timers.tick(1000);
  await flushAsync();
  assert.equal(context.socket.sent.at(-1).code, '4821');
  context.socket.receive({reason: 'bad-code', sessionId: 'K7P2QX', type: 'error'});
  await flushAsync();

  assert.match(context.states.at(-1), /^reconnect-code: The connection dropped and the TV has a new code/);
  assert.equal(context.sender.isAwaitingCode, true);
  assert.equal(media.video.stopped, false);
  // It waits for the person: no more offers (each wrong code counts towards the lock).
  const offers = context.socket.sent.filter((m) => m.type === 'offer').length;
  t.mock.timers.tick(60000);
  await flushAsync();
  assert.equal(context.socket.sent.filter((m) => m.type === 'offer').length, offers);

  await context.sender.resume('7310');
  assert.equal(context.socket.sent.at(-1).code, '7310');
  assert.equal(context.sender.isAwaitingCode, false);
  assert.equal(FakePeerConnection.instances.at(-1).transceivers[0].track, media.video);
});

test('a share that never connected still ends instead of retrying', async (t) => {
  const {peerConnection, states, video} = await startShare(t);

  peerConnection.setConnectionState('failed');

  assert.equal(states.at(-1), 'failed');
  assert.equal(video.stopped, true);
});

test('stopping while reconnecting ends the share for good', async (t) => {
  t.mock.timers.enable({apis: ['setTimeout', 'setInterval']});
  const context = await startShare(t);
  await goLive(context);

  context.peerConnection.setConnectionState('failed');
  context.sender.stopSharing('stopped');
  t.mock.timers.tick(60000);
  await flushAsync();

  assert.equal(context.states.at(-1), 'stopped');
  assert.equal(FakePeerConnection.instances.length, 1);
  assert.equal(context.video.stopped, true);
});

test('the connection line shows size, frame rate and bitrate', () => {
  assert.equal(
    formatConnection({bitrateKbps: 6240, framesPerSecond: 14.6, height: 1080, width: 1920}),
    '1920 × 1080 · 15 fps · 6.2 Mbit/s',
  );
  assert.equal(formatConnection({bitrateKbps: 640, framesPerSecond: null, height: null, width: null}), '640 kbit/s');
  assert.equal(formatConnection(null), '');
});
