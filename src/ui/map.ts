// Minimap / city map renderer and road routing.

import { BLOCK, BLOCK_DISTRICT, COLS, DISTRICTS, FEATURES, ROAD_X, ROAD_Z, ROWS, blockOrigin, featureGeom, type InteriorKind } from '../../shared/city.js';
import type { CityBuild } from '../world/city.js';

export const ICONS: Partial<Record<InteriorKind, string>> = {
  exchange: '📈', tradingfirm: '💹', research: '🔬', whaleclub: '🐋', builderhub: '🛠', jobs: '💼', vctower: '🏦', hackhouse: '💻',
  defihub: '🌾', airdrop: '🪂', governance: '🏛', cafe: '☕', burger: '🍔', grill: '🍽', finedining: '🥂', club: '🎧', boutique: '👕',
  furniture: '🛋', nftgallery: '🖼', studio: '🎬', media: '📰', residence: '🏠', realestate: '🔑', convention: '🎤', dealership: '🚗',
  usedcars: '🚙', customs: '🔧', transport: '🚕',
};

const PAD = 60;
const minX = ROAD_X[0] - PAD, maxX = ROAD_X[ROAD_X.length - 1] + PAD;
const minZ = ROAD_Z[0] - PAD, maxZ = ROAD_Z[ROAD_Z.length - 1] + PAD;
const SCALE = 2; // px per meter in the base canvas

let base: HTMLCanvasElement | null = null;

export function buildBaseMap(city: CityBuild) {
  const c = document.createElement('canvas');
  c.width = (maxX - minX) * SCALE; c.height = (maxZ - minZ) * SCALE;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1d2a1e'; x.fillRect(0, 0, c.width, c.height);
  const P = (wx: number, wz: number) => [(wx - minX) * SCALE, (wz - minZ) * SCALE] as const;
  // roads
  x.fillStyle = '#2c3038';
  const [rx0, rz0] = P(ROAD_X[0] - 8, ROAD_Z[0] - 8);
  const [rx1, rz1] = P(ROAD_X[ROAD_X.length - 1] + 8, ROAD_Z[ROAD_Z.length - 1] + 8);
  x.fillRect(rx0, rz0, rx1 - rx0, rz1 - rz0);
  for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) {
    const [bx, bz] = blockOrigin(col, r);
    const d = BLOCK_DISTRICT[r][col];
    const [px, pz] = P(bx, bz);
    x.fillStyle = '#56585e'; x.fillRect(px, pz, BLOCK * SCALE, BLOCK * SCALE);
    x.fillStyle = d === 'park' ? '#2f5a2a' : shade(DISTRICTS[d].color, 0.28);
    x.fillRect(px + 4 * SCALE, pz + 4 * SCALE, (BLOCK - 8) * SCALE, (BLOCK - 8) * SCALE);
  }
  for (const fp of city.footprints) {
    const [px, pz] = P(fp.x - fp.w / 2, fp.z - fp.d / 2);
    x.fillStyle = fp.feature ? shade(DISTRICTS[fp.district].color, 0.75) : '#3a3e46';
    x.fillRect(px, pz, fp.w * SCALE, fp.d * SCALE);
  }
  // lane lines
  x.strokeStyle = 'rgba(232,185,35,0.35)'; x.lineWidth = 1;
  for (const rx of ROAD_X) { const [a, b] = P(rx, ROAD_Z[0]); const [, e] = P(rx, ROAD_Z[ROAD_Z.length - 1]); x.beginPath(); x.moveTo(a, b); x.lineTo(a, e); x.stroke(); }
  for (const rz of ROAD_Z) { const [a, b] = P(ROAD_X[0], rz); const [e] = P(ROAD_X[ROAD_X.length - 1], rz); x.beginPath(); x.moveTo(a, b); x.lineTo(e, b); x.stroke(); }
  base = c;
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(((n >> 16) & 255) * k) | 0},${(((n >> 8) & 255) * k) | 0},${((n & 255) * k) | 0})`;
}

export interface MapMarks {
  player: { x: number; z: number; heading: number };
  waypoint?: { x: number; z: number } | null;
  route?: { x: number; z: number }[] | null;
  others?: { x: number; z: number; friend?: boolean }[];
  ride?: { x: number; z: number } | null;
  pickup?: { x: number; z: number } | null;
}

/** Rotating, player-centred minimap. `yaw` = camera yaw (map rotates so camera-forward is up). */
export function drawMinimap(ctx: CanvasRenderingContext2D, size: number, marks: MapMarks, yaw: number, zoom = 1.6) {
  if (!base) return;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = '#16201a'; ctx.fillRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  // camera looks along F = (-sin yaw, -cos yaw) in world x/z (= canvas x/y); rotate so F points up
  const rot = -Math.PI / 2 - Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  ctx.rotate(rot);
  const s = zoom / SCALE;
  ctx.scale(s, s);
  const px = (marks.player.x - minX) * SCALE, pz = (marks.player.z - minZ) * SCALE;
  ctx.drawImage(base, -px, -pz);
  const W = (wx: number, wz: number) => [(wx - marks.player.x) * SCALE, (wz - marks.player.z) * SCALE] as const;
  if (marks.route && marks.route.length > 1) {
    ctx.strokeStyle = '#b46bff'; ctx.lineWidth = 6 / s * 0.6; ctx.lineJoin = 'round';
    ctx.beginPath();
    marks.route.forEach((p, i) => { const [a, b] = W(p.x, p.z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
    ctx.stroke();
  }
  ctx.font = `${22 / s * 0.6}px "Segoe UI Emoji", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const f of FEATURES) {
    const d = featureGeom(f).door;
    const [a, b] = W(d[0], d[2]);
    ctx.save(); ctx.translate(a, b); ctx.rotate(-rot);
    ctx.fillText(ICONS[f.kind] ?? '•', 0, 0); ctx.restore();
  }
  for (const o of marks.others ?? []) { const [a, b] = W(o.x, o.z); ctx.fillStyle = o.friend ? '#38f2a5' : '#4fb3ff'; ctx.beginPath(); ctx.arc(a, b, 5 / s * 0.6, 0, 7); ctx.fill(); }
  if (marks.ride) { const [a, b] = W(marks.ride.x, marks.ride.z); ctx.fillStyle = '#ffd23f'; ctx.fillRect(a - 6, b - 6, 12, 12); }
  if (marks.pickup) { const [a, b] = W(marks.pickup.x, marks.pickup.z); ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(a, b, 10, 0, 7); ctx.stroke(); }
  if (marks.waypoint) { const [a, b] = W(marks.waypoint.x, marks.waypoint.z); ctx.fillStyle = '#b46bff'; ctx.beginPath(); ctx.arc(a, b, 9 / s * 0.6, 0, 7); ctx.fill(); }
  ctx.restore();
  // player arrow (always up-ish relative to camera)
  ctx.save();
  ctx.translate(size / 2, size / 2);
  const H = marks.player.heading;
  ctx.rotate(Math.atan2(Math.cos(H), Math.sin(H)) + rot + Math.PI / 2);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); ctx.stroke();
}

