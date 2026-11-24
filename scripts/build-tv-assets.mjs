// Builds the TV receiver page as one file, app/assets/raw/receiver.html,
// which CastAir's WebView loads from file:///pkg/assets/raw/receiver.html.
// Chromium refuses ES module scripts from file:// (an opaque origin), so the
// modules are flattened into a single classic script, as Tandem's
// build-vega-assets.mjs does.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_OUT = join(root, 'app', 'assets', 'raw', 'receiver.html');
export const DEFAULT_SIGNALING_URL = 'wss://castair.app/signal';

// Dependency order: each module may only use modules listed before it.
const MODULES = ['web/shared/config.js', 'web/receiver/receiver.js', 'web/receiver/host.js'];
const SCRIPT_TAG = '<script type="module" src="host.js"></script>';

export function toClassicScript(source, label) {
  const stripped = source
    .replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let)\b)/gm, '');
  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(`${label}: import/export left after flattening`);
  }
  return stripped;
}

export async function buildTvAssets({outFile = DEFAULT_OUT, signalingUrl = DEFAULT_SIGNALING_URL} = {}) {
  const parts = [];
  for (const module of MODULES) {
    parts.push(`// ---- ${module}\n${toClassicScript(await readFile(join(root, module), 'utf8'), module)}`);
  }
  const script = `(function () {\n"use strict";\n${parts.join('\n')}\n})();`.replace(
    '__CASTAIR_SIGNALING_URL__',
    signalingUrl,
  );
  const html = await readFile(join(root, 'web/receiver/index.html'), 'utf8');
  if (html.split(SCRIPT_TAG).length !== 2) {
    throw new Error('web/receiver/index.html must load host.js exactly once');
  }
  await mkdir(dirname(outFile), {recursive: true});
  await writeFile(
    outFile,
    html.replace(SCRIPT_TAG, () => `<script>\n${script}\n</script>`),
  );
  return outFile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildTvAssets({signalingUrl: process.env.CASTAIR_SIGNALING_URL || DEFAULT_SIGNALING_URL});
  console.log(`wrote ${out}`);
}
