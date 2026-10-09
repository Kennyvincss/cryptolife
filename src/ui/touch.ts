// On-screen touch controls for phones and tablets: left joystick to move/drive,
// drag the right side to look, buttons for jump/run/phone/map/chat/emotes.
// Interaction prompts (E/R/F/G) are tappable in the HUD.

import type { Input } from '../engine/input.js';
import { h } from './dom.js';

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
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    move(t.clientX, t.clientY);
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
    for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) move(t.clientX, t.clientY);
  }, { passive: true });
  const end = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === jid) release(); };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // look by dragging the right side of the screen
  let lid: number | null = null, lx = 0, ly = 0;
  look.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    lid = t.identifier; lx = t.clientX; ly = t.clientY;
  }, { passive: false });
  look.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === lid) {
      input.addLook((t.clientX - lx) * 1.6, (t.clientY - ly) * 1.6);
      lx = t.clientX; ly = t.clientY;
    }
  }, { passive: false });
  look.addEventListener('touchend', () => (lid = null));

  // hide the controls while a full-screen UI is open
  const tick = () => { const b = actions.blocked(); for (const el of [joy, pad, look, bar]) el.style.display = b ? 'none' : ''; if (b) release(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}
