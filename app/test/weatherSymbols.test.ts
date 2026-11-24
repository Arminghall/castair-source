/*
 * Tests for weather symbol descriptions.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {describeSymbol} from '../src/standby/weatherSymbols';

describe('describeSymbol', () => {
  it.each([
    ['partlycloudy_night', 'partly-night', 'Partly cloudy'],
    ['partlycloudy_day', 'partly-day', 'Partly cloudy'],
    ['clearsky_night', 'clear-night', 'Clear'],
    ['clearsky_day', 'clear-day', 'Clear'],
    ['fair_polartwilight', 'clear-day', 'Fair'],
    ['cloudy', 'cloudy', 'Cloudy'],
    ['fog', 'fog', 'Fog'],
    ['heavyrainshowers_day', 'rain', 'Heavy rain'],
    ['lightrain', 'rain', 'Light rain'],
    ['rainshowers_night', 'rain', 'Rain'],
    ['lightsleet', 'sleet', 'Sleet'],
    ['lightsnow', 'snow', 'Snow'],
    ['rainandthunder', 'thunder', 'Thunder'],
    ['lightsleetshowersandthunder_day', 'thunder', 'Thunder'],
  ])('%s', (code, icon, text) => {
    expect(describeSymbol(code)).toEqual({text, icon});
  });
  it('unknown codes are null', () => {
    expect(describeSymbol('nonsense')).toBeNull();
    expect(describeSymbol('unknown')).toBeNull();
  });
});
