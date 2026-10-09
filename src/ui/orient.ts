// Landscape play on phones. iOS Safari can't lock orientation, so when the
// device is held in portrait during gameplay we rotate the whole page 90° with
// CSS (turn the phone sideways to play). Android additionally tries real
// fullscreen + orientation lock. Touch coordinates are mapped back with toApp().

import { isTouchDevice } from '../engine/input.js';
import { emit } from '../state.js';

export const view = { rotated: false, w: window.innerWidth, h: window.innerHeight };
let enabled = false;

export function enableLandscape() {
  if (!isTouchDevice()) return;
  enabled = true;
  document.body.classList.add('land');
  update();
  window.addEventListener('resize', () => setTimeout(update, 50));
  window.addEventListener('orientationchange', () => setTimeout(update, 200));
  // Android: real fullscreen + orientation lock on the first touch (needs a user gesture)
  const tryLock = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      await (screen.orientation as any)?.lock?.('landscape');
    } catch { /* iOS & some browsers: fall back to CSS rotation */ }
    setTimeout(update, 300);
  };
  window.addEventListener('touchend', tryLock, { once: true });
}

export function update() {
  const portrait = window.innerHeight > window.innerWidth;
  const rot = enabled && portrait;
  view.rotated = rot;
  document.body.classList.toggle('rotated', rot);
  if (rot) {
    document.body.style.width = window.innerHeight + 'px';
    document.body.style.height = window.innerWidth + 'px';
    view.w = window.innerHeight; view.h = window.innerWidth;
  } else {
    document.body.style.width = ''; document.body.style.height = '';
    view.w = window.innerWidth; view.h = window.innerHeight;
  }
  emit('viewresize', view);
}

/** Convert a screen (client) point into page coordinates when rotated. */
export function toApp(x: number, y: number) {
  return view.rotated ? { x: y, y: window.innerWidth - x } : { x, y };
}
