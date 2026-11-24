/*
 * The 5-minute free cast (spec §6): on the free version every cast (AirPlay
 * mirroring, AirPlay audio-only or a browser share) is timed from when it
 * starts. At 4:00 a small banner shows for 15 s; at 5:00 App stops the cast
 * and shows the plans under "Free casts last 5 minutes", which return to
 * standby after 60 s with no key press. A newcomer taking over starts a new
 * 5 minutes, and unlocking stops the timer at once. Until the stopped cast is
 * really off, the stop is asked for again every 10 s and the end screen stays.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {COLORS} from './config';
import {PlansScreen} from './PlansScreen';
import {U} from './SettingsParts';
import type {Mode} from './ShareMode';

/** A free cast ends at 5:00. */
export const FREE_CAST_MS = 300_000;
/** The banner shows at 4:00... */
export const WARN_AT_MS = 240_000;
/** ...for 15 s. */
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

type Options = {
  /** Changes when a new cast starts or takes over. */
  castKey: number;
  /** Whether a cast is on. */
  active: boolean;
  unlocked: boolean;
  /** False until the unlocked state has loaded; nothing is timed before then. */
  ready?: boolean;
  onWarn?: () => void;
  /** At 5:00, with the castKey it was armed for; again every 10 s while the cast is still on. */
  onEnd: (castKey: number) => void;
};

/** Times the current cast on the free version. `warning` is true while the 4:00 banner shows. */
export function useFreeCast({castKey, active, unlocked, ready = true, onWarn, onEnd}: Options): {warning: boolean} {
  const [warning, setWarning] = useState(false);
  const callbacks = useRef({onWarn, onEnd});
  callbacks.current = {onWarn, onEnd};
  const limited = ready && !unlocked;
  // When the current cast started, whether it has been ended, and since when the TV has been limited.
  const castStart = useRef(0);
  const ended = useRef(false);
  const limitedSince = useRef(0);

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

  useEffect(() => {
    setWarning(false);
    if (!active || !limited) {
      return;
    }
    const armedFor = castKey;
    let retry: ReturnType<typeof setInterval> | undefined;
    const stop = () => callbacks.current.onEnd(armedFor);
    const keepStopping = () => {
      retry = setInterval(stop, STOP_RETRY_MS);
    };
    const stopRetrying = () => {
      if (retry !== undefined) {
        clearInterval(retry);
      }
    };
    if (ended.current) {
      keepStopping();
      return stopRetrying;
    }
    const now = Date.now();
    // From the start of the cast, but never sooner than LOCKED_GRACE_MS after the limit applied.
    const endAt = Math.max(castStart.current + FREE_CAST_MS, limitedSince.current + LOCKED_GRACE_MS);
    const warnAt = endAt - (FREE_CAST_MS - WARN_AT_MS);
    let hide: ReturnType<typeof setTimeout> | undefined;
    const warn = setTimeout(
      () => {
        setWarning(true);
        callbacks.current.onWarn?.();
        hide = setTimeout(() => setWarning(false), BANNER_MS);
      },
      Math.max(0, warnAt - now),
    );
    const end = setTimeout(() => {
      ended.current = true;
      if (hide !== undefined) {
        clearTimeout(hide);
      }
      setWarning(false);
      stop();
      keepStopping();
    }, endAt - now);
    return () => {
      clearTimeout(warn);
      clearTimeout(end);
      stopRetrying();
      if (hide !== undefined) {
        clearTimeout(hide);
      }
    };
  }, [castKey, active, limited]);

  return {warning};
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
  onWarn?: () => void;
  /** Stops a cast of `kind`: at 5:00, and again every 10 s while it's still on. */
  onStop: (kind: CastKind) => void;
};

/**
 * The free cast as App runs it. The timer belongs to the newest cast:
 * AirPlay mirroring or a browser share (App calls startCast when one starts
 * or takes over), or AirPlay audio-only playing with nothing on screen.
 * Audio that starts during a share doesn't restart the share's 5 minutes;
 * audio still playing when the share stops becomes the cast, with its own.
 * At 5:00 only the cast that ran out is stopped, and the end screen stays up
 * until it's really off (`closeEnd` waits for that), unless the TV unlocks.
 */
export function useFreeCastSession({mode, audio, unlocked, ready = true, onWarn, onStop}: SessionOptions): {
  warning: boolean;
  /** True from 5:00 until the end screen closes. */
  ended: boolean;
  /** A cast started or took over: a new 5 minutes, and the end screen closes. */
  startCast: (kind: CastKind) => void;
  /** Back, the Back row or the idle wait on the end screen. */
  closeEnd: () => void;
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

  const {warning} = useFreeCast({
    castKey: cast.key,
    active,
    unlocked,
    ready,
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

  return {warning, ended, startCast, closeEnd};
}

/** The 4:00 banner: a bottom corner of the cast, never in the remote's way. */
export const FreeCastBanner = ({visible}: {visible: boolean}) =>
  visible ? (
    <View pointerEvents="none" style={styles.banner}>
      <Text style={styles.bannerText}>
        1 minute left on this free cast · Unlock unlimited casts in CastAir's Settings
      </Text>
    </View>
  ) : null;

type EndProps = Omit<React.ComponentProps<typeof PlansScreen>, 'title'>;

/**
 * The plans under "Free casts last 5 minutes". Back, the Back row, or 60 s
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
      title="Free casts last 5 minutes"
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
