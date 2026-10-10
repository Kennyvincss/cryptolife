// On-screen touch controls for phones and tablets: left joystick to move/drive,
// drag the right side to look, buttons for jump/run/phone/map/chat/emotes.
// Interaction prompts (E/R/F/G) are tappable in the HUD.

import type { Input } from '../engine/input.js';
import { h } from './dom.js';
import { toApp } from './orient.js';

export function mountTouch(input: Input, actions: { phone: () => void; map: () => void; chat: () => void; blocked: () => boolean }) {
  document.body.classList.add('touch');
  const knob = h('div.joy-knob');
  const joy = h('div.joy', knob);
  const look = h('div.look-zone');
  let run = false;
  const runBtn = h('button.tbtn', '🏃');
  const bar = h('div.tbar',
    h('button.tbtn', { onclick: actions.phone }, '📱'),
    h('button.tbtn', { onclick: actions.map }, '🗺'),
    h('button.tbtn', { onclick: actions.chat }, '💬'),
    h('button.tbtn', { onclick: () => input.tap('Digit2') }, '💃'),
  );
  const pad = h('div.tpad', runBtn, h('button.tbtn.big', { ontouchstart: (e: TouchEvent) => { e.preventDefault(); input.setVirtual('Space', true); }, ontouchend: () => input.setVirtual('Space', false) }, '⤒'));
  runBtn.addEventListener('click', () => { run = !run; runBtn.classList.toggle('on', run); });
  document.body.append(look, joy, bar, pad);

  // joystick
  let jid: number | null = null, cx = 0, cy = 0;
  const R = 55;
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft'];
  const release = () => { for (const k of keys) input.setVirtual(k, false); knob.style.transform = ''; jid = null; };
  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    jid = t.identifier;
    const r = joy.getBoundingClientRect();
    const c = toApp(r.left + r.width / 2, r.top + r.height / 2);
    cx = c.x; cy = c.y;
    const p = toApp(t.clientX, t.clientY);
    move(p.x, p.y);
  }, { passive: false });
  const move = (x: number, y: number) => {
    let dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / R, ny = dy / R;
    input.setVirtual('KeyW', ny < -0.3);
    input.setVirtual('KeyS', ny > 0.3);
    input.setVirtual('KeyA', nx < -0.3);
    input.setVirtual('KeyD', nx > 0.3);
    input.setVirtual('ShiftLeft', run || Math.hypot(nx, ny) > 0.95);
  };
  window.addEventListener('touchmove', (e) => {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) { const p = toApp(t.clientX, t.clientY); move(p.x, p.y); }
  }, { passive: true });
  const end = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) release(); };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // look by dragging the right side of the screen
  let lid: number | null = null, lx = 0, ly = 0;
  look.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    lid = t.identifier; const p = toApp(t.clientX, t.clientY); lx = p.x; ly = p.y;
  }, { passive: false });
  // two fingers on the look area: pinch to zoom the camera
  let pinch = 0;
  const pinchDist = (e: TouchEvent) => { const ts = Array.from(e.touches).filter((t) => look.contains(t.target as Node)); if (ts.length < 2) return 0; const a = toApp(ts[0].clientX, ts[0].clientY), b = toApp(ts[1].clientX, ts[1].clientY); return Math.hypot(a.x - b.x, a.y - b.y); };
  look.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const pd = pinchDist(e);
    if (pd) { if (pinch) input.wheel += (pinch - pd) / 45; pinch = pd; return; }
    pinch = 0;
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lid) {
      const p = toApp(t.clientX, t.clientY);
      input.addLook((p.x - lx) * 1.6, (p.y - ly) * 1.6);
      lx = p.x; ly = p.y;
    }
  }, { passive: false });
  look.addEventListener('touchend', () => { lid = null; pinch = 0; });

  // hide the controls while a full-screen UI is open
  const tick = () => { const b = actions.blocked(); for (const el of [joy, pad, look, bar]) el.style.display = b ? 'none' : ''; if (b) release(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
