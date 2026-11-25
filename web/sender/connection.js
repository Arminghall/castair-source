// CastAir casting page: the "connection" line shown while sharing.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later

// Turns CastAirSender.describeConnection() into "1920 × 1080 · 15 fps · 6.2 Mbit/s".
// Parts the browser hasn't measured yet are left out.
export function formatConnection(connection) {
  if (!connection) {
    return '';
  }
  const parts = [];
  if (connection.width && connection.height) {
    parts.push(`${connection.width} × ${connection.height}`);
  }
  if (connection.framesPerSecond != null) {
    parts.push(`${Math.round(connection.framesPerSecond)} fps`);
  }
  if (connection.bitrateKbps != null) {
    parts.push(
      connection.bitrateKbps >= 1000
        ? `${(connection.bitrateKbps / 1000).toFixed(1)} Mbit/s`
        : `${connection.bitrateKbps} kbit/s`,
    );
  }
  return parts.join(' · ');
}
