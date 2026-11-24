/*
 * Tests for the 5-minute free cast: the timer, the 4:00 banner and the end
 * screen (spec §6). Fake timers throughout.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {BackHandler, StyleSheet} from 'react-native';
import {act, fireEvent, render, renderHook, screen} from '@testing-library/react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {
  END_IDLE_MS,
  FREE_CAST_MS,
  FreeCastBanner,
  FreeCastEndScreen,
  STOP_RETRY_MS,
  WARN_AT_MS,
  useFreeCast,
  useFreeCastSession,
} from '../src/FreeCast';
import type {UnlockState} from '../src/Unlock';

const BANNER = "1 minute left on this free cast · Unlock unlimited casts in CastAir's Settings";
const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};

type Options = Parameters<typeof useFreeCast>[0];
const onWarn = jest.fn();
const onEnd = jest.fn();

/** The hook, with a cast already running unless `over` says otherwise. */
const cast = (over: Partial<Options> = {}) =>
  renderHook(
    (props: Partial<Options>) => useFreeCast({castKey: 1, active: true, unlocked: false, onWarn, onEnd, ...props}),
    {
      initialProps: over,
    },
  );

/** The hook driving the banner, as App uses them. */
const BannerHost = (props: Partial<Options>) => {
  const {warning} = useFreeCast({castKey: 1, active: true, unlocked: false, onWarn, onEnd, ...props});
  return <FreeCastBanner visible={warning} />;
};

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('warns at 4:00 and ends at 5:00', () => {
  const {result} = cast();
  advance(WARN_AT_MS - 1);
  expect(onWarn).not.toHaveBeenCalled();
  expect(result.current.warning).toBe(false);
  advance(1);
  expect(onWarn).toHaveBeenCalledTimes(1);
  expect(result.current.warning).toBe(true);
  advance(FREE_CAST_MS - WARN_AT_MS - 1);
  expect(onEnd).not.toHaveBeenCalled();
  advance(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  // With the cast it was armed for.
  expect(onEnd).toHaveBeenCalledWith(1);
  expect(result.current.warning).toBe(false);
});

it('asks again every 10 s while the ended cast is still on, and stops once it is off', () => {
  const view = cast();
  advance(FREE_CAST_MS);
  expect(onEnd).toHaveBeenCalledTimes(1);
  advance(STOP_RETRY_MS - 1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  advance(1);
  expect(onEnd).toHaveBeenCalledTimes(2);
  expect(onEnd).toHaveBeenLastCalledWith(1);
  advance(STOP_RETRY_MS);
  expect(onEnd).toHaveBeenCalledTimes(3);
  view.rerender({active: false});
  expect(jest.getTimerCount()).toBe(0);
  advance(FREE_CAST_MS * 2);
  expect(onEnd).toHaveBeenCalledTimes(3);
  expect(onWarn).toHaveBeenCalledTimes(1);
});

it('banner hides after 15 s', () => {
  render(<BannerHost />);
  expect(screen.queryByText(BANNER)).toBeNull();
  advance(WARN_AT_MS);
  const text = screen.getByText(BANNER);
  // Over the cast in a bottom corner, never in the way of the remote.
  let node = text.parent;
  while (node && node.props.pointerEvents === undefined) {
    node = node.parent;
  }
  expect(node?.props.pointerEvents).toBe('none');
  const style = StyleSheet.flatten(node?.props.style);
  expect(style.position).toBe('absolute');
  expect(style.bottom).toBeDefined();
  advance(15_000 - 1);
  expect(screen.getByText(BANNER)).toBeTruthy();
  advance(1);
  expect(screen.queryByText(BANNER)).toBeNull();
});

it('unlocking mid-cast clears both timers', () => {
  const view = render(<BannerHost />);
  advance(WARN_AT_MS + 5_000);
  expect(screen.getByText(BANNER)).toBeTruthy();
  view.rerender(<BannerHost unlocked />);
  // The banner goes at once, and nothing is left to end the cast.
  expect(screen.queryByText(BANNER)).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  advance(FREE_CAST_MS * 2);
  expect(onEnd).not.toHaveBeenCalled();
  expect(onWarn).toHaveBeenCalledTimes(1);
});

it('a takeover at 4:59 restarts the 5 minutes', () => {
  const view = render(<BannerHost castKey={1} />);
  advance(WARN_AT_MS);
  expect(screen.getByText(BANNER)).toBeTruthy();
  advance(FREE_CAST_MS - WARN_AT_MS - 1_000);
  // A newcomer takes over at 4:59 (the banner was gone by then; it mustn't come back stale).
  view.rerender(<BannerHost castKey={2} />);
  expect(screen.queryByText(BANNER)).toBeNull();
  advance(1_000);
  expect(onEnd).not.toHaveBeenCalled();
  advance(WARN_AT_MS - 1_000 - 1);
  expect(onWarn).toHaveBeenCalledTimes(1);
  advance(1);
  expect(onWarn).toHaveBeenCalledTimes(2);
  expect(screen.getByText(BANNER)).toBeTruthy();
  advance(FREE_CAST_MS - WARN_AT_MS - 1);
  expect(onEnd).not.toHaveBeenCalled();
  advance(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it('a takeover while the banner shows hides it at once', () => {
  const view = render(<BannerHost castKey={1} />);
  advance(WARN_AT_MS + 2_000);
  expect(screen.getByText(BANNER)).toBeTruthy();
  view.rerender(<BannerHost castKey={2} />);
  expect(screen.queryByText(BANNER)).toBeNull();
});

it('cast ending before 5:00 clears timers', () => {
  const view = render(<BannerHost castKey={1} />);
  advance(WARN_AT_MS + 5_000);
  expect(screen.getByText(BANNER)).toBeTruthy();
  view.rerender(<BannerHost castKey={1} active={false} />);
  expect(screen.queryByText(BANNER)).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  advance(FREE_CAST_MS);
  expect(onEnd).not.toHaveBeenCalled();
  // The next cast starts at once with a fresh 5 minutes: no cool-down.
  view.rerender(<BannerHost castKey={2} active />);
  advance(FREE_CAST_MS - 1);
  expect(onEnd).not.toHaveBeenCalled();
  advance(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

it('unlocked: nothing armed', () => {
  const {result} = cast({unlocked: true});
  expect(jest.getTimerCount()).toBe(0);
  advance(FREE_CAST_MS * 3);
  expect(onWarn).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  expect(result.current.warning).toBe(false);
});

describe('before the unlocked state has loaded', () => {
  it('nothing is armed', () => {
    cast({ready: false});
    expect(jest.getTimerCount()).toBe(0);
    advance(FREE_CAST_MS * 2);
    expect(onWarn).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ready and unlocked: nothing arms for the running cast', () => {
    const view = cast({ready: false});
    advance(30_000);
    view.rerender({ready: true, unlocked: true});
    expect(jest.getTimerCount()).toBe(0);
    advance(FREE_CAST_MS * 2);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ready and locked early: the 5 minutes count from the start of the cast', () => {
    const view = cast({ready: false});
    advance(60_000);
    view.rerender({ready: true});
    advance(WARN_AT_MS - 60_000 - 1);
    expect(onWarn).not.toHaveBeenCalled();
    advance(1);
    expect(onWarn).toHaveBeenCalledTimes(1);
    advance(FREE_CAST_MS - WARN_AT_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('ready and locked late: warned at once, and ended no sooner than 60 s later', () => {
    const view = cast({ready: false});
    advance(270_000);
    view.rerender({ready: true});
    advance(0);
    expect(view.result.current.warning).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(1);
    advance(60_000 - 1);
    expect(onEnd).not.toHaveBeenCalled();
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

it('a subscription that lapses mid-cast still gets the warning and a minute', () => {
  const view = cast({unlocked: true});
  advance(FREE_CAST_MS * 2);
  view.rerender({unlocked: false});
  advance(0);
  expect(onWarn).toHaveBeenCalledTimes(1);
  advance(60_000 - 1);
  expect(onEnd).not.toHaveBeenCalled();
  advance(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
});

describe('cast session', () => {
  const onStop = jest.fn();
  type SessionOptions = Parameters<typeof useFreeCastSession>[0];
  const session = (over: Partial<SessionOptions> = {}) =>
    renderHook(
      (props: Partial<SessionOptions>) =>
        useFreeCastSession({mode: 'idle', audio: false, unlocked: false, onStop, ...props}),
      {initialProps: over},
    );

  it('ends at 5:00 by stopping the cast that ran out, and shows the end screen', () => {
    const view = session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    advance(FREE_CAST_MS - 1);
    expect(view.result.current.ended).toBe(false);
    advance(1);
    expect(onStop.mock.calls).toEqual([['airplay']]);
    expect(view.result.current.ended).toBe(true);
  });

  it('a timer armed for the old cast that fires during a takeover does nothing', () => {
    const view = session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    advance(FREE_CAST_MS - 1);
    // A browser share takes over at 4:59.999, and the old timer fires before the next render.
    act(() => {
      view.result.current.startCast('browser');
      jest.advanceTimersByTime(1);
    });
    expect(onStop).not.toHaveBeenCalled();
    expect(view.result.current.ended).toBe(false);
    view.rerender({mode: 'browser'});
    advance(FREE_CAST_MS - 1);
    expect(onStop).not.toHaveBeenCalled();
    advance(1);
    expect(onStop.mock.calls).toEqual([['browser']]);
  });

  it('keeps the end screen up and keeps stopping while the cast is still on', () => {
    const view = session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    advance(FREE_CAST_MS);
    expect(onStop).toHaveBeenCalledTimes(1);
    // Back (or the idle wait) while the share hasn't stopped: the end screen stays.
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(true);
    advance(STOP_RETRY_MS);
    expect(onStop.mock.calls).toEqual([['browser'], ['browser']]);
    // The share stops: the close that was asked for lands, and nothing more is stopped.
    view.rerender({mode: 'idle'});
    expect(view.result.current.ended).toBe(false);
    advance(STOP_RETRY_MS * 3);
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('once the cast is off, the end screen stays until closed', () => {
    const view = session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    advance(FREE_CAST_MS);
    view.rerender({mode: 'idle'});
    advance(STOP_RETRY_MS * 2);
    expect(view.result.current.ended).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(false);
  });

  it('unlocking on the end screen lets it close even before the cast is off', () => {
    const view = session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    advance(FREE_CAST_MS);
    view.rerender({mode: 'airplay', unlocked: true});
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(false);
  });

  it('AirPlay audio from standby is a cast of its own', () => {
    const view = session();
    view.rerender({audio: true});
    advance(FREE_CAST_MS - 1);
    expect(onStop).not.toHaveBeenCalled();
    advance(1);
    expect(onStop.mock.calls).toEqual([['audio']]);
  });

  it("AirPlay audio during a browser share doesn't restart the share's 5 minutes, and isn't stopped with it", () => {
    const view = session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    advance(120_000);
    view.rerender({mode: 'browser', audio: true});
    advance(FREE_CAST_MS - 120_000 - 1);
    expect(onStop).not.toHaveBeenCalled();
    advance(1);
    // Only the share ran out.
    expect(onStop.mock.calls).toEqual([['browser']]);
    // The share stops; the music still playing is now the cast, with its own 5 minutes.
    view.rerender({mode: 'idle', audio: true});
    advance(FREE_CAST_MS - 1);
    expect(onStop).toHaveBeenCalledTimes(1);
    advance(1);
    expect(onStop.mock.calls).toEqual([['browser'], ['audio']]);
  });
});

describe('end screen', () => {
  const onClose = jest.fn();
  const onBuy = jest.fn();
  const onCheckAgain = jest.fn();
  const showEnd = () =>
    render(
      <FreeCastEndScreen products={{}} state={LOCKED} onBuy={onBuy} onCheckAgain={onCheckAgain} onClose={onClose} />,
    );
  /** A key on the remote, the way the TV reports it. */
  const pressKey = () => {
    const calls = (useTVEventHandler as jest.Mock).mock.calls;
    act(() => calls[calls.length - 1][0]({eventType: 'down', eventKeyAction: 0}));
  };
  const pressBack = () => {
    const calls = (BackHandler.addEventListener as jest.Mock).mock.calls.filter(
      (c: unknown[]) => c[0] === 'hardwareBackPress',
    );
    act(() => {
      calls[calls.length - 1][1]();
    });
  };

  beforeEach(() => {
    jest.spyOn(BackHandler, 'addEventListener');
  });

  it('shows the end title with the plans', () => {
    showEnd();
    expect(screen.getByText('Free casts last 5 minutes')).toBeTruthy();
    expect(screen.getByText('Check purchases again')).toBeTruthy();
  });

  it('end screen returns to standby after 60 s idle', () => {
    showEnd();
    advance(END_IDLE_MS - 10_000);
    pressKey();
    // A key press starts the 60 s again.
    advance(END_IDLE_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('waits while Amazon is answering, then gives 60 s more', async () => {
    let answer: () => void = () => undefined;
    onCheckAgain.mockImplementation(() => new Promise<boolean>((resolve) => (answer = () => resolve(true))));
    showEnd();
    await act(async () => {
      fireEvent.press(screen.getByText('Check purchases again'));
    });
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    advance(END_IDLE_MS * 3);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer());
    advance(END_IDLE_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes to standby', () => {
    showEnd();
    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
