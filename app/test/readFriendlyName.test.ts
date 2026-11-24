/*
 * Asking for the device-name privilege: once, but only once answered.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {AsyncStorage} from '../src/storage';
import {SecurityManager} from '@amazon-devices/security-manager-lib';
import {KeplerIdentifiers} from '@amazon-devices/kepler-identifiers';
import {readFriendlyName} from '../src/DeviceName';

const log = jest.fn();
const setItem = AsyncStorage.setItem as jest.Mock;
const request = SecurityManager.requestPrivilege as jest.Mock;

beforeEach(() => {
  setItem.mockClear();
  (AsyncStorage.getItem as jest.Mock).mockReset().mockResolvedValue(null);
  request.mockReset().mockResolvedValue('DENY');
  (KeplerIdentifiers.getFriendlyDeviceName as jest.Mock).mockReset().mockResolvedValue('Fire TV Stick 4K Select');
});

it('remembers a real "no" so it does not ask again', async () => {
  request.mockResolvedValueOnce('DENY');
  expect(await readFriendlyName(log)).toBeNull();
  expect(setItem).toHaveBeenCalledWith('deviceNamePrivilegeAsked', require('../src/buildInfo').BUILD.release);
});

it('asks again next time if the dialog failed without an answer', async () => {
  request.mockRejectedValueOnce(new Error('dialog dismissed'));
  // undefined: couldn't read the name (the caller keeps its name and retries)
  expect(await readFriendlyName(log)).toBeUndefined();
  expect(setItem).not.toHaveBeenCalledWith('deviceNamePrivilegeAsked', expect.anything());
});

it('asks again when forced, even after an earlier "no"', async () => {
  request.mockResolvedValueOnce('ALLOW');
  (KeplerIdentifiers.getFriendlyDeviceName as jest.Mock).mockResolvedValueOnce('Living Room');
  expect(await readFriendlyName(log, {force: true})).toBe('Living Room');
  expect(request).toHaveBeenCalledTimes(1);
});

it('asks again once after an update, which resets the permission', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('castair@0+older-build');
  request.mockResolvedValueOnce('ALLOW');
  (KeplerIdentifiers.getFriendlyDeviceName as jest.Mock).mockResolvedValueOnce('Living Room');
  expect(await readFriendlyName(log)).toBe('Living Room');
  expect(request).toHaveBeenCalledTimes(1);
});

it('does not ask twice in the same version after a "no"', async () => {
  const {BUILD} = require('../src/buildInfo');
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(BUILD.release);
  expect(await readFriendlyName(log)).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("says it couldn't read the name (rather than 'no name') when the lookup fails", async () => {
  const {loadReceiverName} = require('../src/DeviceName');
  (SecurityManager.getPrivilegeState as jest.Mock).mockRejectedValueOnce(new Error('timed out'));
  expect(await loadReceiverName(log)).toBeNull();
});
