// Builds server/data/places.tsv.gz from a GeoNames dump directory
// (cities5000.txt, admin1CodesASCII.txt, countryInfo.txt).
// Usage: node server/scripts/build-places.mjs <dumpDir> <outFile>
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

const [dumpDir, outFile] = process.argv.slice(2);
if (!dumpDir || !outFile) {
  console.error('usage: build-places.mjs <dumpDir> <outFile>');
  process.exit(2);
}

const lines = (name) => readFileSync(join(dumpDir, name), 'utf8').split('\n').filter(Boolean);

const countries = new Map();
for (const line of lines('countryInfo.txt')) {
  if (line.startsWith('#')) continue;
  const f = line.split('\t');
  countries.set(f[0], f[4]);
}

const regions = new Map();
for (const line of lines('admin1CodesASCII.txt')) {
  const f = line.split('\t');
  regions.set(f[0], f[1]);
}

const clean = (s) => (s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const out = [];
for (const line of lines('cities5000.txt')) {
  const f = line.split('\t');
  const [id, name, asciiName] = f;
  const cc = f[8];
  const region = regions.get(`${cc}.${f[10]}`) ?? '';
  const country = countries.get(cc) ?? cc;
  out.push([id, name, asciiName, region, country, cc, f[4], f[5], f[17], f[14] || '0'].map(clean).join('\t'));
}
writeFileSync(outFile, gzipSync(out.join('\n') + '\n', {level: 9}));
console.log(`${out.length} places -> ${outFile}`);
