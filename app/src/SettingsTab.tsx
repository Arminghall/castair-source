/*
 * The Settings tab: two columns of grouped rows (spec 5.4).
 *
 * Copyright (C) 2026 Parker Wahle
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';
import type {Prefs} from './Prefs';
import {SHARE_ADDRESS} from './config';
import {deviceCountry} from './standby/clock';
import type {StandbyInfo} from './standby/data';
import {effectiveUnits} from './standby/units';
import type {UnlockState} from './Unlock';
import {Group, Note, Row, Section, U} from './SettingsParts';

type Props = {
  receiverName: string;
  prefs: Prefs;
  info: StandbyInfo | null;
  serverConnected: boolean;
  unlockState: UnlockState;
  onPrefs: (patch: Partial<Prefs>) => void;
  onUseFireTvName: () => void;
  onOpenLocation: () => void;
  onOpenPlans: () => void;
};

const TEMP_NEXT = {auto: 'C', C: 'F', F: 'auto'} as const;
const CLOCK_NEXT = {auto: '24', '24': '12', '12': 'auto'} as const;
const WALLPAPER_NEXT = {off: 'daily', daily: 'hourly', hourly: 'off'} as const;
const WALLPAPER_LABEL = {off: 'Off', daily: 'Daily', hourly: 'Hourly'} as const;
const PHOTOS_NEXT = {random: 'landscape', landscape: 'graphics', graphics: 'random'} as const;
const PHOTOS_LABEL = {random: 'Random', landscape: 'Landscape', graphics: 'Graphics'} as const;

export const SettingsTab = ({
  receiverName,
  prefs,
  info,
  serverConnected,
  unlockState,
  onPrefs,
  onUseFireTvName,
  onOpenLocation,
  onOpenPlans,
}: Props) => {
  const units = effectiveUnits(prefs, deviceCountry(), info);
  const temp = prefs.tempUnit === 'auto' ? `°${units.tempUnit} (automatic)` : `°${prefs.tempUnit}`;
  const clock = prefs.clock === 'auto' ? `${units.hour12 ? '12' : '24'}-hour (automatic)` : `${prefs.clock}-hour`;
  const location = prefs.placeId ? (prefs.placeName ?? prefs.placeId) : 'Not set';

  return (
    <View style={styles.cols}>
      <View style={styles.col}>
        <Section>This TV</Section>
        <Group>
          <Row label="Name" value={receiverName} chevron onPress={onUseFireTvName} />
        </Group>
        <Note>
          Taken from the Fire TV's name (Settings → My Fire TV → About): "Lounge" appears as CastAir-Lounge. Not being
          used? Select this row and choose Allow.
        </Note>

        <Section>Look</Section>
        <Group>
          <Row
            label="Wallpaper"
            value={WALLPAPER_LABEL[prefs.wallpaper]}
            chevron
            onPress={() => onPrefs({wallpaper: WALLPAPER_NEXT[prefs.wallpaper]})}
          />
          <Row
            label="Photos"
            value={PHOTOS_LABEL[prefs.photos]}
            chevron
            disabled={prefs.wallpaper === 'off'}
            onPress={() => onPrefs({photos: PHOTOS_NEXT[prefs.photos]})}
          />
          <Row label="Clock" value={clock} chevron onPress={() => onPrefs({clock: CLOCK_NEXT[prefs.clock]})} />
        </Group>

        <Section>Laptop sharing</Section>
        <Group>
          <Row label="Status" value={serverConnected ? 'Connected' : 'Not connected'} />
          <Row label="Address" value={SHARE_ADDRESS} />
          <Row
            label="Laptop sharing code"
            value={prefs.shareCodeOn ? 'On' : 'Off'}
            chevron
            onPress={() => onPrefs({shareCodeOn: !prefs.shareCodeOn})}
          />
        </Group>
      </View>
      <View style={styles.col}>
        <Section>Plan</Section>
        <Group>
          {unlockState.unlocked ? (
            <Row label="CastAir Unlimited" value={`On · ${unlockState.kind ?? 'subscription'}`} />
          ) : (
            <Row label="CastAir Unlimited" value="Free version · 5-minute casts" chevron onPress={onOpenPlans} />
          )}
        </Group>

        <Section>Weather</Section>
        <Group>
          <Row
            label="Show weather"
            box={prefs.showWeather}
            onPress={() => onPrefs({showWeather: !prefs.showWeather})}
          />
          <Row label="Location" value={location} chevron onPress={onOpenLocation} />
          <Row
            label="Temperature"
            value={temp}
            chevron
            onPress={() => onPrefs({tempUnit: TEMP_NEXT[prefs.tempUnit]})}
          />
        </Group>

        <Section>Mirroring</Section>
        <Group>
          <Row
            label="Compatibility Mode"
            box={prefs.compatibilityMode}
            onPress={() => onPrefs({compatibilityMode: !prefs.compatibilityMode})}
          />
          <Row
            label="Bad LAN/Wi-Fi Mode"
            box={prefs.badNetworkMode}
            disabled={prefs.compatibilityMode}
            onPress={() => onPrefs({badNetworkMode: !prefs.badNetworkMode})}
          />
        </Group>
        <Note>
          Compatibility Mode plays mirrored video through the TV's standard player. Try it if the picture doesn't
          appear. Highlights and shadows lose some fidelity.
        </Note>
        <Note>
          Bad LAN/Wi-Fi Mode waits about 0.7 seconds for picture and sound instead of 0.15. Try it if mirroring
          stutters. Does not apply to Compatibility Mode.
        </Note>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  cols: {flexDirection: 'row'},
  col: {flex: 1, marginHorizontal: 1.5 * U},
});
