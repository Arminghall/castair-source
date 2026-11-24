// CastAir TV receiver: accepts browser shares from laptops over WebRTC.
// Adapted from Tandem's src/receiver/receiver.js (github.com/kevinl95/Tandem),
// Apache-2.0; see third_party_notices/TANDEM-LICENSE. Changes: Copyright (C)
// 2026 Arminghall: no approval step (every allowed laptop is accepted, and a
// newcomer takes over), a "busy" mode, renames, LAN-only, 30 s keep-alive.
//
// SPDX-License-Identifier: AGPL-3.0-or-later AND Apache-2.0
import {PEER_CONFIGURATION, enableStereoOpus, prioritizeIceCandidates} from '../shared/config.js';

// The CastAir server drops connections silent for 120 s.
const KEEPALIVE_INTERVAL_MS = 30 * 1000;
// Reconnect quickly after a blip, then back off.
const RECONNECT_DELAY_MS = 3000;
// One TV talking to CastAir's own server: keep retries frequent, so a
// redeploy or blip never leaves the TV unlisted for long.
const MAX_RECONNECT_DELAY_MS = 15 * 1000;
// How long a dropped share may take to come back before the TV gives up.
const DISCONNECT_GRACE_MS = 8 * 1000;
// An accepted sender that hasn't connected this long after the answer has failed.
const CONNECT_TIMEOUT_MS = 30000;
// Bounds for ICE candidates held for senders the TV hasn't accepted yet.
const MAX_BUFFERED_CANDIDATES_PER_SENDER = 64;
const MAX_BUFFERED_SENDERS = 8;

function isEndOfCandidates(candidate) {
  return candidate == null || candidate.candidate === '';
}

// Receiver states reported through onStateChange:
//   signaling-connecting → waiting → connecting → streaming
//   signaling-closed while the socket reconnects, error for failed signals.
// onShareChange(true, senderName) when a share's media is connected, and
// onShareChange(false) when it ends.
export class CastAirReceiver {
  constructor(videoElement, options = {}) {
    if (!videoElement) {
      throw new Error('A target video element is required.');
    }

    this.videoElement = videoElement;
    this.runtimeConfig = {
      peerConfiguration: {...PEER_CONFIGURATION, iceServers: []},
      sessionId: (options.sessionId ?? '').trim(),
      signalingEndpoint: (options.signalingEndpoint ?? '').trim(),
    };
    this.receiverName = options.receiverName ?? '';
    this.receiverSecret = options.receiverSecret ?? '';
    this.onStateChange = options.onStateChange ?? (() => {});
    this.onShareChange = options.onShareChange ?? (() => {});
    this.onCode = options.onCode ?? (() => {});
    // Whether laptops must type a code to share here; the app's Settings switch.
    this.codeRequired = options.codeRequired ?? true;
    this.isBusy = false;
    this.activeSenderName = null;
    this.isShareLive = false;
    this.isDisposed = false;
    this.isFlushingRemoteCandidates = false;
    this.bufferedCandidates = new Map();
    this.activeSenderId = null;
    this.peerConnection = null;
    this.signalingSocket = null;
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.reconnectDelay = RECONNECT_DELAY_MS;
    this.isPaused = false;
    this.connectTimer = null;
  }

