// Share codes: a 4-digit code per TV that a laptop must type to share to it.
// The code changes every 10 minutes and whenever a share ends; the previous
// code stays valid for 60 s so someone mid-typing isn't caught out. Five wrong
// codes for one TV from one network lock that network out of that TV for 60 s.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {randomInt} from 'node:crypto';

const ROTATE_MS = 10 * 60 * 1000;
const GRACE_MS = 60 * 1000;
const LOCK_MS = 60 * 1000;
const MAX_BAD = 5;
// A broken injected source could repeat forever; crypto's never will in practice.
const MAX_DRAWS = 100;

/**
 * Codes come from crypto `randomInt(10000)` unless a test injects `digits` (integer) or `random` ([0, 1)).
 * `check` answers 'ok', 'bad' or 'locked' for a code typed from network `net`.
 */
export function createCodes({now = () => Date.now(), random, digits} = {}) {
  // `digits` returns an integer 0-9999 (the default is exact: crypto randomInt). `random` is the
  // test-friendly alternative in [0, 1); a float round trip, so only for tests.
  const draw = digits ?? (random ? () => Math.floor(random() * 10000) : () => randomInt(10000));
  const sessions = new Map(); // sessionId → {code, issuedAt, previous, previousUntil}
  const attempts = new Map(); // `${sessionId}|${net}` → {bad: [timestamps], lockedUntil}

  const attemptKey = (sessionId, net) => `${sessionId}|${net}`;

  return {
    // A new code, never the one the TV shows now (a "change" must change it).
    issue(sessionId) {
      const t = now();
      const old = sessions.get(sessionId);
      let code = String(draw()).padStart(4, '0');
      for (let i = 1; i < MAX_DRAWS && code === old?.code; i++) {
        code = String(draw()).padStart(4, '0');
      }
      sessions.set(sessionId, {
        code,
        issuedAt: t,
        previous: old?.code ?? null,
        previousUntil: t + GRACE_MS,
      });
      return code;
    },

    // The code the TV shows, or null.
    current(sessionId) {
      return sessions.get(sessionId)?.code ?? null;
    },

    due(sessionId) {
      const s = sessions.get(sessionId);
      return Boolean(s) && now() - s.issuedAt >= ROTATE_MS;
    },

    check(sessionId, net, code) {
      const t = now();
      const key = attemptKey(sessionId, net);
      const record = attempts.get(key) ?? {bad: [], lockedUntil: 0};
      if (t < record.lockedUntil) {
        return 'locked';
      }
      const s = sessions.get(sessionId);
      const typed = String(code ?? '');
      if (s && (typed === s.code || (s.previous !== null && t < s.previousUntil && typed === s.previous))) {
        attempts.delete(key);
        return 'ok';
      }
      record.bad = [...record.bad.filter((x) => t - x < LOCK_MS), t];
      if (record.bad.length >= MAX_BAD) {
        record.bad = [];
        record.lockedUntil = t + LOCK_MS;
      }
      attempts.set(key, record);
      return 'bad';
    },

    // Drops wrong-code records that can no longer count towards a lockout or lock anyone out.
    prune() {
      const t = now();
      for (const [key, record] of attempts) {
        if (t >= record.lockedUntil && record.bad.every((x) => t - x >= LOCK_MS)) {
          attempts.delete(key);
        }
      }
    },

    // How many network/TV wrong-code records are held (for tests).
    remembered() {
      return attempts.size;
    },

    forget(sessionId) {
      sessions.delete(sessionId);
      for (const key of attempts.keys()) {
        if (key.startsWith(`${sessionId}|`)) {
          attempts.delete(key);
        }
      }
    },
  };
}
