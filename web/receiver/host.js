// CastAir TV receiver page: the bridge between the page and the CastAir app
// (React Native, in a Vega WebView). The app talks to it through
// window.castairHost; the page answers with window.ReactNativeWebView
// messages: {type: 'state'|'share-started'|'share-ended'|'code'|'exit-app'|'log'}.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {generateSessionCode} from '../shared/config.js';
import {CastAirReceiver} from './receiver.js';

// Replaced by scripts/build-tv-assets.mjs.
const SIGNALING_URL = '__CASTAIR_SIGNALING_URL__';

function post(message) {
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  } catch {
    // Not inside the app (opened in a desktop browser for testing).
  }
}

function stored(key, make) {
  try {
    const value = localStorage.getItem(key) || make();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return make();
  }
}

// The last value the app gave setCodeRequired, kept so the first message on
// every connection (even before the app has spoken) is the TV's own choice.
// Nothing stored means On, the app's default.
function loadCodeRequired() {
  try {
    return localStorage.getItem('castair.codeRequired') !== '0';
  } catch {
    return true;
  }
}

function saveCodeRequired(on) {
  try {
    localStorage.setItem('castair.codeRequired', on ? '1' : '0');
  } catch {
    // Not persisted: the app sets it again on every 'waiting'.
  }
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const params = new URLSearchParams(location.search);
const receiver = new CastAirReceiver(document.getElementById('video'), {
  signalingEndpoint: SIGNALING_URL,
  sessionId: stored('castair.code', () => generateSessionCode()),
  receiverSecret: stored('castair.secret', randomSecret),
  receiverName: params.get('name') || 'CastAir',
  codeRequired: loadCodeRequired(),
  onCode: (code) => post({type: 'code', code}),
  onStateChange: (state, detail) => post({type: 'state', state, detail}),
  onShareChange: (active, senderName) => post(active ? {type: 'share-started', senderName} : {type: 'share-ended'}),
});

window.castairHost = {
  setName: (name) => receiver.setName(name),
  setCodeRequired: (on) => {
    saveCodeRequired(on);
    receiver.setCodeRequired(on);
  },
  setBusy: (on) => receiver.setBusy(on),
  endShare: () => receiver.endShare(),
  onBackground: () => {
    receiver.endShare();
    receiver.pauseSignaling();
  },
  onForeground: () => receiver.connectSignaling(),
  handleBack: () => {
    if (!receiver.endShare()) {
      post({type: 'exit-app'});
    }
  },
};

receiver.connectSignaling();
post({type: 'log', msg: 'receiver page loaded'});
