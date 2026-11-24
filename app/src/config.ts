/*
 * CastAir's fixed settings.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** The name iPhones and Macs show in Screen Mirroring. One TV for now. */
export const RECEIVER_NAME = 'CastAir';

/** Where staff can get CastAir's source (AGPL-3.0 §13). */
export const SOURCE_NOTE = 'castair.app/source (github.com/Arminghall/castair-source)';

/** Where laptops go to share (the CastAir server, B8). */
export const SHARE_ADDRESS = 'castair.app/connect';

/** Brand colours (docs/castair/brand/castair-icon.svg). */
export const COLORS = {
  green: '#174D3A',
  greenDark: '#0F3328',
  cream: '#FAF8F2',
  mint: '#7FD9B0',
  muted: '#A9C2B7',
};

/** The only server the TV talks to (standby info, place search). */
export const SERVER_URL = 'https://castair.app';

/** How often the standby screen refreshes weather and time-zone info. */
export const STANDBY_REFRESH_MS = 30 * 60 * 1000;
/** Weather kept from an earlier run is hidden once it's older than this. */
export const WEATHER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** The wallpaper is asked for again after this long when the server had none or no usable change time. */
export const WALLPAPER_RETRY_MS = 15 * 60_000;
