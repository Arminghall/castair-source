/*
 * Tests for the plans screen: labels from Amazon's products, buying, and the
 * thank-you only once the state says unlocked.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import type {Product} from '@amazon-devices/keplerscript-appstore-iap-lib';
import {PlansScreen} from '../src/PlansScreen';
import {SKUS} from '../src/Unlock';
import type {UnlockState} from '../src/Unlock';

const product = (sku: string, priceStr: string, freeTrialPeriod?: string) =>
  ({sku, price: {priceStr}, freeTrialPeriod}) as unknown as Product;
const PRODUCTS = {
  [SKUS.yearly]: product(SKUS.yearly, '£8.99', 'Weekly'),
  [SKUS.monthly]: product(SKUS.monthly, '£1.99'),
  [SKUS.lifetime]: product(SKUS.lifetime, '£14.99'),
};
const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};
const UNLOCKED: UnlockState = {unlocked: true, kind: 'subscription', checkedAt: 1};

const onBuy = jest.fn();
const onCheckAgain = jest.fn();
const onClose = jest.fn();
type Props = React.ComponentProps<typeof PlansScreen>;
const show = (over: Partial<Props> = {}) =>
  render(
    <PlansScreen
      products={PRODUCTS}
      state={LOCKED}
      onBuy={onBuy}
      onCheckAgain={onCheckAgain}
      onClose={onClose}
      {...over}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  onBuy.mockResolvedValue('cancelled');
  onCheckAgain.mockResolvedValue(true);
});

it('Yearly label shows the trial and Amazon price', () => {
  show();
  expect(screen.getByText('Yearly · 7-day free trial, then £8.99 a year')).toBeTruthy();
  expect(screen.getByText('Monthly · £1.99 a month')).toBeTruthy();
  expect(screen.getByText('Lifetime · £14.99 once')).toBeTruthy();
  expect(screen.getByText('Unlock CastAir')).toBeTruthy();
  expect(
    screen.getByText(
      'Subscriptions renew until cancelled. Manage them in your Amazon account under Memberships & Subscriptions.',
    ),
  ).toBeTruthy();
});

it('Yearly drops the trial wording when Amazon has no trial, and takes initial focus', () => {
  show({products: {...PRODUCTS, [SKUS.yearly]: product(SKUS.yearly, '£8.99')}});
  const label = screen.getByText('Yearly · £8.99 a year');
  let node = label.parent;
  while (node && node.props.hasTVPreferredFocus === undefined) {
    node = node.parent;
  }
  expect(node?.props.hasTVPreferredFocus).toBe(true);
});

it('shows a custom title', () => {
  show({title: 'Free casts last 5 minutes'});
  expect(screen.getByText('Free casts last 5 minutes')).toBeTruthy();
});

it('missing product hides its button', () => {
  const {[SKUS.monthly]: _monthly, ...rest} = PRODUCTS;
  show({products: rest});
  expect(screen.queryByText(/^Monthly/)).toBeNull();
  expect(screen.getByText(/^Yearly/)).toBeTruthy();
  expect(screen.getByText(/^Lifetime/)).toBeTruthy();
});

it('buy calls onBuy with the term sku', async () => {
  show();
  for (const [label, sku] of [
    [/^Yearly/, SKUS.yearly],
    [/^Monthly/, SKUS.monthly],
    [/^Lifetime/, SKUS.lifetime],
  ] as const) {
    await act(async () => {
      fireEvent.press(screen.getByText(label));
    });
    expect(onBuy).toHaveBeenLastCalledWith(sku);
  }
});

it('bought shows the thank-you copy once the state is unlocked', async () => {
  onBuy.mockResolvedValue('bought');
  const view = show();
  await act(async () => {
    fireEvent.press(screen.getByText(/^Yearly/));
  });
  // Bought but the saved state still says locked: back on the plans, quietly.
  expect(screen.queryByText('Unlimited casts are on. Thank you!')).toBeNull();
  expect(screen.getByText(/^Yearly/)).toBeTruthy();
  view.rerender(
    <PlansScreen products={PRODUCTS} state={UNLOCKED} onBuy={onBuy} onCheckAgain={onCheckAgain} onClose={onClose} />,
  );
  expect(screen.getByText('Unlimited casts are on. Thank you!')).toBeTruthy();
  fireEvent.press(screen.getByText('Back'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('cancelled shows no error; failed shows a short neutral line', async () => {
  show();
  await act(async () => {
    fireEvent.press(screen.getByText(/^Yearly/));
  });
  expect(screen.queryByText(/Couldn't reach Amazon/)).toBeNull();
  onBuy.mockResolvedValue('failed');
  await act(async () => {
    fireEvent.press(screen.getByText(/^Yearly/));
  });
  expect(screen.getByText("Couldn't reach Amazon. Try again.")).toBeTruthy();
});

it('Check purchases again calls onCheckAgain', async () => {
  show();
  await act(async () => {
    fireEvent.press(screen.getByText('Check purchases again'));
  });
  expect(onCheckAgain).toHaveBeenCalledTimes(1);
});

it('Check purchases again that finds the TV unlocked thanks, with Back focused', async () => {
  const view = show();
  onCheckAgain.mockImplementation(async () => {
    // The check saves unlocked before it resolves, as useUnlock does.
    view.rerender(
      <PlansScreen products={PRODUCTS} state={UNLOCKED} onBuy={onBuy} onCheckAgain={onCheckAgain} onClose={onClose} />,
    );
    return true;
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Check purchases again'));
  });
  expect(screen.getByText('Unlimited casts are on. Thank you!')).toBeTruthy();
  expect(screen.queryByText(/^Yearly/)).toBeNull();
  expect(screen.queryByText('Check purchases again')).toBeNull();
  let node = screen.getByText('Back').parent;
  while (node && node.props.hasTVPreferredFocus === undefined) {
    node = node.parent;
  }
  expect(node?.props.hasTVPreferredFocus).toBe(true);
});

it("Check purchases again that Amazon doesn't answer says so", async () => {
  onCheckAgain.mockResolvedValue(false);
  show();
  expect(screen.queryByText(/Couldn't reach Amazon/)).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText('Check purchases again'));
  });
  expect(screen.getByText("Couldn't reach Amazon. Try again.")).toBeTruthy();
  // Answered but still locked: back on the plans, quietly.
  onCheckAgain.mockResolvedValue(true);
  await act(async () => {
    fireEvent.press(screen.getByText('Check purchases again'));
  });
  expect(screen.queryByText(/Couldn't reach Amazon/)).toBeNull();
  expect(screen.queryByText('Unlimited casts are on. Thank you!')).toBeNull();
});

it('shows "Loading prices…" until the first product load finishes, then the error if none came', () => {
  const view = show({products: {}, productsLoaded: false});
  expect(screen.getByText('Loading prices…')).toBeTruthy();
  expect(screen.queryByText(/Couldn't reach Amazon/)).toBeNull();
  view.rerender(
    <PlansScreen
      products={{}}
      productsLoaded
      state={LOCKED}
      onBuy={onBuy}
      onCheckAgain={onCheckAgain}
      onClose={onClose}
    />,
  );
  expect(screen.queryByText('Loading prices…')).toBeNull();
  expect(screen.getByText("Couldn't reach Amazon. Try again.")).toBeTruthy();
});

it('Back calls onClose', () => {
  show();
  fireEvent.press(screen.getByText('Back'));
  expect(onClose).toHaveBeenCalledTimes(1);
});
