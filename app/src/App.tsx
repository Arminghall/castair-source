/*
 * CastAir: screen-mirroring receiver UI.
 *
 * Copyright (C) 2026 Parker Wahle
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AppState, Dimensions, Linking, StyleSheet, Text, View} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {Receiver, ReceiverEvent, SegmentKind} from 'castair-native';
import {CastAirSurface} from 'castair-surface';
import {AvDelayOverlay} from './AvDelayOverlay';
import {AvSync} from './AvSync';
import {COLORS, RECEIVER_NAME} from './config';
import {ConnectOverlay, MIRACAST_URI} from './ConnectOverlay';
import {cachedReceiverName, loadReceiverName, saveReceiverName, watchReceiverName} from './DeviceName';
import {ReceiverNaming} from './ReceiverNaming';
import {BrowserShare, BrowserShareHandle} from './BrowserShare';
import {FreeCastBanner, FreeCastEndScreen, useFreeCastSession} from './FreeCast';
import {DEFAULT_PREFS, loadPrefs, savePrefs} from './Prefs';
import type {Prefs} from './Prefs';
import {Settings} from './Settings';
import {useUnlock} from './useUnlock';
import {StandbyScreen} from './StandbyScreen';
import {deviceCountry, offsetAt} from './standby/clock';
import {useStandby} from './standby/useStandby';
import {useWallpaper} from './standby/useWallpaper';
import type {ConnectKind} from './standby/view';
import {Mode, ShareEvent, next as nextMode} from './ShareMode';
import {KeepAwake} from './KeepAwake';
import {MirrorPlayer} from './MirrorPlayer';
import {NativeVideo} from './NativeVideo';
import {log, receiverEvent, receiverStats, resetStats, streamEnd, warn} from './Telemetry';

// The receiver advertises the name DeviceName.ts picks, exactly (receiver.c).
// On a first launch (no name remembered), how long to wait for the Fire TV's
// name before advertising the default.
const FIRST_NAME_WAIT_MS = 5000;
// How often to try again when the Fire TV's name couldn't be read.
const NAME_RETRY_MS = 60000;
const FLAC_MIME = 'audio/mp4; codecs="flac"';
const AAC_LC_MIME = 'audio/mp4; codecs="mp4a.40.2"';

/** AirPlay volume (-30..0 dB, -144 = mute) → linear 0..1. */
function airplayVolume(db: number): number {
  if (db <= -30) {
    return 0;
  }
  return Math.pow(10, Math.min(0, db) / 20);
}
const SCREEN = Dimensions.get('window');
// Idle-screen sizes scale with the width the TV reports, which is smaller
// than 1920 on some sticks: at a fixed size the steps ran off the screen.
const U = SCREEN.width / 100;
// Stats run every 5 s; with MSE video, a keyframe is requested every other
// tick (10 s), inside MirrorPlayer's 10 s back buffer.
const KEYFRAME_EVERY_TICKS = 2;
// Compatibility Mode (Settings page): MSE video instead of the native pipeline.
// Bad LAN/Wi-Fi Mode (Settings page): native latency 700 ms instead of 150.

/** Largest box of the video's aspect ratio that fits the screen, centred. */
function fit(w: number, h: number) {
  if (!w || !h) {
    return {left: 0, top: 0, width: SCREEN.width, height: SCREEN.height};
  }
  const scale = Math.min(SCREEN.width / w, SCREEN.height / h);
  const width = Math.round(w * scale);
  const height = Math.round(h * scale);
  return {left: Math.round((SCREEN.width - width) / 2), top: Math.round((SCREEN.height - height) / 2), width, height};
}

