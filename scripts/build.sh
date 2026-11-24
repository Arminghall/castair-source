#!/usr/bin/env bash
# Builds the app: the native module, the native view and the React Native
# app, and (--install) installs and launches it on the TV in VEGA_SERIAL.
#
#   scripts/build.sh [environment] [--install]
#
# environment defaults to "development". With the Vega CLI on PATH (CI: see
# .github/workflows/release.yml) the builds run directly; otherwise in the
# `vega` distrobox.
#
# Copyright (C) 2026 Parker Wahle
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

ENVIRONMENT=development
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    *) ENVIRONMENT="$arg" ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP="$ROOT/app"
if command -v vega > /dev/null; then
  in_vega() { bash -c "$1"; }
else
  in_vega() { distrobox enter vega -- bash -lc "$1"; }
fi

# Releases are identified by the build number alone: the manifest's version
# (a plain integer), passed to the packager as the Appstore's build number,
# and the tag a release is built from (CI).
BUILD_NUMBER=$(sed -n 's/^version *= *"\([0-9][0-9]*\)".*/\1/p' "$APP/manifest.toml")
[ -n "$BUILD_NUMBER" ] || { echo "no integer version in $APP/manifest.toml" >&2; exit 1; }
# package.json carries it too, as <build>.0.0 (scripts/bump.sh sets both).
PACKAGE_VERSION=$(sed -n 's/^  "version": "\(.*\)".*/\1/p' "$APP/package.json")
[ "$PACKAGE_VERSION" = "$BUILD_NUMBER.0.0" ] \
  || { echo "app/package.json version $PACKAGE_VERSION != $BUILD_NUMBER.0.0 (run scripts/bump.sh $BUILD_NUMBER)" >&2; exit 1; }
GIT=$(git -C "$ROOT" rev-parse --short=12 HEAD)
# app/package-lock.json changes on every build (the local module tarball's
# checksum), so it doesn't count.
if ! git -C "$ROOT" diff --quiet HEAD -- app native native-view ':!app/package-lock.json'; then
  # Uncommitted changes: make each build's release unique.
  GIT="$GIT-dirty.$(date +%s)"
fi
RELEASE="castair@$BUILD_NUMBER+$GIT"
# A clean production build of the commit tagged with the build number (CI's
# release builds: tag "3") is just that: castair@3. Other builds keep the
# sha, so they're never confused with the release.
TAG=${GITHUB_REF_TYPE:+${GITHUB_REF_NAME}}
[ -n "$TAG" ] || TAG=$(git -C "$ROOT" describe --exact-match --tags HEAD 2> /dev/null || true)
if [ "$ENVIRONMENT" = production ] && [ "$TAG" = "$BUILD_NUMBER" ] && [ "${GIT%%-dirty*}" = "$GIT" ]; then
  RELEASE="castair@$BUILD_NUMBER"
fi
DIST=vega

# Stamp the release into the bundle; restore the committed file afterwards.
BUILD_INFO="$APP/src/buildInfo.ts"
MANIFEST="$APP/manifest.toml"
cp "$BUILD_INFO" "$BUILD_INFO.orig"
cp "$MANIFEST" "$MANIFEST.orig"
trap 'mv "$BUILD_INFO.orig" "$BUILD_INFO"; mv "$MANIFEST.orig" "$MANIFEST"' EXIT
cat > "$BUILD_INFO" <<EOF
// Written by scripts/build.sh before each build; these are the values for an
// ad-hoc \`npm run build\`.
export const BUILD = {
  release: '$RELEASE',
  dist: '$DIST',
  environment: '$ENVIRONMENT',
  git: '$GIT',
};
EOF

