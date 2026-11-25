// CastAir casting page: wires the page to CastAirSender.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {CastAirSender, captureConstraints, isTerminalShareState, qualityName} from './sender.js';
import {formatConnection} from './connection.js';

const DISCOVER_EVERY_MS = 15000;
const CONNECTION_EVERY_MS = 2000;
const $ = (id) => document.getElementById(id);

const MESSAGES = {
  offering: 'Connecting to the TV…',
  connecting: 'Connecting to the TV…',
  streaming: 'Sharing to the TV',
  reconnecting: 'The connection dropped. Reconnecting to the TV…',
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

// Quality: remembered between visits, and changeable while sharing.
function storedQuality() {
  try {
    return qualityName(localStorage.getItem('castair.quality'));
  } catch {
    return qualityName();
  }
}
const qualityInputs = [...document.querySelectorAll('input[name="quality"]')];
const quality = () => qualityName(qualityInputs.find((input) => input.checked)?.value);
for (const input of qualityInputs) {
  input.checked = input.value === storedQuality();
  input.addEventListener('change', () => {
    try {
      localStorage.setItem('castair.quality', quality());
    } catch {
      // Private browsing: the choice just isn't remembered.
    }
    sender.setQuality(quality());
    render();
  });
}

// Keeps the computer's screen (and so the computer) awake while sharing.
// The browser drops the lock whenever the page is hidden, so it's asked for
// again each time the page comes back. Not every browser has it; that's fine.
let wakeLock = null;
let wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  if (!on) {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if (wakeLock || document.visibilityState !== 'visible') {
    return;
  }
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (!lock) {
      return;
    }
    if (!wantAwake) {
      lock.release().catch(() => {});
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) {
        wakeLock = null;
      }
    });
  } catch {
    // Refused (battery saver, say): sharing carries on without it.
  }
}
document.addEventListener('visibilitychange', () => {
  if (wantAwake) {
    keepAwake(true);
  }
});

// The "connection" line: what is actually being sent, while sharing.
let connectionTimer = null;
function showConnection(on) {
  clearInterval(connectionTimer);
  connectionTimer = null;
  $('connection').hidden = !on;
  $('connection').textContent = '';
  if (!on) {
    return;
  }
  const update = async () => {
    const text = formatConnection(await sender.describeConnection().catch(() => null));
    if (connectionTimer !== null) {
      $('connection').replaceChildren(
        ...text
          .split(' · ')
          .filter(Boolean)
          .map((figure) => {
            const span = document.createElement('span');
            span.textContent = figure;
            return span;
          }),
      );
    }
  };
  connectionTimer = setInterval(update, CONNECTION_EVERY_MS);
  update();
}

let chosen = null;
let tvs = [];
// Set once the server has answered with a list (even an empty one).
let discovered = false;
// The TV being shared to, by name, for the headline while sharing.
let sharingTo = null;
// The share's own status line, put back after a "Reconnecting to CastAir…" blip.
let shareStatus = null;
// A small padlock for TVs that need a code (drawn, so it matches the page).
const LOCK_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="2" fill="currentColor"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
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

