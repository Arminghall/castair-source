/*
 * Unlocking with Amazon in-app purchases (B18): whether this TV has CastAir
 * Unlimited (a subscription) or CastAir Lifetime, from Amazon's receipts,
 * with the last answer cached for when Amazon can't be reached.
 *
 * Amazon's purchasing library is a Vega system bundle the OS provides at
 * runtime (DECISIONS B18): the app bundle doesn't contain it.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  FulfillmentResult,
  NotifyFulfillmentResponseCode,
  ProductDataResponseCode,
  PurchaseResponseCode,
  PurchaseUpdatesResponseCode,
} from '@amazon-devices/keplerscript-appstore-iap-lib';
import type {Product, PurchasingService, Receipt} from '@amazon-devices/keplerscript-appstore-iap-lib';

export type UnlockState = {unlocked: boolean; kind: 'subscription' | 'lifetime' | null; checkedAt: number | null};

/** The in-app items in the Amazon Developer Console. */
export const SKUS = {
  parent: 'castair.unlimited',
  monthly: 'castair.unlimited.monthly',
  yearly: 'castair.unlimited.yearly',
  lifetime: 'castair.lifetime',
} as const;

/** How long the last successful check is trusted when Amazon can't be reached. */
export const CACHE_MS = 14 * 86_400_000;

const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};
const STATE_KEY = 'unlock.state';
const FULFILLED_KEY = 'unlock.fulfilled';
const SUBSCRIPTION_SKUS: readonly string[] = [SKUS.parent, SKUS.monthly, SKUS.yearly];

/** The parts of Amazon's PurchasingService CastAir uses. */
export type Iap = Pick<
  typeof PurchasingService,
  'getPurchaseUpdates' | 'getProductData' | 'purchase' | 'notifyFulfillment'
>;

/** Key-value storage (app/src/storage.ts in the app). */
export type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};

/**
 * The state Amazon's receipts give, checked at `now`. Any receipt that isn't
 * cancelled (or expired) unlocks: a subscription receipt carries the parent
 * SKU on the TV, with an empty termSku. Lifetime wins over a subscription.
 */
export function stateFromReceipts(receipts: Receipt[], now: number): UnlockState {
  const active = receipts.filter((r) => !r.isCancelled);
  if (active.some((r) => r.sku === SKUS.lifetime)) {
    return {unlocked: true, kind: 'lifetime', checkedAt: now};
  }
  if (active.some((r) => SUBSCRIPTION_SKUS.includes(r.sku) || SUBSCRIPTION_SKUS.includes(r.termSku))) {
    return {unlocked: true, kind: 'subscription', checkedAt: now};
  }
  return {unlocked: false, kind: null, checkedAt: now};
}

/**
 * The saved answer while it can be trusted: up to 14 days after the last
 * successful check, or while the clock reads earlier than that check (a clock
 * not yet set never locks out someone who has paid). Otherwise locked.
 */
export function cachedState(saved: UnlockState | null, now: number): UnlockState {
  if (saved && saved.checkedAt !== null && now - saved.checkedAt <= CACHE_MS) {
    return saved;
  }
  return LOCKED;
}

export class Unlock {
  private readonly iap: Iap;
  private readonly storage: Storage;
  private readonly now: () => number;
  private answered = false;
  // Checks run one at a time, in order: an older check never saves over a newer one.
  private queue: Promise<unknown> = Promise.resolve();

  constructor({iap, storage, now}: {iap: Iap; storage: Storage; now: () => number}) {
    this.iap = iap;
    this.storage = storage;
    this.now = now;
  }

  /**
   * Asks Amazon for every receipt (so the answer is complete and an expired
   * subscription locks), confirms new ones, and saves and returns the state.
   * If Amazon can't be reached, returns the cached state instead.
   */
  check(): Promise<UnlockState> {
    return this.checkWith([]);
  }

  /** Whether Amazon answered the last check (false before any check). */
  get lastCheckAnswered(): boolean {
    return this.answered;
  }

  /** The cached state, without asking Amazon. */
  async cached(): Promise<UnlockState> {
    return cachedState(await this.loadState(), this.now());
  }

