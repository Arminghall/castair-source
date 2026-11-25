// castair.app: shows today's photo, the one CastAir TVs on the default wallpaper show,
// behind the page, with Unsplash's credit. Without a photo the page keeps its green.
//
// Copyright (C) 2026 Arminghall
// SPDX-License-Identifier: AGPL-3.0-or-later

const UNSPLASH = /^https:\/\/(images\.)?unsplash\.com\//;

function link(text, href) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  a.rel = 'noopener';
  a.target = '_blank';
  return a;
}

export async function showWallpaper() {
  let photo;
  try {
    const res = await fetch('/api/wallpaper', {cache: 'no-cache'});
    photo = await res.json();
  } catch {
    return;
  }
  if (!photo?.imageUrl || !UNSPLASH.test(photo.imageUrl)) {
    return;
  }
  const root = document.documentElement;
  if (/^#[0-9a-f]{6}$/i.test(photo.color ?? '')) {
    root.style.setProperty('--photo-color', photo.color);
  }
  // Load it first, so it fades in whole rather than drawing in strips.
  const img = new Image();
  img.src = photo.imageUrl;
  try {
    await img.decode();
  } catch {
    return;
  }
  root.style.setProperty('--photo', `url("${photo.imageUrl.replace(/"/g, '%22')}")`);
  document.body.classList.add('has-photo');
  for (const el of document.querySelectorAll('[data-credit]')) {
    const who = UNSPLASH.test(photo.photographerUrl ?? '') ? photo.photographerUrl : photo.unsplashUrl;
    el.replaceChildren(
      'Photo by ',
      link(photo.photographer || 'Unsplash', who),
      ' on ',
      link('Unsplash', photo.unsplashUrl),
    );
    el.hidden = false;
  }
  for (const el of document.querySelectorAll('[data-credit-text]')) {
    el.textContent = `Photo by ${photo.photographer || 'Unsplash'} on Unsplash`;
    el.hidden = false;
  }
}
