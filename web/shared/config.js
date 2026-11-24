// Shared WebRTC helpers for the sharing page and the TV receiver page.
// Adapted from Tandem (github.com/kevinl95/Tandem), Apache-2.0; see
// third_party_notices/TANDEM-LICENSE. Changes: Copyright (C) 2026 Arminghall;
// CastAir is LAN-only, so there are never any STUN or TURN servers.
//
// SPDX-License-Identifier: AGPL-3.0-or-later AND Apache-2.0

const HOST_CANDIDATE_PATTERN = /\btyp host\b/;
// No 0/O or 1/I, so codes read cleanly off a TV screen.
const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_CODE_LENGTH = 6;

export function generateSessionCode(getRandomValues = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = getRandomValues(new Uint8Array(SESSION_CODE_LENGTH));
  // 256 is a multiple of the 32-letter alphabet, so modulo is unbiased.
  return Array.from(bytes, (byte) => SESSION_CODE_ALPHABET[byte % SESSION_CODE_ALPHABET.length]).join('');
}

// WebRTC sends mono Opus unless the receiving side's SDP asks for stereo, so
// the receiver adds stereo and a music-grade bitrate to its answer.
const OPUS_STEREO_PARAMS = {maxaveragebitrate: '128000', 'sprop-stereo': '1', stereo: '1'};

export function enableStereoOpus(sdp = '') {
  const opusPayloadTypes = [...sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/gim)].map(
    ([, payloadType]) => payloadType,
  );

  return opusPayloadTypes.reduce((updated, payloadType) => {
    const fmtpPattern = new RegExp(`^(a=fmtp:${payloadType} )(.*?)(\\r?)$`, 'm');
    return updated.replace(fmtpPattern, (_, prefix, params, carriageReturn) => {
      const merged = new Map(
        params
          .split(';')
          .filter(Boolean)
          .map((param) => {
            const [key, value = ''] = param.split('=');
            return [key.trim(), value.trim()];
          }),
      );
      for (const [key, value] of Object.entries(OPUS_STEREO_PARAMS)) {
        merged.set(key, value);
      }
      const joined = [...merged].map(([key, value]) => `${key}=${value}`).join(';');
      return `${prefix}${joined}${carriageReturn}`;
    });
  }, sdp);
}

export function normalizeSessionCode(code = '') {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

// Video stays on the local network: host candidates only, no STUN or TURN.
export const PEER_CONFIGURATION = Object.freeze({
  bundlePolicy: 'balanced',
  iceCandidatePoolSize: 0,
  iceServers: [],
  iceTransportPolicy: 'all',
  rtcpMuxPolicy: 'require',
});

export function isHostIceCandidate(candidateLine = '') {
  return HOST_CANDIDATE_PATTERN.test(candidateLine);
}

export function prioritizeIceCandidates(candidates = []) {
  return [...candidates].sort((left, right) => {
    const leftPriority = isHostIceCandidate(left?.candidate) ? 0 : 1;
    const rightPriority = isHostIceCandidate(right?.candidate) ? 0 : 1;
    return leftPriority - rightPriority;
  });
}
