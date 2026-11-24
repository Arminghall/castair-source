/*
 * Shared pieces of the Settings page: grouped rows, section labels and the look.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {Dimensions, Pressable, StyleSheet, Text, View} from 'react-native';
import {COLORS} from './config';

export const U = Dimensions.get('window').width / 100;
export const MUTED = 'rgba(244,241,232,.62)';

export const Section = ({children}: {children: string}) => <Text style={styles.section}>{children}</Text>;

export const Group = ({children}: {children: React.ReactNode}) => <View style={styles.group}>{children}</View>;

export const Note = ({children}: {children: React.ReactNode}) => <Text style={styles.note}>{children}</Text>;

/** A row: label left, value (and chevron when it opens something) right. Cream when focused. */
export const Row = ({
  label,
  value,
  chevron = false,
  onPress,
  preferred = false,
  disabled = false,
  box,
  sub,
  innerRef,
  nextFocusRight,
}: {
  label: string;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
  preferred?: boolean;
  disabled?: boolean;
  /** Draw a checkbox on the right: checked or not. */
  box?: boolean;
  /** A smaller muted line under the label. */
  sub?: string;
  innerRef?: React.Ref<View>;
  /** Node handle the remote's RIGHT goes to. */
  nextFocusRight?: number;
}) => (
  <Pressable
    ref={innerRef}
    nextFocusRight={nextFocusRight}
    onPress={onPress}
    disabled={disabled || !onPress}
    focusable={!disabled && !!onPress}
    hasTVPreferredFocus={preferred}
    accessibilityState={{disabled, checked: box}}
    style={disabled ? styles.disabled : undefined}>
    {({focused}: {focused?: boolean}) => (
      <View style={[styles.row, focused && styles.rowFocused]}>
        <View style={styles.labelBlock}>
          <Text style={[styles.label, focused && styles.labelFocused]}>{label}</Text>
          {sub ? <Text style={[styles.sub, focused && styles.valueFocused]}>{sub}</Text> : null}
        </View>
        <View style={styles.right}>
          {value ? <Text style={[styles.value, focused && styles.valueFocused]}>{value}</Text> : null}
          {chevron ? <Text style={[styles.value, focused && styles.valueFocused]}> ›</Text> : null}
          {box !== undefined ? (
            <View style={[styles.box, focused && styles.boxFocused]}>
              {box ? <Text style={styles.tick}>✓</Text> : null}
            </View>
          ) : null}
        </View>
      </View>
    )}
  </Pressable>
);

const styles = StyleSheet.create({
  section: {
    color: COLORS.mint,
    fontSize: 1.1 * U,
    letterSpacing: 0.12 * U,
    textTransform: 'uppercase',
    marginTop: 1.6 * U,
    marginBottom: 0.6 * U,
    marginLeft: 0.4 * U,
  },
  group: {borderRadius: 1.2 * U, backgroundColor: 'rgba(244,241,232,.06)', overflow: 'hidden'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 1.05 * U,
    paddingHorizontal: 1.6 * U,
    borderRadius: 1.2 * U,
  },
  rowFocused: {backgroundColor: COLORS.cream},
  label: {color: COLORS.cream, fontSize: 1.5 * U},
  labelBlock: {flexShrink: 1},
  sub: {color: MUTED, fontSize: 1.15 * U, marginTop: 0.2 * U},
  labelFocused: {color: COLORS.greenDark},
  right: {flexDirection: 'row', alignItems: 'center', flexShrink: 1},
  value: {color: MUTED, fontSize: 1.5 * U, flexShrink: 1},
  valueFocused: {color: 'rgba(16,57,43,.7)'},
  box: {
    width: 2 * U,
    height: 2 * U,
    borderRadius: 0.5 * U,
    borderWidth: 2,
    borderColor: 'rgba(244,241,232,.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFocused: {borderColor: COLORS.greenDark},
  tick: {color: COLORS.mint, fontSize: 1.3 * U, fontWeight: 'bold'},
  note: {color: MUTED, fontSize: 1.12 * U, lineHeight: 1.7 * U, marginTop: 0.5 * U, marginHorizontal: 0.4 * U},
  disabled: {opacity: 0.4},
});
