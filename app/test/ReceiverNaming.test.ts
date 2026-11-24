/*
 * Starting and renaming the receiver as the Fire TV's name changes.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import {ReceiverNaming} from '../src/ReceiverNaming';

function setup(startResult = true) {
  const receiver = {start: jest.fn(() => startResult), stop: jest.fn()};
  const naming = new ReceiverNaming(receiver, jest.fn());
  return {receiver, naming};
}

it('starts under the first name', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir');
  expect(receiver.start).toHaveBeenCalledWith('CastAir');
  expect(receiver.stop).not.toHaveBeenCalled();
});

it('restarts under a new name straight away when nobody is connected', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir');
  naming.rename('CastAir-Living Room');
  expect(receiver.stop).toHaveBeenCalledTimes(1);
  expect(receiver.start).toHaveBeenLastCalledWith('CastAir-Living Room');
});

it('waits for the session to end before renaming', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir');
  naming.setConnections(1);
  naming.rename('CastAir-Living Room');
  expect(receiver.stop).not.toHaveBeenCalled();
  naming.setConnections(0);
  expect(receiver.stop).toHaveBeenCalledTimes(1);
  expect(receiver.start).toHaveBeenLastCalledWith('CastAir-Living Room');
});

it('ignores a rename to the name already advertised', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir-Living Room');
  naming.rename('CastAir-Living Room');
  expect(receiver.stop).not.toHaveBeenCalled();
  expect(receiver.start).toHaveBeenCalledTimes(1);
});

it('retries the same name after a failed start', () => {
  const {receiver, naming} = setup(false);
  naming.start('CastAir');
  naming.rename('CastAir');
  expect(receiver.start).toHaveBeenCalledTimes(2);
});

it('does nothing once closed', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir');
  naming.close();
  naming.rename('CastAir-Living Room');
  expect(receiver.start).toHaveBeenCalledTimes(1);
});

it('restart drops sessions by restarting under the same name', () => {
  const {receiver, naming} = setup();
  naming.start('CastAir-Living Room');
  naming.setConnections(1);
  naming.restart();
  expect(receiver.stop).toHaveBeenCalledTimes(1);
  expect(receiver.start).toHaveBeenLastCalledWith('CastAir-Living Room');
});
