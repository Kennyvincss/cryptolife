// Canvas renderers for in-world screens (charts, news, boards). All market data is labelled SIMULATED.

import * as THREE from 'three';
import { dynamicCanvas } from '../engine/textures.js';
import { store, fmt, clockString } from '../state.js';

export interface Screen { mat: THREE.MeshStandardMaterial; draw: () => void }

export function makeScreen(w: number, h: number, draw: (x: CanvasRenderingContext2D, W: number, H: number) => void, intensity = 1.1): Screen {
  const c = dynamicCanvas(w, h);
  const m = new THREE.MeshStandardMaterial({ map: c.texture, emissiveMap: c.texture, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.3 });
  return { mat: m, draw: () => { draw(c.ctx, w, h); c.texture.needsUpdate = true; } };
}

export function chartScreen(sym: string) {
  return makeScreen(512, 320, (x, W, H) => drawChart(x, W, H, sym));
}

export function drawChart(x: CanvasRenderingContext2D, W: number, H: number, sym: string) {
  x.fillStyle = '#070a12'; x.fillRect(0, 0, W, H);
  const hist = store.priceHistory[sym] ?? [];
  const p = store.prices[sym] ?? 0;
  const tok = store.tokens.find((t) => t.sym === sym);
  const ch = tok ? ((p - tok.open24) / tok.open24) * 100 : 0;
  x.fillStyle = '#e8eef8'; x.font = 'bold 28px Consolas, monospace'; x.textAlign = 'left';
  x.fillText(sym + '/USD', 16, 36);
  x.fillStyle = ch >= 0 ? '#38f2a5' : '#ff5a6e';
  x.fillText(fmt.price(p) + '  ' + fmt.pct(ch), 16, 70);
  x.fillStyle = '#ffb03f'; x.font = 'bold 18px Consolas'; x.textAlign = 'right'; x.fillText('SIMULATED', W - 12, 30);
  x.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(0, 90 + i * 38); x.lineTo(W, 90 + i * 38); x.stroke(); }
  if (hist.length > 2) {
    const mn = Math.min(...hist), mx = Math.max(...hist);
    const rng = mx - mn || mx * 0.001 || 1;
    x.beginPath();
    hist.forEach((v, i) => { const px = (i / (hist.length - 1)) * (W - 20) + 10; const py = H - 20 - ((v - mn) / rng) * (H - 120); i ? x.lineTo(px, py) : x.moveTo(px, py); });
    x.strokeStyle = ch >= 0 ? '#38f2a5' : '#ff5a6e'; x.lineWidth = 3; x.stroke();
    x.lineTo(W - 10, H - 10); x.lineTo(10, H - 10); x.closePath();
    x.fillStyle = ch >= 0 ? 'rgba(56,242,165,0.12)' : 'rgba(255,90,110,0.12)'; x.fill();
  } else {
    x.fillStyle = '#556'; x.font = '20px Consolas'; x.textAlign = 'center'; x.fillText('collecting ticks…', W / 2, H / 2 + 30);
  }
}

export function tickerScreen() {
  return makeScreen(1024, 256, (x, W, H) => {
    x.fillStyle = '#05070c'; x.fillRect(0, 0, W, H);
    const toks = store.tokens;
    const cols = 5;
    toks.slice(0, 10).forEach((t, i) => {
      const p = store.prices[t.sym] ?? t.price;
      const ch = ((p - t.open24) / t.open24) * 100;
      const cx = (i % cols) * (W / cols) + 14, cy = Math.floor(i / cols) * 120 + 50;
      x.fillStyle = '#e8eef8'; x.font = 'bold 30px Consolas'; x.textAlign = 'left'; x.fillText(t.sym, cx, cy);
      x.fillStyle = ch >= 0 ? '#38f2a5' : '#ff5a6e'; x.font = 'bold 26px Consolas';
      x.fillText(fmt.price(p), cx, cy + 34);
      x.font = '22px Consolas'; x.fillText(fmt.pct(ch), cx, cy + 62);
    });
    x.fillStyle = '#ffb03f'; x.font = 'bold 16px Consolas'; x.textAlign = 'right'; x.fillText('SIMULATED MARKET — NOT LIVE PRICES', W - 10, H - 8);
  }, 1.3);
}

export function newsScreen() {
  return makeScreen(768, 432, (x, W, H) => {
    x.fillStyle = '#0b1020'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#d92b3a'; x.fillRect(0, 0, W, 56);
    x.fillStyle = '#fff'; x.font = 'bold 32px "Segoe UI", Arial'; x.textAlign = 'left'; x.fillText('CITYNEWS  ' + clockString(), 18, 40);
    x.font = 'bold 16px Arial'; x.textAlign = 'right'; x.fillText('SIMULATED NEWS', W - 14, 36);
    x.textAlign = 'left';
    store.news.slice(0, 4).forEach((n, i) => {
      x.fillStyle = '#ffb03f'; x.font = 'bold 15px Arial'; x.fillText(n.kind.toUpperCase() + ' · ' + fmt.ago(n.ts) + ' ago', 20, 92 + i * 88);
      x.fillStyle = '#fff'; x.font = 'bold 24px "Segoe UI", Arial';
      wrap(x, n.title, 20, 120 + i * 88, W - 40, 26, 2);
    });
    const p = store.prices; const t = store.tokens;
    x.fillStyle = '#000'; x.fillRect(0, H - 36, W, 36);
    x.font = 'bold 18px Consolas'; x.fillStyle = '#38f2a5';
    x.fillText(t.slice(0, 6).map((k) => `${k.sym} ${fmt.price(p[k.sym] ?? k.price)}`).join('   '), 12, H - 12);
  }, 1.0);
}

export function textScreen(lines: () => string[], title: string, color = '#38f2a5') {
  return makeScreen(768, 432, (x, W, H) => {
    x.fillStyle = '#070a12'; x.fillRect(0, 0, W, H);
    x.fillStyle = color; x.fillRect(0, 0, W, 6);
    x.fillStyle = color; x.font = 'bold 34px "Segoe UI", Arial'; x.textAlign = 'left'; x.fillText(title, 24, 52);
    x.fillStyle = '#e8eef8'; x.font = '24px "Segoe UI", Arial';
    lines().slice(0, 9).forEach((l, i) => { x.fillText(l.slice(0, 52), 24, 100 + i * 36); });
  });
}

function wrap(x: CanvasRenderingContext2D, text: string, px: number, py: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' ');
  let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (x.measureText(t).width > maxW && line) { x.fillText(line, px, py + n * lh); line = w; n++; if (n >= maxLines) return; }
    else line = t;
  }
  if (line && n < maxLines) x.fillText(line, px, py + n * lh);
}
