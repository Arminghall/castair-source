/*
 * Tests for the standby layout (one layout since B17): the ready card, the
 * connect line and corner credit (B14), photo text, the left column and the
 * free-version hint.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {StyleSheet} from 'react-native';
import {act, fireEvent, render, screen, within} from '@testing-library/react-native';
import {StandbyScreen} from '../src/StandbyScreen';
import {DEFAULT_PREFS} from '../src/Prefs';
import type {StandbyInfo, Wallpaper} from '../src/standby/data';
import {U} from '../src/standby/parts';

const NOW = Date.parse('2026-11-20T14:32:00Z');
const london: StandbyInfo = {
  location: {name: 'Cambridge', region: 'England', country: 'United Kingdom', countryCode: 'GB', source: 'place'},
  time: {timeZone: 'Europe/London', utcOffsetMinutes: 0, next: null},
  weather: {tempC: 7, symbol: 'cloudy'},
};
const annie: Wallpaper = {
  imageUrl: 'https://images.unsplash.com/photo-1',
  photographer: 'Annie Spratt',
  photographerUrl: 'https://unsplash.com/@anniespratt',
  unsplashUrl: 'https://unsplash.com/photos/1',
  changesAt: null,
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

describe('ready card', () => {
  it('pill, name, the connect line, time, date, weather', () => {
    show();
    expect(screen.getByTestId('standby-layout')).toBeTruthy();
    expect(screen.getByText('CastAir is ready')).toBeTruthy();
    expect(screen.getByText('CastAir-Front Room')).toBeTruthy();
    expect(screen.getByText('Use Screen Mirroring or castair.app/connect')).toBeTruthy();
    expect(screen.getByText('14:32')).toBeTruthy();
    expect(screen.getByText('Friday 20 November')).toBeTruthy();
    expect(screen.getByText('7°')).toBeTruthy();
    expect(screen.getByText('Cloudy · Cambridge')).toBeTruthy();
  });
  it('offline: the pill is the offline wording', () => {
    show({serverConnected: false});
    act(() => jest.advanceTimersByTime(61_000));
    expect(screen.getByText('AirPlay only, laptop sharing unavailable')).toBeTruthy();
    expect(screen.queryByText('CastAir is ready')).toBeNull();
  });
  it('shows the code under the connect line', () => {
    show({shareCode: '4821'});
    expect(screen.getByText('Use Screen Mirroring or castair.app/connect')).toBeTruthy();
    expect(screen.getByText('Code 4821')).toBeTruthy();
  });
  it('no code when offline or connecting', () => {
    const {unmount} = show({shareCode: '4821', connectingSender: "Sam's iPhone"});
    expect(screen.queryByText(/Code 4821/)).toBeNull();
    unmount();
    show({shareCode: '4821', serverConnected: false});
    act(() => jest.advanceTimersByTime(61_000));
    expect(screen.queryByText(/Code 4821/)).toBeNull();
  });
  it('no code line when shareCode is null', () => {
    show({shareCode: null});
    expect(screen.queryByText(/^Code /)).toBeNull();
  });
  it('a 60-character name and the code both show', () => {
    show({shareCode: '4821', name: 'A'.repeat(60)});
    expect(screen.getByText('A'.repeat(60))).toBeTruthy();
    expect(screen.getByText('Code 4821')).toBeTruthy();
  });
  it('connecting: the sender replaces the connect line', () => {
    show({connectingSender: "Sam's iPhone"});
    expect(screen.getByText("Connecting to Sam's iPhone…")).toBeTruthy();
    expect(screen.queryByText(/Screen Mirroring/)).toBeNull();
  });
  it('without a town: the weather slot says Set your town…', () => {
    show({prefs: DEFAULT_PREFS});
    expect(screen.getByText('Set your town in Settings to see the weather')).toBeTruthy();
    expect(screen.queryByText('7°')).toBeNull();
  });
});

describe('Settings, credit and long names', () => {
  it('Settings is pressable and calls onOpenSettings', () => {
    const onOpenSettings = jest.fn();
    show({onOpenSettings});
    fireEvent.press(screen.getByText('Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
  it('the credit shows once the photo loads', () => {
    show({wallpaper: annie});
    expect(screen.queryByText(/Unsplash/)).toBeNull();
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    expect(screen.getByText('Photo by Annie Spratt on Unsplash')).toBeTruthy();
  });
  it('a 60-character name renders with numberOfLines', () => {
    const name = 'A'.repeat(60);
    show({name});
    expect(screen.getByText(name).props.numberOfLines).toBe(2);
  });
});

const styleOf = (text: string) =>
  Object.assign({}, ...[screen.getByText(text).props.style].flat(3).filter(Boolean)) as Record<string, unknown>;

describe('photo shadow', () => {
  const texts = [
    'CastAir-Front Room',
    '14:32',
    'Friday 20 November',
    'Cloudy · Cambridge',
    'Use Screen Mirroring or castair.app/connect',
  ];
  it('text carries the shadow on a loaded photo, and not without one', () => {
    const view = show({wallpaper: annie});
    for (const t of texts) expect(styleOf(t).textShadowColor).toBeUndefined();
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    for (const t of texts) expect(styleOf(t).textShadowColor).toBe('rgba(0,0,0,.55)');
    view.unmount();
  });
});

describe('with a 60-character name on a photo', () => {
  it('still renders time, weather and the full credit', () => {
    const name = 'A'.repeat(60);
    show({name, wallpaper: annie});
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText('14:32')).toBeTruthy();
    expect(screen.getByText('7°')).toBeTruthy();
    expect(screen.getByText('Photo by Annie Spratt on Unsplash')).toBeTruthy();
  });
});

const flat = (style: unknown) => Object.assign({}, ...[style].flat(3).filter(Boolean)) as Record<string, unknown>;

describe('connect line and credit (B14)', () => {
  it('shows the one connect line, with no per-device wording', () => {
    show();
    expect(screen.getByText('Use Screen Mirroring or castair.app/connect')).toBeTruthy();
    expect(screen.queryByText(/Control Center|Any laptop|iPhone/)).toBeNull();
  });
  it('the credit sits small in the bottom-right corner on a dark shade, inside the drifting layer', () => {
    show({wallpaper: annie});
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    const box = flat(within(screen.getByTestId('standby-content')).getByTestId('standby-credit').props.style);
    expect(box).toMatchObject({position: 'absolute', backgroundColor: 'rgba(0,0,0,.45)'});
    expect(box.right).toBeGreaterThan(0.6 * U);
    expect(box.bottom).toBeGreaterThan(0.6 * U);
    expect(box.left).toBeUndefined();
    expect(box.top).toBeUndefined();
    expect(within(screen.getByTestId('standby-credit')).getByText('Photo by Annie Spratt on Unsplash')).toBeTruthy();
  });
});

describe('grey words on a photo', () => {
  const texts = ['Use Screen Mirroring or castair.app/connect', 'Friday 20 November', 'Cloudy · Cambridge', 'Settings'];
  it('turn 90% opaque once the photo loads; bold words stay cream', () => {
    const view = show({wallpaper: annie});
    for (const t of texts) expect(styleOf(t).color).toBe('rgba(244,241,232,.62)');
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    for (const t of texts) expect(styleOf(t).color).toBe('rgba(244,241,232,.9)');
    expect(styleOf('Screen Mirroring').color).toBe('#FAF8F2');
    view.unmount();
  });
});

describe('left column (B17)', () => {
  it('time, then date, then the weather under the date, left-aligned at the top', () => {
    show();
    const clock = within(screen.getByTestId('standby-clock'));
    expect(clock.getByText('14:32')).toBeTruthy();
    expect(clock.getByText('Friday 20 November')).toBeTruthy();
    expect(clock.getByText('7°')).toBeTruthy();
    expect(clock.getByText('Cloudy · Cambridge')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('standby-clock').props.style).alignItems).toBe('flex-start');
  });

  it('the time is a plain medium-weight clock, not the big thin one', () => {
    show();
    const time = StyleSheet.flatten(screen.getByText('14:32').props.style);
    expect(time.fontWeight).toBe('500');
    expect(time.fontSize).toBeLessThan(6 * U);
  });

  it('Settings is a round button with a gear and its name below, bottom left', () => {
    const onOpenSettings = jest.fn();
    show({onOpenSettings});
    const button = screen.getByTestId('settings-button');
    const circle = StyleSheet.flatten(within(button).getByTestId('settings-circle').props.style);
    expect(circle.borderRadius).toBe(circle.width / 2);
    expect(circle.width).toBe(circle.height);
    expect(within(button).getByTestId('settings-icon')).toBeTruthy();
    expect(within(button).getByText('Settings')).toBeTruthy();
    fireEvent.press(within(button).getByText('Settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Settings ›')).toBeNull();
  });
});

describe('free-version hint', () => {
  it('hint only on the free version', () => {
    const view = show({freeVersion: true});
    expect(screen.getByText('Free version · 5-minute casts')).toBeTruthy();
    view.unmount();
    show({freeVersion: false});
    expect(screen.queryByText('Free version · 5-minute casts')).toBeNull();
  });
  it('is a way into the plans: focusable, and pressing it calls onOpenPlans', () => {
    const onOpenPlans = jest.fn();
    const onOpenSettings = jest.fn();
    show({freeVersion: true, onOpenPlans, onOpenSettings});
    const hint = screen.getByTestId('standby-free-hint');
    expect(hint.props.focusable).not.toBe(false);
    fireEvent.press(screen.getByText('Free version · 5-minute casts'));
    expect(onOpenPlans).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
  it('is hidden while a share is connecting, and muted on a photo', () => {
    const view = show({freeVersion: true, connectingSender: "Sam's iPhone"});
    expect(screen.queryByText('Free version · 5-minute casts')).toBeNull();
    view.unmount();
    show({freeVersion: true, wallpaper: annie});
    expect(styleOf('Free version · 5-minute casts').color).toBe('rgba(244,241,232,.62)');
    fireEvent(screen.getByTestId('standby-photo'), 'load');
    expect(styleOf('Free version · 5-minute casts').color).toBe('rgba(244,241,232,.9)');
  });
});
