/*
 * The silent loop that holds off the Fire TV's screensaver, and how it comes
 * back after the TV takes audio focus away from it.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {KeepAwake} from '../src/KeepAwake';

type Listener = () => void;

class MockAudioPlayer {
  static made: MockAudioPlayer[] = [];
  listeners = new Map<string, Listener[]>();
  loop = false;
  src = '';
  error: unknown = null;
  initialize = jest.fn(async () => undefined);
  play = jest.fn();
  pause = jest.fn();
  deinitialize = jest.fn();

  constructor() {
    MockAudioPlayer.made.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  AudioPlayer: jest.fn(() => new MockAudioPlayer()),
}));

// Lets start()'s awaits finish.
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

async function started() {
  const log = jest.fn();
  const keepAwake = new KeepAwake(log);
  keepAwake.set(true);
  await settle();
  return {keepAwake, log, first: MockAudioPlayer.made[0]};
}

beforeEach(() => {
  MockAudioPlayer.made = [];
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('plays the silent clip on a loop', async () => {
  const {first} = await started();

  expect(MockAudioPlayer.made).toHaveLength(1);
  expect(first.loop).toBe(true);
  expect(first.src).toContain('silence.mp4');
  expect(first.play).toHaveBeenCalledTimes(1);
});

it("waits while a browser share has the TV's sound, then starts again when it ends", async () => {
  const {keepAwake, first} = await started();

  keepAwake.yieldToShare(true);
  first.emit('audiofocuslost'); // the share's sound took audio focus
  jest.advanceTimersByTime(60_000);
  await settle();
  // Starting again now would take the sound away from the share.
  expect(MockAudioPlayer.made).toHaveLength(1);

  keepAwake.yieldToShare(false);
  await settle();

  expect(first.deinitialize).toHaveBeenCalledTimes(1);
  expect(MockAudioPlayer.made).toHaveLength(2);
  expect(MockAudioPlayer.made[1].play).toHaveBeenCalledTimes(1);
});

it('leaves a loop that kept its audio focus alone when a share ends', async () => {
  const {keepAwake, first} = await started();

  keepAwake.yieldToShare(true); // a share with no sound never takes focus
  keepAwake.yieldToShare(false);
  await settle();

  expect(first.deinitialize).not.toHaveBeenCalled();
  expect(MockAudioPlayer.made).toHaveLength(1);
});

it('tries again by itself when focus is lost with nothing sharing', async () => {
  const {first} = await started();

  first.emit('audiofocuslost');
  await settle();
  expect(MockAudioPlayer.made).toHaveLength(1);

  jest.advanceTimersByTime(10_000);
  await settle();

  expect(first.deinitialize).toHaveBeenCalledTimes(1);
  expect(MockAudioPlayer.made).toHaveLength(2);
});

it('starts again when the app comes back on screen after losing focus', async () => {
  const {keepAwake, first} = await started();

  keepAwake.yieldToShare(true);
  first.emit('audiofocuslost');
  keepAwake.resume(); // still sharing: leave it
  await settle();
  expect(MockAudioPlayer.made).toHaveLength(1);

  keepAwake.yieldToShare(false);
  await settle();
  keepAwake.resume(); // already running again: nothing more to do
  await settle();
  expect(MockAudioPlayer.made).toHaveLength(2);
});

it('stays off once turned off, even if a retry was waiting', async () => {
  const {keepAwake, first} = await started();

  first.emit('audiofocuslost');
  keepAwake.set(false);
  jest.advanceTimersByTime(60_000);
  await settle();

  expect(first.deinitialize).toHaveBeenCalledTimes(1);
  expect(MockAudioPlayer.made).toHaveLength(1);
});

it('ignores a focus loss from a player it has already replaced', async () => {
  const {keepAwake, first} = await started();

  first.emit('audiofocuslost');
  jest.advanceTimersByTime(10_000);
  await settle();
  expect(MockAudioPlayer.made).toHaveLength(2);

  first.emit('audiofocuslost'); // a late event from the old player
  jest.advanceTimersByTime(10_000);
  await settle();
  keepAwake.resume();
  await settle();

  expect(MockAudioPlayer.made).toHaveLength(2);
});
