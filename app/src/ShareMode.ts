/*
 * ShareMode: which share is on screen. A newcomer takes over: a browser share
 * arriving during AirPlay stops AirPlay, and AirPlay arriving during a
 * browser share ends that share (DECISIONS B5, B7).
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type Mode = 'idle' | 'airplay' | 'browser';
export type ShareEvent = 'airplayStarted' | 'airplayEnded' | 'browserStarted' | 'browserEnded';
export type ShareAction = 'stopAirplay' | 'endBrowserShare';

/** The mode after `event`, and what to stop to get there. */
export function next(mode: Mode, event: ShareEvent): {mode: Mode; actions: ShareAction[]} {
  switch (event) {
    case 'airplayStarted':
      return {mode: 'airplay', actions: mode === 'browser' ? ['endBrowserShare'] : []};
    case 'browserStarted':
      return {mode: 'browser', actions: mode === 'airplay' ? ['stopAirplay'] : []};
    case 'airplayEnded':
      return {mode: mode === 'airplay' ? 'idle' : mode, actions: []};
    case 'browserEnded':
      return {mode: mode === 'browser' ? 'idle' : mode, actions: []};
  }
}
