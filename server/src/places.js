// GeoNames place list: town search and nearest-place lookup.
// Data: GeoNames cities5000 (CC BY 4.0), see third_party_notices/GEONAMES-NOTICE.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const lower = (s) => s.toLocaleLowerCase('en');

// Reads a .tsv or .tsv.gz of: id name asciiName region country countryCode
// lat lon timeZone population (tab-separated, no header).
//
// Memory: the 70k-line file stays as one buffer; only the search keys and
// the numbers are kept per place, and a Place object is built on demand.
export function loadPlaces(path) {
  let buf = readFileSync(path);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);

  const starts = [];
  const ends = [];
  for (let start = 0, end; start < buf.length; start = end + 1) {
    end = buf.indexOf(10, start);
    if (end < 0) end = buf.length;
    if (end > start) {
      starts.push(start);
      ends.push(end);
    }
  }
  const n = starts.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const pop = new Int32Array(n);
  const names = new Array(n);
  const asciis = new Array(n);
  const ids = new Map();
  for (let i = 0; i < n; i++) {
    const f = buf.toString('utf8', starts[i], ends[i]).split('\t');
    lat[i] = Number(f[6]);
    lon[i] = Number(f[7]);
    pop[i] = Number(f[9]) || 0;
    const name = lower(f[1]);
    const ascii = lower(f[2]);
    names[i] = name;
    asciis[i] = ascii === name ? null : ascii;
    ids.set(f[0], i);
  }
  // Largest first, so a prefix scan yields results already in order.
  const order = Array.from({length: n}, (_, i) => i).sort((a, b) => pop[b] - pop[a]);

  const place = (i) => {
    const f = buf.toString('utf8', starts[i], ends[i]).split('\t');
    return {
      id: f[0],
      name: f[1],
      region: f[3],
      country: f[4],
      countryCode: f[5],
      lat: lat[i],
      lon: lon[i],
      timeZone: f[8],
      population: pop[i],
    };
  };

  return {
    byId(id) {
      const i = ids.get(String(id));
      return i === undefined ? null : place(i);
    },

    search(q, limit = 8) {
      const query = lower(String(q ?? '').trim());
      if (query.length < 2) return [];
      const found = [];
      for (const i of order) {
        if (names[i].startsWith(query) || (asciis[i] !== null && asciis[i].startsWith(query))) {
          found.push(place(i));
          if (found.length >= limit) break;
        }
      }
      return found;
    },

    nearest(qLat, qLon) {
      const cos = Math.cos((qLat * Math.PI) / 180);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        let dLon = Math.abs(lon[i] - qLon);
        if (dLon > 180) dLon = 360 - dLon;
        const dx = dLon * cos;
        const dy = lat[i] - qLat;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best < 0 ? null : place(best);
    },
  };
}
