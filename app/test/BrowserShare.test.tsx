/*
 * Tests for BrowserShare's bridge to the receiver page: the code switch and
 * the code coming back.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React from 'react';
import {act, render} from '@testing-library/react-native';
import {BrowserShare} from '../src/BrowserShare';

type Page = {onMessage: (event: {nativeEvent: {data: string}}) => void};
const page = () => (globalThis as unknown as {__webView: Page}).__webView;
const injected = () => (globalThis as unknown as {__injected?: string[]}).__injected ?? [];
const setCalls = () => injected().filter((js) => js.includes('setCodeRequired'));

const props = {
  visible: false,
  name: 'CastAir',
  onShareStarted: jest.fn(),
  onShareEnded: jest.fn(),
  log: jest.fn(),
};

beforeEach(() => {
  (globalThis as unknown as {__injected?: string[]}).__injected = [];
});

it('injects setCodeRequired on every change, Off and back On included, not on mount', () => {
  const {rerender} = render(<BrowserShare {...props} codeRequired onCode={jest.fn()} />);
  expect(setCalls()).toHaveLength(0);
  rerender(<BrowserShare {...props} codeRequired={false} onCode={jest.fn()} />);
  rerender(<BrowserShare {...props} codeRequired onCode={jest.fn()} />);
  expect(setCalls()).toEqual([
    'window.castairHost && window.castairHost.setCodeRequired(false); true;',
    'window.castairHost && window.castairHost.setCodeRequired(true); true;',
  ]);
});

it('re-sends the switch when the page reports waiting', () => {
  render(<BrowserShare {...props} codeRequired={false} onCode={jest.fn()} />);
  act(() => page().onMessage({nativeEvent: {data: JSON.stringify({type: 'state', state: 'waiting'})}}));
  expect(setCalls()).toEqual(['window.castairHost && window.castairHost.setCodeRequired(false); true;']);
});

it('passes the code, and null, on to the app', () => {
  const onCode = jest.fn();
  render(<BrowserShare {...props} codeRequired onCode={onCode} />);
  act(() => page().onMessage({nativeEvent: {data: JSON.stringify({type: 'code', code: '4821'})}}));
  act(() => page().onMessage({nativeEvent: {data: JSON.stringify({type: 'code', code: null})}}));
  expect(onCode.mock.calls).toEqual([['4821'], [null]]);
});
