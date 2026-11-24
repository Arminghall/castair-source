/*
 * Standby weather: MET Norway symbol codes to a short label and an icon.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type WeatherIcon =
  | 'clear-day'
  | 'clear-night'
  | 'partly-day'
  | 'partly-night'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'sleet'
  | 'snow'
  | 'thunder';

/** A label and icon for a MET symbol code; null for one we don't know (the server sends 'unknown'). */
export function describeSymbol(code: string): {text: string; icon: WeatherIcon} | null {
  const night = /_night$/.test(code);
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  const dayNight = (kind: 'clear' | 'partly'): WeatherIcon => `${kind}-${night ? 'night' : 'day'}`;

  if (base === 'clearsky') {
    return {text: 'Clear', icon: dayNight('clear')};
  }
  if (base === 'fair') {
    return {text: 'Fair', icon: dayNight('clear')};
  }
  if (base === 'partlycloudy') {
    return {text: 'Partly cloudy', icon: dayNight('partly')};
  }
  if (base === 'cloudy') {
    return {text: 'Cloudy', icon: 'cloudy'};
  }
  if (base === 'fog') {
    return {text: 'Fog', icon: 'fog'};
  }
  if (base.includes('thunder')) {
    return {text: 'Thunder', icon: 'thunder'};
  }
  if (base.includes('sleet')) {
    return {text: 'Sleet', icon: 'sleet'};
  }
  if (base.includes('snow')) {
    return {text: 'Snow', icon: 'snow'};
  }
  if (base.includes('rain') || base.includes('showers')) {
    const text = base.startsWith('light') ? 'Light rain' : base.startsWith('heavy') ? 'Heavy rain' : 'Rain';
    return {text, icon: 'rain'};
  }
  return null;
}
