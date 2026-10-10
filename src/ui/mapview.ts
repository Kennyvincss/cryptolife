// Full-screen interactive city map (GTA-style): drag to pan, wheel / pinch /
// buttons to zoom, tap a place or any spot for an info card, set or clear a GPS
// destination, search the place list, recentre on the player.

import { DISTRICTS, FEATURES, districtAt, featureGeom } from '../../shared/city.js';
import { h, add } from './dom.js';
import { ICONS, mapBase, type MapMarks } from './map.js';

export interface Place { id: string; name: string; sub: string; icon: string; x: number; z: number }

function places(): Place[] {
  const out: Place[] = FEATURES.map((f) => {
    const d = featureGeom(f).door;
    const dist = districtAt(d[0], d[2] - 3) ?? districtAt(d[0], d[2] + 3);
    return { id: f.zone, name: f.name, sub: (dist ? DISTRICTS[dist].name : 'Crypto City') + ' · ' + f.blurb, icon: ICONS[f.kind] ?? '•', x: d[0], z: d[2] };
  });
  out.push({ id: 'beach', name: 'Satoshi Beach', sub: 'Seafront · boardwalk, sand and surf', icon: '🏖', x: 60, z: 218 });
  out.push({ id: 'pier', name: 'Genesis Pier', sub: 'Seafront · walk out over the ocean', icon: '⚓', x: 0, z: 280 });
  return out;
}

export class MapView {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private list: HTMLElement;
  private card: HTMLElement;
  private search: HTMLInputElement;
  private cx = 0; private cz = 0; private zoom = 1.6; // px per metre
  private sel: Place | null = null;
  private all = places();
  private ptrs = new Map<number, { x: number; y: number }>();
  private drag = { moved: false, sx: 0, sy: 0, pinch: 0 };
  open = false;
  marks: () => MapMarks = () => ({ player: { x: 0, z: 0, heading: 0 } });
  onDestination?: (x: number, z: number, label: string) => void;
  onClear?: () => void;
  onClose?: () => void;