# Production builds carry only the Appstore's purchase entries: drop the
# manifest's development-only block (Amazon's App Tester, B18). The trap above
# restores the committed manifest.
if [ "$ENVIRONMENT" = production ]; then
  DEV_BEGIN=$(grep -n '^# BEGIN development-only$' "$MANIFEST.orig" | cut -d: -f1 || true)
  DEV_END=$(grep -n '^# END development-only$' "$MANIFEST.orig" | cut -d: -f1 || true)
  [[ "$DEV_BEGIN" =~ ^[0-9]+$ && "$DEV_END" =~ ^[0-9]+$ && "$DEV_BEGIN" -lt "$DEV_END" ]] \
    || { echo "$MANIFEST needs one '# BEGIN development-only' ... '# END development-only' block" >&2; exit 1; }
  sed '/^# BEGIN development-only$/,/^# END development-only$/d' "$MANIFEST.orig" > "$MANIFEST"
  ! grep -q 'iap\.tester' "$MANIFEST" || { echo "App Tester entries left in the production manifest" >&2; exit 1; }
fi

# Production builds are what's submitted: armv7 only (the Fire TV Stick; the
# other targets are for the Vega Virtual Device) and unsigned, since Amazon
# re-signs submitted packages. Development builds keep every target and the
# developer signature that sideloading needs.
# RV_CCACHE=1 (CI) compiles through ccache, so a fresh checkout's new mtimes
# don't cost a full rebuild.
CMAKE_LAUNCHER=""
if [ "${RV_CCACHE:-0}" = 1 ]; then
  CMAKE_LAUNCHER=" --cmakeFlags=-DCMAKE_C_COMPILER_LAUNCHER=ccache --cmakeFlags=-DCMAKE_CXX_COMPILER_LAUNCHER=ccache"
fi
if [ "$ENVIRONMENT" = production ]; then
  NATIVE_BUILD="npm run build:js && vega build -b Release -t armv7$CMAKE_LAUNCHER"
  APP_TARGET="--target armv7 --additional-native-options \"--no-profile\""
else
  NATIVE_BUILD="npm run build"
  APP_TARGET=""
fi

echo "== $RELEASE ($ENVIRONMENT)"
in_vega "set -euo pipefail
  cd '$ROOT/native'
  # npm pack bundles all of dist/: clear it so no stale libraries ship.
  rm -rf dist
  [ -d node_modules ] || npm install --no-audit --no-fund > /dev/null 2>&1
  ($NATIVE_BUILD) > /tmp/rv-native-build.log 2>&1 || { grep -E 'error|FAILED' /tmp/rv-native-build.log | head -20; exit 1; }
  rm -f ./*.tgz
  npm pack --ignore-scripts > /dev/null 2>&1
  # The native UI component (GL surface view): its own package.
  cd '$ROOT/native-view'
  rm -rf dist
  [ -d node_modules ] || npm install --no-audit --no-fund > /dev/null 2>&1
  ($NATIVE_BUILD) > /tmp/rv-view-build.log 2>&1 || { grep -E 'error|FAILED' /tmp/rv-view-build.log | head -20; exit 1; }
  rm -f ./*.tgz
  npm pack --ignore-scripts > /dev/null 2>&1
  # The browser-share receiver page, bundled into one file (DECISIONS B6).
  node '$ROOT/scripts/build-tv-assets.mjs' > /dev/null
  cd '$APP'
  # The app build stages native libraries and keeps old ones: start clean.
  rm -rf build
  npm uninstall castair-native castair-surface > /dev/null 2>&1
  npm install --no-audit --no-fund file:../native/castair-native-0.1.0.tgz file:../native-view/castair-surface-0.1.0.tgz > /dev/null
  npx react-native build-vega --build-type Release --build-number $BUILD_NUMBER $APP_TARGET --hermes-flags '-O,-w' > /tmp/rv-app-build.log 2>&1 \
    || { grep -iE 'error|FAILED' /tmp/rv-app-build.log | head -20; exit 1; }
"


if [ "$INSTALL" = 1 ]; then
  in_vega "cd '$APP'
    vega device terminate-app --appName com.arminghall.castair.main > /dev/null 2>&1 || true
    vega device install-app --packagePath build/armv7-release/castair_armv7.vpkg | tail -1
    vega device launch-app --appName com.arminghall.castair.main | tail -1"
fi
echo "== built $RELEASE"
