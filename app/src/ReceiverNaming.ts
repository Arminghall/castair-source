/*
 * ReceiverNaming: starts the receiver under a name and moves it to a new
 * one when the Fire TV is renamed. A rename that arrives while someone is
 * mirroring waits for the session to end; a failed start leaves no name
 * recorded, so the same name can be tried again.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

type Receiver = {start(name: string): boolean; stop(): void};

export class ReceiverNaming {
  private current: string | null = null;
  private pending: string | null = null;
  private started = false;
  private connected = false;
  private closed = false;

  constructor(
    private readonly receiver: Receiver,
    private readonly log: (msg: string) => void,
  ) {}

  /** Whether start() has been called. */
  get isStarted(): boolean {
    return this.started;
  }

  /** Starts the receiver; once started, the same as rename(). */
  start(name: string): void {
    if (this.started) {
      this.rename(name);
      return;
    }
    this.started = true;
    this.launch(name);
  }

  /** Moves the receiver to `name`, now or when the current session ends. */
  rename(name: string): void {
    if (this.closed || !this.started || name === this.current) {
      return;
    }
    if (this.connected) {
      this.pending = name;
      return;
    }
    this.pending = null;
    if (this.current !== null) {
      this.receiver.stop();
    }
    this.launch(name);
  }

  /** Drops every AirPlay session by restarting under the current name. */
  restart(): void {
    if (this.closed || this.current === null) {
      return;
    }
    const name = this.pending ?? this.current;
    this.pending = null;
    this.connected = false;
    this.receiver.stop();
    this.launch(name);
  }

  /** The number of connected senders; a pending rename runs at zero. */
  setConnections(n: number): void {
    this.connected = n > 0;
    if (!this.connected && this.pending !== null) {
      this.rename(this.pending);
    }
  }

  /** Stops acting on later renames. */
  close(): void {
    this.closed = true;
  }

  private launch(name: string): void {
    if (this.closed) {
      return;
    }
    const ok = this.receiver.start(name);
    this.log(`start(${name}) -> ${ok}`);
    this.current = ok ? name : null;
  }
}