/** Full north-up map. Returns a function converting canvas px -> world coords. */
export function drawFullMap(ctx: CanvasRenderingContext2D, W: number, H: number, marks: MapMarks) {
  if (!base) return (_x: number, _y: number) => ({ x: 0, z: 0 });
  const sc = Math.min(W / base.width, H / base.height);
  const ox = (W - base.width * sc) / 2, oy = (H - base.height * sc) / 2;
  ctx.fillStyle = '#0d1410'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(base, ox, oy, base.width * sc, base.height * sc);
  const P = (wx: number, wz: number) => [ox + (wx - minX) * SCALE * sc, oy + (wz - minZ) * SCALE * sc] as const;
  // district labels
  ctx.font = 'bold 11px "Segoe UI", Arial'; ctx.textAlign = 'center';
  const done = new Set<string>();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = BLOCK_DISTRICT[r][c];
    if (done.has(d)) continue; done.add(d);
    const [bx, bz] = blockOrigin(c, r);
    const [a, b] = P(bx + BLOCK / 2, bz + BLOCK / 2);
    const label = DISTRICTS[d].name.toUpperCase().replace(' DISTRICT', '');
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(5,8,14,0.7)'; ctx.fillRect(a - tw / 2, b - 9, tw, 16);
    ctx.fillStyle = DISTRICTS[d].color; ctx.fillText(label, a, b + 3);
  }
  if (marks.route && marks.route.length > 1) {
    ctx.strokeStyle = '#b46bff'; ctx.lineWidth = 4; ctx.beginPath();
    marks.route.forEach((p, i) => { const [a, b] = P(p.x, p.z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
    ctx.stroke();
  }
  ctx.font = '18px "Segoe UI Emoji", sans-serif'; ctx.textBaseline = 'middle';
  for (const f of FEATURES) { const d = featureGeom(f).door; const [a, b] = P(d[0], d[2]); ctx.fillText(ICONS[f.kind] ?? '•', a, b); }
  for (const o of marks.others ?? []) { const [a, b] = P(o.x, o.z); ctx.fillStyle = o.friend ? '#38f2a5' : '#4fb3ff'; ctx.beginPath(); ctx.arc(a, b, 5, 0, 7); ctx.fill(); }
  if (marks.waypoint) { const [a, b] = P(marks.waypoint.x, marks.waypoint.z); ctx.fillStyle = '#b46bff'; ctx.beginPath(); ctx.arc(a, b, 8, 0, 7); ctx.fill(); }
  const [pa, pb] = P(marks.player.x, marks.player.z);
  ctx.save(); ctx.translate(pa, pb); ctx.rotate(Math.PI - marks.player.heading);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 9); ctx.lineTo(0, 5); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  return (cx: number, cy: number) => ({ x: (cx - ox) / (SCALE * sc) + minX, z: (cy - oy) / (SCALE * sc) + minZ });
}

/** Road route between two world points (grid BFS over intersections). */
export function route(from: { x: number; z: number }, to: { x: number; z: number }) {
  const nearestNode = (p: { x: number; z: number }) => {
    let best: [number, number] = [0, 0], bd = Infinity;
    for (let i = 0; i < ROAD_X.length; i++) for (let j = 0; j < ROAD_Z.length; j++) {
      const d = Math.hypot(ROAD_X[i] - p.x, ROAD_Z[j] - p.z);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    return best;
  };
  const a = nearestNode(from), b = nearestNode(to);
  const key = (n: [number, number]) => n[0] + ',' + n[1];
  const prev = new Map<string, [number, number] | null>([[key(a), null]]);
  const q: [number, number][] = [a];
  while (q.length) {
    const n = q.shift()!;
    if (n[0] === b[0] && n[1] === b[1]) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m: [number, number] = [n[0] + di, n[1] + dj];
      if (m[0] < 0 || m[1] < 0 || m[0] >= ROAD_X.length || m[1] >= ROAD_Z.length || prev.has(key(m))) continue;
      prev.set(key(m), n); q.push(m);
    }
  }
  const path: { x: number; z: number }[] = [{ x: to.x, z: to.z }];
  let cur: [number, number] | null | undefined = b;
  while (cur) { path.push({ x: ROAD_X[cur[0]], z: ROAD_Z[cur[1]] }); cur = prev.get(key(cur)); }
  path.push({ x: from.x, z: from.z });
  return path.reverse();
}
