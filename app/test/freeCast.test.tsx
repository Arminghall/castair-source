/*
 * Tests for the weekly free allowance in the app: the timer, the 5- and
 * 1-minute banners and the end screen (spec §3). Fake timers and a stubbed
 * AsyncStorage throughout.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useLayoutEffect} from 'react';
import {BackHandler, StyleSheet} from 'react-native';
import {act, fireEvent, render, renderHook, screen} from '@testing-library/react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {ALLOWANCE_MS, SAVE_EVERY_MS} from '../src/Allowance';
import {
  BANNER_MS,
  END_IDLE_MS,
  FreeCastBanner,
  FreeCastEndScreen,
  LOCKED_GRACE_MS,
  STOP_RETRY_MS,
  useFreeCast,
  useFreeCastSession,
} from '../src/FreeCast';
import {AsyncStorage} from '../src/storage';
import type {UnlockState} from '../src/Unlock';

const BANNER_5 = '5 minutes of free casting left this week';
const BANNER_1 = '1 minute of free casting left this week';
const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};
const MIN = 60_000;
// Wednesday 25 November 2026, 12:00 UTC; the TV is on UTC in these tests.
const NOW = Date.UTC(2026, 10, 25, 12, 0);
const WEEK = Date.UTC(2026, 10, 23, 5, 0);
const NEXT_WEEK = Date.UTC(2026, 10, 30, 5, 0);

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
/** What the TV has stored, as getItem gives it. */
let stored: Record<string, string> = {};
const storedAllowance = () =>
  JSON.parse(setItem.mock.calls.filter((c: unknown[]) => c[0] === 'freeAllowance').at(-1)[1]);

type Options = Parameters<typeof useFreeCast>[0];
const onWarn = jest.fn();
const onEnd = jest.fn();

/** Lets the stored allowance load (and any timers due) inside act(). */
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

/** The hook, with a cast already running unless `over` says otherwise; the stored state has loaded. */
const cast = async (over: Partial<Options> = {}) => {
  const view = renderHook(
    (props: Partial<Options>) =>
      useFreeCast({castKey: 1, active: true, unlocked: false, offsetMin: 0, onWarn, onEnd, ...props}),
    {initialProps: over},
  );
  await advance(0);
  return view;
};

/** The hook driving the banner, as App uses them. */
const BannerHost = (props: Partial<Options>) => {
  const {warningMs} = useFreeCast({castKey: 1, active: true, unlocked: false, offsetMin: 0, onWarn, onEnd, ...props});
  return <FreeCastBanner leftMs={warningMs} />;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  stored = {};
  getItem.mockImplementation((k: string) => Promise.resolve(stored[k] ?? null));
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  getItem.mockImplementation(() => Promise.resolve(null));
});

it('counts only while the cast is live', async () => {
  const view = await cast({active: false});
  expect(view.result.current.remainingMs).toBe(ALLOWANCE_MS);
  await advance(60 * MIN);
  expect(onEnd).not.toHaveBeenCalled();
  expect(view.result.current.remainingMs).toBe(ALLOWANCE_MS);
  view.rerender({active: true});
  await advance(10 * MIN);
  view.rerender({active: false});
  expect(view.result.current.remainingMs).toBe(20 * MIN);
  await advance(60 * MIN);
  expect(view.result.current.remainingMs).toBe(20 * MIN);
});

