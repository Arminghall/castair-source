/*
 * Settings > Location: search for the town whose weather the standby screen shows,
 * or remove the chosen one. There is no automatic location (B12).
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useEffect, useRef, useState} from 'react';
import {findNodeHandle, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {COLORS} from './config';
import {searchPlaces} from './standby/data';
import type {PlaceHit} from './standby/data';
import {GLASS, Group, MUTED, Note, Row, Section, U} from './SettingsParts';

const DEBOUNCE_MS = 300;

type Props = {
  currentPlace: string | null;
  onPick: (place: PlaceHit | null) => void;
  onBack: () => void;
};

export const LocationScreen = ({currentPlace, onPick, onBack}: Props) => {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  // RIGHT from the search box or the remove row goes to the first match, not whichever row is level.
  const firstHit = useRef<View>(null);
  const [firstHandle, setFirstHandle] = useState<number | undefined>(undefined);
  useEffect(() => {
    const handle = hits.length > 0 && firstHit.current ? findNodeHandle(firstHit.current) : null;
    setFirstHandle(handle ?? undefined);
  }, [hits]);

  // Debounced search; a reply for an older query is dropped.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      searchPlaces(query.trim())
        .then((found) => current && setHits(found))
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.crumb}>Settings › </Text>
        <Text style={styles.title}>Location</Text>
        <Text style={styles.hint} onPress={onBack}>
          Back to Settings
        </Text>
      </View>
      <View style={styles.cols}>
        <View style={styles.col}>
          {currentPlace ? (
            <Group>
              <Row
                label="Remove town"
                sub={`Now ${currentPlace}. Removing it hides the weather.`}
                nextFocusRight={firstHandle}
                preferred
                onPress={() => onPick(null)}
              />
            </Group>
          ) : null}
          <Section>Search for a town</Section>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Town name"
            // Nothing else here takes focus without a town, so the box does (and the keyboard opens).
            autoFocus={!currentPlace}
            // @ts-expect-error nextFocusRight is a TV focus prop missing from TextInput's types
            nextFocusRight={firstHandle}
            placeholderTextColor={MUTED}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Note>
            Or press the microphone button on the remote and say the town. The weather appears once a town is chosen.
          </Note>
        </View>
        <View style={styles.col}>
          <Section>Matches</Section>
          <ScrollView>
            <Group>
              {hits.map((hit, i) => (
                <Row
                  innerRef={i === 0 ? firstHit : undefined}
                  key={hit.id}
                  label={hit.name}
                  value={[hit.region, hit.country].filter(Boolean).join(', ')}
                  onPress={() => onPick(hit)}
                />
              ))}
            </Group>
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1},
  head: {flexDirection: 'row', alignItems: 'center', marginBottom: 2 * U, marginHorizontal: 1.5 * U},
  crumb: {color: MUTED, fontSize: 1.7 * U},
  title: {color: COLORS.cream, fontSize: 1.7 * U, fontWeight: '600', flex: 1},
  hint: {color: MUTED, fontSize: 1.15 * U},
  cols: {flex: 1, flexDirection: 'row'},
  col: {flex: 1, marginHorizontal: 1.5 * U},
  search: {
    color: COLORS.cream,
    fontSize: 1.8 * U,
    paddingVertical: 1 * U,
    paddingHorizontal: 1.6 * U,
    borderRadius: 1 * U,
    ...GLASS,
  },
});
