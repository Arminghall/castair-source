/*
 * The standby layout (one layout since B17). Left column: the time, date and weather at the top, left-aligned, and the
 * row of round buttons (Settings, Apple, Windows, Chrome) at the bottom, with the free-version line under it. Right: a card with the ready pill, the
 * TV's name and how to share.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {leftLabel} from '../Allowance';
import {COLORS} from '../config';
import {
  ConnectLine,
  ICONS,
  LOGOS,
  MUTED,
  ReadyPill,
  RoundButton,
  SettingsButton,
  U,
  mutedOnPhoto,
  shadow,
} from './parts';
import type {ConnectKind, LayoutProps} from './view';

export const StandbyLayout = ({
  view,
  freeVersion = false,
  freeLeftMs = null,
  onOpenSettings,
  onOpenPlans,
  showWindows = false,
  onOpenConnect,
  hideButtons = false,
  focusConnect = null,
  onConnectFocused,
}: LayoutProps) => {
  // The focus goes back to the button whose overlay just closed.
  const focusProps = (kind: ConnectKind) =>
    focusConnect === kind ? {preferred: true, onFocus: onConnectFocused} : {preferred: false};
  const sh = view.onPhoto && shadow;
  const mt = view.onPhoto && mutedOnPhoto;
  const {weather} = view;
  const howToShare = view.connectingSender ? (
    <Text style={[styles.connecting, sh, mt]}>Connecting to {view.connectingSender}…</Text>
  ) : (
    <>
      <ConnectLine onPhoto={view.onPhoto} style={styles.connect} />
      {view.shareCode !== null ? (
        <Text testID="standby-code" style={[styles.code, sh]}>{`Code ${view.shareCode}`}</Text>
      ) : null}
    </>
  );
  return (
    <View testID="standby-layout" style={styles.fill}>
      <View style={styles.left}>
        <View testID="standby-clock" style={styles.clock}>
          <Text style={[styles.time, sh]}>{view.time}</Text>
          <Text style={[styles.date, sh, mt]}>{view.date}</Text>
          {weather ? (
            <View style={styles.wx}>
              <Image source={ICONS[weather.icon]} style={styles.wxIcon} resizeMode="contain" />
              <Text style={[styles.temp, sh]}>{weather.temp}</Text>
              <Text style={[styles.wxText, sh, mt]}>
                {[weather.condition, weather.place].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : view.needsTown ? (
            <Text style={[styles.wxText, styles.noTown, sh, mt]}>Set your town in Settings to see the weather</Text>
          ) : null}
        </View>

        <View style={styles.bottom}>
          {view.connectingSender || hideButtons ? null : (
            <>
              <View testID="standby-buttons" style={styles.buttonRow}>
                <SettingsButton onPress={onOpenSettings} onPhoto={view.onPhoto} />
                <RoundButton
                  icon={LOGOS.apple}
                  label="AirPlay"
                  testID="connect-apple"
                  onPress={() => onOpenConnect?.('apple')}
                  {...focusProps('apple')}
                  onPhoto={view.onPhoto}
                  style={styles.buttonGap}
                />
                {showWindows ? (
                  <RoundButton
                    icon={LOGOS.windows}
                    label="Windows"
                    testID="connect-windows"
                    onPress={() => onOpenConnect?.('windows')}
                    {...focusProps('windows')}
                    onPhoto={view.onPhoto}
                    style={styles.buttonGap}
                  />
                ) : null}
                <RoundButton
                  icon={LOGOS.chrome}
                  label="Cast"
                  testID="connect-chrome"
                  onPress={() => onOpenConnect?.('chrome')}
                  {...focusProps('chrome')}
                  onPhoto={view.onPhoto}
                  style={styles.buttonGap}
                />
              </View>
              {freeVersion ? (
                // A way into the plans screen (spec §5), like Settings › CastAir Unlimited.
                <Pressable testID="standby-free-hint" onPress={onOpenPlans} style={styles.freeHintButton}>
                  {({focused}: {focused?: boolean}) => (
                    <Text style={[styles.freeHint, sh, mt, focused && styles.freeHintFocused]}>
                      {freeLeftMs === null ? 'Free version' : `Free version · ${leftLabel(freeLeftMs)}`}
                    </Text>
                  )}
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>

      <View style={[styles.side, styles.card]}>
        <ReadyPill view={view} readyText="CastAir is ready" style={styles.pill} />
        <Text style={[styles.name, sh]} numberOfLines={2}>
          {view.name}
        </Text>
        {howToShare}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fill: {flex: 1, flexDirection: 'row'},
  left: {flex: 1, paddingHorizontal: 5 * U, paddingTop: 4.5 * U, paddingBottom: 3 * U, justifyContent: 'space-between'},
  clock: {alignItems: 'flex-start'},
  time: {color: COLORS.cream, fontSize: 4.6 * U, fontWeight: '500', letterSpacing: -0.05 * U},
  date: {color: MUTED, fontSize: 1.6 * U, marginTop: 0.3 * U},
  wx: {flexDirection: 'row', alignItems: 'center', marginTop: 1.4 * U},
  wxIcon: {width: 2.4 * U, height: 2.4 * U, marginRight: 0.8 * U},
  temp: {color: COLORS.cream, fontSize: 1.6 * U, fontWeight: '600', marginRight: 0.8 * U},
  wxText: {color: MUTED, fontSize: 1.6 * U},
  noTown: {maxWidth: 34 * U, marginTop: 1.4 * U},
  bottom: {alignItems: 'flex-start'},
  buttonRow: {flexDirection: 'row', alignItems: 'flex-start'},
  buttonGap: {marginLeft: 2.2 * U},
  freeHintButton: {marginTop: 1.4 * U},
  freeHint: {color: MUTED, fontSize: 1.4 * U},
  freeHintFocused: {color: COLORS.cream, fontWeight: '700', textDecorationLine: 'underline'},
  side: {flex: 1.05, alignSelf: 'center', marginRight: 3 * U},
  // Only as tall as its content, centred against the left column.
  card: {
    borderRadius: 1.6 * U,
    backgroundColor: 'rgba(18,18,20,.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.08)',
    padding: 3.5 * U,
  },
  pill: {alignSelf: 'flex-start'},
  name: {color: COLORS.cream, fontSize: 3.4 * U, lineHeight: 3.8 * U, fontWeight: '600', marginTop: 2 * U},
  connecting: {color: MUTED, fontSize: 1.7 * U, marginTop: 1.6 * U},
  code: {color: COLORS.cream, fontSize: 2.6 * U, lineHeight: 3.2 * U, fontWeight: '700', marginTop: 1.2 * U},
  connect: {fontSize: 1.7 * U, lineHeight: 2.6 * U, marginTop: 1.6 * U},
});
