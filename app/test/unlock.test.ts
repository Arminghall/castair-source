/*
 * Tests for unlocking with Amazon purchases (Unlock, useUnlock), against the
 * manual mock of Amazon's purchasing library (test/__mocks__) and a memory
 * storage.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {act, renderHook} from '@testing-library/react-native';
import {
  FulfillmentResult,
  NotifyFulfillmentResponseCode,
  PurchaseResponseCode,
  PurchaseUpdatesResponseCode,
  PurchasingService,
} from '@amazon-devices/keplerscript-appstore-iap-lib';
import type {Receipt} from '@amazon-devices/keplerscript-appstore-iap-lib';
import {AsyncStorage} from '../src/storage';
import {SKUS, Unlock, cachedState, stateFromReceipts} from '../src/Unlock';
import type {UnlockState} from '../src/Unlock';
import {useUnlock} from '../src/useUnlock';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-23T12:00:00Z');
const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};

const iap = PurchasingService as unknown as {[K in keyof typeof PurchasingService]: jest.Mock};

const receipt = (receiptId: string, sku: string, more: Partial<Receipt> = {}): Receipt =>
  ({receiptId, sku, termSku: '', isCancelled: false, cancelDate: null, ...more}) as Receipt;

/** Amazon answers getPurchaseUpdates with these receipts, on one page. */
const amazonHas = (...receipts: Receipt[]) =>
  iap.getPurchaseUpdates.mockResolvedValue({
    responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL,
    receiptList: receipts,
    hasMore: false,
  });
const amazonUnreachable = () => iap.getPurchaseUpdates.mockRejectedValue(new Error('no network'));

const store = new Map<string, string>();
const memory = {
  getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
  setItem: (k: string, v: string) => {
    store.set(k, v);
    return Promise.resolve();
  },
};
const saved = (): UnlockState | null => JSON.parse(store.get('unlock.state') ?? 'null');
const waits: number[] = [];
const makeUnlock = (now = NOW) =>
  new Unlock({
    iap: PurchasingService,
    storage: memory,
    now: () => now,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });

beforeEach(() => {
  store.clear();
  waits.length = 0;
  jest.clearAllMocks();
  amazonHas();
  iap.notifyFulfillment.mockResolvedValue({responseCode: NotifyFulfillmentResponseCode.SUCCESSFUL});
  iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.FAILED, receipt: null});
  (AsyncStorage.getItem as jest.Mock).mockImplementation(memory.getItem);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(memory.setItem);
});

describe('stateFromReceipts', () => {
  it('subscription receipt (parent sku, empty termSku) → unlocked subscription', () => {
    expect(stateFromReceipts([receipt('r1', 'castair.unlimited')], NOW)).toEqual({
      unlocked: true,
      kind: 'subscription',
      checkedAt: NOW,
    });
    expect(stateFromReceipts([receipt('r2', 'castair.unlimited.yearly')], NOW).kind).toBe('subscription');
    expect(stateFromReceipts([receipt('r3', 'x', {termSku: 'castair.unlimited.monthly'})], NOW).kind).toBe(
      'subscription',
    );
  });

  it('lifetime receipt → unlocked lifetime, even with a cancelled subscription', () => {
    const lifetime = receipt('l', 'castair.lifetime');
    const cancelledSub = receipt('s', 'castair.unlimited', {isCancelled: true});
    expect(stateFromReceipts([cancelledSub, lifetime], NOW)).toEqual({
      unlocked: true,
      kind: 'lifetime',
      checkedAt: NOW,
    });
    expect(stateFromReceipts([receipt('s2', 'castair.unlimited'), lifetime], NOW).kind).toBe('lifetime');
  });

  it('cancelled only → locked', () => {
    const receipts = [
      receipt('s', 'castair.unlimited', {isCancelled: true}),
      receipt('l', 'castair.lifetime', {isCancelled: true}),
    ];
    expect(stateFromReceipts(receipts, NOW)).toEqual({unlocked: false, kind: null, checkedAt: NOW});
    expect(stateFromReceipts([], NOW)).toEqual({unlocked: false, kind: null, checkedAt: NOW});
  });

  it("other apps' or unknown SKUs don't unlock", () => {
    expect(stateFromReceipts([receipt('o', 'castair.other')], NOW).unlocked).toBe(false);
  });

  it('the SKUs are the Developer Console ones', () => {
    expect(SKUS).toEqual({
      parent: 'castair.unlimited',
      monthly: 'castair.unlimited.monthly',
      yearly: 'castair.unlimited.yearly',
      lifetime: 'castair.lifetime',
    });
  });
});

