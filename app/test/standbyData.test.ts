/*
 * Tests for the standby data fetchers.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {SERVER_URL} from '../src/config';
import {fetchStandby, fetchWallpaper, searchPlaces} from '../src/standby/data';

const info = {
  location: {
    name: 'Cambridge',
    region: 'Cambridgeshire',
    country: 'United Kingdom',
    countryCode: 'GB',
    source: 'place',
  },
  time: {timeZone: 'Europe/London', utcOffsetMinutes: 0, next: null},
  weather: {tempC: 6, symbol: 'clearsky_night'},
};
const ok = (body: unknown) => jest.fn(() => Promise.resolve({status: 200, json: () => Promise.resolve(body)}));
const urlOf = (fn: jest.Mock) => (fn.mock.calls[0] as unknown[])[0];

describe('fetchStandby', () => {
  it('requests weather and returns the body', async () => {
    const f = ok(info);
    expect(await fetchStandby({placeId: null, weather: true, timeZone: null}, f as never)).toEqual(info);
    expect(urlOf(f)).toBe(`${SERVER_URL}/api/standby?weather=1`);
  });
  it('adds place and tz', async () => {
    const f = ok(info);
    await fetchStandby({placeId: '123', weather: true, timeZone: 'Europe/London'}, f as never);
    expect(urlOf(f)).toBe(`${SERVER_URL}/api/standby?weather=1&place=123&tz=Europe%2FLondon`);
  });
  it('weather=0 when off', async () => {
    const f = ok(info);
    await fetchStandby({placeId: null, weather: false, timeZone: null}, f as never);
    expect(urlOf(f)).toBe(`${SERVER_URL}/api/standby?weather=0`);
  });
  it('null fields stay null', async () => {
    const f = ok({location: null, time: null, weather: null});
    expect(await fetchStandby({placeId: null, weather: true, timeZone: null}, f as never)).toEqual({
      location: null,
      time: null,
      weather: null,
    });
  });
  it('null on reject', async () => {
    const f = jest.fn(() => Promise.reject(new Error('offline')));
    expect(await fetchStandby({placeId: null, weather: true, timeZone: null}, f as never)).toBeNull();
  });
  it('null on non-200', async () => {
    const f = jest.fn(() => Promise.resolve({status: 502, json: () => Promise.resolve(info)}));
    expect(await fetchStandby({placeId: null, weather: true, timeZone: null}, f as never)).toBeNull();
  });
  it('null on bad JSON', async () => {
    const f = jest.fn(() => Promise.resolve({status: 200, json: () => Promise.reject(new Error('bad'))}));
    expect(await fetchStandby({placeId: null, weather: true, timeZone: null}, f as never)).toBeNull();
  });
  it('gives up after 10 s', async () => {
    jest.useFakeTimers();
    try {
      const f = jest.fn(() => new Promise(() => undefined));
      const p = fetchStandby({placeId: null, weather: true, timeZone: null}, f as never);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(await p).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('searchPlaces', () => {
  const places = [{id: '2653941', name: 'Cambridge', region: 'England', country: 'United Kingdom'}];
  it('does not fetch for short queries', async () => {
    const f = ok({places});
    expect(await searchPlaces('n', f as never)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
  it('unwraps the places array', async () => {
    const f = ok({places});
    expect(await searchPlaces('camb', f as never)).toEqual(places);
    expect(urlOf(f)).toBe(`${SERVER_URL}/api/places?q=camb`);
  });
  it('[] on failure', async () => {
    const f = jest.fn(() => Promise.reject(new Error('offline')));
    expect(await searchPlaces('camb', f as never)).toEqual([]);
  });
});

describe('fetchWallpaper', () => {
  const wallpaper = {
    imageUrl: 'https://images.unsplash.com/photo-1',
    color: '#336699',
    photographer: 'Ada',
    photographerUrl: 'https://unsplash.com/@ada',
    unsplashUrl: 'https://unsplash.com/photos/1',
    changesAt: '2026-11-22T00:00:00.000Z',
  };
  it('builds the URL and returns the wallpaper', async () => {
    const f = ok(wallpaper);
    expect(await fetchWallpaper({photos: 'landscape', every: 'hour'}, f as never)).toEqual(wallpaper);
    expect(urlOf(f)).toBe(`${SERVER_URL}/api/wallpaper?photos=landscape&every=hour`);
  });
  it('returns null for {wallpaper:null}, HTTP 500, a non-https imageUrl, or a missing photographer', async () => {
    const opts = {photos: 'random', every: 'day'} as const;
    expect(await fetchWallpaper(opts, ok({wallpaper: null}) as never)).toBeNull();
    const err = jest.fn(() => Promise.resolve({status: 500, json: () => Promise.resolve({})}));
    expect(await fetchWallpaper(opts, err as never)).toBeNull();
    expect(await fetchWallpaper(opts, ok({...wallpaper, imageUrl: 'http://x.test/a.jpg'}) as never)).toBeNull();
    expect(await fetchWallpaper(opts, ok({...wallpaper, photographer: undefined}) as never)).toBeNull();
    const down = jest.fn(() => Promise.reject(new Error('offline')));
    expect(await fetchWallpaper(opts, down as never)).toBeNull();
  });
});