  /**
   * Opens Amazon's purchase screen for `sku`. After a purchase (or when the
   * account already owns it) checks again, so the state is saved unlocked.
   * Amazon reports a purchase the viewer backs out of as FAILED, with no
   * receipt, so FAILED counts as cancelled; a bad SKU, no purchasing on this
   * device, or an error is a failure.
   */
  async buy(sku: string): Promise<'bought' | 'cancelled' | 'failed'> {
    let res;
    try {
      res = await this.iap.purchase({sku});
    } catch {
      return 'failed';
    }
    switch (res.responseCode) {
      case PurchaseResponseCode.SUCCESSFUL:
      case PurchaseResponseCode.ALREADY_PURCHASED:
        // Count the new receipt even if Amazon's history doesn't list it yet.
        await this.checkWith(res.receipt ? [res.receipt] : []);
        return 'bought';
      case PurchaseResponseCode.FAILED:
        return 'cancelled';
      default:
        return 'failed';
    }
  }

  /** Amazon's products (local prices, trial period) by SKU; none if Amazon fails. */
  async products(): Promise<Record<string, Product>> {
    try {
      const res = await this.iap.getProductData({skus: [SKUS.monthly, SKUS.yearly, SKUS.lifetime]});
      if (res.responseCode !== ProductDataResponseCode.SUCCESSFUL || !res.productData) {
        return {};
      }
      // A Map by the library's types; a plain object is accepted too, as the spike did.
      const data = res.productData as Map<string, Product> | Record<string, Product>;
      return data instanceof Map ? Object.fromEntries(data) : {...data};
    } catch {
      return {};
    }
  }

  private checkWith(extra: Receipt[]): Promise<UnlockState> {
    const run = this.queue.then(() => this.runCheck(extra));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runCheck(extra: Receipt[]): Promise<UnlockState> {
    const fromAmazon = await this.receipts();
    this.answered = fromAmazon !== null;
    if (fromAmazon === null) {
      // Amazon's history can't be read; a purchase it just answered still counts.
      const cached = await this.cached();
      const bought = stateFromReceipts(extra, this.now());
      if (!bought.unlocked || cached.kind === 'lifetime') {
        return cached;
      }
      await this.fulfil(extra);
      await this.save(STATE_KEY, bought);
      return bought;
    }
    const known = new Set(fromAmazon.map((r) => r.receiptId));
    const receipts = [...fromAmazon, ...extra.filter((r) => !known.has(r.receiptId))];
    const state = stateFromReceipts(receipts, this.now());
    await this.fulfil(receipts);
    await this.save(STATE_KEY, state);
    return state;
  }

  /** Every page of Amazon's receipts, or null if Amazon can't be reached. */
  private async receipts(): Promise<Receipt[] | null> {
    const all: Receipt[] = [];
    try {
      let first = true;
      let more = true;
      while (more) {
        const res = await this.iap.getPurchaseUpdates({reset: first});
        if (res.responseCode !== PurchaseUpdatesResponseCode.SUCCESSFUL) {
          return null;
        }
        all.push(...(res.receiptList ?? []));
        more = !!res.hasMore;
        first = false;
      }
    } catch {
      return null;
    }
    return all;
  }

  /**
   * Confirms receipts Amazon hasn't been told about (unconfirmed purchases are
   * refunded after 14 days) and remembers them. Cancelled receipts are skipped;
   * a confirmation Amazon refuses is tried again at the next check.
   */
  private async fulfil(receipts: Receipt[]): Promise<void> {
    const done = await this.loadFulfilled();
    const before = done.length;
    for (const r of receipts) {
      if (r.isCancelled || done.includes(r.receiptId)) {
        continue;
      }
      try {
        const res = await this.iap.notifyFulfillment({
          receiptId: r.receiptId,
          fulfillmentResult: FulfillmentResult.FULFILLED,
        });
        if (res.responseCode === NotifyFulfillmentResponseCode.SUCCESSFUL) {
          done.push(r.receiptId);
        }
      } catch {
        // Tried again at the next check.
      }
    }
    if (done.length > before) {
      await this.save(FULFILLED_KEY, done);
    }
  }

  private async loadState(): Promise<UnlockState | null> {
    const saved = (await this.load(STATE_KEY)) as Partial<UnlockState> | null;
    const ok =
      saved !== null &&
      typeof saved === 'object' &&
      typeof saved.unlocked === 'boolean' &&
      (saved.checkedAt === null || typeof saved.checkedAt === 'number');
    return ok ? (saved as UnlockState) : null;
  }

  private async loadFulfilled(): Promise<string[]> {
    const saved = await this.load(FULFILLED_KEY);
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
  }

  private async load(key: string): Promise<unknown> {
    try {
      const text = await this.storage.getItem(key);
      return text === null ? null : JSON.parse(text);
    } catch {
      return null;
    }
  }

  private async save(key: string, value: unknown): Promise<void> {
    try {
      await this.storage.setItem(key, JSON.stringify(value));
    } catch {
      // The answer still stands for this run; the next check saves again.
    }
  }
}