describe('stateFromReceipts by type', () => {
  it('an unknown SKU counts by its type: entitlement → lifetime, subscription → subscription', () => {
    expect(stateFromReceipts([receipt('a', 'x', {productType: 2 as never})], NOW).kind).toBe('lifetime');
    expect(stateFromReceipts([receipt('b', 'x', {productType: 3 as never})], NOW).kind).toBe('subscription');
    expect(stateFromReceipts([receipt('c', 'x', {productType: 'SUBSCRIPTION' as never})], NOW).kind).toBe(
      'subscription',
    );
    expect(stateFromReceipts([receipt('d', 'x', {productType: 1 as never})], NOW).unlocked).toBe(false);
    expect(stateFromReceipts([receipt('e', 'x', {productType: 2 as never, isCancelled: true})], NOW).unlocked).toBe(
      false,
    );
  });
});

describe('cachedState', () => {
  const lastGood: UnlockState = {unlocked: true, kind: 'lifetime', checkedAt: NOW};

  it('kept up to 14 days after the last successful check', () => {
    expect(cachedState(lastGood, NOW + 14 * DAY)).toEqual(lastGood);
  });
  it('locked after 14 days, or with no successful check', () => {
    expect(cachedState(lastGood, NOW + 14 * DAY + 1)).toEqual(LOCKED);
    expect(cachedState(null, NOW)).toEqual(LOCKED);
    expect(cachedState(LOCKED, NOW)).toEqual(LOCKED);
  });
});

