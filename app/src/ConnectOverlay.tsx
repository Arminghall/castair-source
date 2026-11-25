/*
 * The "how to connect" overlays the standby screen's AirPlay, Windows and Cast
 * buttons open (spec §2): a dark scrim and a centred card in the ready card's
 * style, with numbered steps that use this TV's own names and code. Back
 * closes it, and so do 2 minutes without a key press. The Windows one has a
 * button that opens the Fire TV's own Windows (Miracast) sharing app.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {COLORS, SHARE_ADDRESS} from './config';
import {LOGOS, MUTED, U} from './standby/parts';
import type {ConnectKind} from './standby/view';

/** The Fire TV's own Windows sharing (Miracast) app; proven on the office TV on 25 Nov 2026. */
export const MIRACAST_URI = 'orpheus://com.amazon.miracast_sink.main';
/** The overlay closes after this long without a key press. */
export const OVERLAY_IDLE_MS = 120_000;

const ENABLE_LABEL = 'Enable Windows sharing';

type Props = {
  kind: ConnectKind;
  /** The name this TV advertises, e.g. "CastAir-Lounge". */
  castAirName: string;
  /** The Fire TV's own name, e.g. "Lounge"; null when it couldn't be read. */
  fireTvName: string | null;
  /** The code laptops must type; null when laptop codes are off. */
  shareCode: string | null;
  onClose: () => void;
  /** Opens the Fire TV's sharing app; rejects when it can't be opened. */
  onEnableWindows: () => Promise<void>;
};

const B = ({children}: {children: React.ReactNode}) => <Text style={styles.bold}>{children}</Text>;
const I = ({children}: {children: React.ReactNode}) => <Text style={styles.name}>{children}</Text>;

/** Numbered steps: they are a real sequence. */
const Steps = ({steps}: {steps: React.ReactNode[]}) => (
  <View style={styles.steps}>
    {steps.map((step, i) => (
      <View key={i} style={styles.step}>
        <View style={styles.number}>
          <Text style={styles.numberText}>{i + 1}</Text>
        </View>
        <Text style={styles.stepText}>{step}</Text>
      </View>
    ))}
  </View>
);

const SAME_WIFI = 'Join the same Wi-Fi as this TV.';

