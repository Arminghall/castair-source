/*
 * KeepAwake: holds off Vega's screensaver (ambient mode) while the idle
 * screen waits for a sender. Vega has no keep-awake API; only active media
 * playback does it, so this loops a 2-second silent clip (assets/raw) through
 * the OS player in URL mode, which loops internally at almost no CPU cost.
 *
 * The TV can take audio focus away from the loop for good: a browser share
 * with sound does, the moment it starts. The loop then stays stopped until it
 * is started again, so this starts it again: when that share ends, or after a
 * short wait when nothing is sharing. Without that the screensaver took over
 * five minutes after any share with sound.
 *
 * Copyright (C) 2026 Parker Wahle
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {AudioPlayer} from '@amazon-devices/react-native-w3cmedia';

const SILENCE_URL = 'file:///pkg/assets/raw/silence.mp4';
// How long to wait before taking audio focus back when nothing is sharing.
const RETRY_MS = 10_000;

type Log = (msg: string) => void;

export class KeepAwake {
  private player: AudioPlayer | null = null;
  private wanted = false;
  private starting = false;
  // The TV took audio focus from the current player, which stopped it.
  private lost = false;
  // A browser share is running: its sound is what took the focus, so wait.
  private sharing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly log: Log) {}

  /** Idempotent: call with true while idle, false once a sender connects. */
  set(on: boolean): void {
    this.wanted = on;
    if (on) {
      this.start().catch((e) => this.log(`keep-awake failed: ${String(e)}`));
    } else {
      this.stop();
    }
  }

  /**
   * A browser share started (true) or ended (false). While one runs, the loop
   * is left alone if it lost focus: starting it would take the sound away from
   * the share, and the share's own sound holds the screensaver off.
   */
  yieldToShare(sharing: boolean): void {
    this.sharing = sharing;
    if (sharing) {
      this.cancelRetry();
    } else {
      this.resume();
    }
  }

  /** Starts the loop again if it lost focus (a share ended, or the app is back on screen). */
  resume(): void {
    if (this.wanted && this.lost && !this.sharing) {
      this.log('keep-awake starting again');
      this.stop();
      this.start().catch((e) => this.log(`keep-awake failed: ${String(e)}`));
    }
  }

  private async start(): Promise<void> {
    if (this.player || this.starting) {
      return;
    }
    this.starting = true;
    try {
      const ap = new AudioPlayer();
      await ap.initialize();
      if (!this.wanted) {
        ap.deinitialize();
        return;
      }
      ap.addEventListener('error', () => this.log(`keep-awake player error ${JSON.stringify(ap.error)}`));
      ap.addEventListener('audiofocuslost', () => this.onFocusLost(ap));
      ap.loop = true;
      ap.src = SILENCE_URL;
      ap.play();
      this.player = ap;
      this.log('keep-awake on');
    } finally {
      this.starting = false;
    }
  }

  private onFocusLost(ap: AudioPlayer): void {
    if (this.player !== ap) {
      return; // a late event from a player already replaced
    }
    this.lost = true;
    this.log(`keep-awake lost audio focus${this.sharing ? ' to a share' : ''}`);
    if (!this.sharing) {
      this.cancelRetry();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.resume();
      }, RETRY_MS);
    }
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private stop(): void {
    this.cancelRetry();
    this.lost = false;
    const ap = this.player;
    this.player = null;
    if (ap) {
      ap.pause();
      ap.deinitialize();
      this.log('keep-awake off');
    }
  }
}
