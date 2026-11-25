/*
 * Tests for the Settings page: the Settings tab, the About tab and the Location screen.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {BackHandler, StyleSheet} from 'react-native';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {Settings} from '../src/Settings';
import {DEFAULT_PREFS} from '../src/Prefs';
import type {StandbyInfo} from '../src/standby/data';
import type {UnlockState} from '../src/Unlock';

// The TV's own region, which sets automatic units before the server's guess (spec 5.3).
let mockTvCountry: string | null = 'GB';
jest.mock('../src/standby/clock', () => ({
  ...jest.requireActual('../src/standby/clock'),
  deviceCountry: () => mockTvCountry,
}));

const info: StandbyInfo = {
  location: {name: 'Cambridge', region: 'England', country: 'United Kingdom', countryCode: 'GB', source: 'place'},
  time: {timeZone: 'Europe/London', utcOffsetMinutes: 0, next: null},
  weather: null,
};

const props = {
  receiverName: 'CastAir-Front Room',
  prefs: DEFAULT_PREFS,
  info,
  serverConnected: true,
  unlockState: {unlocked: false, kind: null, checkedAt: null} as UnlockState,
  products: {},
  onBuy: jest.fn(),
  onCheckAgain: jest.fn(),
  onPrefs: jest.fn(),
  onUseFireTvName: jest.fn(),
  onClose: jest.fn(),
};
type Props = React.ComponentProps<typeof Settings>;
const show = (over: Partial<Props> = {}) => render(<Settings {...props} {...over} />);

/** Press the hardware Back button the way the TV does. */
function pressBack() {
  const calls = (BackHandler.addEventListener as jest.Mock).mock.calls.filter((c) => c[0] === 'hardwareBackPress');
  act(() => {
    calls[calls.length - 1][1]();
  });
}

beforeEach(() => {
  mockTvCountry = 'GB';
  jest.clearAllMocks();
  jest.spyOn(BackHandler, 'addEventListener');
});
const realFetch = global.fetch;
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.fetch = realFetch;
});

it('opens on the Settings tab with the TV name and current values', () => {
  show();
  expect(screen.getByText('CastAir-Front Room')).toBeTruthy();
  expect(screen.getByText('Not set')).toBeTruthy();
  expect(screen.getByText('°C (automatic)')).toBeTruthy();
  expect(screen.getByText('24-hour (automatic)')).toBeTruthy();
  expect(screen.getByText('Connected')).toBeTruthy();
  expect(screen.getByText('castair.app')).toBeTruthy();
  fireEvent.press(screen.getByText('Name'));
  expect(props.onUseFireTvName).toHaveBeenCalledTimes(1);
});

it('shows a chosen place and a missing server link', () => {
  show({prefs: {...DEFAULT_PREFS, placeId: '1', placeName: 'Leeds'}, serverConnected: false});
  expect(screen.getByText('Leeds')).toBeTruthy();
  expect(screen.getByText('Not connected')).toBeTruthy();
});

it('toggling Show weather saves it', () => {
  show();
  fireEvent.press(screen.getByText('Show weather'));
  expect(props.onPrefs).toHaveBeenCalledWith({showWeather: false});
});

it('automatic units follow the TV region before the server location', () => {
  mockTvCountry = 'US';
  show(); // the server says GB
  expect(screen.getByText('°F (automatic)')).toBeTruthy();
  expect(screen.getByText('12-hour (automatic)')).toBeTruthy();
});

it('automatic units fall back to the server location without a TV region', () => {
  mockTvCountry = null;
  show({info: {...info, location: {...info.location!, countryCode: 'US'}}});
  expect(screen.getByText('°F (automatic)')).toBeTruthy();
});

it('Temperature cycles automatic, °C, °F', () => {
  const {rerender} = show();
  fireEvent.press(screen.getByText('Temperature'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({tempUnit: 'C'});
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, tempUnit: 'C'}} />);
  fireEvent.press(screen.getByText('Temperature'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({tempUnit: 'F'});
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, tempUnit: 'F'}} />);
  expect(screen.getByText('°F')).toBeTruthy();
  fireEvent.press(screen.getByText('Temperature'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({tempUnit: 'auto'});
});

