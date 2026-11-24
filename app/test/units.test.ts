/*
 * Tests for standby units.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {autoCountry, defaultUnits, effectiveUnits, formatTemp} from '../src/standby/units';

describe('defaultUnits', () => {
  it('GB is C and 24-hour', () => expect(defaultUnits('GB')).toEqual({tempUnit: 'C', hour12: false}));
  it('US is F and 12-hour', () => expect(defaultUnits('US')).toEqual({tempUnit: 'F', hour12: true}));
  it('null is C and 24-hour', () => expect(defaultUnits(null)).toEqual({tempUnit: 'C', hour12: false}));
  it('AU is C and 12-hour', () => expect(defaultUnits('AU')).toEqual({tempUnit: 'C', hour12: true}));
  it('LR is F and 24-hour', () => expect(defaultUnits('LR')).toEqual({tempUnit: 'F', hour12: false}));
});

describe('formatTemp', () => {
  it('Celsius', () => expect(formatTemp(7, 'C')).toBe('7°'));
  it('Fahrenheit', () => expect(formatTemp(7, 'F')).toBe('45°'));
  it('never shows -0', () => expect(formatTemp(-0.4, 'C')).toBe('0°'));
  it('keeps real negatives', () => expect(formatTemp(-3, 'C')).toBe('-3°'));
});

describe('autoCountry and effectiveUnits', () => {
  const info = {
    location: {name: 'x', region: null, country: null, countryCode: 'US', source: 'place' as const},
    time: null,
    weather: null,
  };
  const auto = {tempUnit: 'auto' as const, clock: 'auto' as const};
  it('the TV region comes before the server location', () => {
    expect(autoCountry('GB', info)).toBe('GB');
    expect(effectiveUnits(auto, 'GB', info)).toEqual({countryCode: 'GB', tempUnit: 'C', hour12: false});
  });
  it('falls back to the server location, then null', () => {
    expect(autoCountry(null, info)).toBe('US');
    expect(autoCountry(null, null)).toBeNull();
  });
  it('explicit choices win', () => {
    expect(effectiveUnits({tempUnit: 'F', clock: '12'}, 'GB', null)).toMatchObject({tempUnit: 'F', hour12: true});
  });
});
