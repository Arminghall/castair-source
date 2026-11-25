/*
 * DeviceName: each TV advertises a name from the Fire TV's own device name
 * (Settings → My Fire TV → About), so several TVs can be told apart:
 * "Lounge" becomes "CastAir-Lounge". Reading the custom name needs the
 * device-friendly-name privilege, which the TV asks the viewer for once.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {AsyncStorage} from './storage';
import {KeplerIdentifiers} from '@amazon-devices/kepler-identifiers';
import {PrivilegeState, SecurityManager} from '@amazon-devices/security-manager-lib';
import {getModel} from '@amazon-devices/react-native-device-info';
import {BUILD} from './buildInfo';
import {RECEIVER_NAME} from './config';

export const NAME_PRIVILEGE = 'com.amazon.devconf.privilege.identifiers.device-friendly-name';
// The build that last showed the consent dialog: a "no" isn't asked again in
// that build, but installing a new build resets the permission, so it asks
// once more.
const ASKED_KEY = 'deviceNamePrivilegeAsked';
// The last name advertised, so the next launch can advertise at once.
const LAST_NAME_KEY = 'lastReceiverName';
// An mDNS label holds 63 bytes, and the RAOP record is "<12 hex>@<name>".
const MAX_BYTES = 50;

// A platform call that hasn't answered in this long is treated as failed.
const CALL_TIMEOUT_MS = 10000;
// The consent dialog waits for a person, so it gets longer.
const DIALOG_TIMEOUT_MS = 120000;

/** `promise`, or a rejection naming `what` after `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** An error's message, or the thrown value as JSON (platform errors are often plain objects). */
function describe(e: unknown): string {
  if (e instanceof Error) {
    return e.message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Cuts a string to at most `max` UTF-8 bytes without splitting a character. */
function clip(s: string, max: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > max) {
      break;
    }
    out += ch;
    bytes += n;
  }
  return out;
}

/**
 * The receiver name for a Fire TV device name: "CastAir-<name>", the name
 * itself if it already starts with CastAir, or plain "CastAir" when there's
 * no custom name (none, blank, or still the model name).
 */
export function receiverNameFor(friendly: string | null, model: string | null): string {
  // The mDNS responder splits names on dots, so they become spaces.
  const name = (friendly ?? '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || (model && name.toLowerCase() === model.trim().toLowerCase())) {
    return RECEIVER_NAME;
  }
  const full = name.toLowerCase().startsWith(RECEIVER_NAME.toLowerCase()) ? name : `${RECEIVER_NAME}-${name}`;
  return clip(full, MAX_BYTES).trim();
}

/**
 * The Fire TV's custom name, asking for the privilege the first time (or
 * whenever `force` is set: About's "Use the Fire TV's name"); null if unavailable.
 */
export async function readFriendlyName(
  log: (msg: string) => void,
  {force = false}: {force?: boolean} = {},
): Promise<string | null | undefined> {
  try {
    let state = await withTimeout(
      SecurityManager.getPrivilegeState(NAME_PRIVILEGE),
      CALL_TIMEOUT_MS,
      'getPrivilegeState',
    );
    log(`device name privilege was: ${state}`);
    if (state !== PrivilegeState.ALLOW && (force || (await AsyncStorage.getItem(ASKED_KEY)) !== BUILD.release)) {
      state = await withTimeout(
        SecurityManager.requestPrivilege(NAME_PRIVILEGE),
        DIALOG_TIMEOUT_MS,
        'requestPrivilege',
      );
      // Only a real answer counts as asked: a dialog that failed asks again.
      await AsyncStorage.setItem(ASKED_KEY, BUILD.release);
    }
    log(`device name privilege: ${state}`);
    if (state !== PrivilegeState.ALLOW) {
      log('device name privilege not granted: using the default name');
      return null;
    }
    return await withTimeout(KeplerIdentifiers.getFriendlyDeviceName(), CALL_TIMEOUT_MS, 'getFriendlyDeviceName');
  } catch (e) {
    log(`device name unavailable: ${describe(e)}`);
    return undefined; // couldn't read it, as opposed to "no custom name"
  }
}

/** The Fire TV's own name as people see it (Win+K lists it), or null when there's none to show. */
export function fireTvNameFor(friendly: string | null): string | null {
  const name = (friendly ?? '').trim();
  return name || null;
}

/**
 * The name this TV should advertise now, or null when the Fire TV's name
 * couldn't be read (a slow or failed lookup): the caller keeps its current
 * name and tries again, rather than falling back to plain CastAir.
 * `onFireTvName` gets the Fire TV's own name (fireTvNameFor) whenever it was read.
 */
export async function loadReceiverName(
  log: (msg: string) => void,
  {onFireTvName, ...opts}: {force?: boolean; onFireTvName?: (name: string | null) => void} = {},
): Promise<string | null> {
  let model: string | null = null;
  try {
    model = String(getModel());
  } catch {
    model = null;
  }
  const friendly = await readFriendlyName(log, opts);
  if (friendly === undefined) {
    return null;
  }
  log(`fire tv name ${JSON.stringify(friendly)}, model ${JSON.stringify(model)}`);
  onFireTvName?.(fireTvNameFor(friendly));
  return receiverNameFor(friendly, model);
}

/**
 * Calls `onChange` with the new receiver name, and the Fire TV's own name
 * (fireTvNameFor), when the Fire TV is renamed. Returns an unsubscribe.
 */
export async function watchReceiverName(
  onChange: (name: string, fireTvName: string | null) => void,
  log: (msg: string) => void,
): Promise<() => void> {
  try {
    const sub = await KeplerIdentifiers.addFriendlyDeviceNameListener({
      onFriendlyDeviceNameChanged: (n: string) => {
        let model: string | null = null;
        try {
          model = String(getModel());
        } catch {
          model = null;
        }
        onChange(receiverNameFor(n, model), fireTvNameFor(n));
      },
    });
    return () => sub.unsubscribe();
  } catch (e) {
    log(`device name changes not available: ${describe(e)}`);
    return () => undefined;
  }
}

/** The name advertised last time, if any. */
export async function cachedReceiverName(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_NAME_KEY);
  } catch {
    return null;
  }
}

/** Remembers the advertised name for the next launch. */
export function saveReceiverName(name: string): void {
  AsyncStorage.setItem(LAST_NAME_KEY, name).catch(() => undefined);
}