export const ConnectOverlay = ({kind, castAirName, fireTvName, shareCode, onClose, onEnableWindows}: Props) => {
  const close = useRef(onClose);
  close.current = onClose;
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const [unavailable, setUnavailable] = useState(false);

  const startIdle = useCallback(() => {
    if (idle.current !== undefined) {
      clearTimeout(idle.current);
    }
    idle.current = setTimeout(() => close.current(), OVERLAY_IDLE_MS);
  }, []);

  useEffect(() => {
    mounted.current = true;
    startIdle();
    return () => {
      mounted.current = false;
      if (idle.current !== undefined) {
        clearTimeout(idle.current);
      }
    };
  }, [startIdle]);

  useTVEventHandler(() => startIdle());

  // Back closes the overlay, never the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const enableWindows = () => {
    // A link that throws at once counts as a failed one too.
    Promise.resolve()
      .then(onEnableWindows)
      .catch(() => {
        if (mounted.current) {
          setUnavailable(true);
        }
      });
  };

  let title: string;
  let body: React.ReactNode;
  if (kind === 'apple') {
    title = 'Share from an iPhone, iPad or Mac';
    body = (
      <Steps
        steps={[
          SAME_WIFI,
          <>
            Open <B>Control Centre</B> and choose <B>Screen Mirroring</B>.
          </>,
          <>
            Choose <I>{castAirName}</I>.
          </>,
        ]}
      />
    );
  } else if (kind === 'chrome') {
    title = 'Share from your browser';
    body = (
      <>
        <Steps
          steps={[
            SAME_WIFI,
            <>
              In Chrome or Edge, go to <B>{SHARE_ADDRESS}</B>.
            </>,
            shareCode !== null ? (
              <>
                Choose <I>{castAirName}</I> and type the code <B>{shareCode}</B>.
              </>
            ) : (
              <>
                Choose <I>{castAirName}</I>.
              </>
            ),
            'Pick a screen, a window or a tab.',
          ]}
        />
        <Text style={styles.line}>Works on Windows, Mac and Chromebook.</Text>
      </>
    );
  } else {
    title = 'Share from a Windows laptop';
    body = (
      <>
        <Text style={styles.heading}>With Win+K</Text>
        <Steps
          steps={[
            <>
              Press <B>{ENABLE_LABEL}</B> below.
            </>,
            <>
              On the laptop press <B>Win+K</B>.
            </>,
            fireTvName !== null ? (
              <>
                Choose <I>{fireTvName}</I>.
              </>
            ) : (
              'Choose this Fire TV.'
            ),
          ]}
        />
        <Text style={styles.note}>
          This opens the Fire TV's own sharing screen. Press Back on the remote to come back to CastAir.
        </Text>
        <Text style={styles.heading}>Or in a browser</Text>
        <Text style={styles.line}>
          Go to <B>{SHARE_ADDRESS}</B> in Chrome or Edge.
        </Text>
        <Pressable testID="enable-windows" hasTVPreferredFocus onPress={enableWindows} style={styles.buttonBox}>
          {({focused}: {focused?: boolean}) => (
            <View style={[styles.button, focused && styles.buttonFocused]}>
              <Text style={[styles.buttonText, focused && styles.buttonTextFocused]}>{ENABLE_LABEL}</Text>
            </View>
          )}
        </Pressable>
        {unavailable ? <Text style={styles.error}>Windows sharing isn't available on this Fire TV.</Text> : null}
      </>
    );
  }

  return (
    <View testID="connect-overlay" style={styles.scrim}>
      <View testID="connect-card" style={styles.card}>
        <View testID="connect-header" style={styles.header}>
          <Image testID="connect-logo" source={LOGOS[kind]} resizeMode="contain" style={styles.logo} />
          <Text style={styles.title}>{title}</Text>
        </View>
        {body}
        <Text style={styles.back}>Press Back to close</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // A light dim: the standby text steps aside while an overlay is open (StandbyScreen
  // `hideButtons`), so only the wallpaper is behind the glass.
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Black glass, like the standby ready card (StandbyLayout `card`), a little denser for reading.
  card: {
    width: 68 * U,
    borderRadius: 1.6 * U,
    backgroundColor: 'rgba(12,12,14,.74)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.1)',
    padding: 3.5 * U,
  },
  header: {flexDirection: 'row', alignItems: 'center'},
  logo: {width: 3.6 * U, height: 3.6 * U, tintColor: COLORS.cream, marginRight: 1.6 * U},
  title: {flex: 1, color: COLORS.cream, fontSize: 2.6 * U, lineHeight: 3.2 * U, fontWeight: '600'},
  heading: {color: COLORS.mint, fontSize: 1.5 * U, fontWeight: '600', marginTop: 2 * U},
  steps: {marginTop: 1.6 * U},
  step: {flexDirection: 'row', alignItems: 'center', marginTop: 1 * U},
  number: {
    width: 2.6 * U,
    height: 2.6 * U,
    borderRadius: 1.3 * U,
    marginRight: 1.2 * U,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,217,176,.14)',
  },
  numberText: {color: COLORS.mint, fontSize: 1.4 * U, fontWeight: '700'},
  stepText: {flex: 1, color: MUTED, fontSize: 1.7 * U, lineHeight: 2.4 * U},
  bold: {color: COLORS.cream, fontWeight: '600'},
  name: {color: COLORS.cream, fontStyle: 'italic', fontWeight: '600'},
  line: {color: MUTED, fontSize: 1.7 * U, lineHeight: 2.4 * U, marginTop: 1.4 * U},
  note: {color: MUTED, fontSize: 1.4 * U, lineHeight: 2 * U, marginTop: 1.2 * U},
  buttonBox: {alignSelf: 'flex-start', marginTop: 2.2 * U},
  button: {
    paddingHorizontal: 2.2 * U,
    paddingVertical: 1 * U,
    borderRadius: 2 * U,
    backgroundColor: 'rgba(244,241,232,.12)',
  },
  buttonFocused: {backgroundColor: COLORS.cream},
  buttonText: {color: COLORS.cream, fontSize: 1.6 * U, fontWeight: '600'},
  buttonTextFocused: {color: COLORS.greenDark, fontWeight: '700'},
  error: {color: COLORS.cream, fontSize: 1.5 * U, marginTop: 1.2 * U},
  back: {color: MUTED, fontSize: 1.3 * U, marginTop: 2.4 * U},
});
