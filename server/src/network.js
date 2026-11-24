// Which devices share a network. IPv4 homes share one public address; IPv6
// homes give every device its own address inside the household's /64, so the
// /64 prefix is the network.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later
import {isIP} from 'node:net';

const MAPPED_V4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** Expands an IPv6 address to its eight 16-bit groups. */
function hextets(ip) {
  // A trailing dotted quad (::1.2.3.4) stands for two hextets.
  const quad = ip.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  let text = ip;
  if (quad) {
    const [, head, a, b, c, d] = quad;
    const hex = (x, y) => ((Number(x) << 8) | Number(y)).toString(16);
    text = `${head}${hex(a, b)}:${hex(c, d)}`;
  }
  const [left, right] = text.split('::');
  const l = left ? left.split(':') : [];
  const r = right === undefined ? [] : right ? right.split(':') : [];
  const fill = text.includes('::') ? Array(8 - l.length - r.length).fill('0') : [];
  return [...l, ...fill, ...r].map((h) => h.toLowerCase().padStart(4, '0'));
}

/**
 * The key two devices must share to be introduced: '4:a.b.c.d' for IPv4,
 * '6:' plus the first four hextets for IPv6, and '?:ip' (matching only
 * itself) for anything unparsable.
 */
export function networkKey(ip) {
  const text = String(ip ?? '');
  const mapped = text.match(MAPPED_V4);
  if (mapped && isIP(mapped[1]) === 4) {
    return `4:${mapped[1]}`;
  }
  const family = isIP(text);
  if (family === 4) {
    return `4:${text}`;
  }
  if (family === 6) {
    return `6:${hextets(text).slice(0, 4).join(':')}`;
  }
  return `?:${text}`;
}
