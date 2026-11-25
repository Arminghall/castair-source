// CastAir sharing page: shares a laptop's screen to a CastAir TV over WebRTC.
// Adapted from Tandem's src/sender/sender.js (github.com/kevinl95/Tandem),
// Apache-2.0; see third_party_notices/TANDEM-LICENSE. Changes: Copyright (C)
// 2026 Arminghall: no approval step on the TV, LAN-only (no STUN), and a
// 30 s keep-alive for CastAir's own server.
//
// SPDX-License-Identifier: AGPL-3.0-or-later AND Apache-2.0
import {PEER_CONFIGURATION, normalizeSessionCode} from '../shared/config.js';

// The CastAir server drops connections silent for 120 s.
const KEEPALIVE_INTERVAL_MS = 30 * 1000;
const RECONNECT_DELAY_MS = 3000;
// A share that hasn't connected this long after the TV answered has failed.
const CONNECT_TIMEOUT_MS = 20000;
const WRONG_CODE_MESSAGE = "That code doesn't match the TV. Check the code on the TV screen.";
const CODE_LOCKED_MESSAGE = 'Too many wrong codes. Wait a minute and try again.';
const PREFERRED_VIDEO_CODEC = 'video/H264';
// A share that was live and then drops is offered again to the same TV, with
// the same captured stream: after these waits, then it gives up.
const SHARE_RECONNECT_DELAYS_MS = [1000, 3000, 6000, 10000, 15000, 20000];
// "disconnected" is often a blip that heals itself; the TV gives up after 8 s,
// so start again a little before that.
const DISCONNECT_GRACE_MS = 5000;
const RECONNECT_CODE_MESSAGE = 'The connection dropped and the TV has a new code. Type the code on the TV to carry on.';
// The TV shows 1080p, so anything bigger only spreads the bitrate thinner.
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

// What each choice on the casting page asks the browser's encoder for.
// Without these, Chrome and Edge cap a whole screen at about 2.5 Mbit/s.
export const QUALITIES = Object.freeze({
  text: Object.freeze({
    contentHint: 'detail',
    degradationPreference: 'maintain-resolution',
    frameRate: 15,
    maxBitrate: 8_000_000,
    startKbps: 3000,
  }),
  video: Object.freeze({
    contentHint: 'motion',
    degradationPreference: 'balanced',
    frameRate: 30,
    maxBitrate: 12_000_000,
    startKbps: 4000,
  }),
});
export const DEFAULT_QUALITY = 'text';
const MIN_KBPS = 800;
const MAX_KBPS = 12000;

export function qualityName(name) {
  return Object.hasOwn(QUALITIES, name) ? name : DEFAULT_QUALITY;
}

// The video part of getDisplayMedia's options for a quality.
export function captureConstraints(name) {
  const {frameRate} = QUALITIES[qualityName(name)];
  return {frameRate: {ideal: frameRate, max: frameRate}, height: {max: MAX_HEIGHT}, width: {max: MAX_WIDTH}};
}

// Chrome and Edge start every stream near 300 kbit/s and climb slowly, so a
// share looks blocky for its first seconds. These Chromium-only settings, added
// to the TV's answer before this browser reads it, start it higher. Only the
// sending browser sees them; other browsers are left alone (see tuneBitrate).
export function boostVideoBitrate(sdp = '', {startKbps, minKbps = MIN_KBPS, maxKbps = MAX_KBPS} = {}) {
  if (!startKbps) {
    return sdp;
  }
  const extra = `x-google-start-bitrate=${startKbps};x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps}`;
  let inVideo = false;
  return sdp
    .split('\n')
    .map((line) => {
      if (line.startsWith('m=')) {
        inVideo = line.startsWith('m=video');
        return line;
      }
      // Retransmission (rtx) payloads carry "apt=" and have no bitrate of their own.
      const fmtp = /^(a=fmtp:\d+ )([^\r]*)(\r?)$/.exec(line);
      if (!inVideo || !fmtp || /\bapt=/.test(fmtp[2]) || fmtp[2].includes('x-google-start-bitrate')) {
        return line;
      }
      return `${fmtp[1]}${fmtp[2]};${extra}${fmtp[3]}`;
    })
    .join('\n');
}

function isChromium() {
  return /\bChrom(e|ium)\//.test(globalThis.navigator?.userAgent ?? '');
}
const CODE_ERRORS = new Set(['bad-code', 'code-locked', 'code-required']);
const TERMINAL_SHARE_STATES = new Set([
  'bad-code',
  'code-locked',
  'code-required',
  'declined',
  'failed',
  'no-receiver',
  'rate-limited',
  'receiver-left',
  'stopped',
]);

