/*
 * Tests for the standby screen on the TV.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react-native';
import {StandbyScreen} from '../src/StandbyScreen';
import {DEFAULT_PREFS} from '../src/Prefs';
import {WALLPAPER_RETRY_MS} from '../src/config';
import type {StandbyInfo, Wallpaper} from '../src/standby/data';

const NOW = Date.parse('2026-11-20T14:32:00Z');

const london: StandbyInfo = {
  location: {name: 'Cambridge', region: 'England', country: 'United Kingdom', countryCode: 'GB', source: 'place'},
  time: {timeZone: 'Europe/London', utcOffsetMinutes: 0, next: null},
  weather: {tempC: 7, symbol: 'cloudy'},
};

type Props = React.ComponentProps<typeof StandbyScreen>;
const base: Props = {
  name: 'CastAir-Front Room',
  info: london,
  prefs: {...DEFAULT_PREFS, placeId: '2653941', placeName: 'Cambridge'},
  nowMs: NOW,
  country: null,
  serverConnected: true,
  connectingSender: null,
  onOpenSettings: jest.fn(),
};
const show = (over: Partial<Props> = {}) => render(<StandbyScreen {...base} {...over} />);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('shows time, date, name and CastAir is ready', () => {
  show();
  expect(screen.getByText('14:32')).toBeTruthy();
  expect(screen.getByText('Friday 20 November')).toBeTruthy();
  expect(screen.getByText('CastAir-Front Room')).toBeTruthy();
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
  expect(screen.getByText('Settings')).toBeTruthy();
  expect(screen.getByText(/Screen Mirroring/)).toBeTruthy();
  expect(screen.getByText(/castair\.app\/connect/)).toBeTruthy();
});

it('shows weather with the town', () => {
  show();
  expect(screen.getByText('7°')).toBeTruthy();
  expect(screen.getByText('Cloudy · Cambridge')).toBeTruthy();
});

it('without a chosen town, asks for one instead of showing weather (B12)', () => {
  // Cached info from before B12 may still hold a guessed town and its weather.
  show({prefs: DEFAULT_PREFS});
  expect(screen.queryByText('7°')).toBeNull();
  expect(screen.queryByText(/Cambridge/)).toBeNull();
  expect(screen.getByText('Set your town in Settings to see the weather')).toBeTruthy();
});

it('hides weather when showWeather is off or weather is null', () => {
  const off = show({prefs: {...base.prefs, showWeather: false}});
  expect(screen.queryByText(/Set your town/)).toBeNull();
  expect(screen.queryByText('7°')).toBeNull();
  expect(screen.queryByText(/Cambridge/)).toBeNull();
  off.unmount();
  show({info: {...london, weather: null}});
  expect(screen.queryByText(/Cambridge/)).toBeNull();
  expect(screen.queryByText(/Set your town/)).toBeNull();
  expect(screen.getByText('14:32')).toBeTruthy();
});

it('uses 12-hour and °F for a US location on auto', () => {
  show({info: {...london, location: {...london.location!, name: 'Austin', countryCode: 'US'}}});
  expect(screen.getByText('2:32 PM')).toBeTruthy();
  expect(screen.getByText('45°')).toBeTruthy();
  expect(screen.getByText('Friday, November 20')).toBeTruthy();
});

it('an explicit clock and unit beat the location', () => {
  show({prefs: {...base.prefs, clock: '12', tempUnit: 'F'}});
  expect(screen.getByText('2:32 PM')).toBeTruthy();
  expect(screen.getByText('45°')).toBeTruthy();
});

it('falls back to the device clock when the server sent no time', () => {
  show({info: null});
  expect(screen.getByText(/^\d{1,2}:\d{2}/)).toBeTruthy();
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
});

it('pill waits 60 s before showing AirPlay only', () => {
  const view = show({serverConnected: false});
  act(() => jest.advanceTimersByTime(59_000));
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1_000));
  expect(screen.getByText('AirPlay only, laptop sharing unavailable')).toBeTruthy();
  expect(screen.queryByText('CastAir is ready')).toBeNull();
  view.rerender(<StandbyScreen {...base} serverConnected />);
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
});

it('a reconnect inside the 60 s restarts the wait', () => {
  const view = show({serverConnected: false});
  act(() => jest.advanceTimersByTime(40_000));
  view.rerender(<StandbyScreen {...base} serverConnected />);
  view.rerender(<StandbyScreen {...base} serverConnected={false} />);
  act(() => jest.advanceTimersByTime(40_000));
  expect(screen.getByText('CastAir is ready')).toBeTruthy();
});

it('Connecting replaces the how-to line and hides Settings', () => {
  show({connectingSender: 'Sam’s iPhone'});
  expect(screen.getByText('Connecting to Sam’s iPhone…')).toBeTruthy();
  expect(screen.queryByText(/Screen Mirroring/)).toBeNull();
  expect(screen.queryByText('Settings')).toBeNull();
});

it('pressing Settings calls onOpenSettings', () => {
  const onOpenSettings = jest.fn();
  show({onOpenSettings});
  fireEvent.press(screen.getByText('Settings'));
  expect(onOpenSettings).toHaveBeenCalledTimes(1);
});

it('moves the content every 3 minutes, and the streams twice as far', () => {
  show();
  const shift = (id: string) => {
    const t = (screen.getByTestId(id).props.style as Array<{transform?: Array<Record<string, number>>}>)
      .flat(2)
      .find((s) => s?.transform)?.transform;
    return {x: t?.[0].translateX ?? 0, y: t?.[1].translateY ?? 0};
  };
  const first = shift('standby-content');
  act(() => jest.advanceTimersByTime(3 * 60_000));
  const second = shift('standby-content');
  expect(second).not.toEqual(first);
  expect(Math.hypot(second.x, second.y)).toBeCloseTo(Math.hypot(first.x, first.y), 5);
  const streams = shift('standby-streams');
  expect(streams.x).toBeCloseTo(second.x * 2, 5);
  expect(streams.y).toBeCloseTo(second.y * 2, 5);
});

const annie: Wallpaper = {
  imageUrl: 'https://images.unsplash.com/photo-1?w=1920',
  color: '#405060',
  photographer: 'Annie Spratt',
  photographerUrl: 'https://unsplash.com/@anniespratt',
  unsplashUrl: 'https://unsplash.com/photos/1',
  changesAt: null,
};
const CREDIT = 'Photo by Annie Spratt on Unsplash';
const flatStyle = (id: string) =>
  Object.assign({}, ...[screen.getByTestId(id).props.style].flat(3).filter(Boolean)) as Record<string, unknown>;
const textStyle = (text: string) =>
  Object.assign({}, ...[screen.getByText(text).props.style].flat(3).filter(Boolean)) as Record<string, unknown>;

it('with a wallpaper, shows the photo but no credit until it loads', () => {
  show({wallpaper: annie});
  const photo = screen.getByTestId('standby-photo');
  expect(photo.props.source).toEqual({uri: annie.imageUrl});
  expect(flatStyle('standby-photo').opacity).toBe(0);
  expect(screen.queryByText(CREDIT)).toBeNull();
  fireEvent(photo, 'load');
  expect(flatStyle('standby-photo').opacity).not.toBe(0);
  // The credit drifts with the content layer.
  expect(within(screen.getByTestId('standby-content')).getByText(CREDIT)).toBeTruthy();
});

it('a photo that fails to load keeps the green background and shows no credit', () => {
  show({wallpaper: annie});
  fireEvent(screen.getByTestId('standby-photo'), 'error');
  expect(flatStyle('standby-photo').opacity).toBe(0);
  expect(screen.getByTestId('standby-streams')).toBeTruthy();
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  expect(screen.queryByTestId('standby-tint')).toBeNull();
});

it('a failed photo is retried after WALLPAPER_RETRY_MS, and the credit shows once it loads', () => {
  show({wallpaper: annie});
  const before = screen.getByTestId('standby-photo');
  fireEvent(before, 'error');
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  expect(screen.queryByTestId('standby-tint')).toBeNull();
  act(() => jest.advanceTimersByTime(WALLPAPER_RETRY_MS - 1_000));
  expect(screen.getByTestId('standby-photo')).toBe(before);
  act(() => jest.advanceTimersByTime(1_000));
  // A remounted image is a new element.
  const after = screen.getByTestId('standby-photo');
  expect(after).not.toBe(before);
  expect(after.props.source).toEqual({uri: annie.imageUrl});
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  fireEvent(after, 'load');
  expect(screen.getByText(CREDIT)).toBeTruthy();
  expect(screen.getByTestId('standby-tint')).toBeTruthy();
});

it('the retry timer is cleared on unmount, on a new URL and on wallpaper null', () => {
  const view = show({wallpaper: annie});
  const idle = jest.getTimerCount();
  fireEvent(screen.getByTestId('standby-photo'), 'error');
  expect(jest.getTimerCount()).toBe(idle + 1);
  view.rerender(
    <StandbyScreen {...base} wallpaper={{...annie, imageUrl: 'https://images.unsplash.com/photo-2?w=1920'}} />,
  );
  expect(jest.getTimerCount()).toBe(idle);
  fireEvent(screen.getByTestId('standby-photo'), 'error');
  view.rerender(<StandbyScreen {...base} wallpaper={null} />);
  expect(jest.getTimerCount()).toBe(idle);
  view.rerender(<StandbyScreen {...base} wallpaper={annie} />);
  fireEvent(screen.getByTestId('standby-photo'), 'error');
  view.unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('a pending retry is dropped when the wallpaper goes away', () => {
  const view = show({wallpaper: annie});
  fireEvent(screen.getByTestId('standby-photo'), 'error');
  view.rerender(<StandbyScreen {...base} wallpaper={null} />);
  view.rerender(<StandbyScreen {...base} wallpaper={annie} />);
  const before = screen.getByTestId('standby-photo');
  act(() => jest.advanceTimersByTime(WALLPAPER_RETRY_MS));
  expect(screen.getByTestId('standby-photo')).toBe(before);
});

it('A to B to A: the credit waits for A to load again', () => {
  const view = show({wallpaper: annie});
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  const b = {...annie, imageUrl: 'https://images.unsplash.com/photo-2?w=1920'};
  view.rerender(<StandbyScreen {...base} wallpaper={b} />);
  view.rerender(<StandbyScreen {...base} wallpaper={annie} />);
  expect(screen.queryByText(CREDIT)).toBeNull();
  expect(flatStyle('standby-photo').opacity).toBe(0);
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  expect(screen.getByText(CREDIT)).toBeTruthy();
});

it('a new wallpaper URL hides the credit until the new photo loads', () => {
  const view = show({wallpaper: annie});
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  expect(screen.getByText(CREDIT)).toBeTruthy();
  const next = {...annie, imageUrl: 'https://images.unsplash.com/photo-2?w=1920', photographer: 'Ben Jones'};
  view.rerender(<StandbyScreen {...base} wallpaper={next} />);
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  expect(screen.getByTestId('standby-photo').props.source).toEqual({uri: next.imageUrl});
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  expect(screen.getByText('Photo by Ben Jones on Unsplash')).toBeTruthy();
  expect(screen.queryByText(CREDIT)).toBeNull();
});

it('wallpaper null after a loaded photo: photo and credit gone', () => {
  const view = show({wallpaper: annie});
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  view.rerender(<StandbyScreen {...base} wallpaper={null} />);
  expect(screen.queryByTestId('standby-photo')).toBeNull();
  expect(screen.queryByTestId('standby-tint')).toBeNull();
  expect(screen.queryByText(/Unsplash/)).toBeNull();
  // The same photo coming back still waits for its load before the credit shows.
  view.rerender(<StandbyScreen {...base} wallpaper={annie} />);
  expect(screen.queryByText(CREDIT)).toBeNull();
});

it('the tint shows only over a loaded photo', () => {
  const view = show();
  expect(screen.queryByTestId('standby-tint')).toBeNull();
  view.rerender(<StandbyScreen {...base} wallpaper={annie} />);
  expect(screen.queryByTestId('standby-tint')).toBeNull();
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  expect(flatStyle('standby-tint').backgroundColor).toBe('rgba(0,0,0,.35)');
});

it('over a loaded photo the text gets a shadow; on green it does not', () => {
  const view = show({wallpaper: annie});
  expect(textStyle('14:32').textShadowColor).toBeUndefined();
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  expect(textStyle('14:32').textShadowColor).toBe('rgba(0,0,0,.55)');
  expect(textStyle('CastAir is ready').textShadowColor).toBe('rgba(0,0,0,.55)');
  view.rerender(<StandbyScreen {...base} wallpaper={null} />);
  expect(textStyle('14:32').textShadowColor).toBeUndefined();
});

it('there is one layout (B17)', () => {
  show();
  expect('layout' in DEFAULT_PREFS).toBe(false);
  expect(screen.getByTestId('standby-layout')).toBeTruthy();
});

it('a long photographer name is credited in full, never cut short', () => {
  const photographer = 'Annabel-Louise Fitzwilliam-Montgomery Smythes'; // 45 characters
  expect(photographer).toHaveLength(45);
  show({wallpaper: {...annie, photographer}});
  fireEvent(screen.getByTestId('standby-photo'), 'load');
  const credit = screen.getByText(`Photo by ${photographer} on Unsplash`);
  expect(credit.props.numberOfLines).toBeUndefined();
});
