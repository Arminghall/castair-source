/*
 * useStandby: the standby screen's data (cached first, then the server) and clock.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {useEffect, useState} from 'react';
import {STANDBY_REFRESH_MS, WEATHER_MAX_AGE_MS} from '../config';
import {loadCachedStandby, saveCachedStandby} from '../Prefs';
import type {Prefs} from '../Prefs';
import {deviceTimeZone} from './clock';
import {fetchStandby} from './data';
import type {StandbyInfo} from './data';

/**
 * What to show from the copy in storage: the clock's saved offsets, and the
 * weather only while it is recent (a restart with no internet must not show
 * yesterday's weather as current).
 */
function fromCache(cached: StandbyInfo, nowMs: number): StandbyInfo {
  const fresh = typeof cached.fetchedAt === 'number' && nowMs - cached.fetchedAt <= WEATHER_MAX_AGE_MS;
  const time = typeof cached.time?.utcOffsetMinutes === 'number' ? cached.time : null;
  return {location: cached.location ?? null, time, weather: fresh ? (cached.weather ?? null) : null};
}

/**
 * The info to show and the current time (ticking at each minute boundary).
 * Weather is asked for only once a town is chosen. It refreshes at mount, every STANDBY_REFRESH_MS, when the place or the
 * weather switch changes, and when refreshKey changes (Settings closed).
 * A failed fetch keeps what is already shown. While not active (mirroring or
 * sharing) nothing ticks or fetches; going active again refreshes at once.
 */
export function useStandby(prefs: Prefs, refreshKey: number, active = true): {info: StandbyInfo | null; nowMs: number} {
  const [info, setInfo] = useState<StandbyInfo | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    loadCachedStandby()
      .then((cached) => {
        if (alive && cached) {
          setInfo((current) => current ?? fromCache(cached, Date.now()));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    let alive = true;
    const refresh = async () => {
      const fresh = await fetchStandby({
        placeId: prefs.placeId,
        // No town, no weather: CastAir never guesses the location (B12).
        weather: prefs.showWeather && prefs.placeId !== null,
        timeZone: deviceTimeZone(),
      });
      if (alive && fresh) {
        setInfo(fresh);
        saveCachedStandby({...fresh, fetchedAt: Date.now()}).catch(() => undefined);
      }
    };
    refresh().catch(() => undefined);
    const timer = setInterval(() => refresh().catch(() => undefined), STANDBY_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [prefs.placeId, prefs.showWeather, refreshKey, active]);

  useEffect(() => {
    if (!active) {
      return;
    }
    setNowMs(Date.now());
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNowMs(Date.now());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(timer);
  }, [active]);

  return {info, nowMs};
}
