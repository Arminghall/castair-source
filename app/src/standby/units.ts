/*
 * Standby units: temperature unit and 12/24-hour defaults by country.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type {Prefs} from '../Prefs';
import type {StandbyInfo} from './data';

const FAHRENHEIT = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];
const TWELVE_HOUR = ['US', 'CA', 'AU', 'NZ', 'IN', 'PH', 'PK', 'BD', 'EG', 'SA', 'MY', 'CO'];

export function defaultUnits(countryCode: string | null): {tempUnit: 'C' | 'F'; hour12: boolean} {
  const code = countryCode ? countryCode.toUpperCase() : '';
  return {tempUnit: FAHRENHEIT.includes(code) ? 'F' : 'C', hour12: TWELVE_HOUR.includes(code)};
}

/** The country that sets automatic units and date order: the TV's own region first, then the server's guess. */
export function autoCountry(tvCountry: string | null, info: StandbyInfo | null): string | null {
  return tvCountry ?? info?.location?.countryCode ?? null;
}

/** The units in use: the user's choice, or the automatic default for `autoCountry`. */
export function effectiveUnits(
  prefs: Pick<Prefs, 'tempUnit' | 'clock'>,
  tvCountry: string | null,
  info: StandbyInfo | null,
): {tempUnit: 'C' | 'F'; hour12: boolean; countryCode: string | null} {
  const countryCode = autoCountry(tvCountry, info);
  const defaults = defaultUnits(countryCode);
  return {
    countryCode,
    tempUnit: prefs.tempUnit === 'auto' ? defaults.tempUnit : prefs.tempUnit,
    hour12: prefs.clock === 'auto' ? defaults.hour12 : prefs.clock === '12',
  };
}

export function formatTemp(tempC: number, unit: 'C' | 'F'): string {
  const value = unit === 'F' ? (tempC * 9) / 5 + 32 : tempC;
  // `+ 0` turns a rounded -0 into 0, so -0.4 shows "0°".
  return `${Math.round(value) + 0}°`;
}