describe('Unlock.check', () => {
  it('Amazon fails at launch: cached unlocked kept within 14 days', async () => {
    const lastGood: UnlockState = {unlocked: true, kind: 'subscription', checkedAt: NOW - 13 * DAY};
    store.set('unlock.state', JSON.stringify(lastGood));
    amazonUnreachable();
    expect(await makeUnlock().check()).toEqual(lastGood);
    // Amazon answering with a failure code is the same as not answering.
    iap.getPurchaseUpdates.mockResolvedValue({
      responseCode: PurchaseUpdatesResponseCode.FAILED,
      receiptList: [],
      hasMore: false,
    });
    expect(await makeUnlock().check()).toEqual(lastGood);
    // The failed checks don't overwrite the last good answer.
    expect(saved()).toEqual(lastGood);
  });

  it('lastCheckAnswered says whether Amazon answered the last check', async () => {
    const unlock = makeUnlock();
    expect(unlock.lastCheckAnswered).toBe(false);
    await unlock.check();
    expect(unlock.lastCheckAnswered).toBe(true);
    amazonUnreachable();
    await unlock.check();
    expect(unlock.lastCheckAnswered).toBe(false);
  });

  it('cached unlocked older than 14 days → locked', async () => {
    store.set('unlock.state', JSON.stringify({unlocked: true, kind: 'lifetime', checkedAt: NOW - 15 * DAY}));
    amazonUnreachable();
    expect(await makeUnlock().check()).toEqual(LOCKED);
  });

  it('never checked and Amazon unreachable → locked', async () => {
    amazonUnreachable();
    expect(await makeUnlock().check()).toEqual(LOCKED);
  });

  it('clock earlier than checkedAt keeps the cache', async () => {
    const lastGood: UnlockState = {unlocked: true, kind: 'lifetime', checkedAt: NOW};
    store.set('unlock.state', JSON.stringify(lastGood));
    amazonUnreachable();
    // A stick whose clock isn't set yet reads 1970.
    expect(await makeUnlock(0).check()).toEqual(lastGood);
    expect(cachedState(lastGood, NOW - 400 * DAY)).toEqual(lastGood);
  });

  it('a successful check saves the answer, and a cancelled subscription locks again', async () => {
    amazonHas(receipt('s', 'castair.unlimited'));
    expect(await makeUnlock().check()).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    expect(saved()).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    amazonHas(receipt('s', 'castair.unlimited', {isCancelled: true}));
    expect(await makeUnlock(NOW + DAY).check()).toEqual({unlocked: false, kind: null, checkedAt: NOW + DAY});
    expect(saved()?.unlocked).toBe(false);
  });

  it('reads every page, asking for the full history only on the first', async () => {
    iap.getPurchaseUpdates
      .mockResolvedValueOnce({
        responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL,
        receiptList: [receipt('s', 'castair.unlimited', {isCancelled: true})],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL,
        receiptList: [receipt('l', 'castair.lifetime')],
        hasMore: false,
      });
    expect((await makeUnlock().check()).kind).toBe('lifetime');
    expect(iap.getPurchaseUpdates.mock.calls).toEqual([[{reset: true}], [{reset: false}]]);
  });

  it('notifyFulfillment once per receipt across two checks', async () => {
    amazonHas(receipt('r1', 'castair.unlimited'), receipt('gone', 'castair.lifetime', {isCancelled: true}));
    await makeUnlock().check();
    expect(iap.notifyFulfillment.mock.calls).toEqual([
      [{receiptId: 'r1', fulfillmentResult: FulfillmentResult.FULFILLED}],
    ]);
    amazonHas(receipt('r1', 'castair.unlimited'), receipt('r2', 'castair.lifetime'));
    await makeUnlock().check();
    expect(iap.notifyFulfillment.mock.calls.map(([req]: [{receiptId: string}]) => req.receiptId)).toEqual(['r1', 'r2']);
    expect(JSON.parse(store.get('unlock.fulfilled') ?? '[]')).toEqual(['r1', 'r2']);
  });

  it('a fulfillment Amazon refuses is retried at the next check', async () => {
    amazonHas(receipt('r1', 'castair.lifetime'));
    iap.notifyFulfillment.mockResolvedValueOnce({responseCode: NotifyFulfillmentResponseCode.FAILED});
    expect((await makeUnlock().check()).unlocked).toBe(true);
    iap.notifyFulfillment.mockRejectedValueOnce(new Error('gone'));
    expect((await makeUnlock().check()).unlocked).toBe(true);
    await makeUnlock().check();
    await makeUnlock().check();
    expect(iap.notifyFulfillment).toHaveBeenCalledTimes(3);
    expect(JSON.parse(store.get('unlock.fulfilled') ?? '[]')).toEqual(['r1']);
  });

  it('unreadable saved state counts as never checked', async () => {
    store.set('unlock.state', 'not json');
    store.set('unlock.fulfilled', '{"x":1}');
    amazonUnreachable();
    expect(await makeUnlock().check()).toEqual(LOCKED);
    amazonHas(receipt('r1', 'castair.lifetime'));
    expect((await makeUnlock().check()).unlocked).toBe(true);
    expect(JSON.parse(store.get('unlock.fulfilled') ?? '[]')).toEqual(['r1']);
  });
});

