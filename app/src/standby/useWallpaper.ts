/*
 * useWallpaper: the standby wallpaper photo, fetched from the server and renewed when it changes.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {useEffect, useState} from 'react';
import {WALLPAPER_RETRY_MS} from '../config';
import type {Prefs} from '../Prefs';
import {fetchWallpaper} from './data';
import type {Wallpaper} from './data';

const CHANGE_MARGIN_MS = 5_000;
const MIN_WAIT_MS = 60_000;

/** Milliseconds until the next fetch: just after the photo changes, or a retry when that time is unknown or past. */
function nextDelay(wallpaper: Wallpaper | null, nowMs: number): number {
  const changesAt = wallpaper?.changesAt ? Date.parse(wallpaper.changesAt) : NaN;
  if (Number.isNaN(changesAt) || changesAt <= nowMs) {
    return WALLPAPER_RETRY_MS;
  }
  return Math.max(changesAt + CHANGE_MARGIN_MS - nowMs, MIN_WAIT_MS);
}

/**
 * The wallpaper to show, or null (off, or none yet). Fetches at once, then again
 * when the photo is due to change; a failed refresh keeps the photo already shown.
 * While not active (mirroring or sharing) nothing is fetched; going active again
 * fetches at once. Changing the photo kind refetches.
 */
export function useWallpaper(prefs: Prefs, active: boolean): Wallpaper | null {
  const [wallpaper, setWallpaper] = useState<Wallpaper | null>(null);
  const {wallpaper: mode, photos} = prefs;

  useEffect(() => {
    if (mode === 'off') {
      setWallpaper(null);
      return;
    }
    if (!active) {
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      let fresh: Wallpaper | null = null;
      try {
        fresh = await fetchWallpaper({photos, every: mode === 'hourly' ? 'hour' : 'day'});
      } catch {
        fresh = null;
      }
      if (!alive) {
        return;
      }
      if (fresh) {
        setWallpaper(fresh);
      }
      timer = setTimeout(() => run().catch(() => undefined), nextDelay(fresh, Date.now()));
    };
    run().catch(() => undefined);
    return () => {
      alive = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [mode, photos, active]);

  return mode === 'off' ? null : wallpaper;
}
