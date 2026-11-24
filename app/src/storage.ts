/*
 * Persistent key-value storage. The legacy AsyncStorage in
 * @amazon-devices/react-native-kepler didn't keep anything across an app
 * restart on the office Fire TV (B12), so settings use Amazon's packaged
 * async-storage system module instead.
 *
 * Copyright (C) 2026 Arminghall
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
export {default as AsyncStorage} from '@amazon-devices/react-native-async-storage__async-storage';
