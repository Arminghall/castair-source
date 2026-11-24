/*
 * Telemetry: local logging only. CastAir sends nothing off the device; these
 * keep upstream's function names so the rest of the app is unchanged, and
 * the log lines reach `loggingctl log -f` through console.
 *
 * Copyright (C) 2026 Parker Wahle
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type {NativeVideoState, ReceiverEvent} from 'castair-native';

/** App-side messages, to the device log (first line only). */
export function log(msg: string): void {
  console.log(`CASTAIR ${msg}`);
}

/** Something wrong but recoverable. */
export function warn(msg: string, extra?: Record<string, unknown>): void {
  console.warn(`CASTAIR ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
}

/** Counted occurrences: not recorded. */
export function countEvent(_name: string): void {}

/** Receiver events: logged when they're errors, otherwise ignored. */
export function receiverEvent(e: ReceiverEvent): void {
  if (e.type === 'error') {
    warn(`receiver error: ${JSON.stringify(e)}`);
  }
}

/** An MSE player's buffer and frame counts (MirrorPlayer). */
export type PlayerMetrics = {
  aheadMs: number;
  behindMs: number;
  queue: number;
  totalFrames: number;
  droppedFrames: number;
};

/** Playback statistics: not recorded. */
export function receiverStats(
  _s: Record<string, unknown>,
  _video: PlayerMetrics | null,
  _audio: PlayerMetrics | null,
  _av: {offsetMs: number; delayMs: number},
  _native: NativeVideoState | null = null,
): void {}

/** Kept for upstream compatibility: nothing to reset. */
export function resetStats(): void {}

/** Kept for upstream compatibility: there's no unlock to record. */
export function setPremium(_owned: boolean): void {}

/** Kept for upstream compatibility: there's no session to end. */
export function streamEnd(_reason: 'disconnected' | 'app_closed'): void {}
