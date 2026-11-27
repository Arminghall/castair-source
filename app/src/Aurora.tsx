/*
 * CastAir's own background: an aurora over a treeline, by Kush Dwivedi on
 * Unsplash (Unsplash License: free to use; credit appreciated, and given here).
 * It ships with the app, so it shows from the first launch, offline too. The
 * standby screen uses it whenever no daily photo is showing; Settings and the
 * Plans screen always use it, a little darker so their text stays easy to read.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {Image, StyleSheet, View} from 'react-native';

export const AURORA = require('./assets/aurora.jpg');
export const AURORA_CREDIT = 'Photo by Kush Dwivedi on Unsplash';

/** The aurora filling its parent, under a dark tint, for the menu screens. */
export const Backdrop = () => (
  <>
    <Image testID="backdrop" source={AURORA} resizeMode="cover" style={styles.fill} />
    <View testID="backdrop-tint" style={styles.tint} />
  </>
);

const styles = StyleSheet.create({
  fill: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%'},
  tint: {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.42)'},
});
