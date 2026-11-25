/*
 * The "how to connect" overlays the standby screen's AirPlay, Windows and Cast buttons open.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {BackHandler, StyleSheet} from 'react-native';
import {act} from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {ConnectOverlay, MIRACAST_URI, OVERLAY_IDLE_MS} from '../src/ConnectOverlay';

type Props = React.ComponentProps<typeof ConnectOverlay>;
const onClose = jest.fn();
const onEnableWindows = jest.fn(() => Promise.resolve());
const show = (over: Partial<Props> = {}) =>
  render(
    <ConnectOverlay
      kind="apple"
      castAirName="CastAir-Lounge"
      fireTvName="Lounge"
      shareCode="4821"
      onClose={onClose}
      onEnableWindows={onEnableWindows}
      {...over}
    />,
  );

/** A key on the remote, the way the TV reports it. */
const pressKey = () => {
  const calls = (useTVEventHandler as jest.Mock).mock.calls;
  act(() => calls[calls.length - 1][0]({eventType: 'down', eventKeyAction: 0}));
};
/** The hardware Back button; returns whether the handler took it (true keeps the app open). */
const pressBack = () => {
  const calls = (BackHandler.addEventListener as jest.Mock).mock.calls.filter(
    (c: unknown[]) => c[0] === 'hardwareBackPress',
  );
  let handled: unknown;
  act(() => {
    handled = calls[calls.length - 1][1]();
  });
  return handled;
};
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(BackHandler, 'addEventListener');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('opens the Fire TV sharing app by its own address and closes after 2 minutes idle', () => {
  expect(MIRACAST_URI).toBe('orpheus://com.amazon.miracast_sink.main');
  expect(OVERLAY_IDLE_MS).toBe(120_000);
});

it('Apple: the title, three steps with the CastAir name, and how to close', () => {
  show({kind: 'apple'});
  expect(screen.getByTestId('connect-overlay')).toBeTruthy();
  expect(screen.getByText('Share from an iPhone, iPad or Mac')).toBeTruthy();
  expect(screen.getByText('Join the same Wi-Fi as this TV.')).toBeTruthy();
  expect(screen.getByText('Open Control Centre and choose Screen Mirroring.')).toBeTruthy();
  expect(screen.getByText('Choose CastAir-Lounge.')).toBeTruthy();
  expect(screen.getByText('Press Back to close')).toBeTruthy();
  expect(screen.queryByText(/AirPlay/)).toBeNull();
  expect(screen.queryByTestId('enable-windows')).toBeNull();
});

it.each([
  ['apple', 'Share from an iPhone, iPad or Mac'],
  ['windows', 'Share from a Windows laptop'],
  ['chrome', 'Share from your browser'],
] as const)('%s: the logo and the title share one row', (kind, title) => {
  show({kind});
  const header = screen.getByTestId('connect-header');
  expect(within(header).getByTestId('connect-logo')).toBeTruthy();
  expect(within(header).getByText(title)).toBeTruthy();
  expect(StyleSheet.flatten(header.props.style).flexDirection).toBe('row');
});

it('the card is black glass like the ready card, not solid green', () => {
  show({kind: 'apple'});
  const card = StyleSheet.flatten(screen.getByTestId('connect-card').props.style);
  expect(card.backgroundColor).toMatch(/^rgba\(\d+,\d+,\d+,\.\d+\)$/);
});

it('Chrome: four steps with the name and code, and the closing line', () => {
  show({kind: 'chrome'});
  expect(screen.getByText('Share from your browser')).toBeTruthy();
  expect(screen.getByText('Join the same Wi-Fi as this TV.')).toBeTruthy();
  expect(screen.getByText('In Chrome or Edge, go to castair.app.')).toBeTruthy();
  expect(screen.getByText('Choose CastAir-Lounge and type the code 4821.')).toBeTruthy();
  expect(screen.getByText('Pick a screen, a window or a tab.')).toBeTruthy();
  expect(screen.getByText('Works on Windows, Mac and Chromebook.')).toBeTruthy();
  expect(screen.getByText('Press Back to close')).toBeTruthy();
});

it('Chrome: no code when laptop codes are off', () => {
  show({kind: 'chrome', shareCode: null});
  expect(screen.getByText('Choose CastAir-Lounge.')).toBeTruthy();
  expect(screen.queryByText(/code/)).toBeNull();
});

it("Windows: the Win+K steps with the Fire TV's own name, the note, the browser line and the button", () => {
  show({kind: 'windows'});
  expect(screen.getByText('Share from a Windows laptop')).toBeTruthy();
  expect(screen.getByText('With Win+K')).toBeTruthy();
  expect(screen.getByText('Press Enable Windows sharing below.')).toBeTruthy();
  expect(screen.getByText('On the laptop press Win+K.')).toBeTruthy();
  expect(screen.getByText('Choose Lounge.')).toBeTruthy();
  expect(
    screen.getByText("This opens the Fire TV's own sharing screen. Press Back on the remote to come back to CastAir."),
  ).toBeTruthy();
  expect(screen.getByText('Or in a browser')).toBeTruthy();
  expect(screen.getByText('Go to castair.app in Chrome or Edge.')).toBeTruthy();
  expect(screen.getByText('Press Back to close')).toBeTruthy();
  const button = screen.getByTestId('enable-windows');
  expect(button.props.hasTVPreferredFocus ?? button.parent?.props.hasTVPreferredFocus).toBe(true);
});

it("Windows: 'Choose this Fire TV' when its name couldn't be read", () => {
  show({kind: 'windows', fireTvName: null});
  expect(screen.getByText('Choose this Fire TV.')).toBeTruthy();
});

it('Back closes it and keeps the app open', () => {
  show();
  expect(pressBack()).toBe(true);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('closes after 2 minutes without a key press; a key press starts the wait again', async () => {
  jest.useFakeTimers();
  show();
  await advance(OVERLAY_IDLE_MS - 10_000);
  pressKey();
  await advance(OVERLAY_IDLE_MS - 1);
  expect(onClose).not.toHaveBeenCalled();
  await advance(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Enable Windows sharing opens the sharing app', async () => {
  show({kind: 'windows'});
  await act(async () => {
    fireEvent.press(screen.getByTestId('enable-windows'));
  });
  expect(onEnableWindows).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Windows sharing isn't available on this Fire TV.")).toBeNull();
});

it('says so when opening the sharing app throws at once', async () => {
  onEnableWindows.mockImplementationOnce(() => {
    throw new Error('no handler');
  });
  show({kind: 'windows'});
  await act(async () => {
    fireEvent.press(screen.getByTestId('enable-windows'));
  });
  expect(screen.getByText("Windows sharing isn't available on this Fire TV.")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

it("says so when the sharing app can't be opened, and stays open", async () => {
  onEnableWindows.mockImplementationOnce(() => Promise.reject(new Error('no handler')));
  show({kind: 'windows'});
  await act(async () => {
    fireEvent.press(screen.getByTestId('enable-windows'));
  });
  expect(screen.getByText("Windows sharing isn't available on this Fire TV.")).toBeTruthy();
  expect(screen.getByTestId('connect-overlay')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});
