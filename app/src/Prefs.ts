/*
 * Standby preferences, kept in AsyncStorage next to the existing mode flags.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {AsyncStorage} from './storage';
import type {StandbyInfo} from './standby/data';

export type Prefs = {
  showWeather: boolean;
  placeId: string | null;
  placeName: string | null;
  tempUnit: 'auto' | 'C' | 'F';
  clock: 'auto' | '24' | '12';
  compatibilityMode: boolean;
  badNetworkMode: boolean;
  wallpaper: 'off' | 'daily' | 'hourly';
  photos: 'random' | 'landscape' | 'graphics';
  /** The TV's switch: laptops must type the code shown on the TV (not the code itself). */
  shareCodeOn: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  showWeather: true,
  placeId: null,
  placeName: null,
  tempUnit: 'auto',
  clock: 'auto',
  compatibilityMode: false,
  badNetworkMode: false,
  wallpaper: 'off',
  photos: 'random',
  shareCodeOn: true,
};

// compatibilityMode and badNetworkMode keep the keys and '1'/'0' values App.tsx already uses.
const COMPATIBILITY_KEY = 'compatibilityMode';
const BAD_NETWORK_KEY = 'badNetworkMode';
const PREFS_KEY = 'standbyPrefs';
const CACHE_KEY = 'standbyCache';

type StoredPrefs = Omit<Prefs, 'compatibilityMode' | 'badNetworkMode'>;

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Storage trouble must never break the screen.
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const WALLPAPERS: Prefs['wallpaper'][] = ['off', 'daily', 'hourly'];
const PHOTOS: Prefs['photos'][] = ['random', 'landscape', 'graphics'];

/** The stored value if it is one of the allowed ones, else the fallback. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export async function loadPrefs(): Promise<Prefs> {
  const [stored, compatibility, badNetwork] = await Promise.all([
    read(PREFS_KEY),
    read(COMPATIBILITY_KEY),
    read(BAD_NETWORK_KEY),
  ]);
  const json = parseJson(stored);
  const {layout: _layout, ...rest} = (json && typeof json === 'object' ? json : {}) as Partial<StoredPrefs> & {
    layout?: unknown; // one layout since B17; older saves still have it
  };
  return {
    ...DEFAULT_PREFS,
    ...rest,
    wallpaper: oneOf(rest.wallpaper, WALLPAPERS, DEFAULT_PREFS.wallpaper),
    photos: oneOf(rest.photos, PHOTOS, DEFAULT_PREFS.photos),
    shareCodeOn: typeof rest.shareCodeOn === 'boolean' ? rest.shareCodeOn : DEFAULT_PREFS.shareCodeOn,
    compatibilityMode: compatibility === '1',
    badNetworkMode: badNetwork === '1',
  };
}

// savePrefs reads, merges and writes: calls run one after another, so two quick
// saves cannot lose an update.
let saveChain: Promise<unknown> = Promise.resolve();

export function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const run = async (): Promise<Prefs> => {
    const next = {...(await loadPrefs()), ...patch};
    const {compatibilityMode, badNetworkMode, ...rest} = next;
    await Promise.all([
      write(PREFS_KEY, JSON.stringify(rest)),
      write(COMPATIBILITY_KEY, compatibilityMode ? '1' : '0'),
      write(BAD_NETWORK_KEY, badNetworkMode ? '1' : '0'),
    ]);
    return next;
  };
  const result = saveChain.then(run);
  saveChain = result.catch(() => undefined);
  return result;
}

export async function loadCachedStandby(): Promise<StandbyInfo | null> {
  const json = parseJson(await read(CACHE_KEY));
  return json && typeof json === 'object' ? (json as StandbyInfo) : null;
}

export async function saveCachedStandby(info: StandbyInfo): Promise<void> {
  await write(CACHE_KEY, JSON.stringify(info));
}