export const App = () => {
  const [mirroring, setMirroring] = useState(false);
  const [sender, setSender] = useState<string | null>(null);
  const [receiverName, setReceiverName] = useState(RECEIVER_NAME);
  // The Fire TV's own name (Win+K lists it), once read; null until then or when the privilege was denied.
  const [fireTvName, setFireTvName] = useState<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const [videoSize, setVideoSize] = useState<[number, number]>([0, 0]);
  const player = useRef<MirrorPlayer | null>(null);
  // Video goes to the native pipeline (CastAirSurface) unless the viewer has
  // turned on Compatibility Mode (Settings page); then to MSE (MirrorPlayer).
  const [compatibility, setCompatibility] = useState(false);
  const useNative = useRef(true);
  useNative.current = !compatibility;
  const nativeVideo = useRef<NativeVideo | null>(null);
  const [badNetwork, setBadNetwork] = useState(false);
  const badNetworkRef = useRef(false);
  badNetworkRef.current = badNetwork;
  // CastAir Unlimited (B18): mounted once, here, and passed down.
  const unlock = useUnlock();
  const [showSettings, setShowSettings] = useState(false);
  // Settings opens on the plans when the standby screen's free-version hint is pressed.
  const [settingsTab, setSettingsTab] = useState<'settings' | 'plans'>('settings');
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  // Bumped when Settings closes, so the standby info refreshes at once.
  const [refreshKey, setRefreshKey] = useState(0);
  const [serverConnected, setServerConnected] = useState(false);
  const [shareCode, setShareCode] = useState<string | null>(null);
  // The "how to connect" overlay open over the standby screen, if any.
  const [connect, setConnect] = useState<ConnectKind | null>(null);
  // The button whose overlay just closed, until it has the focus back.
  const [focusConnect, setFocusConnect] = useState<ConnectKind | null>(null);
  const country = useMemo(() => deviceCountry(), []);
  const audio = useRef<MirrorPlayer | null>(null);
  const audioCt = useRef(0);
  const volume = useRef(1);
  const surface = useRef<string | null>(null);
  const keepAwake = useRef(new KeepAwake(log));
  // Settings' "Use the Fire TV's name": asks for the privilege again and renames.
  const useFireTvName = useRef<() => void>(() => undefined);
  // Which share is on screen (ShareMode.ts), and the handles it acts on.
  const [mode, setMode] = useState<Mode>('idle');
  const modeRef = useRef<Mode>('idle');
  const namingRef = useRef<ReceiverNaming | null>(null);
  const browser = useRef<BrowserShareHandle | null>(null);
  // The standby data and wallpaper only run while the standby screen can show.
  const standbyActive = mode === 'idle' && !mirroring && !audioOnly;
  const {info: standbyInfo, nowMs} = useStandby(prefs, refreshKey, standbyActive);
  const wallpaper = useWallpaper(prefs, standbyActive);
  // The weekly free allowance (FreeCast.tsx), reset on Monday at 05:00 by the
  // standby clock's time. At zero on the free version: stop the cast that ran
  // out the usual way, and show the end screen.
  const audioCast = audioOnly && sender !== null;
  const offsetMin = standbyInfo?.time ? offsetAt(nowMs, standbyInfo.time) : -new Date().getTimezoneOffset();
  const freeCast = useFreeCastSession({
    mode,
    audio: audioCast,
    unlocked: unlock.state.unlocked,
    ready: unlock.ready,
    offsetMin,
    onWarn: (leftMs) => {
      const minutes = leftMs / 60_000;
      log(`free cast: ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`);
    },
    onStop: (kind) => {
      log(`free cast: allowance used up, stopping the ${kind} cast`);
      if (kind === 'browser') {
        browser.current?.endShare();
      } else {
        namingRef.current?.restart();
      }
      setShowSettings(false);
    },
  });
  const shareEvent = useRef<(event: ShareEvent) => void>(() => undefined);
  shareEvent.current = (event: ShareEvent) => {
    const {mode: m, actions} = nextMode(modeRef.current, event);
    modeRef.current = m;
    setMode(m);
    if (event === 'airplayStarted' || event === 'browserStarted') {
      // A cast starting ends any "how to connect" overlay; standby starts on Settings afterwards.
      setConnect(null);
      setFocusConnect(null);
    }
    if (event === 'airplayStarted') {
      freeCast.startCast('airplay');
    } else if (event === 'browserStarted') {
      freeCast.startCast('browser');
      // A share with sound takes audio focus from the keep-awake loop (KeepAwake.ts).
      keepAwake.current.yieldToShare(true);
    } else if (event === 'browserEnded') {
      keepAwake.current.yieldToShare(false);
    }
    for (const action of actions) {
      log(`${event}: ${action}`);
      if (action === 'stopAirplay') {
        namingRef.current?.restart();
      } else {
        browser.current?.endShare();
      }
    }
  };
  const avSync = useRef(new AvSync()).current;
  const [avDelay, setAvDelay] = useState(0);
  useEffect(() => {
    const naming = new ReceiverNaming(Receiver, log);
    namingRef.current = naming;
    const closePlayer = () => {
      player.current?.close();
      player.current = null;
    };
    const closeAudio = () => {
      audio.current?.close();
      audio.current = null;
    };

    Receiver.onAudio((kind, segment, senderMs) => {
      // Native playback takes mirrored audio itself (as PCM): no MSE player,
      // which would only compete for audio focus.
      if (nativeVideo.current) {
        closeAudio();
        return;
      }
      if (kind === SegmentKind.Init) {
        // Each audio stream (mirroring, or music) starts with a new init segment.
        closeAudio();
        const a = new MirrorPlayer(log, {kind: 'audio', mime: audioCt.current === 4 ? AAC_LC_MIME : FLAC_MIME});
        audio.current = a;
        a.open()
          .then(() => a.setVolume(volume.current))
          .catch((e) => log(`audio open failed: ${String(e)}`));
      }
      audio.current?.push(segment, kind === SegmentKind.Media, senderMs);
    });

    // A stalled video player is replaced: the sender is asked for a keyframe,
    // which starts a new player (see onVideo below). At most every 10 s.
    let lastRecovery = 0;
    const recoverVideo = (p: MirrorPlayer) => {
      const now = Date.now();
      warn('video player stalled', {player: p.stats(), receiver: Receiver.stats()});
      if (now - lastRecovery >= 10000) {
        lastRecovery = now;
        closePlayer();
        Receiver.restartVideo();
      }
    };

    // MSE video only: native video bypasses JS (the surface takes it directly).
    Receiver.onVideo((kind, segment, senderMs) => {
      if (useNative.current) {
        return;
      }
      if (kind === SegmentKind.Init && !player.current) {
        const p = new MirrorPlayer(log, {kind: 'video'}, recoverVideo);
        player.current = p;
        p.setSurface(surface.current);
        p.open().catch((e) => log(`player open failed: ${String(e)}`));
      }
      player.current?.push(segment, kind === SegmentKind.Media, senderMs);
    });

    Receiver.onEvent((e: ReceiverEvent) => {
      receiverEvent(e);
      switch (e.type) {
        case 'started':
          setReceiverName(String(e.name));
          break;
        case 'client_request':
          naming.setConnections(1);
          setSender(String(e.name));
          avSync.useSender(String(e.deviceid)).then((ms) => {
            setAvDelay(ms);
            nativeVideo.current?.setAudioDelay(ms);
            log(`av delay for ${String(e.model)}: ${ms}ms`);
          });
          break;
        case 'video_format': {
          const [w, h] = e.source as [number, number];
          setVideoSize([w, h]);
          break;
        }
        case 'video_init':
          // Sent for every new SPS, including rotation, which libairplay
          // doesn't report as a video_format change.
          if ((e.width as number) > 0 && (e.height as number) > 0) {
            setVideoSize([e.width as number, e.height as number]);
          }
          break;
        case 'audio_format':
          audioCt.current = e.ct as number;
          setAudioOnly(!e.using_screen);
          break;
        case 'volume':
          volume.current = airplayVolume(e.db as number);
          audio.current?.setVolume(volume.current);
          break;
        case 'mirror_video_running':
          setMirroring(Boolean(e.running));
          shareEvent.current(e.running ? 'airplayStarted' : 'airplayEnded');
          if (e.running) {
            setAudioOnly(false);
            nativeVideo.current = useNative.current ? new NativeVideo(badNetworkRef.current, avSync.delayMs) : null;
          }
          if (!e.running) {
            closePlayer();
            nativeVideo.current = null;
          }
          break;
        case 'conn_destroy':
          naming.setConnections(e.connections as number);
          if ((e.connections as number) <= 0) {
            shareEvent.current('airplayEnded');
            setMirroring(false);
            setSender(null);
            setAudioOnly(false);
            closePlayer();
            closeAudio();
            nativeVideo.current = null;
            resetStats();
          }
          break;
      }
    });

    log(`screen ${SCREEN.width}x${SCREEN.height}`);
    // Each TV advertises a name from the Fire TV's own device name
    // (DeviceName.ts). The last name advertised goes up at once; the Fire
    // TV's name follows when it's read (or after FIRST_NAME_WAIT_MS on a
    // first launch), and renames wait for any session to end.
    let closed = false;
    const named = (name: string) => {
      if (!closed) {
        saveReceiverName(name);
        naming.start(name);
      }
    };
    cachedReceiverName().then((cached) => {
      if (closed) {
        return;
      }
      if (cached) {
        naming.start(cached);
      } else {
        setTimeout(() => {
          if (!closed && !naming.isStarted) {
            naming.start(RECEIVER_NAME);
          }
        }, FIRST_NAME_WAIT_MS);
      }
    });
    // A Fire TV name that can't be read right now (a slow or failed lookup)
    // keeps the current name and is tried again, instead of becoming plain
    // CastAir until the next launch.
    let nameRetry: ReturnType<typeof setTimeout> | undefined;
    const loadName = (force = false) => {
      if (nameRetry) {
        clearTimeout(nameRetry);
      }
      const onFireTvName = (n: string | null) => {
        if (!closed) {
          setFireTvName(n);
        }
      };
      loadReceiverName(log, {force, onFireTvName}).then((name) => {
        if (closed) {
          return;
        }
        if (name === null) {
          log(`Fire TV name unavailable: keeping the current name, retrying in ${NAME_RETRY_MS / 1000} s`);
          nameRetry = setTimeout(() => loadName(), NAME_RETRY_MS);
          return;
        }
        named(name);
      });
    };
    loadName();
    useFireTvName.current = () => loadName(true);
    let unwatch: () => void = () => undefined;
    watchReceiverName((name, fireTv) => {
      named(name);
      if (!closed) {
        setFireTvName(fireTv);
      }
    }, log).then((u) => {
      if (closed) {
        u();
      } else {
        unwatch = u;
      }
    });
    const awake = keepAwake.current;
    awake.set(true);
    let statsTicks = 0;
    const stats = setInterval(() => {
      const s = Receiver.stats();
      if ((s.connections as number) > 0) {
        const nv = nativeVideo.current;
        receiverStats(
          s,
          nv ? null : (player.current?.metrics() ?? null),
          audio.current?.metrics() ?? null,
          avSync,
          nv ? nv.state() : null,
        );
        // iOS and macOS send one IDR per session unless asked; the player can
        // only drop played video (MirrorPlayer.trim) back to an IDR, so ask
        // for one every KEYFRAME_EVERY_TICKS (DECISIONS.md D7).
        if (player.current && ++statsTicks % KEYFRAME_EVERY_TICKS === 0 && !Receiver.requestKeyframe()) {
          warn('keyframe request not sent (no event channel)');
        }
      }
    }, 5000);
    const sync = setInterval(() => avSync.tick(nativeVideo.current ?? player.current, audio.current), 1000);
    return () => {
      closed = true;
      if (nameRetry) {
        clearTimeout(nameRetry);
      }
      naming.close();
      unwatch();
      clearInterval(stats);
      clearInterval(sync);
      // Before stop(), whose disconnects would end it as "disconnected".
      streamEnd('app_closed');
      Receiver.stop();
      Receiver.onEvent(null);
      Receiver.onVideo(null);
      Receiver.onAudio(null);
      closePlayer();
      closeAudio();
      awake.set(false);
    };
  }, [avSync]);

  useEffect(() => {
    loadPrefs()
      .then((loaded) => {
        setPrefs(loaded);
        setCompatibility(loaded.compatibilityMode);
        setBadNetwork(loaded.badNetworkMode);
      })
      .catch(() => undefined);
  }, []);
  const onBadNetworkMode = (on: boolean) => {
    setBadNetwork(on);
    nativeVideo.current?.setBadNetwork(on);
    log(`bad network mode ${on ? 'on' : 'off'}`);
    savePrefs({badNetworkMode: on})
      .then(setPrefs)
      .catch(() => undefined);
  };
  const onCompatibilityMode = (on: boolean) => {
    setCompatibility(on);
    log(`compatibility mode ${on ? 'on' : 'off'}`);
    savePrefs({compatibilityMode: on})
      .then(setPrefs)
      .catch(() => undefined);
  };

  // Settings page changes: the two mirroring modes act on the players as well as saving.
  const onSettingsPrefs = (patch: Partial<Prefs>) => {
    const {compatibilityMode, badNetworkMode, ...rest} = patch;
    if (compatibilityMode !== undefined) {
      onCompatibilityMode(compatibilityMode);
    }
    if (badNetworkMode !== undefined) {
      onBadNetworkMode(badNetworkMode);
    }
    if (Object.keys(rest).length > 0) {
      savePrefs(rest)
        .then(setPrefs)
        .catch(() => undefined);
    }
  };

  // The silent keep-awake loop runs only while nothing is connected, so it
  // never competes with the real players for audio focus.
  useEffect(() => {
    keepAwake.current.set(sender === null);
  }, [sender]);

  // The overlay closes as a sender connects, and the Windows one when the TV stops being paid.
  const windowsAllowed = unlock.ready && unlock.state.unlocked;
  useEffect(() => {
    if (sender !== null) {
      setConnect(null);
      setFocusConnect(null);
    }
  }, [sender]);
  useEffect(() => {
    if (!windowsAllowed) {
      setConnect((c) => (c === 'windows' ? null : c));
    }
  }, [windowsAllowed]);

  // Back on screen (after the screensaver, say): start the loop again if the
  // TV stopped it while CastAir was away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background') {
        keepAwake.current.resume();
      }
    });
    return () => sub.remove();
  }, []);

  // The browser-share WebView stays mounted over every screen (B6): same
  // parent and position, so React keeps it across screen changes.
  const withBrowser = (screen: React.ReactElement) => (
    <View style={styles.app}>
      {screen}
      <BrowserShare
        ref={browser}
        visible={mode === 'browser'}
        name={receiverName}
        codeRequired={prefs.shareCodeOn}
        onCode={setShareCode}
        onShareStarted={() => shareEvent.current('browserStarted')}
        onShareEnded={() => shareEvent.current('browserEnded')}
        onServerConnection={setServerConnected}
        log={log}
      />
      <FreeCastBanner leftMs={freeCast.warningMs} />
    </View>
  );

  // Before the cast screens: the stopped cast's last events may still be on their way.
  if (freeCast.ended) {
    return withBrowser(
      <FreeCastEndScreen
        products={unlock.products}
        productsLoaded={unlock.productsLoaded}
        state={unlock.state}
        onBuy={unlock.buy}
        onCheckAgain={unlock.checkNow}
        onClose={freeCast.closeEnd}
      />,
    );
  }

  if (mirroring) {
    return withBrowser(
      <View style={styles.root}>
        {!compatibility ? (
          <CastAirSurface style={styles.fill} />
        ) : (
          <KeplerVideoSurfaceView
            style={[styles.video, fit(videoSize[0], videoSize[1])]}
            onSurfaceViewCreated={(handle: string) => {
              surface.current = handle;
              player.current?.setSurface(handle);
            }}
            onSurfaceViewDestroyed={() => {
              surface.current = null;
              player.current?.setSurface(null);
            }}
          />
        )}
        <AvDelayOverlay
          active={mirroring}
          delayMs={avDelay}
          onChange={(ms) => {
            avSync.setDelay(ms);
            setAvDelay(avSync.delayMs);
            log(`av delay set to ${avSync.delayMs}ms`);
          }}
        />
      </View>,
    );
  }

  if (audioOnly && sender) {
    return withBrowser(
      <View style={styles.idle}>
        <Text style={styles.line}>Playing audio from</Text>
        <Text style={styles.name}>{sender}</Text>
      </View>,
    );
  }

  if (showSettings) {
    return withBrowser(
      <Settings
        receiverName={receiverName}
        prefs={{...prefs, compatibilityMode: compatibility, badNetworkMode: badNetwork}}
        info={standbyInfo}
        serverConnected={serverConnected}
        unlockState={unlock.state}
        freeLeftMs={freeCast.remainingMs}
        products={unlock.products}
        productsLoaded={unlock.productsLoaded}
        onBuy={unlock.buy}
        onCheckAgain={unlock.checkNow}
        onPrefs={onSettingsPrefs}
        onUseFireTvName={() => useFireTvName.current()}
        initialTab={settingsTab}
        onClose={() => {
          setShowSettings(false);
          setRefreshKey((k) => k + 1);
        }}
      />,
    );
  }

  const freeVersion = unlock.ready && !unlock.state.unlocked;
  const openSettings = (tab: 'settings' | 'plans') => {
    setConnect(null);
    setFocusConnect(null);
    setSettingsTab(tab);
    setShowSettings(true);
  };
  // Always inside the same View, so opening an overlay doesn't remount the standby screen.
  return withBrowser(
    <View style={styles.fillFlex}>
      <StandbyScreen
        name={receiverName}
        info={standbyInfo}
        prefs={prefs}
        nowMs={nowMs}
        country={country}
        serverConnected={serverConnected}
        connectingSender={sender}
        shareCode={shareCode}
        freeVersion={freeVersion}
        freeLeftMs={freeVersion ? freeCast.remainingMs : null}
        onOpenSettings={() => openSettings('settings')}
        onOpenPlans={() => openSettings('plans')}
        showWindows={windowsAllowed}
        onOpenConnect={(kind) => {
          setFocusConnect(null);
          setConnect(kind);
        }}
        hideButtons={connect !== null}
        focusConnect={focusConnect}
        onConnectFocused={() => setFocusConnect(null)}
        wallpaper={wallpaper}
      />
      {connect !== null ? (
        <ConnectOverlay
          kind={connect}
          castAirName={receiverName}
          fireTvName={fireTvName}
          shareCode={prefs.shareCodeOn ? shareCode : null}
          onClose={() => {
            setFocusConnect(connect);
            setConnect(null);
          }}
          onEnableWindows={async () => Linking.openURL(MIRACAST_URI)}
        />
      ) : null}
    </View>,
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  video: {position: 'absolute'},
  fill: {position: 'absolute', left: 0, top: 0, width: SCREEN.width, height: SCREEN.height},
  app: {flex: 1, backgroundColor: '#000'},
  fillFlex: {flex: 1},
  idle: {flex: 1, backgroundColor: COLORS.greenDark, alignItems: 'center'},
  line: {color: COLORS.muted, fontSize: 2 * U},
  name: {color: COLORS.cream, fontSize: 4.2 * U, fontWeight: 'bold', marginTop: 0.4 * U},
});