it('Clock cycles automatic, 24-hour, 12-hour', () => {
  const {rerender} = show();
  fireEvent.press(screen.getByText('Clock'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({clock: '24'});
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, clock: '24'}} />);
  fireEvent.press(screen.getByText('Clock'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({clock: '12'});
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, clock: '12'}} />);
  fireEvent.press(screen.getByText('Clock'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({clock: 'auto'});
});

const cycle = (label: string, key: 'wallpaper' | 'photos', steps: [string, string][], extra = {}) => {
  const {rerender} = show({prefs: {...DEFAULT_PREFS, ...extra}});
  for (const [from, to] of steps) {
    rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, ...extra, [key]: from}} />);
    fireEvent.press(screen.getByText(label));
    expect(props.onPrefs).toHaveBeenLastCalledWith({[key]: to});
  }
};

it('there is no Layout row (one layout since B17)', () => {
  show();
  expect(screen.queryByText('Layout')).toBeNull();
  expect(screen.queryByText(/Calm clock|Ready corner|Clock \+ card/)).toBeNull();
});

it('Wallpaper cycles Off, Daily, Hourly, Off', () => {
  show();
  expect(screen.getByText('Off')).toBeTruthy();
  cycle('Wallpaper', 'wallpaper', [
    ['off', 'daily'],
    ['daily', 'hourly'],
    ['hourly', 'off'],
  ]);
  expect(screen.getByText('Hourly')).toBeTruthy();
});

it('Photos cycles Random, Landscape, Graphics, Random', () => {
  cycle(
    'Photos',
    'photos',
    [
      ['random', 'landscape'],
      ['landscape', 'graphics'],
      ['graphics', 'random'],
    ],
    {wallpaper: 'daily'},
  );
  expect(screen.getByText('Graphics')).toBeTruthy();
});

it('Photos is disabled while Wallpaper is Off', () => {
  const {rerender} = show();
  expect(screen.getByText('Random')).toBeTruthy();
  fireEvent.press(screen.getByText('Photos'));
  expect(props.onPrefs).not.toHaveBeenCalled();
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, wallpaper: 'daily'}} />);
  fireEvent.press(screen.getByText('Photos'));
  expect(props.onPrefs).toHaveBeenCalledWith({photos: 'landscape'});
});

it('all existing rows are still present, grouped under Look and Weather', () => {
  show();
  for (const t of [
    'Name',
    'Look',
    'Wallpaper',
    'Photos',
    'Clock',
    'Weather',
    'Show weather',
    'Location',
    'Temperature',
    'Compatibility Mode',
    'Bad LAN/Wi-Fi Mode',
    'Status',
    'Address',
  ]) {
    expect(screen.getByText(t)).toBeTruthy();
  }
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  expect(screen.queryByText('Standby screen')).toBeNull();
});

it('puts the Plan row at the top of the right column, above Weather, so the left column fits the TV', () => {
  show();
  const texts = screen.getAllByText(/./).map((n) => n.props.children);
  const at = (t: string) => texts.indexOf(t);
  for (const t of ['Plan', 'CastAir Unlimited', 'Weather', 'Laptop sharing code', 'Mirroring']) {
    expect(at(t)).toBeGreaterThan(-1);
  }
  // Left column first (This TV, Look, Laptop sharing), then right (Plan, Weather, Mirroring).
  expect(at('Laptop sharing code')).toBeLessThan(at('Plan'));
  expect(at('Plan')).toBeLessThan(at('CastAir Unlimited'));
  expect(at('CastAir Unlimited')).toBeLessThan(at('Weather'));
  expect(at('Weather')).toBeLessThan(at('Mirroring'));
  expect(at('This TV')).toBeLessThan(at('Look'));
});

