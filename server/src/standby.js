// What the TV's idle screen shows: the time zone for its clock and, once the
// user has picked a town, the town and its weather. There is no automatic
// location: IP geolocation put the office in the wrong town (B12). Nothing
// here logs or stores the location.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {zoneInfo} from './timezone.js';

/**
 * @param {{places: ReturnType<import('./places.js').loadPlaces>,
 *          weather: {current(lat: number, lon: number): Promise<object | null>},
 *          now: () => Date}} deps
 */
export function createStandby({places, weather, now}) {
  async function standby(query) {
    const placeId = query.get('place');
    const place = placeId ? places.byId(placeId) : null;
    const at = now();
    // The TV's own zone first, then the chosen town's.
    const time = zoneInfo(query.get('tz') || '', at) ?? (place ? zoneInfo(place.timeZone, at) : null);
    const wantWeather = query.get('weather') !== '0' && place !== null;
    return {
      location: place
        ? {
            name: place.name,
            region: place.region,
            country: place.country,
            countryCode: place.countryCode,
            source: 'place',
          }
        : null,
      time,
      weather: wantWeather ? await weather.current(place.lat, place.lon) : null,
    };
  }

  const search = (q) => places.search(q).map(({id, name, region, country}) => ({id, name, region, country}));

  return {standby, search};
}
