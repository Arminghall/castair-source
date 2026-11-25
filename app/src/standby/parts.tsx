/*
 * Standby parts used by the layout: the screen unit, colours, the weather
 * icons, the drift and offline hooks, and the pill, round-button, connect-line and
 * photo-credit pieces.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useEffect, useState} from 'react';
import {Dimensions, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {StyleProp, TextStyle, ViewStyle} from 'react-native';
import {COLORS, SHARE_ADDRESS} from '../config';
import type {ConnectKind, StandbyView} from './view';
import type {WeatherIcon} from './weatherSymbols';

export const SCREEN = Dimensions.get('window');
/** One hundredth of the screen width: every size on the standby screen is in these. */
export const U = SCREEN.width / 100;
export const MUTED = 'rgba(244,241,232,.62)';

export const ICONS: Record<WeatherIcon, number> = {
  'clear-day': require('../assets/weather/clear-day.png'),
  'clear-night': require('../assets/weather/clear-night.png'),
  'partly-day': require('../assets/weather/partly-day.png'),
  'partly-night': require('../assets/weather/partly-night.png'),
  cloudy: require('../assets/weather/cloudy.png'),
  fog: require('../assets/weather/fog.png'),
  rain: require('../assets/weather/rain.png'),
  sleet: require('../assets/weather/sleet.png'),
  snow: require('../assets/weather/snow.png'),
  thunder: require('../assets/weather/thunder.png'),
};

/** Keeps cream text readable over a photo. The layout adds it to text when `view.onPhoto` is true. */
export const shadow: TextStyle = {
  textShadowColor: 'rgba(0,0,0,.55)',
  textShadowRadius: 0.5 * U,
  textShadowOffset: {width: 0, height: 0.1 * U},
};

/** Grey text over a photo: nearly solid cream, so the photo doesn't show through it (B15). */
export const mutedOnPhoto: TextStyle = {color: 'rgba(244,241,232,.9)'};

/** How long the server link may be down before the pill says so. */
const OFFLINE_AFTER_MS = 60_000;
/** Anti-ghosting: the content moves to the next point on a circle this often. */
const DRIFT_EVERY_MS = 3 * 60_000;
const DRIFT_RADIUS = 0.6 * U;
const DRIFT_STEPS = 8;

/** The content layer's offset; the background moves twice as far. */
export function useDrift(): {dx: number; dy: number} {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % DRIFT_STEPS), DRIFT_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  const angle = (step * 2 * Math.PI) / DRIFT_STEPS;
  return {dx: DRIFT_RADIUS * Math.cos(angle), dy: DRIFT_RADIUS * Math.sin(angle)};
}

/** Laptop sharing counts as unavailable once the server link has been down for a minute. */
export function useOffline(serverConnected: boolean): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (serverConnected) {
      setOffline(false);
      return;
    }
    const timer = setTimeout(() => setOffline(true), OFFLINE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [serverConnected]);
  return offline;
}

/** The mint "ready" pill, or the muted AirPlay-only one once the server has been gone a minute. */
export const ReadyPill = ({
  view,
  readyText = 'Ready to share',
  style,
}: {
  view: StandbyView;
  readyText?: string;
  style?: StyleProp<ViewStyle>;
}) => (
  <View style={[styles.pill, view.offline && styles.pillOffline, style]}>
    {view.offline ? null : <View style={styles.dot} />}
    <Text
      style={[
        styles.pillText,
        view.offline && styles.pillTextOffline,
        view.onPhoto && shadow,
        view.offline && view.onPhoto && mutedOnPhoto,
      ]}>
      {view.offline ? 'Screen Mirroring only, laptop sharing unavailable' : readyText}
    </Text>
  </View>
);

const GEAR = require('../assets/settings_gear.png');
/** One-colour white 256 px marks, tinted like the gear. */
export const LOGOS: Record<ConnectKind, number> = {
  apple: require('../assets/logo_airplay.png'),
  windows: require('../assets/logo_windows.png'),
  chrome: require('../assets/logo_cast.png'),
};

/**
 * A round button with a one-colour icon and its name below. It turns cream when the
 * remote focuses it. The circle and icon get `<testID minus -button>-circle` / `-icon`.
 * `preferred` makes it take the remote's focus when it appears.
 */
