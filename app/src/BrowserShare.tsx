/*
 * BrowserShare: hosts the receiver page (web/receiver, bundled into
 * assets/raw/receiver.html) in a WebView that stays mounted all the time
 * (DECISIONS B6). Hidden as a 2x2 px speck until a laptop shares, then full
 * screen. The Vega WebView ignores absolute positioning on itself, so the
 * wrapper View does the positioning.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {AppState, BackHandler, Dimensions, StyleSheet, View} from 'react-native';
import {WebView} from '@amazon-devices/webview';
import type {WebViewMethods} from '@amazon-devices/webview/dist/types/WebViewTypes';

const SCREEN = Dimensions.get('window');
const PAGE = 'file:///pkg/assets/raw/receiver.html';

// Page states that tell whether the server link is up; the others change nothing.
const SERVER_CONNECTED: Record<string, boolean> = {
  waiting: true,
  connecting: true,
  streaming: true,
  'signaling-closed': false,
  'signaling-connecting': false,
  paused: false,
};

export type BrowserShareHandle = {endShare(): void};

type Props = {
  visible: boolean;
  name: string;
  /** Whether laptops must type the code shown on the TV. */
  codeRequired: boolean;
  /** The code the server last sent, or null when none is needed. */
  onCode: (code: string | null) => void;
  onShareStarted: (senderName: string) => void;
  onShareEnded: () => void;
  /** Whether the receiver page is connected to the CastAir server. */
  onServerConnection?: (connected: boolean) => void;
  log: (msg: string) => void;
};

/** A JS call into the page's bridge, as a string for injectJavaScript. */
const call = (fn: string, arg?: string | boolean) =>
  `window.castairHost && window.castairHost.${fn}(${arg === undefined ? '' : JSON.stringify(arg)}); true;`;

export const BrowserShare = forwardRef<BrowserShareHandle, Props>(
  ({visible, name, codeRequired, onCode, onShareStarted, onShareEnded, onServerConnection, log}, ref) => {
    const web = useRef<WebViewMethods | null>(null);
    // The page is loaded once with the first name; renames go through setName.
    const initialName = useRef(name);
    // The latest name, re-sent whenever the page (re)connects: a rename sent
    // before the page has loaded or connected would otherwise be lost.
    const nameRef = useRef(name);
    nameRef.current = name;
    // Likewise the code switch, re-sent when the page reports 'waiting'.
    const codeRequiredRef = useRef(codeRequired);
    codeRequiredRef.current = codeRequired;
    const codeRequiredSeen = useRef(false);
    const inject = (js: string) => web.current?.injectJavaScript(js);

    useImperativeHandle(ref, () => ({endShare: () => inject(call('endShare'))}));

    useEffect(() => {
      if (name !== initialName.current) {
        inject(call('setName', name));
      }
    }, [name]);

    useEffect(() => {
      // Not on mount (the page starts from its stored value and is told again
      // on 'waiting'), but on every later change, Off and back On included.
      if (codeRequiredSeen.current) {
        inject(call('setCodeRequired', codeRequired));
      }
      codeRequiredSeen.current = true;
    }, [codeRequired]);

    // Back ends a share in progress.
    useEffect(() => {
      if (!visible) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        inject(call('endShare'));
        return true;
      });
      return () => sub.remove();
    }, [visible]);

    // Leaving the screen ends the share and disconnects; coming back reconnects.
    useEffect(() => {
      const sub = AppState.addEventListener('change', (state) => {
        // Any state but background counts as back: Vega may not send
        // 'active', and onForeground does nothing if already connected.
        if (state === 'background') {
          inject(call('onBackground'));
        } else {
          inject(call('onForeground'));
        }
      });
      return () => sub.remove();
    }, []);

    const onMessage = (event: {nativeEvent: {data: string}}) => {
      let msg: {type?: string; senderName?: string; state?: string; msg?: string; code?: string | null};
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'state' && msg.state !== undefined && msg.state in SERVER_CONNECTED) {
        onServerConnection?.(SERVER_CONNECTED[msg.state]);
      }
      if (msg.type === 'code') {
        onCode(typeof msg.code === 'string' ? msg.code : null);
      } else if (msg.type === 'share-started') {
        log(`browser share from ${msg.senderName ?? 'a laptop'}`);
        onShareStarted(msg.senderName ?? 'A laptop');
      } else if (msg.type === 'share-ended') {
        log('browser share ended');
        onShareEnded();
      } else if (msg.type === 'state' && msg.state === 'paused' && AppState.currentState !== 'background') {
        // Paused while CastAir is on screen: the return to the foreground
        // was missed, so reconnect now.
        log('receiver page paused while in the foreground: reconnecting');
        inject(call('onForeground'));
      } else if (msg.type === 'state' && msg.state === 'waiting') {
        log('receiver page: waiting');
        inject(call('setName', nameRef.current));
        inject(call('setCodeRequired', codeRequiredRef.current));
      } else if (msg.type === 'state' || msg.type === 'log') {
        log(`receiver page: ${msg.state ?? msg.msg ?? ''}`);
      }
    };

    return (
      <View
        testID="browser-share"
        pointerEvents={visible ? 'auto' : 'none'}
        style={visible ? styles.full : styles.hidden}>
        <WebView
          ref={web}
          style={visible ? styles.fullInner : styles.hiddenInner}
          source={{uri: `${PAGE}?name=${encodeURIComponent(initialName.current)}`}}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsDefaultMediaControl
          onMessage={onMessage}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  full: {position: 'absolute', left: 0, top: 0, width: SCREEN.width, height: SCREEN.height, backgroundColor: '#000'},
  fullInner: {width: SCREEN.width, height: SCREEN.height},
  hidden: {position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.01},
  hiddenInner: {width: 2, height: 2},
});
