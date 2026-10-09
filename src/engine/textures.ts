// Procedural texture generation (all original, generated at runtime).

import * as THREE from 'three';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

let maxAniso = 4;
export function setMaxAnisotropy(n: number) { maxAniso = n; }

function tex(c: HTMLCanvasElement, color = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, seed: number, scale = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < w * h; i++) {
    const n = (r() - 0.5) * amp * scale;
    img.data[i * 4] = Math.max(0, Math.min(255, base[0] + n));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + n));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + n));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

// ---------------- ground ----------------
export const asphalt = () => cached('asphalt', () => {
  const [c, x] = canvas(512, 512);
  noiseFill(x, 512, 512, [52, 54, 58], 28, 11);
  const r = rng(5);
  // patches & cracks
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(${30 + r() * 30},${30 + r() * 30},${34 + r() * 30},0.25)`;
    x.beginPath(); x.ellipse(r() * 512, r() * 512, 10 + r() * 60, 6 + r() * 30, r() * 3, 0, Math.PI * 2); x.fill();
  }
  x.strokeStyle = 'rgba(20,20,22,0.5)'; x.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    x.beginPath(); let px = r() * 512, py = r() * 512; x.moveTo(px, py);
    for (let k = 0; k < 8; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  return tex(c);
});

/** Road segment texture: 16m wide, 16m long tile. u across, v along. */
export const roadMarkings = () => cached('roadmark', () => {
  const [c, x] = canvas(256, 256);
  x.clearRect(0, 0, 256, 256);
  const m = 256 / 16;
  // center double yellow
  x.fillStyle = '#e8b923';
  x.fillRect(8 * m - 0.35 * m, 0, 0.15 * m, 256);
  x.fillRect(8 * m + 0.2 * m, 0, 0.15 * m, 256);
  // lane dashes
  x.fillStyle = '#e9e9e4';
  for (const off of [4, 12]) for (let v = 0; v < 16; v += 4) x.fillRect(off * m - 0.07 * m, v * m, 0.14 * m, 2 * m);
  // edge lines
  x.fillRect(0.6 * m, 0, 0.12 * m, 256);
  x.fillRect(15.3 * m, 0, 0.12 * m, 256);
  const t = tex(c, true, true);
  return t;
});

export const crosswalk = () => cached('crosswalk', () => {
  const [c, x] = canvas(256, 64);
  x.clearRect(0, 0, 256, 64);
  x.fillStyle = 'rgba(235,235,230,0.92)';
  for (let i = 0; i < 16; i++) if (i % 2 === 0) x.fillRect(i * 16 + 2, 4, 12, 56);
  return tex(c, true, false);
});

export const sidewalk = () => cached('sidewalk', () => {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, [168, 166, 160], 16, 21);
  x.strokeStyle = 'rgba(90,90,88,0.55)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke();
  }
  const r = rng(3);
  for (let i = 0; i < 30; i++) { x.fillStyle = `rgba(80,80,70,${r() * 0.15})`; x.fillRect(r() * 256, r() * 256, 4 + r() * 20, 4 + r() * 20); }
  return tex(c);
});

export const grass = () => cached('grass', () => {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, [70, 108, 52], 40, 31);
  const r = rng(9);
  for (let i = 0; i < 2500; i++) {
    x.strokeStyle = `rgba(${40 + r() * 60},${90 + r() * 70},${30 + r() * 30},0.6)`;
    const px = r() * 256, py = r() * 256;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 3, py - 3 - r() * 4); x.stroke();
  }
  return tex(c);
});

export const dirt = () => cached('dirt', () => {
  const [c, x] = canvas(128, 128);
  noiseFill(x, 128, 128, [120, 104, 84], 30, 41);
  return tex(c);
});

// ---------------- facades ----------------
export type FacadeStyle = 'glass' | 'marble' | 'brick' | 'neon' | 'concrete' | 'villa' | 'industrial' | 'residential';
export const FACADE_TILE = { w: 12.8, h: 14.4 }; // 4 columns x 4 floors

export function facade(style: FacadeStyle, seed = 1) {
  return {
    map: cached('fac_' + style + seed, () => facadeCanvas(style, seed, false)),
    emissive: cached('face_' + style + seed, () => facadeCanvas(style, seed, true)),
  };
}

function facadeCanvas(style: FacadeStyle, seed: number, emissive: boolean) {
  const W = 512, H = 576;
  const [c, x] = canvas(W, H);
  const r = rng(seed * 97 + style.length * 13);
  const cols = 4, floors = 4;
  const cw = W / cols, fh = H / floors;
  const pal: Record<FacadeStyle, { wall: [number, number, number]; win: string; frame: string; inset: number; winH: number }> = {
    glass: { wall: [40, 58, 78], win: '#28425e', frame: '#8fa3b5', inset: 0.04, winH: 0.88 },
    marble: { wall: [220, 214, 200], win: '#2b3644', frame: '#b8ae98', inset: 0.2, winH: 0.66 },
    brick: { wall: [138, 64, 46], win: '#26303a', frame: '#e4dccb', inset: 0.22, winH: 0.58 },
    neon: { wall: [26, 24, 34], win: '#1b2030', frame: '#3a3550', inset: 0.12, winH: 0.6 },
    concrete: { wall: [150, 150, 146], win: '#2a3440', frame: '#6b6f72', inset: 0.16, winH: 0.6 },
    villa: { wall: [236, 232, 222], win: '#2f3a46', frame: '#ffffff', inset: 0.25, winH: 0.6 },
    industrial: { wall: [96, 102, 108], win: '#2c343c', frame: '#4b5056', inset: 0.15, winH: 0.4 },
    residential: { wall: [196, 170, 140], win: '#2b3542', frame: '#efe6d6', inset: 0.2, winH: 0.58 },
  };
  const p = pal[style];
  if (emissive) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); }
  else {
    noiseFill(x, W, H, p.wall, style === 'glass' ? 8 : 22, seed + 3);
    if (style === 'brick') {
      x.strokeStyle = 'rgba(70,40,30,0.45)'; x.lineWidth = 1;
      for (let yy = 0; yy < H; yy += 8) {
        x.beginPath(); x.moveTo(0, yy); x.lineTo(W, yy); x.stroke();
        for (let xx = (yy / 8) % 2 ? 0 : 12; xx < W; xx += 24) { x.beginPath(); x.moveTo(xx, yy); x.lineTo(xx, yy + 8); x.stroke(); }
      }
    }
    if (style === 'industrial') {
      x.strokeStyle = 'rgba(40,44,48,0.5)';
      for (let xx = 0; xx < W; xx += 10) { x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, H); x.stroke(); }
    }
    // floor slabs
    x.fillStyle = 'rgba(0,0,0,0.18)';
    for (let f = 0; f < floors; f++) x.fillRect(0, f * fh, W, 4);
  }
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      const ix = col * cw + cw * p.inset;
      const iw = cw * (1 - p.inset * 2);
      const ih = fh * p.winH;
      const iy = f * fh + (fh - ih) * 0.55;
      const lit = r() < (style === 'industrial' ? 0.25 : 0.42);
      const warm = r();
      if (emissive) {
        if (lit) {
          const cl = warm < 0.6 ? `rgb(255,${200 + r() * 40},${130 + r() * 50})` : warm < 0.85 ? `rgb(220,235,255)` : `rgb(160,${200 + r() * 50},255)`;
          x.fillStyle = cl;
          x.globalAlpha = 0.55 + r() * 0.45;
          x.fillRect(ix + 2, iy + 2, iw - 4, ih - 4);
          // blinds / silhouettes
          x.globalAlpha = 0.35;
          x.fillStyle = '#000';
          if (r() < 0.4) for (let b = 0; b < ih; b += 6) x.fillRect(ix + 2, iy + b, iw - 4, 2);
          if (r() < 0.3) x.fillRect(ix + iw * 0.3, iy + ih * 0.35, iw * 0.12, ih * 0.65);
          x.globalAlpha = 1;
        }
        if (style === 'neon' && col === 0) {
          x.fillStyle = r() < 0.5 ? '#ff2f9a' : '#2fe6ff';
          x.fillRect(0, f * fh + fh - 6, W, 3);
        }
      } else {
        x.fillStyle = p.frame;
        x.fillRect(ix - 3, iy - 3, iw + 6, ih + 6);
        const grd = x.createLinearGradient(ix, iy, ix + iw, iy + ih);
        grd.addColorStop(0, shade(p.win, 1.25));
        grd.addColorStop(0.5, p.win);
        grd.addColorStop(1, shade(p.win, 0.75));
        x.fillStyle = grd;
        x.fillRect(ix, iy, iw, ih);
        // reflections
        x.fillStyle = 'rgba(255,255,255,0.07)';
        x.beginPath(); x.moveTo(ix, iy + ih); x.lineTo(ix + iw * 0.5, iy); x.lineTo(ix + iw * 0.7, iy); x.lineTo(ix + iw * 0.2, iy + ih); x.fill();
        x.fillStyle = p.frame;
        if (style === 'glass') { x.fillRect(ix + iw / 2 - 1, iy, 2, ih); }
        else { x.fillRect(ix + iw / 2 - 2, iy, 4, ih); x.fillRect(ix, iy + ih * 0.35, iw, 3); }
        if (style === 'brick' || style === 'residential' || style === 'villa') { x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(ix - 5, iy + ih + 3, iw + 10, 5); }
      }
    }
  }
  return tex(c, true);
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * k), g = Math.min(255, ((n >> 8) & 255) * k), b = Math.min(255, (n & 255) * k);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// ---------------- interior surfaces ----------------
export const woodFloor = (tone = 0) => cached('wood' + tone, () => {
  const [c, x] = canvas(512, 512);
  const bases: [number, number, number][] = [[150, 108, 70], [96, 64, 42], [196, 160, 118], [70, 50, 40]];
  const b = bases[tone % bases.length];
  const r = rng(77 + tone);
  for (let row = 0; row < 8; row++) {
    let xx = -r() * 200;
    while (xx < 512) {
      const len = 120 + r() * 200;
      const k = 0.85 + r() * 0.3;
      x.fillStyle = `rgb(${b[0] * k},${b[1] * k},${b[2] * k})`;
      x.fillRect(xx, row * 64, len, 64);
      for (let gl = 0; gl < 10; gl++) {
        x.strokeStyle = `rgba(40,25,15,${0.08 + r() * 0.1})`;
        x.beginPath(); const gy = row * 64 + r() * 64; x.moveTo(xx, gy); x.bezierCurveTo(xx + len / 3, gy + (r() - 0.5) * 10, xx + len * 0.6, gy + (r() - 0.5) * 10, xx + len, gy); x.stroke();
      }
      x.fillStyle = 'rgba(20,12,6,0.6)'; x.fillRect(xx, row * 64, 2, 64);
      xx += len;
    }
    x.fillStyle = 'rgba(20,12,6,0.6)'; x.fillRect(0, row * 64, 512, 2);
  }
  return tex(c);
});

export const marble = (dark = false) => cached('marble' + dark, () => {
  const [c, x] = canvas(512, 512);
  x.fillStyle = dark ? '#1b1c20' : '#ecebe6'; x.fillRect(0, 0, 512, 512);
  const r = rng(dark ? 3 : 4);
  for (let i = 0; i < 40; i++) {
    x.strokeStyle = dark ? `rgba(200,180,120,${0.08 + r() * 0.15})` : `rgba(120,120,130,${0.06 + r() * 0.14})`;
    x.lineWidth = 0.5 + r() * 2;
    x.beginPath(); let px = r() * 512, py = r() * 512; x.moveTo(px, py);
    for (let k = 0; k < 12; k++) { px += (r() - 0.3) * 60; py += (r() - 0.5) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  x.strokeStyle = dark ? 'rgba(0,0,0,0.5)' : 'rgba(160,160,160,0.35)'; x.lineWidth = 1;
  for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * 256, 0); x.lineTo(i * 256, 512); x.stroke(); x.beginPath(); x.moveTo(0, i * 256); x.lineTo(512, i * 256); x.stroke(); }
  return tex(c);
});

export const tiles = (color = '#e8ecef', grout = '#9aa3aa', n = 8) => cached('tiles' + color + n, () => {
  const [c, x] = canvas(256, 256);
  x.fillStyle = grout; x.fillRect(0, 0, 256, 256);
  const s = 256 / n;
  const r = rng(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    x.fillStyle = color; x.globalAlpha = 0.9 + r() * 0.1; x.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
  }
  x.globalAlpha = 1;
  return tex(c);
});

export const checker = (a = '#f2f2f2', b = '#1c1c1f') => cached('chk' + a + b, () => {
  const [c, x] = canvas(256, 256);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? a : b; x.fillRect(i * 32, j * 32, 32, 32); }
  return tex(c);
});

export const carpet = (color: [number, number, number]) => cached('carpet' + color.join(), () => {
  const [c, x] = canvas(128, 128);
  noiseFill(x, 128, 128, color, 24, color[0] + color[1]);
  return tex(c);
});

export const plaster = (color: [number, number, number]) => cached('plaster' + color.join(), () => {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, color, 8, color[2] + 7);
  return tex(c);
});

export const concreteFloor = () => cached('concf', () => {
  const [c, x] = canvas(256, 256);
  noiseFill(x, 256, 256, [128, 128, 126], 18, 55);
  const r = rng(8);
  for (let i = 0; i < 25; i++) { x.fillStyle = `rgba(60,60,60,${r() * 0.12})`; x.beginPath(); x.ellipse(r() * 256, r() * 256, 10 + r() * 40, 10 + r() * 30, 0, 0, 7); x.fill(); }
  x.strokeStyle = 'rgba(50,50,50,0.4)'; x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
  return tex(c);
});

export const fabric = (color: string) => cached('fab' + color, () => {
  // subtle woven noise around the base colour (no visible grid)
  const [c, x] = canvas(128, 128);
  const col = parseInt(color.slice(1), 16);
  noiseFill(x, 128, 128, [(col >> 16) & 255, (col >> 8) & 255, col & 255], 14, col & 1023);
  x.globalAlpha = 0.05;
  for (let i = 0; i < 128; i += 2) { x.fillStyle = '#000'; x.fillRect(i, 0, 1, 128); }
  x.globalAlpha = 1;
  const t = tex(c);
  t.repeat.set(3, 3);
  return t;
});

// ---------------- signs, screens, art ----------------
export function signTexture(text: string, color: string, bg = 'rgba(0,0,0,0)', font = 'bold 72px "Segoe UI", Arial, sans-serif', w = 1024, h = 160) {
  const [c, x] = canvas(w, h);
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.font = font;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)?.[1] ?? '72');
  while (x.measureText(text).width > w * 0.92 && size > 12) { size -= 4; x.font = font.replace(/\d+px/, size + 'px'); }
  x.shadowColor = color; x.shadowBlur = 24;
  x.fillStyle = color;
  x.fillText(text, w / 2, h / 2 + 4);
  x.shadowBlur = 0;
  x.fillStyle = '#ffffff'; x.globalAlpha = 0.55;
  x.fillText(text, w / 2, h / 2 + 4);
  x.globalAlpha = 1;
  return tex(c, true, false);
}

export function artTexture(seed: number) {
  return cached('art' + seed, () => {
    const [c, x] = canvas(256, 256);
    const r = rng(seed * 31 + 7);
    const hue = r() * 360;
    const grd = x.createLinearGradient(0, 0, 256, 256);
    grd.addColorStop(0, `hsl(${hue},60%,${20 + r() * 30}%)`);
    grd.addColorStop(1, `hsl(${(hue + 120) % 360},60%,${30 + r() * 30}%)`);
    x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
    const kind = Math.floor(r() * 3);
    for (let i = 0; i < 30; i++) {
      x.fillStyle = `hsla(${(hue + r() * 180) % 360},80%,${40 + r() * 40}%,${0.3 + r() * 0.6})`;
      if (kind === 0) { x.beginPath(); x.arc(r() * 256, r() * 256, 5 + r() * 50, 0, 7); x.fill(); }
      else if (kind === 1) { x.fillRect(Math.floor(r() * 16) * 16, Math.floor(r() * 16) * 16, 16 * (1 + Math.floor(r() * 4)), 16 * (1 + Math.floor(r() * 4))); }
      else { x.save(); x.translate(128, 128); x.rotate(r() * 6.28); x.fillRect(0, 0, 10 + r() * 100, 4 + r() * 10); x.restore(); }
    }
    return tex(c, true, false);
  });
}

export function skylineTexture(night: boolean) {
  return cached('skyline' + night, () => {
    const [c, x] = canvas(1024, 512);
    const grd = x.createLinearGradient(0, 0, 0, 512);
    if (night) { grd.addColorStop(0, '#05070f'); grd.addColorStop(0.7, '#1a2140'); grd.addColorStop(1, '#3a2a40'); }
    else { grd.addColorStop(0, '#6aa6e8'); grd.addColorStop(0.7, '#bcd8f2'); grd.addColorStop(1, '#e8eef2'); }
    x.fillStyle = grd; x.fillRect(0, 0, 1024, 512);
    const r = rng(night ? 2 : 1);
    for (let layer = 0; layer < 3; layer++) {
      let xx = 0;
      while (xx < 1024) {
        const bw = 30 + r() * 70, bh = 80 + r() * (layer === 2 ? 300 : 200);
        const shadeV = night ? 10 + layer * 8 : 120 - layer * 30;
        x.fillStyle = `rgb(${shadeV},${shadeV + 5},${shadeV + 15})`;
        x.fillRect(xx, 512 - bh, bw, bh);
        for (let wy = 512 - bh + 6; wy < 506; wy += 9) for (let wx = xx + 4; wx < xx + bw - 4; wx += 7) {
          if (r() < (night ? 0.35 : 0.15)) { x.fillStyle = night ? `rgba(255,${200 + r() * 50},140,${0.6 + r() * 0.4})` : 'rgba(30,40,60,0.4)'; x.fillRect(wx, wy, 3, 4); }
        }
        xx += bw + r() * 6;
      }
    }
    return tex(c, true, false);
  });
}

export function noiseNormal() {
  return cached('nnorm', () => {
    const [c, x] = canvas(128, 128);
    const img = x.createImageData(128, 128);
    const r = rng(99);
    for (let i = 0; i < 128 * 128; i++) {
      img.data[i * 4] = 128 + (r() - 0.5) * 30;
      img.data[i * 4 + 1] = 128 + (r() - 0.5) * 30;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return tex(c, false);
  });
}

/** Dynamic canvas texture (screens, tickers) — caller redraws and sets needsUpdate. */
export function dynamicCanvas(w: number, h: number) {
  const [c, x] = canvas(w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { canvas: c, ctx: x, texture: t };
}
