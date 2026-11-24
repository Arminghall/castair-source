/*
 * Standby data: the server's /api/standby and /api/places, with silent failure.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {SERVER_URL} from '../config';
import type {Prefs} from '../Prefs';

export type StandbyInfo = {
  location: {
    name: string;
    region: string | null;
    country: string | null;
    countryCode: string | null;
    source: 'place';
  } | null;
  time: {
    timeZone: string;
    utcOffsetMinutes: number;
    next: {at: string; utcOffsetMinutes: number} | null;
  } | null;
  weather: {tempC: number; symbol: string} | null;
  /** Epoch ms when the server answered; set on the copy kept in storage. */
  fetchedAt?: number;
};

export type PlaceHit = {id: string; name: string; region: string | null; country: string | null};

export type Wallpaper = {
  imageUrl: string;
  color: string | null;
  photographer: string;
  photographerUrl: string;
  unsplashUrl: string;
  changesAt: string | null;
};

const TIMEOUT_MS = 10_000;

type FetchFn = typeof fetch;

/** GET a JSON body, giving up after 10 s (RN fetch has no timeout option). */
async function getJson(url: string, fetchFn: FetchFn): Promise<unknown> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
  });
  try {
    const request = (async () => {
      const res = await fetchFn(url, controller ? {signal: controller.signal} : undefined);
      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.json();
    })();
    request.catch(() => undefined); // a late failure after the timeout is not an unhandled rejection
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

/** Time zone, location and (optionally) weather for the standby screen; null on any failure. */
export async function fetchStandby(
  opts: {placeId: string | null; weather: boolean; timeZone: string | null},
  fetchFn: FetchFn = fetch,
): Promise<StandbyInfo | null> {
  let url = `${SERVER_URL}/api/standby?weather=${opts.weather ? 1 : 0}`;
  if (opts.placeId) {
    url += `&place=${encodeURIComponent(opts.placeId)}`;
  }
  if (opts.timeZone) {
    url += `&tz=${encodeURIComponent(opts.timeZone)}`;
  }
  try {
    const body = (await getJson(url, fetchFn)) as Partial<StandbyInfo> | null;
    if (!body || typeof body !== 'object') {
      return null;
    }
    return {location: body.location ?? null, time: body.time ?? null, weather: body.weather ?? null};
  } catch {
    return null;
  }
}

/** Place-name search for Settings; [] on failure or a query under 2 characters. */
export async function searchPlaces(q: string, fetchFn: FetchFn = fetch): Promise<PlaceHit[]> {
  if (q.length < 2) {
    return [];
  }
  try {
    const body = (await getJson(`${SERVER_URL}/api/places?q=${encodeURIComponent(q)}`, fetchFn)) as {
      places?: PlaceHit[];
    } | null;
    return Array.isArray(body?.places) ? body.places : [];
  } catch {
    return [];
  }
}

/** The current wallpaper photo and its credit; null on any failure or an unusable answer. */
export async function fetchWallpaper(
  opts: {photos: Prefs['photos']; every: 'day' | 'hour'},
  fetchFn: FetchFn = fetch,
): Promise<Wallpaper | null> {
  const url = `${SERVER_URL}/api/wallpaper?photos=${opts.photos}&every=${opts.every}`;
  try {
    const body = (await getJson(url, fetchFn)) as Partial<Wallpaper> | null;
    if (!body || typeof body !== 'object') {
      return null;
    }
    if (typeof body.imageUrl !== 'string' || !body.imageUrl.startsWith('https://')) {
      return null;
    }
    if (typeof body.photographer !== 'string' || body.photographer === '') {
      return null;
    }
    return {
      imageUrl: body.imageUrl,
      color: typeof body.color === 'string' ? body.color : null,
      photographer: body.photographer,
      photographerUrl: typeof body.photographerUrl === 'string' ? body.photographerUrl : '',
      unsplashUrl: typeof body.unsplashUrl === 'string' ? body.unsplashUrl : '',
      changesAt: typeof body.changesAt === 'string' ? body.changesAt : null,
    };
  } catch {
    return null;
  }
}
