/*
 * The weekly free allowance (spec §3): on the free version, casting (AirPlay
 * mirroring, AirPlay audio-only or a browser share) uses up 30 minutes a week,
 * counted only while a cast is live. The week starts on Monday at 05:00, TV
 * time (Allowance.ts holds the maths); a cast running through the reset
 * carries on and counts against the new week. What's used is kept on the TV,
 * saved every 15 s during a cast and when it ends. A 15 s banner shows when 5
 * minutes are left and again at 1 minute; at zero App stops the cast and shows
 * the plans under "This week's free casting is used up", which return to
 * standby after 60 s with no key press. A newcomer taking over carries on with
 * what's left, and a cast that starts with nothing left is stopped at once.
 * Unlocking stops the count at once. Until the stopped cast is really off, the
 * stop is asked for again every 10 s and the end screen stays.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {SAVE_EVERY_MS, WARN_AT_MS, currentState, remainingMs, spend, weekStart} from './Allowance';
import type {AllowanceState} from './Allowance';
import {COLORS} from './config';
import {PlansScreen} from './PlansScreen';
import {U} from './SettingsParts';
import type {Mode} from './ShareMode';
import {AsyncStorage} from './storage';

/** Each banner shows for 15 s. */
export const BANNER_MS = 15_000;
/**
 * When the TV turns out to be on the free version while a cast is already
 * running (the unlocked state loading at startup, or a subscription lapsing),
 * the cast still gets at least this long, banner first: no cast ends unwarned.
 */
export const LOCKED_GRACE_MS = 60_000;
/** The end screen returns to standby after 60 s with no key press. */
export const END_IDLE_MS = 60_000;
/** While an ended cast is still on, its stop is asked for again this often. */
export const STOP_RETRY_MS = 10_000;

/** One commit charges at most this long: a longer span means the clock jumped, not that the cast ran. */
const MAX_SPAN_MS = 4 * SAVE_EVERY_MS;

/** Where the allowance is kept: JSON of AllowanceState. */
const STORAGE_KEY = 'freeAllowance';
const WEEK_MS = 7 * 24 * 3_600_000;
/** The last banner also shows at once for a cast with less than that left: no cast ends unwarned. */
const LAST_WARNING_MS = WARN_AT_MS[WARN_AT_MS.length - 1];

const parse = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

type Options = {
  /** Changes when a new cast starts or takes over. */
  castKey: number;
  /** Whether a cast is on. */
  active: boolean;
  unlocked: boolean;
  /** False until the unlocked state has loaded; nothing is timed before then. */
  ready?: boolean;
  /** The TV's offset from UTC in minutes, for the Monday 05:00 reset. */
  offsetMin: number;
  /** As a banner shows, with the time left it announces. */
  onWarn?: (leftMs: number) => void;
  /** At zero, with the castKey it was armed for; again every 10 s while the cast is still on. */
  onEnd: (castKey: number) => void;
};

/**
 * Times casting on the free version against the weekly allowance.
 * `warningMs` is the time a banner announces while it shows, else null.
 * `remainingMs` is null when unlocked, before the unlocked state or the
 * stored allowance has loaded.
 */
