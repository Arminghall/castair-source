/*
 * The standby view: everything a layout shows, worked out once from the
 * server's info, the prefs and the clock, so the layout only arranges it.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type {Prefs} from '../Prefs';
import {formatDate, formatTime, offsetAt} from './clock';
import type {StandbyInfo} from './data';
import {effectiveUnits, formatTemp} from './units';
import {describeSymbol} from './weatherSymbols';
import type {WeatherIcon} from './weatherSymbols';

export type StandbyView = {
  time: string;
  date: string;
  name: string;
  offline: boolean;
  connectingSender: string | null;
  /** The code laptops must type, or null: none set, offline or connecting. */
  shareCode: string | null;
  weather: {icon: WeatherIcon; temp: string; condition: string; place: string | null} | null;
  needsTown: boolean;
  /** "Photo by … on Unsplash" while a loaded photo is on screen, else null. */
  credit: string | null;
  /** A loaded photo is behind the text: the layout adds the text shadow. */
  onPhoto: boolean;
};

export type LayoutProps = {
  view: StandbyView;
  freeVersion?: boolean;
  onOpenSettings: () => void;
  /** The free-version hint opens the plans screen. */
  onOpenPlans?: () => void;
};

type ViewInput = {
  name: string;
  info: StandbyInfo | null;
  prefs: Prefs;
  nowMs: number;
  country: string | null;
  offline: boolean;
  connectingSender: string | null;
  shareCode: string | null;
  credit: string | null;
};

export function buildView({
  name,
  info,
  prefs,
  nowMs,
  country,
  offline,
  connectingSender,
  shareCode,
  credit,
}: ViewInput): StandbyView {
  const {countryCode, tempUnit, hour12} = effectiveUnits(prefs, country, info);
  // No time zone from the server: the stick's own clock, silently.
  const offsetMin = info?.time ? offsetAt(nowMs, info.time) : -new Date(nowMs).getTimezoneOffset();

  // Weather needs a chosen town (B12); until then the corner says where to set one.
  const hasTown = prefs.placeId !== null;
  const needsTown = prefs.showWeather && !hasTown;
  const described = prefs.showWeather && hasTown && info?.weather ? describeSymbol(info.weather.symbol) : null;
  const weather =
    described && info?.weather
      ? {
          icon: described.icon,
          temp: formatTemp(info.weather.tempC, tempUnit),
          condition: described.text,
          place: info.location?.name ?? null,
        }
      : null;

  return {
    time: formatTime(nowMs, offsetMin, hour12),
    date: formatDate(nowMs, offsetMin, countryCode),
    name,
    offline,
    connectingSender,
    shareCode: prefs.shareCodeOn && !offline && !connectingSender ? shareCode : null,
    weather,
    needsTown,
    credit,
    onPhoto: credit !== null,
  };
}
