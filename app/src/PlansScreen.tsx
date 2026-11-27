/*
 * The plans screen: Yearly, Monthly and Lifetime, bought with the remote
 * (B18). Prices and the free trial come from Amazon's product data. Reached
 * from Settings, and from the end of the free allowance (with its own title and a line under it).
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Backdrop} from './Aurora';
import type {Product} from '@amazon-devices/keplerscript-appstore-iap-lib';
import {COLORS} from './config';
import {Group, MUTED, Note, Row, U} from './SettingsParts';
import {SKUS} from './Unlock';
import type {UnlockState} from './Unlock';

type Props = {
  /** Amazon's products by SKU; a missing one hides its button. */
  products: Record<string, Product>;
  state: UnlockState;
  /** False while the first product load is still going (shows "Loading prices…"). */
  productsLoaded?: boolean;
  onBuy: (sku: string) => Promise<'bought' | 'cancelled' | 'failed'>;
  /** Asks Amazon again; resolves whether Amazon answered. */
  onCheckAgain: () => Promise<boolean>;
  onClose: () => void;
  title?: string;
  /** A line under the title (not with the thanks). */
  subtitle?: string;
};

type Plan = {sku: string; label: string};

/** The buttons for the products Amazon returned, Yearly first. */
function plans(products: Record<string, Product>): Plan[] {
  const out: Plan[] = [];
  const yearly = products[SKUS.yearly];
  if (yearly) {
    const price = yearly.price.priceStr;
    out.push({
      sku: SKUS.yearly,
      label: yearly.freeTrialPeriod ? `Yearly · 7-day free trial, then ${price} a year` : `Yearly · ${price} a year`,
    });
  }
  const monthly = products[SKUS.monthly];
  if (monthly) {
    out.push({sku: SKUS.monthly, label: `Monthly · ${monthly.price.priceStr} a month`});
  }
  const lifetime = products[SKUS.lifetime];
  if (lifetime) {
    out.push({sku: SKUS.lifetime, label: `Lifetime · ${lifetime.price.priceStr} once`});
  }
  return out;
}

export const PlansScreen = ({
  products,
  state,
  productsLoaded = true,
  onBuy,
  onCheckAgain,
  onClose,
  title = 'Unlock CastAir',
  subtitle,
}: Props) => {
  const [busy, setBusy] = useState(false);
  // Amazon answered a purchase or a check: thanks if the saved state now says unlocked.
  const [confirmed, setConfirmed] = useState(false);
  const [failed, setFailed] = useState(false);
  const list = plans(products);

  // Presses while Amazon is answering are ignored; the rows stay focusable so focus isn't lost.
  const buy = async (sku: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setConfirmed(false);
    setFailed(false);
    try {
      const result = await onBuy(sku);
      // Thanks only once the saved state says unlocked (the render below checks it).
      setConfirmed(result === 'bought');
      setFailed(result === 'failed');
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setConfirmed(false);
    setFailed(false);
    try {
      const answered = await onCheckAgain();
      setConfirmed(answered);
      setFailed(!answered);
    } finally {
      setBusy(false);
    }
  };

  const thanks = confirmed && state.unlocked;
  let status: string | null = null;
  if (busy) {
    status = 'Checking with Amazon…';
  } else if (failed || (productsLoaded && list.length === 0)) {
    status = "Couldn't reach Amazon. Try again.";
  } else if (list.length === 0) {
    status = 'Loading prices…';
  }

  return (
    <View style={styles.root}>
      <Backdrop />
      <View style={styles.page}>
        <Text style={[styles.title, subtitle && !thanks ? styles.titleOverSubtitle : null]}>
          {thanks ? 'Unlimited casts are on. Thank you!' : title}
        </Text>
        {subtitle && !thanks ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {thanks ? (
          <Group>
            <Row label="Back" chevron preferred onPress={onClose} />
          </Group>
        ) : (
          <>
            {status ? <Text style={styles.status}>{status}</Text> : null}
            <Group>
              {list.map((plan, i) => (
                <Row key={plan.sku} label={plan.label} chevron preferred={i === 0} onPress={() => buy(plan.sku)} />
              ))}
              <Row label="Check purchases again" chevron preferred={list.length === 0} onPress={checkAgain} />
              <Row label="Back" chevron onPress={onClose} />
            </Group>
            <Note>
              Subscriptions renew until cancelled. Manage them in your Amazon account under Memberships & Subscriptions.
            </Note>
          </>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.greenDark},
  page: {flex: 1, paddingHorizontal: 12 * U, paddingTop: 6 * U, paddingBottom: 3 * U},
  title: {color: COLORS.cream, fontSize: 3 * U, fontWeight: '600', marginBottom: 2.4 * U},
  titleOverSubtitle: {marginBottom: 0.8 * U},
  subtitle: {color: MUTED, fontSize: 1.6 * U, marginBottom: 2.4 * U},
  status: {color: MUTED, fontSize: 1.4 * U, marginBottom: 1.2 * U},
});