export const RoundButton = ({
  icon,
  label,
  testID,
  onPress,
  onPhoto,
  style,
  preferred = false,
  onFocus,
}: {
  icon: number;
  label: string;
  testID: string;
  onPress?: () => void;
  onPhoto: boolean;
  style?: StyleProp<ViewStyle>;
  preferred?: boolean;
  onFocus?: () => void;
}) => {
  const base = testID.replace(/-button$/, '');
  return (
    <Pressable testID={testID} onPress={onPress} onFocus={onFocus} hasTVPreferredFocus={preferred} style={style}>
      {({focused}: {focused?: boolean}) => (
        <View style={styles.settings}>
          <View testID={`${base}-circle`} style={[styles.settingsCircle, focused && styles.settingsCircleFocused]}>
            <Image
              testID={`${base}-icon`}
              source={icon}
              resizeMode="contain"
              style={[styles.settingsIcon, {tintColor: focused ? COLORS.greenDark : COLORS.cream}]}
            />
          </View>
          <Text style={[styles.settingsText, onPhoto && [shadow, mutedOnPhoto], focused && styles.settingsTextFocused]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
};

/** Settings: the round button with the gear. */
export const SettingsButton = ({
  onPress,
  onPhoto,
  style,
}: {
  onPress: () => void;
  onPhoto: boolean;
  style?: StyleProp<ViewStyle>;
}) => (
  <RoundButton
    icon={GEAR}
    label="Settings"
    testID="settings-button"
    onPress={onPress}
    onPhoto={onPhoto}
    style={style}
  />
);

/** How to share, in one line (B14). */
export const ConnectLine = ({onPhoto, style}: {onPhoto: boolean; style?: StyleProp<TextStyle>}) => (
  <Text style={[styles.connect, onPhoto && shadow, style, onPhoto && mutedOnPhoto]}>
    Use <Text style={styles.connectBold}>Screen Mirroring</Text> or{' '}
    <Text style={styles.connectBold}>{SHARE_ADDRESS}</Text>
  </Text>
);

/**
 * The Unsplash photo credit: small, in the bottom-right corner on a dark shade
 * (like Bing's), always in the same place (B14). Nothing when no photo is on screen.
 * Never truncated: the name and "Unsplash" must show in full, so a long one wraps upwards.
 */
export const Credit = ({text}: {text: string | null}) =>
  text ? (
    <View testID="standby-credit" style={styles.creditBox}>
      <Text style={styles.credit}>{text}</Text>
    </View>
  ) : null;

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 0.6 * U,
    paddingHorizontal: 1.4 * U,
    borderRadius: 99,
    backgroundColor: 'rgba(127,217,176,.14)',
  },
  pillOffline: {backgroundColor: 'rgba(244,241,232,.08)'},
  dot: {
    width: 0.9 * U,
    height: 0.9 * U,
    borderRadius: 99,
    marginRight: 0.8 * U,
    backgroundColor: COLORS.mint,
    shadowColor: COLORS.mint,
    shadowOpacity: 1,
    shadowRadius: 1 * U,
    shadowOffset: {width: 0, height: 0},
  },
  pillText: {color: COLORS.mint, fontSize: 1.7 * U, fontWeight: '600'},
  pillTextOffline: {color: MUTED},
  settings: {alignItems: 'center'},
  settingsCircle: {
    width: 5.6 * U,
    height: 5.6 * U,
    borderRadius: 2.8 * U,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(18,18,20,.62)',
  },
  settingsCircleFocused: {backgroundColor: COLORS.cream},
  settingsIcon: {width: 2.6 * U, height: 2.6 * U},
  settingsText: {color: MUTED, fontSize: 1.15 * U, marginTop: 0.8 * U},
  settingsTextFocused: {fontWeight: '700'},
  connect: {color: MUTED},
  connectBold: {color: COLORS.cream, fontWeight: '600'},
  // 1.5·U and 1·U from the edges stay on screen with the 0.6·U drift. Up to 30·U wide, so a
  // long credit wraps rather than running across the screen.
  creditBox: {
    position: 'absolute',
    right: 1.5 * U,
    bottom: 1 * U,
    maxWidth: 30 * U,
    paddingHorizontal: 0.7 * U,
    paddingVertical: 0.25 * U,
    borderRadius: 0.4 * U,
    backgroundColor: 'rgba(0,0,0,.45)',
  },
  credit: {color: 'rgba(244,241,232,.85)', fontSize: 0.9 * U},
});
