/*
 * The About tab: licence notices AGPL 5(d) asks for, third-party notices, privacy, credits.
 *
 * Copyright (C) 2026 Parker Wahle
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {BUILD} from './buildInfo';
import {COLORS, SOURCE_NOTE} from './config';
import {AURORA_CREDIT} from './Aurora';
import {GLASS, MUTED, U} from './SettingsParts';

const UPSTREAM_URL = 'github.com/regulad/RosellaView';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';
const MARK = require('./assets/castair_mark.png');

const NOTICES: [string, string, string][] = [
  ['UxPlay', 'GPL-3.0-or-later', 'F. Duncanh and contributors'],
  ['RPiPlay (crypto)', 'GPL-3.0-or-later', 'Florian Draschbacher, Jaslo Ziska'],
  ['playfair', 'GPL-3.0-or-later', 'Esteban Kubata'],
  ['libplist', 'LGPL-2.1-or-later', 'Nikias Bassen and contributors'],
  ['OpenSSL', 'Apache-2.0', 'The OpenSSL Project Authors'],
  ['FFmpeg (AAC, ALAC decoders)', 'LGPL-2.1-or-later', 'the FFmpeg developers'],
  ['Tandem (receiver and sharing page)', 'Apache-2.0', 'the Tandem authors (github.com/kevinl95/Tandem)'],
  ['ws (WebSocket library, server)', 'MIT', 'Einar Otto Stangvik and contributors'],
  ['React Native, React', 'MIT', 'Meta Platforms, Inc.'],
  ['Node-API headers', 'MIT', 'Node.js contributors'],
];

/** A section heading: focusable, so the remote's up/down scrolls section by section. */
const Heading = ({children}: {children: React.ReactNode}) => (
  <View focusable style={styles.headingBlock}>
    <Text style={styles.heading}>{children}</Text>
  </View>
);

export const AboutTab = () => (
  <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
    <View focusable style={styles.titleRow}>
      <Image source={MARK} style={styles.mark} resizeMode="contain" />
      <View style={styles.titleText}>
        <Text style={styles.title}>CastAir</Text>
        <Text style={styles.body}>an Arminghall app</Text>
        <Text style={styles.build}>Build {BUILD.release.replace(/^castair@/, '')}</Text>
      </View>
    </View>

    <Heading>Privacy</Heading>
    <Text style={styles.small}>
      What you mirror stays on your network: it goes only from your device to this TV and is never recorded or sent
      anywhere else. For the clock and weather, the TV sends CastAir's server its time zone and any town you choose in
      Settings; the server uses them only to answer that request. If you turn on wallpapers, the TV loads photos
      directly from Unsplash. CastAir sends no crash reports or statistics. Amazon handles payments; CastAir's server
      never sees them.
    </Text>
    <Text style={styles.small}>Support: castair@arminghall.com</Text>

    <Heading>Licence</Heading>
    <Text style={styles.small}>
      CastAir is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
      Public License, version 3 or (at your option) any later version. It comes with ABSOLUTELY NO WARRANTY. Licence:{' '}
      {LICENSE_URL}
    </Text>
    <Text style={styles.small}>
      Copyright © 2026 Arminghall. Includes code by Parker Wahle ({UPSTREAM_URL}), AGPL-3.0-or-later.
    </Text>
    <Text style={styles.small}>Source code: {SOURCE_NOTE}</Text>

    <Heading>Includes</Heading>
    {NOTICES.map(([name, licence, holder]) => (
      <Text key={name} style={styles.small}>
        {name} ({licence}), © {holder}
      </Text>
    ))}
    <Text style={styles.small}>Licence texts and source code for these are available with CastAir's source.</Text>

    <Heading>Weather, location and photos</Heading>
    <Text style={styles.small}>Weather data: MET Norway (CC BY 4.0)</Text>
    <Text style={styles.small}>Place names: GeoNames (CC BY 4.0)</Text>
    <Text style={styles.small}>Background: {AURORA_CREDIT}</Text>
    <Text style={styles.small}>Wallpaper photos: Unsplash</Text>

    <Heading>Trademarks</Heading>
    <Text style={styles.small}>
      Apple, AirPlay, iPhone, iPad and Mac are trademarks of Apple Inc., registered in the U.S. and other countries and
      regions. IOS is a trademark or registered trademark of Cisco in the U.S. and other countries and is used under
      license. CastAir is not affiliated with or endorsed by Apple Inc.
    </Text>
    <Text style={styles.small}>
      Windows is a trademark of the Microsoft group of companies. Chrome and Google Cast are trademarks of Google LLC.
      CastAir is not affiliated with or endorsed by either.
    </Text>
  </ScrollView>
);

const styles = StyleSheet.create({
  scroll: {flex: 1},
  // One black-glass panel behind all the text, so it reads well over the aurora.
  content: {
    ...GLASS,
    borderRadius: 1.2 * U,
    paddingHorizontal: 2.4 * U,
    paddingTop: 2.2 * U,
    paddingBottom: 2.4 * U,
    marginBottom: 3 * U,
  },
  titleRow: {flexDirection: 'row', alignItems: 'center'},
  titleText: {flexShrink: 1},
  mark: {width: 6 * U, height: 6 * U, marginRight: 1.6 * U},
  title: {color: COLORS.cream, fontSize: 2.8 * U, fontWeight: 'bold'},
  body: {color: MUTED, fontSize: 1.4 * U},
  build: {color: MUTED, fontSize: 1.2 * U, marginTop: 0.2 * U},
  headingBlock: {marginTop: 2 * U, marginBottom: 0.5 * U},
  heading: {color: COLORS.cream, fontSize: 1.6 * U, fontWeight: 'bold'},
  small: {color: MUTED, fontSize: 1.2 * U, lineHeight: 1.9 * U, marginBottom: 0.8 * U},
});