it('Laptop sharing code toggles On/Off and saves', () => {
  const {rerender} = show();
  expect(screen.getByText('Laptop sharing code')).toBeTruthy();
  expect(screen.getAllByText('On').length).toBeGreaterThan(0);
  fireEvent.press(screen.getByText('Laptop sharing code'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({shareCodeOn: false});
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, shareCodeOn: false}} />);
  fireEvent.press(screen.getByText('Laptop sharing code'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({shareCodeOn: true});
});

it('Bad LAN/Wi-Fi Mode is disabled while Compatibility Mode is on', () => {
  const {rerender} = show();
  fireEvent.press(screen.getByText('Bad LAN/Wi-Fi Mode'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({badNetworkMode: true});
  props.onPrefs.mockClear();
  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, compatibilityMode: true}} />);
  fireEvent.press(screen.getByText('Bad LAN/Wi-Fi Mode'));
  expect(props.onPrefs).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Compatibility Mode'));
  expect(props.onPrefs).toHaveBeenCalledWith({compatibilityMode: false});
});

it('picking a town saves the place and Remove town clears it', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.fn().mockResolvedValue({
    status: 200,
    json: () =>
      Promise.resolve({
        places: [{id: '2653941', name: 'Cambridge', region: 'Cambridgeshire', country: 'United Kingdom'}],
      }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const {rerender} = show();
  fireEvent.press(screen.getByText('Location'));
  fireEvent.changeText(screen.getByPlaceholderText('Town name'), 'camb');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(String(fetchMock.mock.calls[0][0])).toContain('/api/places?q=camb');
  expect(screen.getByText('Cambridgeshire, United Kingdom')).toBeTruthy();
  fireEvent.press(screen.getByText('Cambridgeshire, United Kingdom'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({placeId: '2653941', placeName: 'Cambridge'});
  // Back on the Settings tab after picking.
  expect(screen.getByText('Show weather')).toBeTruthy();

  rerender(<Settings {...props} prefs={{...DEFAULT_PREFS, placeId: '2653941', placeName: 'Cambridge'}} />);
  fireEvent.press(screen.getByText('Location'));
  expect(screen.getByText('Now Cambridge. Removing it hides the weather.')).toBeTruthy();
  fireEvent.press(screen.getByText('Remove town'));
  expect(props.onPrefs).toHaveBeenLastCalledWith({placeId: null, placeName: null});
});

it('About tab shows the licence, includes, credits and privacy text', () => {
  show();
  fireEvent.press(screen.getByText('About'));
  expect(screen.getByText(/GNU Affero General/)).toBeTruthy();
  expect(screen.getByText(/UxPlay \(GPL-3.0-or-later\)/)).toBeTruthy();
  expect(screen.getByText('Weather data: MET Norway (CC BY 4.0)')).toBeTruthy();
  expect(screen.getByText('Place names: GeoNames (CC BY 4.0)')).toBeTruthy();
  expect(screen.getByText('Weather, location and photos')).toBeTruthy();
  expect(screen.getByText('Wallpaper photos: Unsplash')).toBeTruthy();
  expect(screen.queryByText(/Cloudflare/)).toBeNull();
  expect(
    screen.getByText(
      "What you mirror stays on your network: it goes only from your device to this TV and is never recorded or sent anywhere else. For the clock and weather, the TV sends CastAir's server its time zone and any town you choose in Settings; the server uses them only to answer that request. If you turn on wallpapers, the TV loads photos directly from Unsplash. CastAir sends no crash reports or statistics. Amazon handles payments; CastAir's server never sees them.",
    ),
  ).toBeTruthy();
  expect(screen.getByText('Support: castair@arminghall.com')).toBeTruthy();
  expect(screen.getByText(/castair\.app\/source/)).toBeTruthy();
  expect(screen.getByText('an Arminghall app')).toBeTruthy();
  expect(screen.queryByText('Compatibility Mode')).toBeNull();
});

it('lets the About heading text shrink to the screen instead of running off it', () => {
  show();
  fireEvent.press(screen.getByText('About'));
  const block = screen.getByText('an Arminghall app').parent?.parent;
  expect(StyleSheet.flatten(block?.props.style)?.flexShrink).toBe(1);
});

it('has no automatic location: no town shows Not set and no remove row', () => {
  show();
  fireEvent.press(screen.getByText('Location'));
  expect(screen.queryByText('Remove town')).toBeNull();
  expect(screen.queryByText(/automatic location|from your network/)).toBeNull();
  expect(screen.getByPlaceholderText('Town name').props.autoFocus).toBe(true);
});

it('sends RIGHT from the search box and the remove row to the first match', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    json: () =>
      Promise.resolve({
        places: [
          {id: '1', name: 'Cambridge', region: 'Cambridgeshire', country: 'United Kingdom'},
          {id: '2', name: 'Northampton', region: 'England', country: 'United Kingdom'},
        ],
      }),
  }) as unknown as typeof fetch;
  // The test renderer has no native node handles: give the first match one.
  jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(42);
  show({prefs: {...DEFAULT_PREFS, placeId: '9', placeName: 'Leeds'}});
  fireEvent.press(screen.getByText('Location'));
  const box = screen.getByPlaceholderText('Town name');
  expect(box.props.nextFocusRight).toBeUndefined();
  // With a town, the Remove town row takes focus and the keyboard stays shut.
  expect(box.props.autoFocus).toBe(false);
  fireEvent.changeText(box, 'nor');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByPlaceholderText('Town name').props.nextFocusRight).toBe(42);
  let row = screen.getByText('Remove town').parent;
  while (row && row.props.nextFocusRight === undefined) {
    row = row.parent;
  }
  expect(row?.props.nextFocusRight).toBe(42);
});