export function isTerminalShareState(state) {
  return TERMINAL_SHARE_STATES.has(state);
}

// One sender per page: it stays connected to signaling to discover TVs on the
// same network, and shares to one TV at a time.
//
// Share states reported through onStateChange:
//   offering → connecting → streaming
//   reconnecting (a live share dropped and is being offered again),
//   reconnect-code (it needs the TV's new code: call resume(code)),
//   and the terminal states in TERMINAL_SHARE_STATES.
// onSignalingChange(true|false) reports whether signaling is connected.
export class CastAirSender {
  constructor({
    signalingEndpoint = '',
    clientId = '',
    name = '',
    onStateChange = () => {},
    onReceivers = () => {},
    onSignalingChange = () => {},
    tuneBitrate = isChromium(),
  } = {}) {
    this.signalingEndpoint = signalingEndpoint.trim();
    this.clientId = clientId;
    this.name = name.trim();
    this.peerConfiguration = {...PEER_CONFIGURATION, iceServers: []};
    this.onStateChange = onStateChange;
    this.onReceivers = onReceivers;
    this.onSignalingChange = onSignalingChange;
    this.tuneBitrate = tuneBitrate;
    this.quality = DEFAULT_QUALITY;
    this.signalingSocket = null;
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.isClosed = false;
    this.resetShare();
  }

  resetShare() {
    this.resetPeer();
    clearTimeout(this.shareReconnectTimer);
    this.shareReconnectTimer = null;
    this.stream = null;
    this.sessionId = null;
    this.shareCode = undefined;
    this.wasLive = false;
    this.reconnectAttempt = 0;
    this.isAwaitingCode = false;
  }

