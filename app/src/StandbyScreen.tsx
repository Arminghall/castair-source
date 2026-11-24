/*
 * The standby screen: what staff see on the TV when nothing is being shared.
 * The shell draws the background (the green streams, or an Unsplash photo once
 * it has loaded, under a dark tint) and hands the content to the layout.
 * Everything drifts a few pixels every 3 minutes so nothing burns in.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import type {Prefs} from './Prefs';
import {COLORS, WALLPAPER_RETRY_MS} from './config';
import type {StandbyInfo, Wallpaper} from './standby/data';
import {StandbyLayout} from './standby/StandbyLayout';
import {Credit, SCREEN, U, useDrift, useOffline} from './standby/parts';
import {buildView} from './standby/view';

const BACKGROUND = require('./assets/standby-bg.png');

type Props = {
  name: string;
  info: StandbyInfo | null;
  prefs: Prefs;
  nowMs: number;
  country: string | null;
  serverConnected: boolean;
  connectingSender: string | null;
  /** The code laptops must type, from the server; null when none. */
  shareCode?: string | null;
  /** Show the "Free version" hint by the Settings button. */
  freeVersion?: boolean;
  onOpenSettings: () => void;
  /** The free-version hint opens the plans screen. */
  onOpenPlans?: () => void;
  wallpaper?: Wallpaper | null;
};

export const StandbyScreen = ({
  name,
  info,
  prefs,
  nowMs,
  country,
  serverConnected,
  connectingSender,
  shareCode = null,
  freeVersion = false,
  onOpenSettings,
  onOpenPlans,
  wallpaper = null,
}: Props) => {
  const offline = useOffline(serverConnected);
  const {dx, dy} = useDrift();

  // The photo shows, with its credit, only once this exact URL has loaded.
  // A new URL (or none) forgets the last load and any failure, so a remounted
  // image never counts as loaded before its own onLoad.
  const imageUrl = wallpaper?.imageUrl ?? null;
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [seenUrl, setSeenUrl] = useState<string | null>(imageUrl);
  if (seenUrl !== imageUrl) {
    setSeenUrl(imageUrl);
    setLoadedUrl(null);
    setFailedUrl(null);
  }

  // A failed load is tried again, same URL, after a while: the next change of
  // photo can be a day away.
  useEffect(() => {
    if (failedUrl === null || failedUrl !== imageUrl) {
      return;
    }
    const timer = setTimeout(() => {
      setFailedUrl(null);
      setRetry((n) => n + 1);
    }, WALLPAPER_RETRY_MS);
    return () => clearTimeout(timer);
  }, [failedUrl, imageUrl]);

  const onPhoto = wallpaper !== null && loadedUrl === wallpaper.imageUrl;
  const credit = onPhoto ? `Photo by ${wallpaper.photographer} on Unsplash` : null;

  const view = buildView({name, info, prefs, nowMs, country, offline, connectingSender, shareCode, credit});
  const drift2 = {transform: [{translateX: dx * 2}, {translateY: dy * 2}]};

  return (
    <View style={styles.root}>
      <Image testID="standby-streams" source={BACKGROUND} resizeMode="stretch" style={[styles.background, drift2]} />
      {wallpaper ? (
        <Image
          // A new URL (or a retry) is a new image: a late load from the old one can't reveal it early.
          key={`${wallpaper.imageUrl}#${retry}`}
          testID="standby-photo"
          source={{uri: wallpaper.imageUrl}}
          resizeMode="cover"
          onLoad={() => setLoadedUrl(wallpaper.imageUrl)}
          onError={() => {
            setLoadedUrl(null);
            setFailedUrl(wallpaper.imageUrl);
          }}
          style={[styles.background, drift2, !onPhoto && styles.hidden]}
        />
      ) : null}
      {onPhoto ? <View testID="standby-tint" style={styles.tint} /> : null}
      <View testID="standby-content" style={[styles.content, {transform: [{translateX: dx}, {translateY: dy}]}]}>
        <StandbyLayout
          view={view}
          freeVersion={freeVersion}
          onOpenSettings={onOpenSettings}
          onOpenPlans={onOpenPlans}
        />
        <Credit text={credit} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.greenDark, overflow: 'hidden'},
  // Bigger than the screen so the drift never shows an edge.
  background: {
    position: 'absolute',
    left: -3 * U,
    top: -3 * U,
    width: SCREEN.width + 6 * U,
    height: SCREEN.height + 6 * U,
  },
  hidden: {opacity: 0},
  tint: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.35)'},
  content: {position: 'absolute', left: 0, top: 0, width: SCREEN.width, height: SCREEN.height},
});