  connectSignaling() {
    if (!this.runtimeConfig.signalingEndpoint || !this.runtimeConfig.sessionId) {
      return null;
    }

    this.isPaused = false;
    clearTimeout(this.reconnectTimer);
    if (this.signalingSocket && this.signalingSocket.readyState !== WebSocket.CLOSED) {
      return this.signalingSocket;
    }

    const signalingUrl = new URL(this.runtimeConfig.signalingEndpoint);
    signalingUrl.searchParams.set('sessionId', this.runtimeConfig.sessionId);
    signalingUrl.searchParams.set('role', 'receiver');
    // Proves this TV owns its code, so another device can't pose as it.
    signalingUrl.searchParams.set('receiverSecret', this.receiverSecret);
    // So the server asks for the code from the first moment, before the settings message.
    signalingUrl.searchParams.set('codeRequired', this.codeRequired ? '1' : '0');
    if (this.receiverName) {
      signalingUrl.searchParams.set('name', this.receiverName);
    }

    const socket = new WebSocket(String(signalingUrl));
    this.signalingSocket = socket;
    this.onStateChange('signaling-connecting');

    socket.addEventListener('open', () => {
      // First thing on every (re)connect, before the server pairs anyone.
      this.sendSettings();
      this.reconnectDelay = RECONNECT_DELAY_MS;
      this.onStateChange(this.peerConnection ? 'streaming' : 'waiting');
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = setInterval(() => this.sendSignal({type: 'ping'}), KEEPALIVE_INTERVAL_MS);
    });
    socket.addEventListener('close', () => {
      if (this.signalingSocket !== socket || this.isDisposed || this.isPaused) {
        return;
      }

      clearInterval(this.keepaliveTimer);
      // The code belonged to that connection; the server sends a fresh one on reconnect.
      this.onCode(null);
      this.onStateChange('signaling-closed');
      this.reconnectTimer = setTimeout(() => this.connectSignaling(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    });
    socket.addEventListener('message', (event) => this.handleSignal(event.data));

    return socket;
  }

  // Disconnects from signaling until connectSignaling() is called again (the
  // app left the screen).
  pauseSignaling() {
    this.isPaused = true;
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.reconnectTimer);
    this.signalingSocket?.close();
    this.signalingSocket = null;
    this.onCode(null);
    this.onStateChange('paused');
  }

  async handleSignal(data) {
    try {
      const message = JSON.parse(data);

      if (message.type === 'offer' && message.sdp) {
        await this.handleOffer(message);
      } else if (message.type === 'ice') {
        await this.addIceCandidate(
          Object.hasOwn(message, 'candidate') ? message.candidate : null,
          message.senderId ?? null,
        );
      } else if (message.type === 'peer-left') {
        this.handleSenderLeft(message.senderId ?? null);
      } else if (message.type === 'code') {
        this.onCode(typeof message.code === 'string' ? message.code : null);
      }
    } catch (error) {
      this.onStateChange('error', error.message);
    }
  }

  // The name the TV is listed under; also used when reconnecting.
  setName(name) {
    this.receiverName = name;
    this.sendSignal({type: 'rename', name});
  }

  sendSettings() {
    this.sendSignal({type: 'settings', codeRequired: this.codeRequired});
  }

  // Tells the server whether laptops need the code; sent now if connected, and
  // again on every reconnect.
  setCodeRequired(on) {
    this.codeRequired = Boolean(on);
    this.sendSettings();
  }

  // While busy (AirPlay on screen, in the fallback where the two can't
  // coexist), every offer is declined with reason "busy".
  setBusy(on) {
    this.isBusy = Boolean(on);
  }

  async handleOffer({sdp, senderId = null, senderName = 'A laptop'}) {
    if (this.isBusy) {
      this.bufferedCandidates.delete(senderId);
      this.sendSignal({type: 'decline', to: senderId, reason: 'busy'});
      return;
    }

    // Every allowed laptop is accepted; a newcomer takes over (B7).
    this.activeSenderName = senderName;
    const answer = await this.acceptOffer({sdp, senderId});
    this.sendSignal({...answer, to: senderId, type: 'answer'});
  }

  handleSenderLeft(senderId) {
    this.bufferedCandidates.delete(senderId);

    if (senderId === this.activeSenderId) {
      this.resetPeerConnection();
      this.onStateChange('waiting');
    }
  }

  // Summarizes the incoming video, for diagnosing senders whose encoders
  // produce corrupt frames: decode errors show up as dropped frames, repeated
  // keyframe requests (PLI) and retransmissions (NACK).
  async describeInbound() {
    if (!this.peerConnection) {
      return null;
    }

    const stats = await this.peerConnection.getStats();
    const video = [...stats.values()].find((entry) => entry.type === 'inbound-rtp' && entry.kind === 'video');
    if (!video) {
      return null;
    }

    return {
      codec: stats.get(video.codecId)?.mimeType ?? null,
      decoder: video.decoderImplementation ?? null,
      framesDecoded: video.framesDecoded ?? null,
      framesDropped: video.framesDropped ?? null,
      framesPerSecond: video.framesPerSecond ?? null,
      height: video.frameHeight ?? null,
      keyFramesDecoded: video.keyFramesDecoded ?? null,
      nackCount: video.nackCount ?? null,
      packetsLost: video.packetsLost ?? null,
      pliCount: video.pliCount ?? null,
      width: video.frameWidth ?? null,
    };
  }

  get hasShare() {
    return this.peerConnection !== null;
  }

  // Ends the current share from the TV side (Back, or the app leaving the
  // screen) and tells the sender, so it stops capturing right away.
  endShare() {
    if (!this.peerConnection) {
      return false;
    }

    this.sendSignal({reason: 'ended', to: this.activeSenderId, type: 'decline'});
    this.resetPeerConnection();
    this.onStateChange('waiting');
    return true;
  }

  sendSignal(message) {
    if (this.signalingSocket?.readyState === WebSocket.OPEN) {
      this.signalingSocket.send(JSON.stringify(message));
    }
  }

  resetPeerConnection() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.disconnectTimer);
    if (this.isShareLive) {
      this.isShareLive = false;
      this.onShareChange(false);
    }
    this.peerConnection?.close();
    this.peerConnection = null;
    this.activeSenderId = null;
    this.videoElement.srcObject = null;
  }

  createPeerConnection(senderId) {
    this.resetPeerConnection();

    const peerConnection = new RTCPeerConnection(this.runtimeConfig.peerConfiguration);
    this.peerConnection = peerConnection;
    this.activeSenderId = senderId;

    peerConnection.addEventListener('track', (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.videoElement.srcObject = stream;
      }
    });
    peerConnection.addEventListener('icecandidate', (event) => {
      this.sendSignal({
        candidate: event.candidate ? event.candidate.toJSON() : null,
        to: senderId,
        type: 'ice',
      });
    });
    peerConnection.addEventListener('connectionstatechange', () => {
      if (this.peerConnection !== peerConnection) {
        return;
      }

      // "disconnected" is often transient (a Wi-Fi blip), so give it
      // DISCONNECT_GRACE_MS to come back; a lid closed mid-share never does,
      // and "failed" can take 30 s or more to arrive.
      clearTimeout(this.disconnectTimer);
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        clearTimeout(this.connectTimer);
        this.onStateChange('streaming');
        if (!this.isShareLive) {
          this.isShareLive = true;
          this.onShareChange(true, this.activeSenderName);
        }
      } else if (state === 'disconnected') {
        this.disconnectTimer = setTimeout(() => {
          if (this.peerConnection === peerConnection && peerConnection.connectionState !== 'connected') {
            this.resetPeerConnection();
            this.onStateChange('waiting', 'The sender stopped responding.');
          }
        }, DISCONNECT_GRACE_MS);
      } else if (state === 'failed' || state === 'closed') {
        this.resetPeerConnection();
        this.onStateChange('waiting', state === 'failed' ? 'The connection to the sender failed.' : undefined);
      }
    });

    return peerConnection;
  }

  // Each accepted offer starts a fresh peer connection, so a new sender can
  // take over after the previous one leaves or fails.
  async acceptOffer({sdp, senderId = null, type = 'offer'}) {
    const peerConnection = this.createPeerConnection(senderId);
    this.onStateChange('connecting');

    await peerConnection.setRemoteDescription({sdp, type});
    const createdAnswer = await peerConnection.createAnswer();
    // Chrome may return a read-only RTCSessionDescription, so copy it.
    const answer = {sdp: enableStereoOpus(createdAnswer.sdp), type: createdAnswer.type};
    await peerConnection.setLocalDescription(answer);
    await this.flushPendingIceCandidates();

    this.connectTimer = setTimeout(() => {
      if (this.peerConnection === peerConnection && peerConnection.connectionState !== 'connected') {
        this.resetPeerConnection();
        this.onStateChange('waiting', 'The connection to the sender timed out.');
      }
    }, CONNECT_TIMEOUT_MS);

    return {
      sdp: peerConnection.localDescription?.sdp ?? answer.sdp,
      type: peerConnection.localDescription?.type ?? answer.type,
    };
  }

  // ICE candidates can arrive before the offer they belong to is accepted.
  async addIceCandidate(candidate, senderId = null) {
    const isForReadyConnection =
      senderId === this.activeSenderId && this.peerConnection?.remoteDescription && !this.isFlushingRemoteCandidates;

    if (isForReadyConnection) {
      await this.applyIceCandidate(candidate);
      return;
    }

    this.bufferCandidate(senderId, candidate);
  }

  bufferCandidate(senderId, candidate) {
    if (!this.bufferedCandidates.has(senderId)) {
      if (this.bufferedCandidates.size >= MAX_BUFFERED_SENDERS) {
        const [oldest] = this.bufferedCandidates.keys();
        this.bufferedCandidates.delete(oldest);
      }
      this.bufferedCandidates.set(senderId, []);
    }

    const queue = this.bufferedCandidates.get(senderId);
    if (queue.length < MAX_BUFFERED_CANDIDATES_PER_SENDER) {
      queue.push(candidate);
    }
  }

  async applyIceCandidate(candidate) {
    try {
      await this.peerConnection.addIceCandidate(candidate);
    } catch (error) {
      // Late candidates from a previous sender no longer match the session.
      console.warn(`Ignoring ICE candidate: ${error.message}`);
    }
  }

  async flushPendingIceCandidates() {
    const senderId = this.activeSenderId;
    let sawEndOfCandidates = false;
    let endOfCandidates = null;
    this.isFlushingRemoteCandidates = true;

    try {
      // Candidates can keep arriving while earlier ones are applied.
      while (this.bufferedCandidates.get(senderId)?.length) {
        const queued = this.bufferedCandidates.get(senderId);
        this.bufferedCandidates.delete(senderId);

        const endMarkerIndex = queued.findIndex(isEndOfCandidates);
        if (!sawEndOfCandidates && endMarkerIndex !== -1) {
          sawEndOfCandidates = true;
          endOfCandidates = queued[endMarkerIndex];
        }
        for (const candidate of prioritizeIceCandidates(queued.filter((candidate) => !isEndOfCandidates(candidate)))) {
          await this.applyIceCandidate(candidate);
        }
      }

      if (sawEndOfCandidates) {
        await this.applyIceCandidate(endOfCandidates);
      }
    } finally {
      this.isFlushingRemoteCandidates = false;
    }
  }

  dispose() {
    this.isDisposed = true;
    clearInterval(this.keepaliveTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);

    if (this.signalingSocket) {
      this.signalingSocket.close();
      this.signalingSocket = null;
    }

    this.resetPeerConnection();
  }
}