describe('Unlock.buy', () => {
  it('buy success → check runs and state unlocks', async () => {
    const bought = receipt('new', 'castair.lifetime');
    iap.purchase.mockImplementation(async () => {
      amazonHas(bought);
      return {responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought};
    });
    const unlock = makeUnlock();
    expect(await unlock.check()).toEqual({unlocked: false, kind: null, checkedAt: NOW});
    expect(await unlock.buy(SKUS.lifetime)).toBe('bought');
    expect(iap.purchase).toHaveBeenCalledWith({sku: 'castair.lifetime'});
    expect(iap.getPurchaseUpdates).toHaveBeenCalledTimes(2);
    expect(saved()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
    expect(await unlock.cached()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
    expect(iap.notifyFulfillment).toHaveBeenCalledTimes(1);
  });

  it("a new purchase counts even before Amazon's purchase history lists it", async () => {
    const bought = receipt('new', 'castair.unlimited');
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought});
    expect(await makeUnlock().buy(SKUS.yearly)).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    expect(iap.notifyFulfillment).toHaveBeenCalledWith({
      receiptId: 'new',
      fulfillmentResult: FulfillmentResult.FULFILLED,
    });
  });

  it("a new purchase counts even if Amazon's history can't be read just after", async () => {
    const bought = receipt('new', 'castair.lifetime');
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought});
    amazonUnreachable();
    expect(await makeUnlock().buy(SKUS.lifetime)).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
    expect(iap.notifyFulfillment).toHaveBeenCalledTimes(1);
  });

  it('buy cancelled → receipts looked for over ~14 s, then state unchanged', async () => {
    const before: UnlockState = {unlocked: false, kind: null, checkedAt: NOW - DAY};
    store.set('unlock.state', JSON.stringify(before));
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.FAILED, receipt: null});
    expect(await makeUnlock().buy(SKUS.monthly)).toBe('cancelled');
    expect(waits).toEqual([2000, 4000, 8000]);
    expect(iap.getPurchaseUpdates).toHaveBeenCalledTimes(4);
    expect(saved()).toEqual(before);
    expect(store.has('unlock.bought')).toBe(false);
  });

  // The missing-key symptom: Amazon charged, but its reply and history have no receipt.
  it('SUCCESSFUL with no receipt and an empty history still unlocks, and stays unlocked for 3 days', async () => {
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: null});
    expect(await makeUnlock().buy(SKUS.yearly)).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    // Later checks with Amazon's list still empty keep it until 3 days have passed.
    expect(await makeUnlock(NOW + 2 * DAY).check()).toEqual({
      unlocked: true,
      kind: 'subscription',
      checkedAt: NOW + 2 * DAY,
    });
    expect(await makeUnlock(NOW + 3 * DAY).check()).toEqual({unlocked: false, kind: null, checkedAt: NOW + 3 * DAY});
  });

  it('SUCCESSFUL lifetime with no receipt unlocks as lifetime, also when Amazon is unreachable after', async () => {
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: null});
    amazonUnreachable();
    expect(await makeUnlock().buy(SKUS.lifetime)).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
  });

  it('a recent purchase never lowers lifetime, and a recent lifetime raises a subscription', async () => {
    store.set('unlock.bought', JSON.stringify({kind: 'subscription', at: NOW}));
    amazonHas(receipt('l', 'castair.lifetime'));
    expect((await makeUnlock().check()).kind).toBe('lifetime');
    store.set('unlock.bought', JSON.stringify({kind: 'lifetime', at: NOW}));
    amazonHas(receipt('s', 'castair.unlimited'));
    expect((await makeUnlock().check()).kind).toBe('lifetime');
  });

  it('FAILED but the receipt turns up while looking → bought', async () => {
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.FAILED, receipt: null});
    let calls = 0;
    iap.getPurchaseUpdates.mockImplementation(async () => {
      calls += 1;
      return {
        responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL,
        receiptList: calls >= 3 ? [receipt('late', 'castair.unlimited')] : [],
        hasMore: false,
      };
    });
    expect(await makeUnlock().buy(SKUS.monthly)).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    expect(iap.notifyFulfillment).toHaveBeenCalledWith({
      receiptId: 'late',
      fulfillmentResult: FulfillmentResult.FULFILLED,
    });
  });

  it('a non-SUCCESSFUL code with an unlocking receipt counts as bought', async () => {
    const r = receipt('odd', 'castair.lifetime');
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.FAILED, receipt: r});
    expect(await makeUnlock().buy(SKUS.lifetime)).toBe('bought');
    expect(saved()?.kind).toBe('lifetime');
  });

  it('already purchased counts as bought; a bad SKU, no support or an exception is a failure', async () => {
    amazonHas(receipt('old', 'castair.lifetime'));
    iap.purchase.mockResolvedValueOnce({responseCode: PurchaseResponseCode.ALREADY_PURCHASED, receipt: null});
    expect(await makeUnlock().buy(SKUS.lifetime)).toBe('bought');
    expect(saved()?.kind).toBe('lifetime');
    // An account with nothing: the failures below find no receipt while looking.
    amazonHas();
    iap.purchase.mockResolvedValueOnce({responseCode: PurchaseResponseCode.INVALID_SKU, receipt: null});
    expect(await makeUnlock().buy('castair.nope')).toBe('failed');
    iap.purchase.mockResolvedValueOnce({responseCode: PurchaseResponseCode.NOT_SUPPORTED, receipt: null});
    expect(await makeUnlock().buy(SKUS.monthly)).toBe('failed');
    iap.purchase.mockRejectedValueOnce(new Error('tester shut down'));
    expect(await makeUnlock().buy(SKUS.monthly)).toBe('failed');
  });
});

