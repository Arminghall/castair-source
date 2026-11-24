/*
 * The idle screen: what staff see on the TV when nothing is mirroring.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {Dimensions, StyleSheet} from 'react-native';
import {act} from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native';

// The two native packages are tarballs scripts/build.sh installs: virtual
// mocks let the tests run before a build.
jest.mock(
  'castair-native',
  () => ({
    Receiver: {
      onEvent: jest.fn(),
      onVideo: jest.fn(),
      onAudio: jest.fn(),
      start: jest.fn(() => true),
      stop: jest.fn(),
      stats: jest.fn(() => ({connections: 0})),
      requestKeyframe: jest.fn(() => true),
      restartVideo: jest.fn(),
      resetIdentity: jest.fn(),
      setVideoLatency: jest.fn(),
      setAudioLatency: jest.fn(),
      nativeVideo: jest.fn(() => ({})),
    },
    SegmentKind: {Init: 0, Media: 1},
  }),
  {virtual: true},
);
jest.mock(
  'castair-surface',
  () => {
    const {View} = require('react-native');
    return {CastAirSurface: View};
  },
  {virtual: true},
);
jest.mock('@amazon-devices/react-native-w3cmedia', () => {
  const {View} = require('react-native');
  return {KeplerVideoSurfaceView: View, VideoPlayer: jest.fn()};
});
jest.mock('../src/KeepAwake', () => ({
  KeepAwake: jest.fn().mockImplementation(() => ({set: jest.fn()})),
}));

// The test machine's locale is en-US; the TV in these tests is British.
jest.mock('../src/standby/clock', () => ({
  ...jest.requireActual('../src/standby/clock'),
  deviceCountry: () => 'GB',
}));

import {Receiver} from 'castair-native';
import {App} from '../src/App';
import {STANDBY_REFRESH_MS} from '../src/config';
import {formatTime} from '../src/standby/clock';

// The standby screen asks the CastAir server for the weather: no network here.
beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
});

// A test that fails with fake timers on must not leave them on for the next one.
afterEach(() => {
  jest.useRealTimers();
});

// Renders the app and lets the stored prefs and cached standby info land inside act().
const renderSettled = async () => {
  const view = render(<App />);
  await act(async () => undefined);
  return view;
};

it('shows CastAir, how to share and the settings link', async () => {
  await renderSettled();
  expect(screen.getAllByText('CastAir').length).toBeGreaterThan(0);
  expect(screen.getByText(/Screen Mirroring/)).toBeTruthy();
  expect(screen.getByText(/castair\.app\/connect/)).toBeTruthy();
  expect(screen.getByText('Settings')).toBeTruthy();
  expect(screen.queryByText(/watermark/i)).toBeNull();
  // The previous app's name, spelled so the repo-wide name check skips it.
  expect(screen.queryByText(/R[o]sella/i)).toBeNull();
});

it('starts the receiver as CastAir when the Fire TV has no custom name', async () => {
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalledWith('CastAir'));
});

it("starts the receiver with the Fire TV's own name once allowed", async () => {
  const {SecurityManager} = require('@amazon-devices/security-manager-lib');
  const {KeplerIdentifiers} = require('@amazon-devices/kepler-identifiers');
  SecurityManager.getPrivilegeState.mockResolvedValueOnce('ALLOW');
  KeplerIdentifiers.getFriendlyDeviceName.mockResolvedValueOnce('Living Room');
  (Receiver.start as jest.Mock).mockClear();
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalledWith('CastAir-Living Room'));
  expect(Receiver.start).not.toHaveBeenCalledWith('CastAir');
});

// Average glyph width of the TV's sans font, as a share of the font size (a
// generous estimate, so long lines get headroom).
const GLYPH = 0.6;

it('fits the how-to line inside the screen width', async () => {
  await renderSettled();
  const width = Dimensions.get('window').width;
  const line = screen.getByText(/^Use Screen Mirroring/);
  const flatten = (node: unknown): string =>
    typeof node === 'string'
      ? node
      : Array.isArray(node)
        ? node.map(flatten).join('')
        : flatten((node as {props?: {children?: unknown}})?.props?.children ?? '');
  const text = flatten(line.props.children);
  expect(text).toContain('castair.app/connect');
  const {fontSize} = StyleSheet.flatten(line.props.style);
  expect(fontSize * text.length * GLYPH).toBeLessThanOrEqual(width * 0.9);
});

it('keeps the Settings link in the layout instead of floating over the how-to line', async () => {
  await renderSettled();
  let node = screen.getByText('Settings').parent;
  while (node && !node.props.onPress) {
    node = node.parent;
  }
  expect(StyleSheet.flatten(node?.props.style)?.position).not.toBe('absolute');
});

it('advertises the last known name at once, before the Fire TV name is read', async () => {
  const {AsyncStorage} = require('../src/storage');
  const {SecurityManager} = require('@amazon-devices/security-manager-lib');
  AsyncStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(k === 'lastReceiverName' ? 'CastAir-Cached' : null),
  );
  // A lookup that hasn't answered yet; answered at the end so nothing is left running.
  let answer: (state: string) => void = () => undefined;
  SecurityManager.getPrivilegeState.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
  (Receiver.start as jest.Mock).mockClear();
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalledWith('CastAir-Cached'));
  AsyncStorage.getItem.mockImplementation(() => Promise.resolve(null));
  await act(async () => answer('DENY'));
});

it("renames the TV when the settings screen's button gets permission for the Fire TV's name", async () => {
  const {SecurityManager} = require('@amazon-devices/security-manager-lib');
  const {KeplerIdentifiers} = require('@amazon-devices/kepler-identifiers');
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalledWith('CastAir'), {timeout: 7000});
  fireEvent.press(screen.getByText('Settings'));
  SecurityManager.requestPrivilege.mockResolvedValueOnce('ALLOW');
  KeplerIdentifiers.getFriendlyDeviceName.mockResolvedValueOnce('Living Room');
  fireEvent.press(screen.getByText('Name'));
  await waitFor(() => expect(Receiver.start).toHaveBeenLastCalledWith('CastAir-Living Room'));
}, 10000);

const cacheOf = (fetchedAt: number, utcOffsetMinutes = 0, symbol = 'cloudy') =>
  JSON.stringify({
    location: {name: 'Cambridge', region: null, country: null, countryCode: 'GB', source: 'place'},
    time: {timeZone: 'Europe/London', utcOffsetMinutes, next: null},
    weather: {tempC: 7, symbol},
    fetchedAt,
  });

const withCache = (value: string) => {
  const {AsyncStorage} = require('../src/storage');
  // A chosen town: without one the standby screen shows no weather (B12).
  const prefs = JSON.stringify({placeId: '2653941', placeName: 'Cambridge'});
  AsyncStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(k === 'standbyCache' ? value : k === 'standbyPrefs' ? prefs : null),
  );
  return () => AsyncStorage.getItem.mockImplementation(() => Promise.resolve(null));
};

it('uses the cached standby info when the fetch fails', async () => {
  const reset = withCache(cacheOf(Date.now() - 60 * 60 * 1000));
  render(<App />);
  expect(await screen.findByText('Cloudy · Cambridge')).toBeTruthy();
  expect(screen.getByText('7°')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalled();
  expect(screen.queryByText(/error|unavailable|offline/i)).toBeNull();
  reset();
});

it('hides weather older than 3 hours but keeps the cached clock offset', async () => {
  const reset = withCache(cacheOf(Date.now() - 4 * 60 * 60 * 1000, 600));
  render(<App />);
  // Ten hours ahead of UTC: the saved offset sets the clock, whatever the machine's zone is.
  const at = (ms: number) => formatTime(ms, 600, false);
  const before = at(Date.now());
  await act(async () => undefined);
  const after = at(Date.now());
  expect(screen.getByText(before === after ? before : new RegExp(`${before}|${after}`))).toBeTruthy();
  expect(screen.queryByText('7°')).toBeNull();
  expect(screen.queryByText(/Cloudy/)).toBeNull();
  reset();
});

it('hides cached weather that has no fetch time', async () => {
  const reset = withCache(JSON.stringify({...JSON.parse(cacheOf(0)), fetchedAt: undefined}));
  render(<App />);
  await act(async () => undefined);
  expect(screen.queryByText('7°')).toBeNull();
  reset();
});

it('hides the weather corner for a symbol it does not know', async () => {
  const reset = withCache(cacheOf(Date.now(), 0, 'unknown'));
  render(<App />);
  await act(async () => undefined);
  expect(screen.queryByText('7°')).toBeNull();
  reset();
});

it('flips the pill after 60 s of the receiver page having no server link', async () => {
  jest.useFakeTimers();
  render(<App />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  await fromPage({type: 'state', state: 'waiting'});
  await fromPage({type: 'state', state: 'signaling-closed'});
  await act(async () => {
    await jest.advanceTimersByTimeAsync(59_000);
  });
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1_500);
  });
  expect(screen.getByText('AirPlay only, laptop sharing unavailable')).toBeTruthy();
  await fromPage({type: 'state', state: 'waiting'});
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
});

it('does not fetch standby info while a laptop is sharing, and fetches again at idle', async () => {
  jest.useFakeTimers();
  render(<App />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  const fetchMock = global.fetch as jest.Mock;
  await fromPage({type: 'share-started', senderName: 'Windows laptop'});
  fetchMock.mockClear();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2 * STANDBY_REFRESH_MS);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await fromPage({type: 'share-ended'});
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not fetch standby info while AirPlay is mirroring', async () => {
  jest.useFakeTimers();
  const onEvent = Receiver.onEvent as jest.Mock;
  onEvent.mockClear();
  render(<App />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  act(() => onEvent.mock.calls.at(-1)[0]({type: 'mirror_video_running', running: true}));
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockClear();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2 * STANDBY_REFRESH_MS);
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('still shows the AirPlay name', async () => {
  const onEvent = Receiver.onEvent as jest.Mock;
  onEvent.mockClear();
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  act(() => onEvent.mock.calls.at(-1)[0]({type: 'started', name: 'CastAir-Front Room'}));
  expect(await screen.findByText('CastAir-Front Room')).toBeTruthy();
});

// What the WebView stand-in (test/setup.js) records.
type WebViewProbe = {
  __webView: {source: {uri: string}; onMessage(e: {nativeEvent: {data: string}}): void};
  __injected?: string[];
};
const probe = globalThis as unknown as WebViewProbe;

// Plays the receiver page: a message from the WebView to the app.
const fromPage = (msg: object) => act(() => probe.__webView.onMessage({nativeEvent: {data: JSON.stringify(msg)}}));

it('loads the bundled receiver page, hidden, named like the TV', async () => {
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  expect(probe.__webView.source.uri).toMatch(/^file:\/\/\/pkg\/assets\/raw\/receiver\.html\?name=CastAir$/);
});

it('a browser share takes over from AirPlay, and the shared screen shows', async () => {
  const onEvent = Receiver.onEvent as jest.Mock;
  onEvent.mockClear();
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  const emit = onEvent.mock.calls.at(-1)[0];
  act(() => emit({type: 'mirror_video_running', running: true}));
  (Receiver.stop as jest.Mock).mockClear();
  await fromPage({type: 'share-started', senderName: 'Windows laptop'});
  expect(Receiver.stop).toHaveBeenCalledTimes(1);
  expect(StyleSheet.flatten(screen.getByTestId('browser-share').props.style).width).toBe(
    Dimensions.get('window').width,
  );
  await fromPage({type: 'share-ended'});
  expect(StyleSheet.flatten(screen.getByTestId('browser-share').props.style).width).toBe(2);
});

it('AirPlay takes over from a browser share', async () => {
  const onEvent = Receiver.onEvent as jest.Mock;
  onEvent.mockClear();
  probe.__injected = [];
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  await fromPage({type: 'share-started', senderName: 'Windows laptop'});
  act(() => onEvent.mock.calls.at(-1)[0]({type: 'mirror_video_running', running: true}));
  expect(probe.__injected.some((js: string) => js.includes('castairHost.endShare()'))).toBe(true);
});

it("tells the receiver page the TV's name once the page is connected", async () => {
  const onEvent = Receiver.onEvent as jest.Mock;
  onEvent.mockClear();
  probe.__injected = [];
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  act(() => onEvent.mock.calls.at(-1)[0]({type: 'started', name: 'CastAir-Front Room'}));
  probe.__injected = [];
  await fromPage({type: 'state', state: 'waiting'});
  expect(probe.__injected).toContain('window.castairHost && window.castairHost.setName("CastAir-Front Room"); true;');
});

it('reconnects the receiver page on any return from the background', async () => {
  const {AppState} = require('react-native');
  const handlers: Array<(state: string) => void> = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_e: string, h: (s: string) => void) => {
    handlers.push(h);
    return {remove: jest.fn()};
  }) as never);
  probe.__injected = [];
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  act(() => handlers.forEach((h) => h('inactive')));
  expect(probe.__injected).toContain('window.castairHost && window.castairHost.onForeground(); true;');
  // Keep a working subscription for later tests (restoring the stand-in loses it).
  spy.mockImplementation((() => ({remove: jest.fn()})) as never);
});

it('reconnects if the page reports it is paused while CastAir is on screen', async () => {
  const {AppState} = require('react-native');
  const before = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true});
  probe.__injected = [];
  render(<App />);
  await waitFor(() => expect(Receiver.start).toHaveBeenCalled());
  await fromPage({type: 'state', state: 'paused'});
  expect(probe.__injected).toContain('window.castairHost && window.castairHost.onForeground(); true;');
  if (before) {
    Object.defineProperty(AppState, 'currentState', before);
  }
});

it("keeps the remembered name and retries when the Fire TV name can't be read", async () => {
  jest.useFakeTimers();
  const {AsyncStorage} = require('../src/storage');
  const {SecurityManager} = require('@amazon-devices/security-manager-lib');
  const {KeplerIdentifiers} = require('@amazon-devices/kepler-identifiers');
  AsyncStorage.getItem.mockImplementation((k: string) =>
    Promise.resolve(k === 'lastReceiverName' ? 'CastAir-Den' : null),
  );
  AsyncStorage.setItem.mockClear();
  SecurityManager.getPrivilegeState.mockRejectedValueOnce(new Error('timed out'));
  (Receiver.start as jest.Mock).mockClear();
  render(<App />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(100);
  });
  expect(Receiver.start).toHaveBeenCalledWith('CastAir-Den');
  expect(Receiver.start).not.toHaveBeenCalledWith('CastAir');
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('lastReceiverName', 'CastAir');
  SecurityManager.getPrivilegeState.mockResolvedValueOnce('ALLOW');
  KeplerIdentifiers.getFriendlyDeviceName.mockResolvedValueOnce('Front Room');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60000);
  });
  expect(Receiver.start).toHaveBeenLastCalledWith('CastAir-Front Room');
  AsyncStorage.getItem.mockImplementation(() => Promise.resolve(null));
});

describe('the 5-minute free cast', () => {
  const BANNER = "1 minute left on this free cast · Unlock unlimited casts in CastAir's Settings";
  const END_TITLE = 'Free casts last 5 minutes';
  const endShareSent = () => (probe.__injected ?? []).some((js) => js.includes('castairHost.endShare()'));
  const advance = (ms: number) =>
    act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  const start = async () => {
    jest.useFakeTimers();
    const onEvent = Receiver.onEvent as jest.Mock;
    onEvent.mockClear();
    probe.__injected = [];
    render(<App />);
    await advance(100);
    return onEvent.mock.calls.at(-1)[0] as (e: object) => void;
  };

  it('a browser share warns at 4:00, ends at 5:00 and shows the plans, then standby after 60 s', async () => {
    await start();
    expect(screen.getByText('Free version · 5-minute casts')).toBeTruthy();
    await fromPage({type: 'share-started', senderName: 'Windows laptop'});
    await advance(240_000);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(endShareSent()).toBe(false);
    await advance(60_000);
    expect(endShareSent()).toBe(true);
    await fromPage({type: 'share-ended'});
    expect(screen.getByText(END_TITLE)).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
    await advance(60_000);
    expect(screen.queryByText(END_TITLE)).toBeNull();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('an AirPlay cast ending while Settings is open stops AirPlay, shows the plans, and Back goes to standby', async () => {
    const emit = await start();
    fireEvent.press(screen.getByText('Settings'));
    act(() => emit({type: 'mirror_video_running', running: true}));
    await advance(245_000);
    expect(screen.getByText(BANNER)).toBeTruthy();
    (Receiver.stop as jest.Mock).mockClear();
    await advance(55_000);
    // The naming restart drops the AirPlay session.
    expect(Receiver.stop).toHaveBeenCalledTimes(1);
    act(() => emit({type: 'conn_destroy', connections: 0}));
    expect(screen.getByText(END_TITLE)).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
    fireEvent.press(screen.getByText('Back'));
    expect(screen.queryByText(END_TITLE)).toBeNull();
    // Standby, not the Settings page that was open under the cast.
    expect(screen.getByText(/castair\.app\/connect/)).toBeTruthy();
  });

  it('a newcomer taking over at 4:59 gets a new 5 minutes', async () => {
    const emit = await start();
    act(() => emit({type: 'mirror_video_running', running: true}));
    await advance(299_000);
    await fromPage({type: 'share-started', senderName: 'Windows laptop'});
    await advance(239_000);
    expect(screen.queryByText(END_TITLE)).toBeNull();
    expect(endShareSent()).toBe(false);
    await advance(61_000);
    expect(endShareSent()).toBe(true);
  });

  it('a new cast can start at once from the end screen', async () => {
    const emit = await start();
    act(() => emit({type: 'mirror_video_running', running: true}));
    await advance(300_000);
    act(() => emit({type: 'conn_destroy', connections: 0}));
    expect(screen.getByText(END_TITLE)).toBeTruthy();
    await fromPage({type: 'share-started', senderName: 'Windows laptop'});
    expect(screen.queryByText(END_TITLE)).toBeNull();
  });

  it('a paying TV, offline at launch, is never warned or stopped', async () => {
    const {AsyncStorage} = require('../src/storage');
    const {PurchasingService} = require('@amazon-devices/keplerscript-appstore-iap-lib');
    AsyncStorage.getItem.mockImplementation((k: string) =>
      Promise.resolve(
        k === 'unlock.state' ? JSON.stringify({unlocked: true, kind: 'lifetime', checkedAt: Date.now()}) : null,
      ),
    );
    PurchasingService.getPurchaseUpdates.mockRejectedValue(new Error('offline'));
    try {
      const emit = await start();
      act(() => emit({type: 'mirror_video_running', running: true}));
      (Receiver.stop as jest.Mock).mockClear();
      await advance(20 * 60_000);
      expect(screen.queryByText(BANNER)).toBeNull();
      expect(screen.queryByText(END_TITLE)).toBeNull();
      expect(Receiver.stop).not.toHaveBeenCalled();
    } finally {
      AsyncStorage.getItem.mockImplementation(() => Promise.resolve(null));
      PurchasingService.getPurchaseUpdates.mockReset();
      PurchasingService.getPurchaseUpdates.mockImplementation(() =>
        Promise.resolve({responseCode: 1, receiptList: [], hasMore: false}),
      );
    }
  });
});
