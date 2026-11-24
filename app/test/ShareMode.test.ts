/*
 * Which share is on screen, AirPlay or a browser share: a newcomer takes
 * over (DECISIONS B5, B7).
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {next} from '../src/ShareMode';

it('browser share takes over from AirPlay', () => {
  expect(next('airplay', 'browserStarted')).toEqual({mode: 'browser', actions: ['stopAirplay']});
});

it('AirPlay takes over from a browser share', () => {
  expect(next('browser', 'airplayStarted')).toEqual({mode: 'airplay', actions: ['endBrowserShare']});
});

it('starts either share from idle with nothing to stop', () => {
  expect(next('idle', 'airplayStarted')).toEqual({mode: 'airplay', actions: []});
  expect(next('idle', 'browserStarted')).toEqual({mode: 'browser', actions: []});
});

it('ending the mode on screen returns to idle', () => {
  expect(next('airplay', 'airplayEnded')).toEqual({mode: 'idle', actions: []});
  expect(next('browser', 'browserEnded')).toEqual({mode: 'idle', actions: []});
});

it("ending a mode that isn't showing changes nothing", () => {
  expect(next('browser', 'airplayEnded')).toEqual({mode: 'browser', actions: []});
  expect(next('airplay', 'browserEnded')).toEqual({mode: 'airplay', actions: []});
  expect(next('idle', 'browserEnded')).toEqual({mode: 'idle', actions: []});
});
