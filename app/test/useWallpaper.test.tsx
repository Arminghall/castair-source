/*
 * Tests for useWallpaper.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';
import {DEFAULT_PREFS} from '../src/Prefs';
import type {Prefs} from '../src/Prefs';
import {WALLPAPER_RETRY_MS} from '../src/config';
import {fetchWallpaper} from '../src/standby/data';
import {useWallpaper} from '../src/standby/useWallpaper';

jest.mock('../src/standby/data', () => ({
  ...jest.requireActual('../src/standby/data'),
  fetchWallpaper: jest.fn(),
}));

const mockFetch = fetchWallpaper as jest.Mock;

const photo = (n: number, changesAt: string | null) => ({
  imageUrl: `https://images.unsplash.com/photo-${n}`,
  color: null,
  photographer: `P${n}`,
  photographerUrl: 'https://unsplash.com/@p',
  unsplashUrl: 'https://unsplash.com/photos/p',
  changesAt,
});

function Probe({prefs, active = true}: {prefs: Prefs; active?: boolean}) {
  const w = useWallpaper(prefs, active);
  return <Text testID="v">{w ? w.photographer : 'none'}</Text>;
}

const shown = (r: ReturnType<typeof render>) => r.getByTestId('v').props.children;
const flush = () => act(async () => {});
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const daily: Prefs = {...DEFAULT_PREFS, wallpaper: 'daily'};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  mockFetch.mockReset();
});
afterEach(() => jest.useRealTimers());

describe('useWallpaper', () => {
  it('off: returns null and never fetches', async () => {
    const r = render(<Probe prefs={DEFAULT_PREFS} />);
    await flush();
    expect(shown(r)).toBe('none');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('daily: fetches with every=day and returns the wallpaper', async () => {
    mockFetch.mockResolvedValue(photo(1, '2026-11-22T00:00:00Z'));
    const r = render(<Probe prefs={daily} />);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith({photos: 'random', every: 'day'});
    expect(shown(r)).toBe('P1');
  });

  it('hourly maps to every=hour', async () => {
    mockFetch.mockResolvedValue(photo(1, '2026-11-21T13:00:00Z'));
    render(<Probe prefs={{...daily, wallpaper: 'hourly'}} />);
    await flush();
    expect(mockFetch).toHaveBeenCalledWith({photos: 'random', every: 'hour'});
  });

  it('refetches when changesAt passes', async () => {
    mockFetch
      .mockResolvedValueOnce(photo(1, '2026-11-21T13:00:00Z'))
      .mockResolvedValueOnce(photo(2, '2026-11-21T14:00:00Z'));
    const r = render(<Probe prefs={daily} />);
    await flush();
    expect(shown(r)).toBe('P1');
    await advance(60 * 60_000 + 4_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(shown(r)).toBe('P2');
  });

  it('retries after 15 minutes when the server answers null', async () => {
    mockFetch.mockResolvedValueOnce(null).mockResolvedValueOnce(photo(1, '2026-11-22T00:00:00Z'));
    const r = render(<Probe prefs={daily} />);
    await flush();
    expect(shown(r)).toBe('none');
    await advance(WALLPAPER_RETRY_MS - 1_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await advance(2_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(shown(r)).toBe('P1');
  });

  it('retries after 15 minutes when changesAt is missing or past', async () => {
    mockFetch.mockResolvedValue(photo(1, '2026-11-21T11:00:00Z'));
    render(<Probe prefs={daily} />);
    await flush();
    await advance(WALLPAPER_RETRY_MS + 1_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh keeps the photo already shown', async () => {
    mockFetch.mockResolvedValueOnce(photo(1, '2026-11-21T13:00:00Z')).mockResolvedValueOnce(null);
    const r = render(<Probe prefs={daily} />);
    await flush();
    await advance(60 * 60_000 + 6_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(shown(r)).toBe('P1');
  });

  it('inactive: no fetch; becoming active fetches at once', async () => {
    mockFetch.mockResolvedValue(photo(1, '2026-11-22T00:00:00Z'));
    const r = render(<Probe prefs={daily} active={false} />);
    await flush();
    expect(mockFetch).not.toHaveBeenCalled();
    r.rerender(<Probe prefs={daily} active />);
    await flush();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(shown(r)).toBe('P1');
  });

  it('switching to off returns null at once', async () => {
    mockFetch.mockResolvedValue(photo(1, '2026-11-22T00:00:00Z'));
    const r = render(<Probe prefs={daily} />);
    await flush();
    expect(shown(r)).toBe('P1');
    r.rerender(<Probe prefs={DEFAULT_PREFS} />);
    expect(shown(r)).toBe('none');
  });

  it('changing photos refetches', async () => {
    mockFetch
      .mockResolvedValueOnce(photo(1, '2026-11-22T00:00:00Z'))
      .mockResolvedValueOnce(photo(2, '2026-11-22T00:00:00Z'));
    const r = render(<Probe prefs={daily} />);
    await flush();
    r.rerender(<Probe prefs={{...daily, photos: 'graphics'}} />);
    await flush();
    expect(mockFetch).toHaveBeenLastCalledWith({photos: 'graphics', every: 'day'});
    expect(shown(r)).toBe('P2');
  });
});
