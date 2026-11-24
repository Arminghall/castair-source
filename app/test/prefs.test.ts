/*
 * Tests for standby preferences storage.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {AsyncStorage} from '../src/storage';
import {DEFAULT_PREFS, loadCachedStandby, loadPrefs, saveCachedStandby, savePrefs} from '../src/Prefs';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => Promise.resolve(store.get(k) ?? null));
  (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    store.set(k, v);
    return Promise.resolve();
  });
});

describe('prefs', () => {
  it('the share code switch defaults to on, and saves', async () => {
    expect(DEFAULT_PREFS.shareCodeOn).toBe(true);
    expect((await loadPrefs()).shareCodeOn).toBe(true);
    await savePrefs({shareCodeOn: false});
    expect((await loadPrefs()).shareCodeOn).toBe(false);
  });
  it('defaults when storage is empty', async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });
  it('savePrefs persists and merges', async () => {
    expect(await savePrefs({clock: '12'})).toEqual({...DEFAULT_PREFS, clock: '12'});
    expect(await savePrefs({placeId: '1', placeName: 'Cambridge'})).toEqual({
      ...DEFAULT_PREFS,
      clock: '12',
      placeId: '1',
      placeName: 'Cambridge',
    });
    expect(await loadPrefs()).toEqual({...DEFAULT_PREFS, clock: '12', placeId: '1', placeName: 'Cambridge'});
  });
  it('two un-awaited saves both persist', async () => {
    // A slow store makes an unserialised read-modify-write lose the first patch.
    (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) => {
      const value = store.get(k) ?? null; // read now, answered late
      return new Promise((resolve) => setTimeout(() => resolve(value), 5));
    });
    const first = savePrefs({clock: '12'});
    const second = savePrefs({tempUnit: 'F'});
    await Promise.all([first, second]);
    expect(await loadPrefs()).toEqual({...DEFAULT_PREFS, clock: '12', tempUnit: 'F'});
  });
  it('reads the existing mode flags', async () => {
    store.set('compatibilityMode', '1');
    store.set('badNetworkMode', '0');
    expect(await loadPrefs()).toEqual({...DEFAULT_PREFS, compatibilityMode: true});
  });
  it('writes the mode flags in the existing format', async () => {
    await savePrefs({badNetworkMode: true});
    expect(store.get('badNetworkMode')).toBe('1');
    expect(store.get('compatibilityMode')).toBe('0');
    expect(JSON.parse(store.get('standbyPrefs') as string)).not.toHaveProperty('badNetworkMode');
  });
  it('ignores corrupt stored JSON', async () => {
    store.set('standbyPrefs', '{nope');
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });
  it('survives storage failures', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation(() => Promise.reject(new Error('x')));
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});

describe('wallpaper prefs and the old layout field', () => {
  it('defaults wallpaper off, photos random, and has no layout (one layout since B17)', async () => {
    expect(DEFAULT_PREFS).toMatchObject({wallpaper: 'off', photos: 'random'});
    expect('layout' in (await loadPrefs())).toBe(false);
  });
  it('an unknown stored wallpaper/photos value loads as the default', async () => {
    store.set('standbyPrefs', JSON.stringify({wallpaper: 'weekly', photos: 'cats', clock: '12'}));
    expect(await loadPrefs()).toEqual({...DEFAULT_PREFS, clock: '12'});
    store.set('standbyPrefs', JSON.stringify({wallpaper: null}));
    expect(await loadPrefs()).toMatchObject({wallpaper: 'off', photos: 'random'});
  });
  it('a stored layout is dropped on load', async () => {
    store.set('standbyPrefs', JSON.stringify({layout: 'corner', clock: '12'}));
    const loaded = await loadPrefs();
    expect('layout' in loaded).toBe(false);
    expect(loaded).toEqual({...DEFAULT_PREFS, clock: '12'});
    store.set('standbyPrefs', JSON.stringify({layout: 5}));
    expect('layout' in (await loadPrefs())).toBe(false);
  });
  it('saves and reloads wallpaper and photos, and no longer writes a layout', async () => {
    store.set('standbyPrefs', JSON.stringify({layout: 'card'}));
    await savePrefs({wallpaper: 'hourly', photos: 'graphics'});
    expect(await loadPrefs()).toMatchObject({wallpaper: 'hourly', photos: 'graphics'});
    expect(store.get('standbyPrefs')).not.toContain('layout');
  });
});

describe('standby cache', () => {
  const info = {
    location: null,
    time: {timeZone: 'Europe/London', utcOffsetMinutes: 0, next: null},
    weather: {tempC: 6, symbol: 'fog'},
  };
  it('is null when empty', async () => expect(await loadCachedStandby()).toBeNull());
  it('round-trips', async () => {
    await saveCachedStandby(info);
    expect(await loadCachedStandby()).toEqual(info);
  });
});
