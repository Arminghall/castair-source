# CastAir

CastAir is a screen-mirroring receiver for Fire TV devices running Vega OS. It shows up on your network as an AirPlay receiver, so you can mirror an iPhone, iPad or Mac to the TV with sound. It also accepts shares from a laptop's browser at https://castair.app.

This repository is the complete corresponding source of the CastAir app, its signalling server and its web pages.

## Layout

- `app/`: the React Native app for Vega OS (standby screen, mirroring, settings, purchases).
- `native/`, `native-view/`: the native Node-API modules (AirPlay receiver, video view).
- `server/`: the Node service that serves the sharing page and pairs laptops with TVs.
- `web/`: the sharing page (`web/sender`) and the TV-side receiver page (`web/receiver`).
- `third_party/`: bundled third-party projects (see below).
- `third_party_notices/`: notices for data and code we include.

## Building the app

You need the Vega SDK 2.0.13986 (`vega sdk use 2.0.13986`) on macOS and the submodules checked out. Then:

```
scripts/build.sh
```

`scripts/bump.sh [build]` sets the build number, and `scripts/build-tv-assets.mjs` bundles the receiver page into the app (`build.sh` runs it).

## Licence

CastAir is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE.md) (AGPL-3.0-or-later).

It is a fork of an AGPL-3.0-or-later AirPlay receiver for Vega by Parker Wahle, built on [UxPlay](https://github.com/FDH2/UxPlay)'s protocol library. The binary also contains GPLv3 code (`lib/playfair` by Esteban Kubata; `lib/crypto.c` from RPiPlay by Florian Draschbacher and Jaslo Ziska, modified by F. Duncanh). Copyright notices stay in the files that carry them.

## Third-party projects in `third_party/`

Each is a separate project under its own licence; see `third_party/SUBMODULES.md` for the exact commits.

- UxPlay: https://github.com/regulad/UxPlay.git (a UxPlay fork; the commit is in `third_party/SUBMODULES.md`)
- libplist: https://github.com/libimobiledevice/libplist.git
- OpenSSL: https://github.com/openssl/openssl.git
- node-api-headers: https://github.com/nodejs/node-api-headers.git
- FFmpeg: https://github.com/FFmpeg/FFmpeg.git

## Privacy

Mirrored content never leaves your local network. CastAir has no analytics or crash reporting. See https://castair.app/privacy.

Support: castair@arminghall.com

CastAir is not affiliated with or endorsed by Apple Inc. Apple, AirPlay, iPhone, iPad and Mac are trademarks of Apple Inc., registered in the U.S. and other countries and regions.
