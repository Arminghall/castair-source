/*
 * The Settings page: a Settings tab and an About tab, and the Location screen behind Settings.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useEffect, useState} from 'react';
import {BackHandler, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import type {Prefs} from './Prefs';
import {AboutTab} from './AboutTab';
import {LocationScreen} from './LocationScreen';
import {PlansScreen} from './PlansScreen';
import {SettingsTab} from './SettingsTab';
import {COLORS} from './config';
import type {StandbyInfo} from './standby/data';
import {MUTED, U} from './SettingsParts';
import type {UnlockState} from './Unlock';

const MARK = require('./assets/castair_mark.png');
const BACKGROUND = require('./assets/standby-bg.png');

type Props = {
  receiverName: string;
  prefs: Prefs;
  info: StandbyInfo | null;
  serverConnected: boolean;
  unlockState: UnlockState;
  /** This week's free time left (FreeCast.tsx); null when unlocked or not yet known. */
  freeLeftMs?: number | null;
  products: React.ComponentProps<typeof PlansScreen>['products'];
  productsLoaded?: boolean;
  onBuy: (sku: string) => Promise<'bought' | 'cancelled' | 'failed'>;
  onCheckAgain: () => Promise<boolean>;
  onPrefs: (patch: Partial<Prefs>) => void;
  onUseFireTvName: () => void;
  onClose: () => void;
  /** The tab to open on: 'plans' from the standby screen's free-version hint. */
  initialTab?: 'settings' | 'plans';
};

type Tab = 'settings' | 'about' | 'location' | 'plans';

const TabPill = ({
  label,
  on,
  preferred,
  onSelect,
}: {
  label: string;
  on: boolean;
  preferred?: boolean;
  onSelect: () => void;
}) => (
  <Pressable onPress={onSelect} onFocus={onSelect} hasTVPreferredFocus={preferred}>
    {({focused}: {focused?: boolean}) => (
      <View style={[styles.tab, on && styles.tabOn, focused && styles.tabFocused]}>
        <Text style={[styles.tabText, on && styles.tabTextOn, focused && styles.tabTextFocused]}>{label}</Text>
      </View>
    )}
  </Pressable>
);

export const Settings = ({
  receiverName,
  prefs,
  info,
  serverConnected,
  unlockState,
  freeLeftMs = null,
  products,
  productsLoaded,
  onBuy,
  onCheckAgain,
  onPrefs,
  onUseFireTvName,
  onClose,
  initialTab = 'settings',
}: Props) => {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Back: Location and the plans return to Settings, anything else closes the page.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'location' || tab === 'plans') {
        setTab('settings');
      } else {
        onClose();
      }
      return true;
    });
    return () => sub.remove();
  }, [tab, onClose]);

  return (
    <View style={styles.root}>
      <Image source={BACKGROUND} resizeMode="stretch" style={styles.background} />
      {tab === 'plans' ? (
        <PlansScreen
          products={products}
          productsLoaded={productsLoaded}
          state={unlockState}
          onBuy={onBuy}
          onCheckAgain={onCheckAgain}
          onClose={() => setTab('settings')}
        />
      ) : tab === 'location' ? (
        <View style={styles.page}>
          <LocationScreen
            currentPlace={prefs.placeId ? (prefs.placeName ?? prefs.placeId) : null}
            onBack={() => setTab('settings')}
            onPick={(place) => {
              onPrefs(place ? {placeId: place.id, placeName: place.name} : {placeId: null, placeName: null});
              setTab('settings');
            }}
          />
        </View>
      ) : (
        <View style={styles.page}>
          <View style={styles.head}>
            <View style={styles.brand}>
              <Image source={MARK} style={styles.brandMark} resizeMode="contain" />
              <Text style={styles.brandText}>CastAir</Text>
            </View>
            <View style={styles.tabs}>
              <TabPill label="Settings" on={tab === 'settings'} preferred onSelect={() => setTab('settings')} />
              <TabPill label="About" on={tab === 'about'} onSelect={() => setTab('about')} />
            </View>
            <Text style={styles.hint}>Back to close</Text>
          </View>
          <View style={styles.body}>
            {tab === 'settings' ? (
              <SettingsTab
                receiverName={receiverName}
                prefs={prefs}
                info={info}
                serverConnected={serverConnected}
                unlockState={unlockState}
                freeLeftMs={freeLeftMs}
                onPrefs={onPrefs}
                onUseFireTvName={onUseFireTvName}
                onOpenLocation={() => setTab('location')}
                onOpenPlans={() => setTab('plans')}
              />
            ) : (
              <AboutTab />
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.greenDark},
  background: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%'},
  page: {flex: 1, paddingHorizontal: 4.5 * U, paddingTop: 3.2 * U, paddingBottom: 3 * U},
  head: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2.2 * U},
  brand: {flexDirection: 'row', alignItems: 'center', flex: 1},
  brandMark: {width: 3.2 * U, height: 3.2 * U, marginRight: 1.1 * U},
  brandText: {color: COLORS.cream, fontSize: 1.7 * U, fontWeight: '600'},
  tabs: {flexDirection: 'row', padding: 0.45 * U, borderRadius: 99, backgroundColor: 'rgba(244,241,232,.08)'},
  tab: {paddingVertical: 0.55 * U, paddingHorizontal: 2.2 * U, borderRadius: 99, marginHorizontal: 0.3 * U},
  tabOn: {backgroundColor: 'rgba(244,241,232,.16)'},
  tabFocused: {backgroundColor: COLORS.cream},
  tabText: {color: 'rgba(244,241,232,.7)', fontSize: 1.55 * U},
  tabTextOn: {color: COLORS.cream, fontWeight: '600'},
  tabTextFocused: {color: COLORS.greenDark, fontWeight: '600'},
  hint: {color: MUTED, fontSize: 1.15 * U, flex: 1, textAlign: 'right'},
  body: {flex: 1},
});