export function useFreeCast({castKey, active, unlocked, ready = true, offsetMin, onWarn, onEnd}: Options): {
  warningMs: number | null;
  remainingMs: number | null;
} {
  const [warningMs, setWarningMs] = useState<number | null>(null);
  const [allowance, setAllowance] = useState<AllowanceState | null>(null);
  const callbacks = useRef({onWarn, onEnd});
  callbacks.current = {onWarn, onEnd};
  const offset = useRef(offsetMin);
  offset.current = offsetMin;
  const limited = ready && !unlocked;
  // Read by the timers: one that fires after the render that unlocks the TV, before the cleanup, must do nothing.
  const limitedNow = useRef(limited);
  limitedNow.current = limited;
  const loaded = allowance !== null;
  const week = allowance?.weekStart ?? null;
  // The allowance as of the last change, and since when the live cast has been counted but not yet spent.
  const state = useRef<AllowanceState | null>(null);
  const spanStart = useRef<number | null>(null);
  // When the current cast started, whether it has been ended, and since when the TV has been limited.
  const castStart = useRef(0);
  const ended = useRef(false);
  const limitedSince = useRef(0);

  const update = useCallback((next: AllowanceState) => {
    state.current = next;
    setAllowance(next);
  }, []);
  /** Spends the live time so far. */
  const commit = useCallback(() => {
    const now = Date.now();
    if (spanStart.current !== null && state.current) {
      update(spend(state.current, Math.max(spanStart.current, now - MAX_SPAN_MS), now, offset.current));
      spanStart.current = now;
    }
  }, [update]);
  const save = useCallback(() => {
    if (state.current) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state.current)).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(parse, () => null)
      .then((stored) => {
        if (!cancelled) {
          update(currentState(stored, Date.now(), offset.current));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [update]);

  useEffect(() => {
    if (active) {
      castStart.current = Date.now();
      ended.current = false;
    }
  }, [castKey, active]);

  useEffect(() => {
    if (limited) {
      limitedSince.current = Date.now();
    }
  }, [limited]);

  // A new week at Monday 05:00, cast or not: the standby line refills, and a running cast re-arms (below).
  useEffect(() => {
    if (!limited || !loaded) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const now = Date.now();
      const current = state.current;
      if (current) {
        const next = currentState(current, now, offsetMin);
        if (next.weekStart !== current.weekStart || next.usedMs !== current.usedMs) {
          update(next);
        }
      }
      timer = setTimeout(refresh, weekStart(now, offsetMin) + WEEK_MS - now);
    };
    refresh();
    return () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [limited, loaded, offsetMin, update]);

  useEffect(() => {
    setWarningMs(null);
    if (!active || !limited || week === null || !state.current) {
      return;
    }
    const armedFor = castKey;
    const now = Date.now();
    spanStart.current = now;
    let retry: ReturnType<typeof setInterval> | undefined;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => {
      if (limitedNow.current) {
        callbacks.current.onEnd(armedFor);
      }
    };
    const keepStopping = () => {
      retry = setInterval(stop, STOP_RETRY_MS);
    };
    const saving = setInterval(() => {
      commit();
      save();
    }, SAVE_EVERY_MS);
    const disarm = () => {
      clearInterval(saving);
      if (retry !== undefined) {
        clearInterval(retry);
      }
      if (hide !== undefined) {
        clearTimeout(hide);
      }
      timers.forEach(clearTimeout);
      commit();
      spanStart.current = null;
      save();
    };
    if (ended.current) {
      keepStopping();
      return disarm;
    }
    // When what's left runs out, but for a cast already running when the limit
    // applied, never sooner than LOCKED_GRACE_MS after that.
    const graceUntil = castStart.current < limitedSince.current ? limitedSince.current + LOCKED_GRACE_MS : 0;
    const endAt = Math.max(now + remainingMs(state.current), graceUntil);
    for (const leftMs of WARN_AT_MS) {
      const warnAt = endAt - leftMs;
      if (warnAt < now && !(leftMs === LAST_WARNING_MS && endAt > now)) {
        continue;
      }
      timers.push(
        setTimeout(
          () => {
            if (!limitedNow.current) {
              return;
            }
            if (hide !== undefined) {
              clearTimeout(hide);
            }
            setWarningMs(leftMs);
            callbacks.current.onWarn?.(leftMs);
            hide = setTimeout(() => setWarningMs(null), BANNER_MS);
          },
          Math.max(0, warnAt - now),
        ),
      );
    }
    timers.push(
      setTimeout(
        () => {
          if (!limitedNow.current) {
            return;
          }
          ended.current = true;
          if (hide !== undefined) {
            clearTimeout(hide);
          }
          setWarningMs(null);
          commit();
          save();
          stop();
          keepStopping();
        },
        Math.max(0, endAt - now),
      ),
    );
    return disarm;
  }, [castKey, active, limited, week, commit, save]);

  return {warningMs, remainingMs: limited && allowance ? remainingMs(allowance) : null};
}

/** The cast the free timer belongs to. */
export type CastKind = 'airplay' | 'browser' | 'audio';

type SessionOptions = {
  /** Which share is on screen (ShareMode). */
  mode: Mode;
  /** Whether AirPlay audio-only is playing. */
  audio: boolean;
  unlocked: boolean;
  ready?: boolean;
  /** The TV's offset from UTC in minutes, for the Monday 05:00 reset. */
  offsetMin: number;
  onWarn?: (leftMs: number) => void;
  /** Stops a cast of `kind`: at zero, and again every 10 s while it's still on. */
  onStop: (kind: CastKind) => void;
};

/**
 * The allowance as App runs it. The timer belongs to the newest cast:
 * AirPlay mirroring or a browser share (App calls startCast when one starts
 * or takes over), or AirPlay audio-only playing with nothing on screen.
 * Audio that starts during a share is counted as part of the share; audio
 * still playing when the share stops becomes the cast. Every cast draws on
 * the same weekly allowance. At zero only the cast that ran out is stopped,
 * and the end screen stays up until it's really off (`closeEnd` waits for
 * that), unless the TV unlocks.
 */
export function useFreeCastSession({mode, audio, unlocked, ready = true, offsetMin, onWarn, onStop}: SessionOptions): {
  /** The time a banner announces while it shows (5 or 1 minute), else null. */
  warningMs: number | null;
  /** True from zero until the end screen closes. */
  ended: boolean;
  /** A cast started or took over: it carries on with what's left, and the end screen closes. */
  startCast: (kind: CastKind) => void;
  /** Back, the Back row or the idle wait on the end screen. */
  closeEnd: () => void;
  /** This week's free time left; null when unlocked or not yet known. */
  remainingMs: number | null;
} {
  // The ref moves at once, so a timer armed for the previous cast can tell it's stale before the next render.
  const castKey = useRef(0);
  const castKind = useRef<CastKind | null>(null);
  const [cast, setCast] = useState<{key: number; kind: CastKind | null}>({key: 0, kind: null});
  const [ended, setEnded] = useState(false);
  const closeWanted = useRef(false);
  const stopper = useRef(onStop);
  stopper.current = onStop;

  const active =
    (cast.kind === 'airplay' && mode === 'airplay') ||
    (cast.kind === 'browser' && mode === 'browser') ||
    (cast.kind === 'audio' && audio);
  const enforcing = active && ready && !unlocked;
  const enforcingNow = useRef(enforcing);
  enforcingNow.current = enforcing;

  const startCast = useCallback((kind: CastKind) => {
    castKey.current += 1;
    castKind.current = kind;
    closeWanted.current = false;
    setCast({key: castKey.current, kind});
    setEnded(false);
  }, []);

  useEffect(() => {
    if (audio && mode === 'idle') {
      startCast('audio');
    }
  }, [audio, mode, startCast]);

  const {warningMs, remainingMs: left} = useFreeCast({
    castKey: cast.key,
    active,
    unlocked,
    ready,
    offsetMin,
    onWarn,
    onEnd: (armedFor) => {
      if (armedFor !== castKey.current || castKind.current === null) {
        return;
      }
      stopper.current(castKind.current);
      setEnded(true);
    },
  });

  const closeEnd = useCallback(() => {
    if (enforcingNow.current) {
      closeWanted.current = true;
    } else {
      setEnded(false);
    }
  }, []);

  useEffect(() => {
    if (!enforcing && closeWanted.current) {
      closeWanted.current = false;
      setEnded(false);
    }
  }, [enforcing]);

  return {warningMs, ended, startCast, closeEnd, remainingMs: left};
}

/** The 5- and 1-minute banners: a bottom corner of the cast, never in the remote's way. */
export const FreeCastBanner = ({leftMs}: {leftMs: number | null}) => {
  if (leftMs === null) {
    return null;
  }
  const minutes = Math.round(leftMs / 60_000);
  return (
    <View pointerEvents="none" style={styles.banner}>
      <Text style={styles.bannerText}>
        {`${minutes} ${minutes === 1 ? 'minute' : 'minutes'} of free casting left this week`}
      </Text>
    </View>
  );
};

type EndProps = Omit<React.ComponentProps<typeof PlansScreen>, 'title' | 'subtitle'>;

/**
 * The plans under "This week's free casting is used up". Back, the Back row, or 60 s
 * with no key press close it; the 60 s wait pauses while Amazon is answering.
 */
export const FreeCastEndScreen = ({products, productsLoaded, state, onBuy, onCheckAgain, onClose}: EndProps) => {
  const close = useRef(onClose);
  close.current = onClose;
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(0);
  const mounted = useRef(true);

  const stopIdle = () => {
    if (idle.current !== undefined) {
      clearTimeout(idle.current);
      idle.current = undefined;
    }
  };
  const startIdle = useCallback(() => {
    stopIdle();
    if (mounted.current && busy.current === 0) {
      idle.current = setTimeout(() => close.current(), END_IDLE_MS);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    startIdle();
    return () => {
      mounted.current = false;
      stopIdle();
    };
  }, [startIdle]);

  useTVEventHandler(() => startIdle());

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Amazon's buying screen can take longer than 60 s: don't close under it.
  const whileAnswering = async <T,>(ask: () => Promise<T>): Promise<T> => {
    busy.current += 1;
    stopIdle();
    try {
      return await ask();
    } finally {
      busy.current -= 1;
      startIdle();
    }
  };

  return (
    <PlansScreen
      products={products}
      productsLoaded={productsLoaded}
      state={state}
      onBuy={(sku) => whileAnswering(() => onBuy(sku))}
      onCheckAgain={() => whileAnswering(onCheckAgain)}
      onClose={onClose}
      title="This week's free casting is used up"
      subtitle="More free time on Monday at 05:00."
    />
  );
};

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    right: 2.4 * U,
    bottom: 2.4 * U,
    maxWidth: 42 * U,
    paddingHorizontal: 1.4 * U,
    paddingVertical: 0.9 * U,
    borderRadius: 0.8 * U,
    backgroundColor: 'rgba(0,0,0,.72)',
    zIndex: 10,
  },
  bannerText: {color: COLORS.cream, fontSize: 1.3 * U},
});
