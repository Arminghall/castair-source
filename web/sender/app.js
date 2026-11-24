// CastAir sharing page: wires the page to CastAirSender.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {CastAirSender, isTerminalShareState} from './sender.js';

const DISCOVER_EVERY_MS = 15000;
const $ = (id) => document.getElementById(id);

const MESSAGES = {
  offering: 'Connecting to the TV…',
  connecting: 'Connecting to the TV…',
  streaming: 'Sharing. Use “Stop sharing” here or in the browser bar to end it.',
  stopped: 'Stopped sharing.',
  declined: "The TV didn't accept the share.",
  failed: "The share didn't connect. Check you're on the same Wi-Fi as the TV and try again.",
  'no-receiver': "That TV isn't available any more. Pick it again from the list.",
  'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
  'code-required': 'Enter the code shown on the TV.',
  'receiver-left': 'The TV ended the share.',
  error: 'Something went wrong.',
};

function stored(key, make) {
  try {
    const value = localStorage.getItem(key) || make();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return make();
  }
}

const clientId = stored('castair.clientId', () => `web-${crypto.randomUUID()}`);
const defaultName = /Windows/.test(navigator.userAgent) ? 'Windows laptop' : 'A laptop';
$('name').value = stored('castair.name', () => defaultName);
$('name').addEventListener('change', () => {
  try {
    localStorage.setItem('castair.name', $('name').value.trim() || defaultName);
  } catch {
    // Private browsing: the name just isn't remembered.
  }
});

let chosen = null;
let tvs = [];
// Set when the server says the chosen TV wants a code the list didn't flag.
let codeDemanded = false;

// Forgets the code typed so far and any code the server asked for.
function forgetCode() {
  codeDemanded = false;
  $('code').value = '';
}

// Picks a TV (or none). Another TV than before starts with no code.
function choose(sessionId) {
  if (sessionId !== chosen) {
    forgetCode();
  }
  chosen = sessionId;
}

function needsCode() {
  const tv = tvs.find((t) => t.sessionId === chosen);
  return Boolean(tv && (tv.codeRequired || codeDemanded));
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function render() {
  const list = $('tvs');
  list.replaceChildren(
    ...tvs.map((tv) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = tv.name;
      if (tv.codeRequired) {
        const lock = document.createElement('span');
        lock.textContent = '🔒';
        lock.setAttribute('role', 'img');
        lock.setAttribute('aria-label', 'needs a code');
        lock.className = 'lock';
        button.append(' ', lock);
      }
      button.setAttribute('aria-pressed', String(tv.sessionId === chosen));
      button.addEventListener('click', () => {
        choose(tv.sessionId);
        render();
        if (needsCode()) {
          $('code').focus();
        }
      });
      li.append(button);
      return li;
    }),
  );
  $('no-tvs').hidden = tvs.length > 0;
  $('no-tvs').textContent = 'No CastAir TVs found. Check the TV is on, showing CastAir, and on the same Wi-Fi as you.';
  $('code-box').hidden = !needsCode();
  $('share').disabled = !chosen || sender.isSharing || (needsCode() && !/^\d{4}$/.test($('code').value));
}

const sender = new CastAirSender({
  signalingEndpoint: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`,
  clientId,
  name: $('name').value,
  onReceivers: (list) => {
    const before = tvs.find((tv) => tv.sessionId === chosen);
    tvs = list;
    const now = tvs.find((tv) => tv.sessionId === chosen);
    if (!now) {
      choose(tvs.length === 1 ? tvs[0].sessionId : null);
    } else if (before?.codeRequired && !now.codeRequired) {
      // The TV turned its code off.
      forgetCode();
    }
    render();
  },
  onSignalingChange: (up) => {
    if (up) {
      sender.discover();
    } else {
      setStatus('Reconnecting to CastAir…');
    }
  },
  onStateChange: (state, detail) => {
    const terminal = isTerminalShareState(state) || state === 'error';
    if (state === 'code-required') {
      codeDemanded = true;
    }
    setStatus(detail ?? MESSAGES[state] ?? state, terminal && state !== 'stopped');
    $('stop').hidden = terminal;
    $('share').hidden = !terminal && state !== 'error';
    render();
  },
});

$('code').addEventListener('input', () => {
  $('code').value = $('code').value.replace(/\D/g, '');
  render();
});

$('share').addEventListener('click', async () => {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: {frameRate: {ideal: 30}},
      audio: $('audio').checked,
      systemAudio: 'include',
    });
  } catch {
    setStatus('Sharing was cancelled.');
    return;
  }
  try {
    await sender.share(stream, chosen, needsCode() ? $('code').value : undefined);
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    setStatus(error.message, true);
  }
});
$('stop').addEventListener('click', () => sender.stopSharing('stopped'));

if (!navigator.mediaDevices?.getDisplayMedia) {
  $('unsupported').hidden = false;
}
sender.connect().catch(() => setStatus("Can't reach CastAir. Check your internet connection and try again.", true));
setInterval(() => {
  if (document.visibilityState === 'visible') {
    sender.discover();
  }
}, DISCOVER_EVERY_MS);