it('banner at 5 minutes left, then at 1 minute left, each for 15 s', async () => {
  render(<BannerHost />);
  await advance(0);
  await advance(25 * MIN - 1);
  expect(screen.queryByText(BANNER_5)).toBeNull();
  await advance(1);
  const text = screen.getByText(BANNER_5);
  expect(onWarn).toHaveBeenLastCalledWith(5 * MIN);
  // Over the cast in a bottom corner, never in the way of the remote.
  let node = text.parent;
  while (node && node.props.pointerEvents === undefined) {
    node = node.parent;
  }
  expect(node?.props.pointerEvents).toBe('none');
  const style = StyleSheet.flatten(node?.props.style);
  expect(style.position).toBe('absolute');
  expect(style.bottom).toBeDefined();
  await advance(BANNER_MS - 1);
  expect(screen.getByText(BANNER_5)).toBeTruthy();
  await advance(1);
  expect(screen.queryByText(BANNER_5)).toBeNull();
  await advance(4 * MIN - BANNER_MS - 1);
  expect(screen.queryByText(BANNER_1)).toBeNull();
  await advance(1);
  expect(screen.getByText(BANNER_1)).toBeTruthy();
  expect(onWarn).toHaveBeenLastCalledWith(MIN);
  await advance(BANNER_MS);
  expect(screen.queryByText(BANNER_1)).toBeNull();
  expect(onWarn).toHaveBeenCalledTimes(2);
});

it('stops at zero, with the cast it was armed for, and asks again every 10 s until the cast is off', async () => {
  const view = await cast();
  await advance(ALLOWANCE_MS - 1);
  expect(onEnd).not.toHaveBeenCalled();
  await advance(1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd).toHaveBeenCalledWith(1);
  expect(view.result.current.warningMs).toBeNull();
  expect(view.result.current.remainingMs).toBe(0);
  await advance(STOP_RETRY_MS - 1);
  expect(onEnd).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(onEnd).toHaveBeenCalledTimes(2);
  expect(onEnd).toHaveBeenLastCalledWith(1);
  view.rerender({active: false});
  await advance(STOP_RETRY_MS * 5);
  expect(onEnd).toHaveBeenCalledTimes(2);
});

it('a cast that starts with nothing left is stopped at once', async () => {
  stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS});
  const view = await cast({active: false});
  expect(view.result.current.remainingMs).toBe(0);
  view.rerender({active: true, castKey: 2});
  await advance(0);
  expect(onEnd).toHaveBeenCalledWith(2);
});

it('saves every 15 s during a cast and when it ends', async () => {
  const view = await cast();
  setItem.mockClear();
  await advance(SAVE_EVERY_MS - 1);
  expect(setItem).not.toHaveBeenCalled();
  await advance(1);
  expect(setItem).toHaveBeenCalledWith('freeAllowance', JSON.stringify({weekStart: WEEK, usedMs: SAVE_EVERY_MS}));
  await advance(SAVE_EVERY_MS);
  expect(storedAllowance()).toEqual({weekStart: WEEK, usedMs: 2 * SAVE_EVERY_MS});
  await advance(4_000);
  view.rerender({active: false});
  expect(storedAllowance()).toEqual({weekStart: WEEK, usedMs: 2 * SAVE_EVERY_MS + 4_000});
  const saves = setItem.mock.calls.length;
  await advance(SAVE_EVERY_MS * 4);
  expect(setItem).toHaveBeenCalledTimes(saves);
});

it("loads the stored state on mount; damaged or last week's data is a fresh week", async () => {
  stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: 12 * MIN});
  const view = await cast({active: false});
  expect(view.result.current.remainingMs).toBe(18 * MIN);
  view.unmount();
  stored.freeAllowance = JSON.stringify({weekStart: WEEK - 7 * 24 * 60 * MIN, usedMs: ALLOWANCE_MS});
  const lastWeek = await cast({active: false});
  expect(lastWeek.result.current.remainingMs).toBe(ALLOWANCE_MS);
  lastWeek.unmount();
  stored.freeAllowance = '{not json';
  const damaged = await cast({active: false});
  expect(damaged.result.current.remainingMs).toBe(ALLOWANCE_MS);
});

it('nothing is timed before the stored state has loaded', async () => {
  getItem.mockImplementation(() => new Promise(() => undefined));
  const view = renderHook(() => useFreeCast({castKey: 1, active: true, unlocked: false, offsetMin: 0, onWarn, onEnd}));
  expect(view.result.current.remainingMs).toBeNull();
  await advance(ALLOWANCE_MS * 2);
  expect(onEnd).not.toHaveBeenCalled();
});

