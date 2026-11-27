/*
 * Unlocking with Amazon in-app purchases (B18): whether this TV has CastAir
 * Unlimited (a subscription) or CastAir Lifetime, from Amazon's receipts,
 * with the last answer cached for when Amazon can't be reached.
 *
 * Amazon's purchasing library is a Vega system bundle the OS provides at
 * runtime (DECISIONS B18): the app bundle doesn't contain it.
 *
 * Real (store-signed) purchases need assets/raw/AppstoreAuthenticationKey.pem,
 * CastAir's public key from the Developer Console (Release Tracks → View →
 * Public Key). Without it the library can't validate receipts and silently
 * drops them: Amazon takes the money and says thanks, but purchase() has no
 * receipt and getPurchaseUpdates is an empty SUCCESSFUL list. The IAP App
 * Tester sandbox doesn't need the key, so sandbox tests can't catch this
 * (found on Waveband, 27 November 2026). Builds 1 to 5 shipped without it.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  FulfillmentResult,
  NotifyFulfillmentResponseCode,
  ProductDataResponseCode,
  ProductType,
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
/**
 * After Amazon says a purchase went through, how long an answer without its
 * receipt is taken as "Amazon hasn't caught up" rather than "not bought".
 */
export const BOUGHT_GRACE_MS = 3 * 86_400_000;
/**
 * After a purchase Amazon didn't confirm in its reply, look for the receipt
 * after these waits (about 14 seconds in all).
 */
export const CONFIRM_WAITS_MS = [0, 2000, 4000, 8000];

const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};
const STATE_KEY = 'unlock.state';
const FULFILLED_KEY = 'unlock.fulfilled';
const BOUGHT_KEY = 'unlock.bought';
const SUBSCRIPTION_SKUS: readonly string[] = [SKUS.parent, SKUS.monthly, SKUS.yearly];

type Bought = {kind: 'subscription' | 'lifetime'; at: number};

/** The library uses numbers (ENTITLED = 2, SUBSCRIPTION = 3); accept the name too. */
const isType = (r: Receipt, type: ProductType, name: string) =>
  (r.productType as unknown) === type || String(r.productType ?? '').toUpperCase() === name;

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
 * CastAir sells only these items, so a receipt counts if its SKU matches OR
 * its type does (an entitlement is Lifetime, a subscription is Unlimited):
 * neither field alone is trusted (Waveband's review purchase, 27 November
 * 2026, wasn't recognised by SKU).
 */
export function stateFromReceipts(receipts: Receipt[], now: number): UnlockState {
  const active = receipts.filter((r) => r && !r.isCancelled);
  if (active.some((r) => r.sku === SKUS.lifetime || isType(r, ProductType.ENTITLED, 'ENTITLED'))) {
    return {unlocked: true, kind: 'lifetime', checkedAt: now};
  }
  if (
    active.some(
      (r) =>
        SUBSCRIPTION_SKUS.includes(r.sku) ||
        SUBSCRIPTION_SKUS.includes(r.termSku) ||
        isType(r, ProductType.SUBSCRIPTION, 'SUBSCRIPTION'),
    )
  ) {
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
  private readonly sleep: (ms: number) => Promise<void>;
  private answered = false;
  // Checks run one at a time, in order: an older check never saves over a newer one.
  private queue: Promise<unknown> = Promise.resolve();

  constructor({
    iap,
    storage,
    now,
    sleep = (ms) => new Promise<void>((done) => setTimeout(done, ms)),
  }: {
    iap: Iap;
    storage: Storage;
    now: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.iap = iap;
    this.storage = storage;
    this.now = now;
    this.sleep = sleep;
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
   * Opens Amazon's purchase screen for `sku`. When Amazon says it went through
   * (or the account already owns it), that is bought: remembered for 3 days in
   * case Amazon's receipts lag, then checked again so the state is saved
   * unlocked. Any other answer may still hide a completed order, so the
   * receipts are looked for over about 14 seconds before giving up. Amazon
   * reports a purchase the viewer backs out of as FAILED, with no receipt, so
   * FAILED with nothing found counts as cancelled; a bad SKU, no purchasing on
   * this device, or an error is a failure.
   */
  async buy(sku: string): Promise<'bought' | 'cancelled' | 'failed'> {
    let res;
    try {
      res = await this.iap.purchase({sku});
    } catch {
      return 'failed';
    }
    const code = res?.responseCode;
    const receipt = res?.receipt ?? null;
    const fromReceipt = receipt ? stateFromReceipts([receipt], this.now()) : LOCKED;
    if (
      code === PurchaseResponseCode.SUCCESSFUL ||
      code === PurchaseResponseCode.ALREADY_PURCHASED ||
      fromReceipt.unlocked
    ) {
      const kind = fromReceipt.kind ?? (sku === SKUS.lifetime ? 'lifetime' : 'subscription');
      await this.save(BOUGHT_KEY, {kind, at: this.now()} satisfies Bought);
      // Count the new receipt even if Amazon's history doesn't list it yet.
      await this.checkWith(receipt ? [receipt] : []);
      return 'bought';
    }
    // Amazon may still have taken the order: look for its receipt for a while.
    for (const wait of CONFIRM_WAITS_MS) {
      if (wait) {
        await this.sleep(wait);
      }
      const found = await this.receipts();
      if (found !== null && stateFromReceipts(found, this.now()).unlocked) {
        await this.checkWith(found);
        return 'bought';
      }
    }
    return code === PurchaseResponseCode.FAILED ? 'cancelled' : 'failed';
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
      const bought = await this.withRecentPurchase(stateFromReceipts(extra, this.now()));
      if (!bought.unlocked || cached.kind === 'lifetime') {
        return cached;
      }
      await this.fulfil(extra);
      await this.save(STATE_KEY, bought);
      return bought;
    }
    const known = new Set(fromAmazon.map((r) => r.receiptId));
    const receipts = [...fromAmazon, ...extra.filter((r) => !known.has(r.receiptId))];
    const state = await this.withRecentPurchase(stateFromReceipts(receipts, this.now()));
    await this.fulfil(receipts);
    await this.save(STATE_KEY, state);
    return state;
  }

  /**
   * `state`, raised to what Amazon said was bought in the last 3 days (or
   * since a clock that now reads earlier), so a purchase whose receipt Amazon
   * hasn't listed yet isn't taken away. Lifetime is never lowered.
   */
  private async withRecentPurchase(state: UnlockState): Promise<UnlockState> {
    if (state.kind === 'lifetime') {
      return state;
    }
    const bought = (await this.load(BOUGHT_KEY)) as Partial<Bought> | null;
    const ok =
      bought !== null &&
      typeof bought === 'object' &&
      (bought.kind === 'lifetime' || bought.kind === 'subscription') &&
      typeof bought.at === 'number';
    if (!ok || this.now() - (bought.at as number) >= BOUGHT_GRACE_MS) {
      return state;
    }
    if (bought.kind === 'lifetime' || !state.unlocked) {
      return {unlocked: true, kind: bought.kind as Bought['kind'], checkedAt: this.now()};
    }
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