function setStatus(text, isError = false, live = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
  $('status').classList.toggle('live', live);
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
        lock.innerHTML = LOCK_ICON;
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
  const awaiting = sender.isAwaitingCode;
  // While a share is running the page shows only what can still be used: the
  // TV list, code, sound and name are settled, so they step aside.
  const busy = sender.isSharing;
  document.querySelector('.panel').dataset.state = awaiting ? 'awaiting' : busy ? 'sharing' : 'idle';
  // The pill at the top of the card, like the TV's "CastAir is ready".
  const found = $('found');
  if (found) {
    $('find-row').hidden = busy;
    found.textContent = tvs.length
      ? `${tvs.length} TV${tvs.length === 1 ? '' : 's'} on your Wi-Fi`
      : discovered
        ? 'No TVs found yet'
        : 'Looking for TVs';
    found.classList.toggle('quiet', tvs.length === 0);
  }
  if ($('options-now')) {
    $('options-now').textContent = `${quality() === 'video' ? 'Smooth video' : 'Sharp text'}${
      $('audio').checked ? ', sound on' : ''
    }`;
  }
  list.hidden = busy;
  $('no-tvs').hidden = tvs.length > 0 || busy;
  $('no-tvs').textContent = discovered
    ? 'No CastAir TVs found. Check the TV is on, showing CastAir, and on the same Wi-Fi as you.'
    : 'Looking for CastAir TVs on your Wi-Fi…';
  $('code-box').hidden = awaiting ? false : busy || !needsCode();
  $('sound-box').hidden = busy;
  $('name-box').hidden = busy;
  $('stop-hint').hidden = !busy || awaiting;
  // "Carry on sharing" is the main button while a new code is needed.
  $('stop').className = awaiting ? 'secondary' : 'primary';
  $('share').textContent = awaiting ? 'Carry on sharing' : 'Share screen';
  $('share').disabled = awaiting
    ? !/^\d{4}$/.test($('code').value)
    : !chosen || sender.isSharing || (needsCode() && !/^\d{4}$/.test($('code').value));
}

const sender = new CastAirSender({
  signalingEndpoint: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`,
  clientId,
  name: $('name').value,
  onReceivers: (list) => {
    const before = tvs.find((tv) => tv.sessionId === chosen);
    tvs = list;
    discovered = true;
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
      if (sender.isSharing && shareStatus) {
        setStatus(...shareStatus);
      }
    } else {
      setStatus('Reconnecting to CastAir…');
    }
  },
  onStateChange: (state, detail) => {
    const terminal = isTerminalShareState(state) || state === 'error';
    if (state === 'code-required') {
      codeDemanded = true;
    }
    const awaiting = state === 'reconnect-code';
    if (awaiting || state === 'stopped' || state === 'receiver-left') {
      // The TV changes its code when a share ends, so the one typed is out of date now.
      $('code').value = '';
    }
    const live = state === 'streaming';
    const message = live && sharingTo ? `Sharing to ${sharingTo}` : (detail ?? MESSAGES[state] ?? state);
    shareStatus = [message, (terminal && state !== 'stopped') || awaiting, live];
    setStatus(...shareStatus);
    $('stop').hidden = terminal;
    $('share').hidden = !terminal && state !== 'error' && !awaiting;
    keepAwake(sender.isSharing);
    showConnection(state === 'streaming');
    render();
    if (awaiting) {
      $('code').focus();
    }
  },
});

$('audio').addEventListener('change', () => render());
$('code').addEventListener('input', () => {
  $('code').value = $('code').value.replace(/\D/g, '');
  render();
});

$('share').addEventListener('click', async () => {
  if (sender.isAwaitingCode) {
    try {
      await sender.resume($('code').value);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: captureConstraints(quality()),
      audio: $('audio').checked,
      systemAudio: 'include',
    });
  } catch {
    setStatus('Sharing was cancelled.');
    return;
  }
  sharingTo = tvs.find((tv) => tv.sessionId === chosen)?.name ?? null;
  try {
    await sender.share(stream, chosen, needsCode() ? $('code').value : undefined, quality());
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    setStatus(error.message, true);
  }
});
$('stop').addEventListener('click', () => sender.stopSharing('stopped'));

if (!navigator.mediaDevices?.getDisplayMedia) {
  $('unsupported').hidden = false;
  // Nothing else on the card can be used here, so the card shows only the notice.
  document.querySelector('.panel').classList.add('unsupported');
}
sender.connect().catch(() => setStatus("Can't reach CastAir. Check your internet connection and try again.", true));
setInterval(() => {
  if (document.visibilityState === 'visible') {
    sender.discover();
  }
}, DISCOVER_EVERY_MS);