  constructor() {
    this.canvas = h('canvas.mv-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.search = h('input.mv-search', { placeholder: 'Search places…', oninput: () => this.renderList() }) as HTMLInputElement;
    this.list = h('div.mv-list');
    this.card = h('div.mv-card');
    const zoomBtn = (lbl: string, f: number) => h('button.mv-btn', { onclick: () => this.zoomBy(f) }, lbl);
    this.el = h('div.mapview',
      this.canvas,
      h('div.mv-side', h('div.mv-title', h('b', 'CRYPTO CITY'), h('button.mv-x', { onclick: () => this.onClose?.() }, '✕')), this.search, this.list),
      h('div.mv-tools', zoomBtn('+', 1.5), zoomBtn('−', 1 / 1.5), h('button.mv-btn', { title: 'Centre on me', onclick: () => this.centreOnPlayer() }, '◎')),
      this.card,
    );
    this.el.style.display = 'none';
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.ptrs.size === 1) this.drag = { moved: false, sx: e.offsetX, sy: e.offsetY, pinch: 0 };
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.ptrs.get(e.pointerId);
      if (!prev) return;
      const sc = this.pxScale();
      if (this.ptrs.size >= 2) {
        this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        const [a, b] = [...this.ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.drag.pinch) this.zoomBy(d / this.drag.pinch, ((a.x + b.x) / 2) * sc, ((a.y + b.y) / 2) * sc);
        this.drag.pinch = d; this.drag.moved = true;
        return;
      }
      const dx = (e.offsetX - prev.x) * sc, dy = (e.offsetY - prev.y) * sc;
      if (Math.hypot(e.offsetX - this.drag.sx, e.offsetY - this.drag.sy) > 6) this.drag.moved = true;
      if (this.drag.moved) { this.cx -= dx / this.zoom; this.cz -= dy / this.zoom; this.draw(); }
      this.ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    });
    const up = (e: PointerEvent) => {
      const was = this.ptrs.has(e.pointerId);
      this.ptrs.delete(e.pointerId);
      if (this.ptrs.size < 2) this.drag.pinch = 0;
      if (was && !this.drag.moved && this.ptrs.size === 0) this.tap(e.offsetX * this.pxScale(), e.offsetY * this.pxScale());
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX * this.pxScale(), e.offsetY * this.pxScale()); }, { passive: false });
    window.addEventListener('resize', () => { if (this.open) this.fit(); });
  }

  /** canvas px per CSS px (canvas backing store vs displayed size) */
  private pxScale() { return this.canvas.width / Math.max(1, this.canvas.clientWidth); }

  private fit() {
    const r = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(200, this.canvas.clientWidth * r);
    this.canvas.height = Math.max(200, this.canvas.clientHeight * r);
    this.draw();
  }

  show() {
    this.open = true;
    this.el.style.display = 'block';
    const m = this.marks();
    this.cx = m.player.x; this.cz = m.player.z;
    this.zoom = 2.2 * Math.min(2, window.devicePixelRatio || 1);
    this.search.value = '';
    this.sel = null;
    this.renderCard();
    this.renderList();
    requestAnimationFrame(() => this.fit());
  }
  hide() { this.open = false; this.el.style.display = 'none'; }

  private zoomBy(f: number, px?: number, py?: number) {
    const W = this.canvas.width, H = this.canvas.height;
    px ??= W / 2; py ??= H / 2;
    const wx = this.cx + (px - W / 2) / this.zoom, wz = this.cz + (py - H / 2) / this.zoom;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.zoom = Math.max(0.4 * dpr, Math.min(12 * dpr, this.zoom * f));
    this.cx = wx - (px - W / 2) / this.zoom; this.cz = wz - (py - H / 2) / this.zoom;
    this.draw();
  }

  private centreOnPlayer() { const m = this.marks(); this.cx = m.player.x; this.cz = m.player.z; this.draw(); }

  private S(wx: number, wz: number): [number, number] {
    return [(wx - this.cx) * this.zoom + this.canvas.width / 2, (wz - this.cz) * this.zoom + this.canvas.height / 2];
  }

  private tap(px: number, py: number) {
    const W = this.canvas.width, H = this.canvas.height;
    const wx = this.cx + (px - W / 2) / this.zoom, wz = this.cz + (py - H / 2) / this.zoom;
    let best: Place | null = null, bd = 26 * Math.min(2, window.devicePixelRatio || 1);
    for (const p of this.all) { const [a, b] = this.S(p.x, p.z); const d = Math.hypot(a - px, b - py); if (d < bd) { bd = d; best = p; } }
    if (!best) {
      const dist = districtAt(wx, wz);
      best = { id: 'pin', name: 'Dropped pin', sub: dist ? DISTRICTS[dist].name : wz > 200 ? 'Satoshi Beach' : 'Crypto City', icon: '📍', x: wx, z: wz };
    }
    this.select(best, false);
  }

  private select(p: Place, centre: boolean) {
    this.sel = p;
    if (centre) { this.cx = p.x; this.cz = p.z; if (this.zoom < 3) this.zoom = 3 * Math.min(2, window.devicePixelRatio || 1); }
    this.renderCard();
    this.draw();
  }

  private renderCard() {
    this.card.innerHTML = '';
    const m = this.marks();
    if (!this.sel) {
      this.card.style.display = m.waypoint ? 'flex' : 'none';
      if (m.waypoint) add(this.card, h('div.mv-info', h('b', 'Destination set'), h('small', 'Follow the purple route.')), h('button.mv-act.ghost', { onclick: () => { this.onClear?.(); this.renderCard(); this.draw(); } }, 'Clear'));
      return;
    }
    const p = this.sel;
    const dist = Math.hypot(p.x - m.player.x, p.z - m.player.z);
    this.card.style.display = 'flex';
    add(this.card,
      h('div.mv-ic', p.icon),
      h('div.mv-info', h('b', p.name), h('small', p.sub), h('small.muted', `${dist < 1000 ? Math.round(dist) + ' m' : (dist / 1000).toFixed(1) + ' km'} away`)),
      h('button.mv-act', { onclick: () => { this.onDestination?.(p.x, p.z, p.name); this.sel = null; this.renderCard(); this.draw(); } }, 'Set destination'),
      m.waypoint ? h('button.mv-act.ghost', { onclick: () => { this.onClear?.(); this.renderCard(); this.draw(); } }, 'Clear') : null,
    );
  }

  private renderList() {
    const q = this.search.value.trim().toLowerCase();
    const m = this.marks();
    const items = this.all.filter((p) => !q || (p.name + ' ' + p.sub).toLowerCase().includes(q))
      .sort((a, b) => Math.hypot(a.x - m.player.x, a.z - m.player.z) - Math.hypot(b.x - m.player.x, b.z - m.player.z));
    this.list.innerHTML = '';
    add(this.list, items.map((p) => h('div.mv-item', { onclick: () => this.select(p, true) }, h('span.mv-ic', p.icon), h('div', h('b', p.name), h('small', p.sub.split(' · ')[0])))));
  }

  /** Redraw (called on interaction and every frame while open). */
  draw() {
    if (!this.open) return;
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const mb = mapBase();
    const m = this.marks();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#16301f'; ctx.fillRect(0, 0, W, H);
    // ocean beyond the map image to the south
    const [, seaY] = this.S(0, mb.maxZ);
    ctx.fillStyle = '#1f5f7a'; ctx.fillRect(0, Math.max(0, seaY), W, H);
    if (mb.img) {
      const [x0, y0] = this.S(mb.minX, mb.minZ);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mb.img, x0, y0, (mb.img.width / mb.scale) * this.zoom, (mb.img.height / mb.scale) * this.zoom);
    }
    // district names
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (m.route && m.route.length > 1) {
      ctx.strokeStyle = '#b46bff'; ctx.lineWidth = 5 * dpr; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); m.route.forEach((p, i) => { const [a, b] = this.S(p.x, p.z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke();
    }
    // places
    const big = this.zoom / dpr > 1.6;
    for (const p of this.all) {
      const [a, b] = this.S(p.x, p.z);
      if (a < -40 || b < -40 || a > W + 40 || b > H + 40) continue;
      const sel = this.sel === p;
      ctx.fillStyle = sel ? '#b46bff' : 'rgba(10,12,20,0.78)';
      ctx.beginPath(); ctx.arc(a, b, (sel ? 17 : 13) * dpr, 0, 7); ctx.fill();
      ctx.font = `${15 * dpr}px "Segoe UI Emoji", sans-serif`;
      ctx.fillText(p.icon, a, b + dpr);
      if (big || sel) {
        ctx.font = `bold ${11 * dpr}px "Segoe UI", Arial`;
        const tw = ctx.measureText(p.name).width + 10 * dpr;
        ctx.fillStyle = 'rgba(10,12,20,0.78)'; ctx.fillRect(a - tw / 2, b + 16 * dpr, tw, 16 * dpr);
        ctx.fillStyle = '#fff'; ctx.fillText(p.name, a, b + 24 * dpr);
      }
    }
    if (this.sel?.id === 'pin') { const [a, b] = this.S(this.sel.x, this.sel.z); ctx.font = `${26 * dpr}px "Segoe UI Emoji", sans-serif`; ctx.fillText('📍', a, b - 12 * dpr); }
    for (const o of m.others ?? []) { const [a, b] = this.S(o.x, o.z); ctx.fillStyle = o.friend ? '#38f2a5' : '#4fb3ff'; ctx.beginPath(); ctx.arc(a, b, 6 * dpr, 0, 7); ctx.fill(); }
    if (m.waypoint) { const [a, b] = this.S(m.waypoint.x, m.waypoint.z); ctx.fillStyle = '#b46bff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * dpr; ctx.beginPath(); ctx.arc(a, b, 10 * dpr, 0, 7); ctx.fill(); ctx.stroke(); }
    // player
    const [pa, pb] = this.S(m.player.x, m.player.z);
    ctx.save(); ctx.translate(pa, pb); ctx.rotate(Math.PI - m.player.heading); ctx.scale(dpr, dpr);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(9, 10); ctx.lineTo(0, 5); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