it('a cast crossing Monday 05:00 is not stopped at the old week zero, and counts from 05:00', async () => {
  // 5 minutes before the reset with 10 minutes left: the old week's zero would be at 05:05.
  jest.setSystemTime(NEXT_WEEK - 5 * MIN);
  stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS - 10 * MIN});
  const view = await cast();
  await advance(5 * MIN);
  // At the reset, 5 minutes of the old 10 were used; the cast carries on with a fresh 30.
  await advance(10 * MIN);
  expect(onEnd).not.toHaveBeenCalled();
  view.rerender({active: false});
  expect(view.result.current.remainingMs).toBe(ALLOWANCE_MS - 10 * MIN);
  expect(storedAllowance()).toEqual({weekStart: NEXT_WEEK, usedMs: 10 * MIN});
});

it('a forward clock jump during a cast is charged at most 60 s and does not stop the cast', async () => {
  const view = await cast();
  await advance(SAVE_EVERY_MS);
  // The TV's clock jumps 20 minutes (an NTP fix, say) before the next save tick.
  jest.setSystemTime(Date.now() + 20 * MIN);
  await advance(SAVE_EVERY_MS);
  expect(onEnd).not.toHaveBeenCalled();
  view.rerender({active: false});
  const used = ALLOWANCE_MS - (view.result.current.remainingMs ?? 0);
  expect(used).toBeGreaterThanOrEqual(2 * SAVE_EVERY_MS);
  expect(used).toBeLessThanOrEqual(2 * SAVE_EVERY_MS + MIN);
});

it('on standby the new week shows at the reset', async () => {
  jest.setSystemTime(NEXT_WEEK - MIN);
  stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS});
  const view = await cast({active: false});
  expect(view.result.current.remainingMs).toBe(0);
  await advance(MIN);
  expect(view.result.current.remainingMs).toBe(ALLOWANCE_MS);
});

it('ready: false times nothing and gives remainingMs null', async () => {
  const view = await cast({ready: false});
  expect(view.result.current.remainingMs).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  await advance(ALLOWANCE_MS * 2);
  expect(onWarn).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  view.rerender({ready: true, unlocked: true});
  expect(jest.getTimerCount()).toBe(0);
  await advance(ALLOWANCE_MS * 2);
  expect(onEnd).not.toHaveBeenCalled();
});

it('unlocked: remainingMs null, nothing armed and never stopped', async () => {
  const view = await cast({unlocked: true});
  expect(view.result.current.remainingMs).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  await advance(ALLOWANCE_MS * 3);
  expect(onWarn).not.toHaveBeenCalled();
  expect(onEnd).not.toHaveBeenCalled();
  expect(view.result.current.warningMs).toBeNull();
});

it('unlocking mid-cast clears the banner and the timers', async () => {
  const view = render(<BannerHost />);
  await advance(0);
  await advance(25 * MIN + 5_000);
  expect(screen.getByText(BANNER_5)).toBeTruthy();
  view.rerender(<BannerHost unlocked />);
  expect(screen.queryByText(BANNER_5)).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
  await advance(ALLOWANCE_MS * 2);
  expect(onEnd).not.toHaveBeenCalled();
  expect(onWarn).toHaveBeenCalledTimes(1);
});

it('a timer firing after the render that unlocks the TV, before its cleanup, stops nothing', async () => {
  /** Fires `fireMs` of timers from a layout effect: after the unlocking render, before passive cleanups. */
  const Host = ({unlocked, fireMs}: {unlocked: boolean; fireMs: number}) => {
    useFreeCast({castKey: 1, active: true, unlocked, offsetMin: 0, onWarn, onEnd});
    useLayoutEffect(() => {
      if (unlocked) {
        jest.advanceTimersByTime(fireMs);
      }
    }, [unlocked, fireMs]);
    return null;
  };
  const view = render(<Host unlocked={false} fireMs={0} />);
  await advance(0);
  await advance(ALLOWANCE_MS - 1_000);
  view.rerender(<Host unlocked fireMs={1_000} />);
  expect(onEnd).not.toHaveBeenCalled();
  await advance(STOP_RETRY_MS * 3);
  expect(onEnd).not.toHaveBeenCalled();
});