describe('overlapping checks', () => {
  it("a slow check started before a buy can't save locked over the purchase", async () => {
    const bought = receipt('new', 'castair.lifetime');
    let answerFirst: (v: unknown) => void = () => undefined;
    // The first check's history read is slow and says locked; later reads list the purchase.
    iap.getPurchaseUpdates
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValue({responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL, receiptList: [bought], hasMore: false});
    iap.purchase.mockResolvedValue({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought});
    const unlock = makeUnlock();
    const slow = unlock.check();
    const buying = unlock.buy(SKUS.lifetime);
    // Long enough for the buy's own check to finish, were it not waiting.
    await new Promise((resolve) => setImmediate(resolve));
    answerFirst({responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL, receiptList: [], hasMore: false});
    // The slow check finishes after the purchase was recorded, so it already counts it.
    expect((await slow).unlocked).toBe(true);
    expect(await buying).toBe('bought');
    expect(saved()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
    expect(await unlock.cached()).toEqual({unlocked: true, kind: 'lifetime', checkedAt: NOW});
  });

  it('checks answer in the order they were asked, and a failed one lets the next run', async () => {
    const unlock = makeUnlock();
    iap.getPurchaseUpdates.mockRejectedValueOnce(new Error('no network')).mockResolvedValueOnce({
      responseCode: PurchaseUpdatesResponseCode.SUCCESSFUL,
      receiptList: [receipt('l', 'castair.lifetime')],
      hasMore: false,
    });
    const first = unlock.check();
    const second = unlock.check();
    expect((await first).unlocked).toBe(false);
    expect((await second).kind).toBe('lifetime');
  });
});

describe('Unlock.products', () => {
  it("returns Amazon's products by SKU, or none when Amazon fails", async () => {
    const yearly = {sku: SKUS.yearly, price: {priceStr: '£8.99'}, freeTrialPeriod: 'Weekly'};
    iap.getProductData.mockResolvedValueOnce({responseCode: 1, productData: new Map([[SKUS.yearly, yearly]])});
    expect(await makeUnlock().products()).toEqual({[SKUS.yearly]: yearly});
    expect(iap.getProductData).toHaveBeenCalledWith({
      skus: ['castair.unlimited.monthly', 'castair.unlimited.yearly', 'castair.lifetime'],
    });
    iap.getProductData.mockResolvedValueOnce({responseCode: 3, productData: new Map()});
    expect(await makeUnlock().products()).toEqual({});
    iap.getProductData.mockRejectedValueOnce(new Error('offline'));
    expect(await makeUnlock().products()).toEqual({});
  });
});

describe('useUnlock', () => {
  const flush = () => act(async () => {});
  const advance = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });
  const yearly = {sku: SKUS.yearly, price: {priceStr: '£8.99'}};
  const amazonHasProducts = () =>
    iap.getProductData.mockResolvedValue({responseCode: 1, productData: new Map([[SKUS.yearly, yearly]])});
  const amazonHasNoProducts = () => iap.getProductData.mockRejectedValue(new Error('no network'));
  const checks = () => iap.getPurchaseUpdates.mock.calls.length;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    amazonHasProducts();
  });
  afterEach(() => jest.useRealTimers());

  it('Amazon fails at launch: shows the cached unlocked state', async () => {
    const lastGood: UnlockState = {unlocked: true, kind: 'lifetime', checkedAt: NOW - 2 * DAY};
    store.set('unlock.state', JSON.stringify(lastGood));
    amazonUnreachable();
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.state).toEqual(lastGood);
  });

  it('ready turns true once the cached state has loaded, whether or not Amazon answers', async () => {
    const lastGood: UnlockState = {unlocked: true, kind: 'subscription', checkedAt: NOW - DAY};
    store.set('unlock.state', JSON.stringify(lastGood));
    let answer: (v: unknown) => void = () => undefined;
    iap.getPurchaseUpdates.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const {result} = renderHook(() => useUnlock());
    expect(result.current.ready).toBe(false);
    await flush();
    // Amazon hasn't answered yet: the cache is in, so the state is ready.
    expect(result.current.ready).toBe(true);
    expect(result.current.state).toEqual(lastGood);
    await act(async () => answer({responseCode: PurchaseUpdatesResponseCode.FAILED, receiptList: [], hasMore: false}));
    expect(result.current.ready).toBe(true);
    expect(result.current.state).toEqual(lastGood);
  });

  it('ready is true with nothing cached and Amazon unreachable (the free version)', async () => {
    amazonUnreachable();
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.state).toEqual(LOCKED);
  });

  it('Check purchases again unlocks a purchase made on another TV', async () => {
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.state.unlocked).toBe(false);
    amazonHas(receipt('elsewhere', 'castair.unlimited'));
    await act(() => result.current.checkNow());
    expect(result.current.state).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    expect(iap.getPurchaseUpdates).toHaveBeenLastCalledWith({reset: true});
  });

  it('checkNow resolves whether Amazon answered', async () => {
    const {result} = renderHook(() => useUnlock());
    await flush();
    let answered: boolean | undefined;
    await act(async () => {
      answered = await result.current.checkNow();
    });
    expect(answered).toBe(true);
    amazonUnreachable();
    await act(async () => {
      answered = await result.current.checkNow();
    });
    expect(answered).toBe(false);
  });

  it('productsLoaded turns true once the first product load finishes, answered or not', async () => {
    let answerProducts: (v: unknown) => void = () => undefined;
    iap.getProductData.mockReturnValueOnce(new Promise((resolve) => (answerProducts = resolve)));
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.productsLoaded).toBe(false);
    await act(async () => answerProducts({responseCode: 3, productData: new Map()}));
    expect(result.current.productsLoaded).toBe(true);
    expect(result.current.products).toEqual({});
  });

  it('useUnlock re-checks after 6 hours', async () => {
    const {result, unmount} = renderHook(() => useUnlock());
    await flush();
    expect(checks()).toBe(1);
    amazonHas(receipt('later', 'castair.lifetime'));
    await advance(21_600_000 - 1);
    expect(checks()).toBe(1);
    await advance(1);
    expect(checks()).toBe(2);
    expect(result.current.state.kind).toBe('lifetime');
    unmount();
    await advance(21_600_000);
    expect(checks()).toBe(2);
  });

  it('a failed check retries at 1, 5 and 15 minutes, then every 6 hours', async () => {
    amazonUnreachable();
    renderHook(() => useUnlock());
    await flush();
    expect(checks()).toBe(1);
    for (const [wait, total] of [
      [60_000, 2],
      [300_000, 3],
      [900_000, 4],
      [21_600_000, 5],
      [21_600_000, 6],
    ]) {
      await advance(wait - 1);
      expect(checks()).toBe(total - 1);
      await advance(1);
      expect(checks()).toBe(total);
    }
  });

  it('a successful retry resets the backoff', async () => {
    amazonUnreachable();
    const {result} = renderHook(() => useUnlock());
    await flush();
    await advance(60_000); // 2nd check fails: next in 5 minutes
    expect(checks()).toBe(2);
    amazonHas(receipt('l', 'castair.lifetime'));
    await advance(300_000); // 3rd succeeds: next in 6 hours
    expect(checks()).toBe(3);
    expect(result.current.state.kind).toBe('lifetime');
    await advance(900_000);
    expect(checks()).toBe(3);
    await advance(21_600_000 - 900_000);
    expect(checks()).toBe(4);
    // A later failure starts again at 1 minute.
    amazonUnreachable();
    await advance(21_600_000);
    expect(checks()).toBe(5);
    await advance(60_000);
    expect(checks()).toBe(6);
  });

  it('products reload after an empty first load, on checkNow', async () => {
    amazonHasNoProducts();
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.products).toEqual({});
    amazonHasProducts();
    await act(() => result.current.checkNow());
    expect(result.current.products).toEqual({[SKUS.yearly]: yearly});
    // Once loaded, they aren't asked for again.
    await act(() => result.current.checkNow());
    expect(iap.getProductData).toHaveBeenCalledTimes(2);
  });

  it('products reload after an empty first load, on the retry tick', async () => {
    amazonHasNoProducts();
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.products).toEqual({});
    amazonHasProducts();
    // The check succeeded but there are no products yet: that's retried at 1 minute too.
    await advance(60_000);
    expect(iap.getProductData).toHaveBeenCalledTimes(2);
    expect(result.current.products).toEqual({[SKUS.yearly]: yearly});
    // Back to every 6 hours once both are in.
    await advance(300_000);
    expect(checks()).toBe(2);
  });

  it('a check started before a buy that ends after it does not re-lock', async () => {
    // The mount check's answer (locked) waits for a slow product load.
    let answerProducts: (v: unknown) => void = () => undefined;
    iap.getProductData.mockReturnValueOnce(new Promise((resolve) => (answerProducts = resolve)));
    const bought = receipt('new', 'castair.unlimited');
    iap.purchase.mockResolvedValueOnce({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought});
    const {result} = renderHook(() => useUnlock());
    await flush();
    await act(async () => {
      await result.current.buy(SKUS.yearly);
    });
    expect(result.current.state.unlocked).toBe(true);
    await act(async () => answerProducts({responseCode: 1, productData: new Map([[SKUS.yearly, yearly]])}));
    expect(result.current.state).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
    expect(result.current.products).toEqual({[SKUS.yearly]: yearly});
  });

  it('buy updates the state, and loads the products', async () => {
    const bought = receipt('new', 'castair.unlimited');
    iap.purchase.mockResolvedValueOnce({responseCode: PurchaseResponseCode.SUCCESSFUL, receipt: bought});
    const {result} = renderHook(() => useUnlock());
    await flush();
    expect(result.current.products).toEqual({[SKUS.yearly]: yearly});
    let outcome = '';
    await act(async () => {
      outcome = await result.current.buy(SKUS.yearly);
    });
    expect(outcome).toBe('bought');
    expect(result.current.state).toEqual({unlocked: true, kind: 'subscription', checkedAt: NOW});
  });
});