it('Back from Location returns to Settings; Back from Settings closes', () => {
  show();
  fireEvent.press(screen.getByText('Location'));
  expect(screen.getByText('Search for a town')).toBeTruthy();
  pressBack();
  expect(props.onClose).not.toHaveBeenCalled();
  expect(screen.getByText('Show weather')).toBeTruthy();
  pressBack();
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

describe('CastAir Unlimited row', () => {
  it("free version shows this week's time left", () => {
    const view = show({freeLeftMs: 24 * 60_000});
    expect(screen.getByText('Free · 24 of 30 min left · resets Monday 05:00')).toBeTruthy();
    view.rerender(<Settings {...props} freeLeftMs={0} />);
    expect(screen.getByText('Free · none left · resets Monday 05:00')).toBeTruthy();
    view.rerender(<Settings {...props} freeLeftMs={null} />);
    expect(screen.getByText('Free version')).toBeTruthy();
  });
  it('free version opens the plans screen, and Back returns to Settings', () => {
    show({freeLeftMs: 30 * 60_000});
    expect(screen.getByText('Free · 30 of 30 min left · resets Monday 05:00')).toBeTruthy();
    fireEvent.press(screen.getByText('CastAir Unlimited'));
    expect(screen.getByText('Unlock CastAir')).toBeTruthy();
    pressBack();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('CastAir Unlimited')).toBeTruthy();
  });
  it('opened straight onto the plans (from the standby hint), Back returns to Settings', () => {
    show({initialTab: 'plans'});
    expect(screen.getByText('Unlock CastAir')).toBeTruthy();
    pressBack();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('CastAir Unlimited')).toBeTruthy();
  });
  it('subscription shows On · subscription and opens nothing', () => {
    show({unlockState: {unlocked: true, kind: 'subscription', checkedAt: 1}});
    expect(screen.getByText('On · subscription')).toBeTruthy();
    fireEvent.press(screen.getByText('CastAir Unlimited'));
    expect(screen.queryByText('Unlock CastAir')).toBeNull();
  });
  it('lifetime shows On · lifetime', () => {
    show({unlockState: {unlocked: true, kind: 'lifetime', checkedAt: 1}});
    expect(screen.getByText('On · lifetime')).toBeTruthy();
  });
});