describe('the 60 s grace when the TV turns out to be free mid-cast', () => {
  it('purchases loading at startup with time left: the allowance counts from when the limit applied', async () => {
    const view = await cast({ready: false});
    await advance(MIN);
    view.rerender({ready: true});
    await advance(ALLOWANCE_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    await advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('nothing left: warned at once with the 1-minute banner, and ended no sooner than 60 s later', async () => {
    stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS});
    const view = await cast({unlocked: true});
    await advance(10 * MIN);
    // A subscription lapses mid-cast.
    view.rerender({unlocked: false});
    await advance(0);
    expect(view.result.current.warningMs).toBe(MIN);
    expect(onWarn).toHaveBeenCalledTimes(1);
    await advance(LOCKED_GRACE_MS - 1);
    expect(onEnd).not.toHaveBeenCalled();
    await advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('with allowance left, the allowance wins over the grace', async () => {
    stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS - 3 * MIN});
    const view = await cast({unlocked: true});
    view.rerender({unlocked: false});
    await advance(LOCKED_GRACE_MS);
    expect(onEnd).not.toHaveBeenCalled();
    await advance(3 * MIN - LOCKED_GRACE_MS);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('cast session', () => {
  const onStop = jest.fn();
  type SessionOptions = Parameters<typeof useFreeCastSession>[0];
  const session = async (over: Partial<SessionOptions> = {}) => {
    const view = renderHook(
      (props: Partial<SessionOptions>) =>
        useFreeCastSession({mode: 'idle', audio: false, unlocked: false, offsetMin: 0, onStop, ...props}),
      {initialProps: over},
    );
    await advance(0);
    return view;
  };

  it('stops the cast that ran out at zero, and shows the end screen', async () => {
    const view = await session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    await advance(ALLOWANCE_MS - 1);
    expect(view.result.current.ended).toBe(false);
    await advance(1);
    expect(onStop.mock.calls).toEqual([['airplay']]);
    expect(view.result.current.ended).toBe(true);
  });

  it('two casts in a row share one allowance: 20 minutes, then 10 ends the second', async () => {
    const view = await session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    await advance(20 * MIN);
    view.rerender({mode: 'idle'});
    expect(view.result.current.remainingMs).toBe(10 * MIN);
    await advance(60 * MIN);
    view.rerender({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(10 * MIN - 1);
    expect(onStop).not.toHaveBeenCalled();
    await advance(1);
    expect(onStop.mock.calls).toEqual([['browser']]);
    expect(view.result.current.ended).toBe(true);
  });

  it('a newcomer taking over does not reset the allowance', async () => {
    const view = await session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    await advance(29 * MIN);
    view.rerender({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(MIN - 1);
    expect(onStop).not.toHaveBeenCalled();
    await advance(1);
    expect(onStop.mock.calls).toEqual([['browser']]);
  });

  it('a timer armed for the old cast that fires during a takeover does nothing', async () => {
    const view = await session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    await advance(ALLOWANCE_MS - 1);
    // A browser share takes over at the last millisecond, and the old timer fires before the next render.
    act(() => {
      view.result.current.startCast('browser');
      jest.advanceTimersByTime(1);
    });
    expect(onStop).not.toHaveBeenCalled();
    view.rerender({mode: 'browser'});
    await advance(0);
    // The newcomer starts with nothing left: stopped at once.
    expect(onStop.mock.calls).toEqual([['browser']]);
  });

  it('a cast that starts with nothing left is stopped at once and shows the end screen', async () => {
    stored.freeAllowance = JSON.stringify({weekStart: WEEK, usedMs: ALLOWANCE_MS});
    const view = await session();
    expect(view.result.current.remainingMs).toBe(0);
    view.rerender({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(0);
    expect(onStop.mock.calls).toEqual([['browser']]);
    expect(view.result.current.ended).toBe(true);
  });

  it('keeps the end screen up and keeps stopping while the cast is still on', async () => {
    const view = await session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(ALLOWANCE_MS);
    expect(onStop).toHaveBeenCalledTimes(1);
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(true);
    await advance(STOP_RETRY_MS);
    expect(onStop.mock.calls).toEqual([['browser'], ['browser']]);
    view.rerender({mode: 'idle'});
    expect(view.result.current.ended).toBe(false);
    await advance(STOP_RETRY_MS * 3);
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('once the cast is off, the end screen stays until closed', async () => {
    const view = await session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(ALLOWANCE_MS);
    view.rerender({mode: 'idle'});
    await advance(STOP_RETRY_MS * 2);
    expect(view.result.current.ended).toBe(true);
    expect(onStop).toHaveBeenCalledTimes(1);
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(false);
  });

  it('unlocking on the end screen lets it close even before the cast is off', async () => {
    const view = await session({mode: 'airplay'});
    act(() => view.result.current.startCast('airplay'));
    await advance(ALLOWANCE_MS);
    view.rerender({mode: 'airplay', unlocked: true});
    act(() => view.result.current.closeEnd());
    expect(view.result.current.ended).toBe(false);
  });

  it("AirPlay audio during a browser share isn't counted on top, and audio left playing at zero is stopped at once", async () => {
    const view = await session({mode: 'browser'});
    act(() => view.result.current.startCast('browser'));
    await advance(5 * MIN);
    view.rerender({mode: 'browser', audio: true});
    await advance(15 * MIN);
    // The share stops after 20 minutes; the music still playing becomes the cast.
    view.rerender({mode: 'idle', audio: true});
    expect(view.result.current.remainingMs).toBe(10 * MIN);
    // Another share takes over at once and runs out the allowance.
    view.rerender({mode: 'browser', audio: true});
    act(() => view.result.current.startCast('browser'));
    await advance(10 * MIN - 1);
    expect(onStop).not.toHaveBeenCalled();
    await advance(1);
    expect(onStop.mock.calls).toEqual([['browser']]);
    // The share stops with the music still playing: the audio is the new cast, with nothing left.
    view.rerender({mode: 'idle', audio: true});
    await advance(0);
    expect(onStop.mock.calls).toEqual([['browser'], ['audio']]);
  });

  it('AirPlay audio from standby counts too', async () => {
    const view = await session();
    view.rerender({audio: true});
    await advance(ALLOWANCE_MS - 1);
    expect(onStop).not.toHaveBeenCalled();
    await advance(1);
    expect(onStop.mock.calls).toEqual([['audio']]);
  });

  it('ready: false gives remainingMs null and never stops', async () => {
    const view = await session({mode: 'airplay', ready: false});
    act(() => view.result.current.startCast('airplay'));
    expect(view.result.current.remainingMs).toBeNull();
    await advance(ALLOWANCE_MS * 2);
    expect(onStop).not.toHaveBeenCalled();
    expect(view.result.current.warningMs).toBeNull();
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

  it('shows the end title and when more time comes, with the plans', () => {
    showEnd();
    expect(screen.getByText("This week's free casting is used up")).toBeTruthy();
    expect(screen.getByText('More free time on Monday at 05:00.')).toBeTruthy();
    expect(screen.getByText('Check purchases again')).toBeTruthy();
  });

  it('end screen returns to standby after 60 s idle', async () => {
    showEnd();
    await advance(END_IDLE_MS - 10_000);
    pressKey();
    // A key press starts the 60 s again.
    await advance(END_IDLE_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    await advance(1);
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
    await advance(END_IDLE_MS * 3);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => answer());
    await advance(END_IDLE_MS - 1);
    expect(onClose).not.toHaveBeenCalled();
    await advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes to standby', () => {
    showEnd();
    pressBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
