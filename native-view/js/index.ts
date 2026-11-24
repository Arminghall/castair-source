// JS face of com.arminghall.castair.surface: a native view that shows the
// mirrored video. It takes the H.264 straight from the receiver, decodes it
// with the hardware decoder and renders it with its own shader, full range
// intact (.claude/docs/DECISIONS.md D12). Mount it full screen; it letterboxes. Its
// state is in Receiver.nativeVideo(), its status lines in receiver events.
//
// Copyright (C) 2026 Parker Wahle
// SPDX-License-Identifier: AGPL-3.0-or-later

// The registration helper ships with the app's react-native-kepler; it is
// resolved from the app's node_modules when Metro bundles this package.
// It is a CommonJS module (module.exports = fn), hence the interop below.
type Register = (name: string, config: object) => void;
declare const require: (id: string) => {__esModule?: boolean; default?: Register} | Register;

const NAME = 'CastAirSurface';

const mod = require('@amazon-devices/react-native-kepler/Libraries/Utilities/registerGeneratedViewConfig');
const register = (typeof mod === 'function' ? mod : mod.default) as Register;
register(NAME, {
  uiViewClassName: NAME,
  validAttributes: {},
});

export type CastAirSurfaceProps = {
  style?: unknown;
};

/** Host component: a string, as React Native expects for native views. */
export const CastAirSurface = NAME as unknown as (props: CastAirSurfaceProps) => null;