  // Forgets the current peer connection but keeps the share (stream, TV, code).
  resetPeer() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.disconnectTimer);
    this.connectTimer = null;
    this.disconnectTimer = null;
    this.peerConnection?.close();
    this.peerConnection = null;
    this.videoTransceiver = null;
    this.pendingRemoteCandidates = [];
    this.pendingLocalCandidates = [];
    this.isOfferAcknowledged = false;
    this.lastOutboundSample = null;
  }

  // True from share() until the share ends, including while it reconnects.
  get isSharing() {
    return this.stream !== null;
  }

  connect() {
    if (!this.signalingEndpoint || !this.clientId) {
      return Promise.reject(new Error('A signaling endpoint and client id are required.'));
    }

    const signalingUrl = new URL(this.signalingEndpoint);
    signalingUrl.searchParams.set('role', 'sender');
    signalingUrl.searchParams.set('clientId', this.clientId);
    if (this.name) {
      signalingUrl.searchParams.set('name', this.name);
    }

    const socket = new WebSocket(String(signalingUrl));
    this.signalingSocket = socket;
    socket.addEventListener('message', (event) => this.handleSignal(event.data));
    socket.addEventListener('close', () => {
      clearInterval(this.keepaliveTimer);
      if (this.signalingSocket !== socket || this.isClosed) {
        return;
      }

      this.onSignalingChange(false);
      // A share in progress keeps flowing peer to peer, but only a connected
      // sender can be told that the TV left, so end shares that aren't live.
      if (this.isSharing && this.peerConnection?.connectionState !== 'connected') {
        if (this.wasLive) {
          // The reconnect waits for the server connection to come back.
          this.beginReconnect();
        } else {
          this.stopSharing('failed', 'Lost the connection to the CastAir server.');
        }
      }
      this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), RECONNECT_DELAY_MS);
    });

    return new Promise((resolve, reject) => {
      socket.addEventListener('open', () => {
        clearInterval(this.keepaliveTimer);
        this.keepaliveTimer = setInterval(() => this.sendSignal({type: 'ping'}), KEEPALIVE_INTERVAL_MS);
        this.onSignalingChange(true);
        resolve();
      });
      socket.addEventListener('error', () => reject(new Error('Could not reach the CastAir server.')));
    });
  }

  discover() {
    this.sendSignal({type: 'discover'});
  }

  async share(stream, sessionId, shareCode, quality = this.quality) {
    const code = normalizeSessionCode(sessionId);
    if (!code) {
      throw new Error('Pick a TV or enter its code.');
    }
    if (this.signalingSocket?.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to the CastAir server yet.');
    }
    if (this.isSharing) {
      this.stopSharing('stopped');
    }

    this.stream = stream;
    this.sessionId = code;
    this.shareCode = shareCode;
    this.quality = qualityName(quality);
    // The browser's "Stop sharing" button ends the video track.
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (this.stream === stream) {
          this.stopSharing('stopped');
        }
      });
    }
    await this.offer();
  }

  // Offers the held stream to the TV on a fresh peer connection: once when a
  // share starts, and again each time a live share drops.
  async offer() {
    this.resetPeer();
    const stream = this.stream;
    const peerConnection = new RTCPeerConnection(this.peerConfiguration);
    this.peerConnection = peerConnection;
    peerConnection.addEventListener('icecandidate', (event) => {
      if (this.peerConnection !== peerConnection) {
        return;
      }
      const message = {
        candidate: event.candidate ? event.candidate.toJSON() : null,
        type: 'ice',
      };
      // Hold candidates until the TV answers, so they always follow the offer.
      if (this.isOfferAcknowledged) {
        this.sendSignal(message);
      } else {
        this.pendingLocalCandidates.push(message);
      }
    });
    peerConnection.addEventListener('connectionstatechange', () => {
      if (this.peerConnection !== peerConnection) {
        return;
      }
      clearTimeout(this.disconnectTimer);
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        clearTimeout(this.connectTimer);
        this.wasLive = true;
        this.reconnectAttempt = 0;
        this.applyQuality();
        this.onStateChange('streaming');
      } else if (state === 'failed') {
        this.dropped('failed');
      } else if (state === 'disconnected' && this.wasLive) {
        this.disconnectTimer = setTimeout(() => {
          if (this.peerConnection === peerConnection && peerConnection.connectionState !== 'connected') {
            this.beginReconnect();
          }
        }, DISCONNECT_GRACE_MS);
      }
    });

    const quality = QUALITIES[this.quality];
    for (const track of stream.getTracks()) {
      // Sharp text or smooth motion for the screen (the quality choice), and
      // fidelity over speech processing for the sound.
      track.contentHint = track.kind === 'video' ? quality.contentHint : 'music';
      const transceiver = peerConnection.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
      });
      if (track.kind === 'video') {
        preferCodec(transceiver, PREFERRED_VIDEO_CODEC);
        this.videoTransceiver = transceiver;
      }
    }
    await this.applyQuality();

    await peerConnection.setLocalDescription(await peerConnection.createOffer());
    if (this.peerConnection !== peerConnection) {
      return;
    }
    this.progress('offering');
    this.sendSignal({
      ...(this.shareCode ? {code: this.shareCode} : {}),
      sdp: peerConnection.localDescription.sdp,
      sessionId: this.sessionId,
      type: 'offer',
    });
  }

  // offering and connecting, which read as "reconnecting" once a share has been live.
  progress(state) {
    this.onStateChange(this.wasLive ? 'reconnecting' : state);
  }

  // Applies the quality choice to the running share: frame rate and size on the
  // capture, bitrate and what to give up first on the encoder. Every step is
  // best effort; a browser that refuses one keeps its own default.
  async applyQuality() {
    const quality = QUALITIES[this.quality];
    for (const track of this.stream?.getVideoTracks() ?? []) {
      track.contentHint = quality.contentHint;
      // The whole set every time: applyConstraints replaces what was asked at capture,
      // so the frame rate alone would lift the 1080p limit.
      track.applyConstraints?.(captureConstraints(this.quality))?.catch?.(() => {});
    }
    const rtpSender = this.videoTransceiver?.sender;
    if (typeof rtpSender?.getParameters !== 'function') {
      return false;
    }
    try {
      const parameters = rtpSender.getParameters();
      if (!parameters.encodings?.length) {
        return false;
      }
      parameters.degradationPreference = quality.degradationPreference;
      for (const encoding of parameters.encodings) {
        encoding.maxBitrate = quality.maxBitrate;
        encoding.maxFramerate = quality.frameRate;
      }
      await rtpSender.setParameters(parameters);
      return true;
    } catch {
      return false;
    }
  }

  // Changes the quality, mid-share too.
  setQuality(name) {
    this.quality = qualityName(name);
    return this.isSharing ? this.applyQuality() : Promise.resolve(false);
  }

  // The connection failed or never completed: a share that was live tries
  // again, one that never got going ends.
  dropped(finalState, detail) {
    if (this.wasLive) {
      this.beginReconnect();
    } else {
      this.stopSharing(finalState, detail);
    }
  }

  beginReconnect() {
    if (!this.isSharing || this.isAwaitingCode) {
      return;
    }
    this.resetPeer();
    clearTimeout(this.shareReconnectTimer);
    const delay = SHARE_RECONNECT_DELAYS_MS[this.reconnectAttempt];
    if (delay === undefined) {
      this.stopSharing('failed', 'Lost the connection to the TV. Share again to carry on.');
      return;
    }
    this.reconnectAttempt += 1;
    this.onStateChange('reconnecting');
    this.shareReconnectTimer = setTimeout(() => {
      if (!this.isSharing) {
        return;
      }
      if (this.signalingSocket?.readyState !== WebSocket.OPEN) {
        // Still waiting for the CastAir server (a laptop just woken, say).
        this.beginReconnect();
        return;
      }
      this.offer().catch(() => this.beginReconnect());
    }, delay);
  }

  // The TV changed its code while the share was down: keep the captured
  // stream and wait for the person to type the new code.
  awaitCode(detail = RECONNECT_CODE_MESSAGE) {
    this.resetPeer();
    clearTimeout(this.shareReconnectTimer);
    this.isAwaitingCode = true;
    this.onStateChange('reconnect-code', detail);
  }

  // Carries on a share that stopped at reconnect-code, with the TV's new code.
  async resume(shareCode) {
    if (!this.isAwaitingCode) {
      return;
    }
    if (this.signalingSocket?.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to the CastAir server yet.');
    }
    this.isAwaitingCode = false;
    this.shareCode = shareCode;
    this.reconnectAttempt = 0;
    this.onStateChange('reconnecting');
    await this.offer();
  }

  async handleSignal(data) {
    try {
      const message = JSON.parse(data);

      if (message.type === 'receivers') {
        this.onReceivers(Array.isArray(message.receivers) ? message.receivers : []);
        return;
      }

      // Everything else concerns the current share; drop leftovers from a
      // previous TV.
      // …or from a connection this share has already given up on.
      if (!this.peerConnection || (message.sessionId && message.sessionId !== this.sessionId)) {
        return;
      }

      if (message.type === 'answer') {
        this.acknowledgeOffer();
      }

      if (message.type === 'answer' && message.sdp) {
        await this.setAnswer(message.sdp);
        this.progress('connecting');
        const peerConnection = this.peerConnection;
        this.connectTimer = setTimeout(() => {
          if (this.peerConnection === peerConnection && peerConnection.connectionState !== 'connected') {
            this.dropped('failed', 'The TV answered but the connection never completed.');
          }
        }, CONNECT_TIMEOUT_MS);
        const pending = this.pendingRemoteCandidates;
        this.pendingRemoteCandidates = [];
        for (const candidate of pending) {
          await this.peerConnection.addIceCandidate(candidate);
        }
      } else if (message.type === 'ice') {
        const candidate = Object.hasOwn(message, 'candidate') ? message.candidate : null;
        // Relayed messages can overtake the answer, so hold candidates until then.
        if (this.peerConnection.remoteDescription) {
          await this.peerConnection.addIceCandidate(candidate);
        } else {
          this.pendingRemoteCandidates.push(candidate);
        }
      } else if (message.type === 'decline' && message.reason === 'ended') {
        this.stopSharing('receiver-left');
      } else if (message.type === 'decline') {
        this.stopSharing(
          'declined',
          message.reason === 'busy' ? 'The TV is busy with another request. Try again in a moment.' : undefined,
        );
      } else if (message.type === 'error' && message.reason === 'no-peer') {
        // Mid-reconnect the TV may still be finding the server again itself.
        this.dropped('no-receiver');
      } else if (message.type === 'error' && this.wasLive && CODE_ERRORS.has(message.reason)) {
        // The code typed at the start has changed since (it does every 10 minutes).
        this.awaitCode(message.reason === 'code-locked' ? CODE_LOCKED_MESSAGE : undefined);
      } else if (message.type === 'error' && message.reason === 'code-required') {
        this.stopSharing('code-required');
      } else if (message.type === 'error' && message.reason === 'bad-code') {
        this.stopSharing('bad-code', WRONG_CODE_MESSAGE);
      } else if (message.type === 'error' && message.reason === 'code-locked') {
        this.stopSharing('code-locked', CODE_LOCKED_MESSAGE);
      } else if (message.type === 'error' && message.reason === 'rate-limited') {
        this.stopSharing('rate-limited');
      } else if (message.type === 'peer-left') {
        this.stopSharing('receiver-left');
      }
    } catch (error) {
      this.onStateChange('error', error.message);
    }
  }

  // Reads the TV's answer, with a higher starting bitrate where the browser
  // understands the request; the plain answer if it objects.
  async setAnswer(sdp) {
    const peerConnection = this.peerConnection;
    if (this.tuneBitrate) {
      const tuned = boostVideoBitrate(sdp, {startKbps: QUALITIES[this.quality].startKbps});
      try {
        await peerConnection.setRemoteDescription({sdp: tuned, type: 'answer'});
        return;
      } catch {
        // Fall through to the answer as the TV sent it.
      }
    }
    await peerConnection.setRemoteDescription({sdp, type: 'answer'});
  }

  acknowledgeOffer() {
    if (this.isOfferAcknowledged) {
      return;
    }
    this.isOfferAcknowledged = true;
    for (const message of this.pendingLocalCandidates.splice(0)) {
      this.sendSignal(message);
    }
  }

  sendSignal(message) {
    if (this.signalingSocket?.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(message));
    }
  }

  // Summarizes the selected ICE path and outgoing media, for showing whether
  // media flows directly over the LAN.
  async describeConnection() {
    if (!this.peerConnection) {
      return null;
    }

    const stats = await this.peerConnection.getStats();
    const entries = [...stats.values()];
    const transport = entries.find((entry) => entry.type === 'transport');
    const pair =
      stats.get(transport?.selectedCandidatePairId) ??
      entries.find((entry) => entry.type === 'candidate-pair' && entry.nominated && entry.state === 'succeeded');
    const local = pair && stats.get(pair.localCandidateId);
    const remote = pair && stats.get(pair.remoteCandidateId);
    const video = entries.find((entry) => entry.type === 'outbound-rtp' && entry.kind === 'video');
    const audio = entries.find((entry) => entry.type === 'outbound-rtp' && entry.kind === 'audio');

    let bitrateKbps = null;
    if (video && this.lastOutboundSample) {
      const seconds = (video.timestamp - this.lastOutboundSample.timestamp) / 1000;
      if (seconds > 0) {
        bitrateKbps = Math.round(((video.bytesSent - this.lastOutboundSample.bytesSent) * 8) / seconds / 1000);
      }
    }
    if (video) {
      this.lastOutboundSample = {bytesSent: video.bytesSent, timestamp: video.timestamp};
    }

    return {
      audioCodec: audio ? (stats.get(audio.codecId)?.mimeType ?? null) : null,
      bitrateKbps,
      codec: video ? (stats.get(video.codecId)?.mimeType ?? null) : null,
      framesPerSecond: video?.framesPerSecond ?? null,
      hasAudio: this.stream.getAudioTracks().length > 0,
      height: video?.frameHeight ?? null,
      localCandidate: local ? describeCandidate(local) : null,
      qualityLimitation: video?.qualityLimitationReason ?? null,
      remoteCandidate: remote ? describeCandidate(remote) : null,
      width: video?.frameWidth ?? null,
    };
  }

  stopSharing(finalState = 'stopped', detail) {
    if (!this.isSharing) {
      return;
    }

    // Tell the TV straight away; it would otherwise keep the last frame up
    // until the WebRTC connection times out.
    this.sendSignal({type: 'bye'});

    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.resetShare();
    this.onStateChange(finalState, detail);
  }

  close() {
    this.stopSharing('stopped');
    this.isClosed = true;
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.reconnectTimer);
    this.signalingSocket?.close();
  }
}

function describeCandidate(candidate) {
  return {
    address: candidate.address ?? candidate.ip ?? null,
    port: candidate.port ?? null,
    protocol: candidate.protocol ?? null,
    type: candidate.candidateType ?? null,
  };
}

export function preferCodec(transceiver, mimeType) {
  const capabilities = globalThis.RTCRtpReceiver?.getCapabilities?.('video');
  if (!capabilities || typeof transceiver.setCodecPreferences !== 'function') {
    return false;
  }

  const wanted = mimeType.toLowerCase();
  const preferred = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === wanted);
  if (preferred.length === 0) {
    return false;
  }

  try {
    transceiver.setCodecPreferences([
      ...preferred,
      ...capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== wanted),
    ]);
    return true;
  } catch {
    return false;
  }
}
