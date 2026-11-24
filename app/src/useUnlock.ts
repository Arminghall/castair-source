/*
 * useUnlock: CastAir's unlocked state for the UI (B18). Shows the cached
 * answer at once, then asks Amazon at mount, every 6 hours and after a
 * purchase. When Amazon doesn't answer (or has no products for the plans
 * screen yet), it tries again after 1, 5 and 15 minutes before going back to
 * every 6 hours. Mount it once (in App) and pass the result down, so there's
 * one set of checks.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {PurchasingService} from '@amazon-devices/keplerscript-appstore-iap-lib';
import type {Product} from '@amazon-devices/keplerscript-appstore-iap-lib';
import {AsyncStorage} from './storage';
import {Unlock} from './Unlock';
import type {UnlockState} from './Unlock';

/** How often a running TV asks Amazon again: 6 hours. */
export const RECHECK_MS = 21_600_000;
/** After a check Amazon didn't answer: retry after 1, 5, then 15 minutes, then every 6 hours. */
export const RETRY_MS = [60_000, 300_000, 900_000];

const LOCKED: UnlockState = {unlocked: false, kind: null, checkedAt: null};
const ignore = () => undefined;

export function useUnlock(): {
  state: UnlockState;
  /** False until the cached state has loaded at mount, whether or not Amazon answered. */
  ready: boolean;
  /** Asks Amazon now; resolves whether Amazon answered. */
  checkNow(): Promise<boolean>;
  buy(sku: string): Promise<'bought' | 'cancelled' | 'failed'>;
  products: Record<string, Product>;
  /** False until the first product load has finished, whether or not Amazon answered. */
  productsLoaded: boolean;
} {
  const [unlock] = useState(() => new Unlock({iap: PurchasingService, storage: AsyncStorage, now: Date.now}));
  const [state, setState] = useState<UnlockState>(LOCKED);
  const [ready, setReady] = useState(false);
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [productsLoaded, setProductsLoaded] = useState(false);
  const mounted = useRef(false);
  // Bumped when a purchase is saved: a check that started before then has an out-of-date answer.
  const generation = useRef(0);
  // Asks Amazon (and loads the products while there are none), then schedules the next try.
  const refresh = useRef<() => Promise<boolean>>(async () => false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let haveProducts = false;
    mounted.current = true;

    const loadProducts = async () => {
      const p = await unlock.products();
      if (!alive) {
        return;
      }
      setProductsLoaded(true);
      if (Object.keys(p).length > 0) {
        haveProducts = true;
        setProducts(p);
      }
    };

    refresh.current = async () => {
      const startedAt = generation.current;
      const checked = unlock.check().then((next) => ({next, answered: unlock.lastCheckAnswered}));
      const [{next, answered}] = await Promise.all([checked, haveProducts ? undefined : loadProducts()]);
      if (!alive) {
        return answered;
      }
      if (startedAt === generation.current) {
        setState(next);
      }
      let delay = RECHECK_MS;
      if (answered && haveProducts) {
        failures = 0;
      } else {
        delay = RETRY_MS[failures] ?? RECHECK_MS;
        failures += 1;
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => refresh.current().catch(ignore), delay);
      return answered;
    };

    const start = async () => {
      const saved = await unlock.cached();
      if (!alive) {
        return;
      }
      setState(saved);
      setReady(true);
      await refresh.current();
    };
    start().catch(ignore);

    return () => {
      alive = false;
      mounted.current = false;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      refresh.current = async () => false;
    };
  }, [unlock]);

  const checkNow = useCallback(() => refresh.current(), []);

  const buy = useCallback(
    async (sku: string) => {
      // A purchase checks again inside Unlock.buy; show what that check saved.
      const result = await unlock.buy(sku);
      if (result === 'bought') {
        generation.current += 1;
        const saved = await unlock.cached();
        if (mounted.current) {
          setState(saved);
        }
      }
      return result;
    },
    [unlock],
  );

  return {state, ready, checkNow, buy, products, productsLoaded};
}
