// Normalises an arbitrary car glTF into the game's car format:
//   body_{paint,glass,trim,chrome,head,brake}, doorL_* / doorR_* (relative to the hinge),
//   wheel_{rim,tyre} (one wheel at the origin, axle along X), plus extras with
//   wheel centres, radius, seat and size. Forward = +Z, up = +Y, ground at y = 0,
//   driver (left) side = +X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { load } from '/__carproc/inspect.js';

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

function avgTexColor(tex) {
  try {
    const img = tex.image; if (!img || !img.width) return null;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < 64; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
    return new THREE.Color().setRGB(r / 64 / 255, g / 64 / 255, b / 64 / 255, THREE.SRGBColorSpace);
  } catch { return null; }
}

const texCache = new Map();
function texData(tex) {
  if (texCache.has(tex)) return texCache.get(tex);
  let d = null;
  try {
    const img = tex.image; const w = Math.min(256, img.width), h = Math.min(256, img.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h);
    d = { w, h, px: x.getImageData(0, 0, w, h).data, flipY: tex.flipY };
  } catch { d = null; }
  texCache.set(tex, d);
  return d;
}
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function sample(d, u, v, out) {
  u = u - Math.floor(u); v = v - Math.floor(v);
  if (d.flipY) v = 1 - v;
  const x = Math.min(d.w - 1, Math.floor(u * d.w)), y = Math.min(d.h - 1, Math.floor(v * d.h));
  const i = (y * d.w + x) * 4;
  out[0] = toLin(d.px[i] / 255); out[1] = toLin(d.px[i + 1] / 255); out[2] = toLin(d.px[i + 2] / 255);
  return out;
}

/** Triangle soup: Float32 positions (9 per tri), per-tri material index, per-vertex linear colour (material × texture × vertex colour). */
function collect(scene) {
  const mats = [], matIdx = new Map();
  const pos = [], tm = [], vcol = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry;
    const P = g.getAttribute('position'), C = g.getAttribute('color'), I = g.index, UV = g.getAttribute('uv');
    const tc = [1, 1, 1];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
    const v = new THREE.Vector3();
    for (const gr of groups) {
      const m = ms[gr.materialIndex ?? 0] ?? ms[0];
      if (!matIdx.has(m)) { matIdx.set(m, mats.length); mats.push(m); }
      const mi = matIdx.get(m);
      for (let k = gr.start; k < gr.start + gr.count; k += 3) {
        for (let j = 0; j < 3; j++) {
          const vi = I ? I.getX(k + j) : k + j;
          v.fromBufferAttribute(P, vi).applyMatrix4(o.matrixWorld);
          pos.push(v.x, v.y, v.z);
          const mc = m.color ?? new THREE.Color(1, 1, 1);
          let r = mc.r, gg = mc.g, bb = mc.b;
          const td = m.map && UV ? texData(m.map) : null;
          if (td) { sample(td, UV.getX(vi), UV.getY(vi), tc); r *= tc[0]; gg *= tc[1]; bb *= tc[2]; }
          if (C) { r *= C.getX(vi); gg *= C.getY(vi); bb *= C.getZ(vi); }
          vcol.push(r, gg, bb);
        }
        tm.push(mi);
      }
    }
  });
  return { pos: new Float32Array(pos), tm: Int32Array.from(tm), vcol: new Float32Array(vcol), mats };
}

function transform(soup, fn) { const v = new THREE.Vector3(); for (let i = 0; i < soup.pos.length; i += 3) { v.set(soup.pos[i], soup.pos[i + 1], soup.pos[i + 2]); fn(v); soup.pos[i] = v.x; soup.pos[i + 1] = v.y; soup.pos[i + 2] = v.z; } }
function bbox(soup, tris) {
  const b = new THREE.Box3(), v = new THREE.Vector3();
  const it = tris ?? { length: soup.tm.length };
  const n = tris ? tris.length : soup.tm.length;
  for (let t = 0; t < n; t++) { const ti = tris ? tris[t] : t; for (let j = 0; j < 3; j++) { const o = ti * 9 + j * 3; v.set(soup.pos[o], soup.pos[o + 1], soup.pos[o + 2]); b.expandByPoint(v); } }
  return b;
}

/** Connected components (by shared, welded vertex positions) within each material. */
function components(soup) {
  const n = soup.tm.length;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const key = new Map();
  for (let t = 0; t < n; t++) for (let j = 0; j < 3; j++) {
    const o = t * 9 + j * 3;
    const k = soup.tm[t] + ':' + Math.round(soup.pos[o] * 2000) + ',' + Math.round(soup.pos[o + 1] * 2000) + ',' + Math.round(soup.pos[o + 2] * 2000);
    const prev = key.get(k);
    if (prev === undefined) key.set(k, t); else { const a = find(prev), b = find(t); if (a !== b) parent[a] = b; }
  }
  const groups = new Map();
  for (let t = 0; t < n; t++) { const r = find(t); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(t); }
  return [...groups.values()].map((tris) => ({ tris, box: bbox(soup, tris), mat: soup.tm[tris[0]] }));
}

function classify(m, cfg, centroidZ) {
  const n = (m.name || '').toLowerCase();
  const col = (m.color ?? new THREE.Color(1, 1, 1)).clone();
  if (m.map) { const a = avgTexColor(m.map); if (a) col.multiply(a); }
  const transparent = (m.transparent && (m.opacity ?? 1) < 0.95) || m.transmission > 0.3 || m.alphaMode === 'BLEND';
  if (cfg.paint?.some((p) => n.includes(p.toLowerCase()))) return { role: 'paint', col };
  if (cfg.notPaint?.some((p) => n.includes(p.toLowerCase()))) { /* fallthrough */ }
  if (/head|front.?l|lamp_f|drl|indicator|blinker|turn|signal/.test(n) && /light|lamp|led|drl|indicator|blinker|signal/.test(n)) return { role: 'head', col };
  if (/tail|brake|rear.?l|stop/.test(n) && /light|lamp|led/.test(n)) return { role: 'brake', col };
  if (/light|lamp|led/.test(n)) return { role: centroidZ > 0 ? 'head' : 'brake', col };
  if (transparent || /glass|window|windshield|windscreen|screen/.test(n)) return { role: 'glass', col };
  if (/paint|carpaint|car_paint|body_col|bodycol|exterior|^body$/.test(n) && !cfg.notPaint?.some((p) => n.includes(p.toLowerCase()))) return { role: 'paint', col };
  if ((m.metalness ?? 0) > 0.6 && lum(col) > 0.35) return { role: 'chrome', col, metal: m.metalness, rough: m.roughness };
  return { role: 'trim', col, metal: m.metalness ?? 0, rough: m.roughness ?? 0.6 };
}

function buildGeo(soup, tris, colorOf, offset) {
  const n = tris.length;
  const P = new Float32Array(n * 9), C = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const ti = tris[t];
    const c = colorOf(ti);
    for (let j = 0; j < 9; j++) P[t * 9 + j] = soup.pos[ti * 9 + j] - (offset ? offset.getComponent(j % 3) : 0);
    for (let j = 0; j < 9; j++) C[t * 9 + j] = soup.vcol[ti * 9 + j];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

export async function info(file) {
  const scene = await load(file);
  const soup = collect(scene);
  const b = bbox(soup);
  const area = new Map();
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < soup.tm.length; t++) { const o = t * 9; a.fromArray(soup.pos, o); bb.fromArray(soup.pos, o + 3); c.fromArray(soup.pos, o + 6); const ar = bb.sub(a).cross(c.sub(a)).length() / 2; area.set(soup.tm[t], (area.get(soup.tm[t]) ?? 0) + ar); }
  return { tris: soup.tm.length, size: b.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3)), min: b.min.toArray().map((x) => +x.toFixed(3)),
    mats: soup.mats.map((m, i) => ({ i, name: m.name, color: '#' + (m.color?.getHexString() ?? 'ffffff'), map: !!m.map, metal: m.metalness, rough: m.roughness, transp: m.transparent, op: m.opacity, area: +(area.get(i) ?? 0).toFixed(4) })) };
}

/**
 * cfg: { file, fwd: '+z'|'-z'|'+x'|'-x', length (m), doors: 2|4, doorLen?, archK?, seatY?, paintHex?, noDoors? }
 */
export async function process(cfg) {
  const scene = await load(cfg.file);
  const soup = collect(scene);
  const rot = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[cfg.fwd ?? '+z'];
  const up = cfg.up ?? '+y';
  transform(soup, (v) => { if (up === '+z') v.set(v.x, v.z, -v.y); if (up === '-z') v.set(v.x, -v.z, v.y); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot); });
  let b = bbox(soup);
  const s = cfg.length / (b.max.z - b.min.z);
  const ctr = b.getCenter(new THREE.Vector3());
  transform(soup, (v) => { v.x = (v.x - ctr.x) * s; v.z = (v.z - ctr.z) * s; v.y = (v.y - b.min.y) * s; });
  b = bbox(soup);
  const size = b.getSize(new THREE.Vector3());

  const comps = components(soup);
  // ---- wheels: circular, ground-touching components in each corner
  const quads = { FL: [], FR: [], RL: [], RR: [] };
  for (const c of comps) {
    const sz = c.box.getSize(new THREE.Vector3()), cc = c.box.getCenter(new THREE.Vector3());
    if (c.box.min.y > 0.08 || sz.y < 0.4 || sz.y > 1.0 || Math.abs(sz.y - sz.z) > 0.22 * sz.y || sz.x > 0.5 || Math.abs(cc.x) < size.x * 0.2) continue;
    quads[(cc.z > 0 ? 'F' : 'R') + (cc.x > 0 ? 'L' : 'R')].push(c);
  }
  const wheels = {};
  let ok = true;
  for (const q of Object.keys(quads)) {
    if (!quads[q].length) { ok = false; continue; }
    const wb = new THREE.Box3(); for (const c of quads[q]) wb.union(c.box);
    wheels[q] = { box: wb, c: wb.getCenter(new THREE.Vector3()), r: (wb.max.y - wb.min.y) / 2 };
  }
  const wheelOf = new Map();
  if (ok) for (const c of comps) for (const [q, w] of Object.entries(wheels)) {
    const inner = q[1] === 'L' ? [w.box.min.x - 0.28, w.box.max.x + 0.02] : [w.box.min.x - 0.02, w.box.max.x + 0.28];
    const r = w.r * 1.04;
    if (c.box.min.x >= inner[0] && c.box.max.x <= inner[1] && c.box.min.y >= w.c.y - r && c.box.max.y <= w.c.y + r && c.box.min.z >= w.c.z - r && c.box.max.z <= w.c.z + r) { for (const t of c.tris) wheelOf.set(t, q); break; }
  }

  // ---- per-triangle roles
  const nT = soup.tm.length;
  const matRole = soup.mats.map((m) => {
    const n = (m.name || '').toLowerCase();
    if (/light|lamp|led|drl|indicator|blinker|signal/.test(n)) return 'light';
    if ((m.transparent && (m.opacity ?? 1) < 0.95) || m.transmission > 0.3 || /glass|window|windshield|windscreen/.test(n)) return 'glass';
    if (m.transparent) return 'glassy';
    return 'solid';
  });
  const role = new Array(nT);
  const cen = (t, out) => out.set((soup.pos[t * 9] + soup.pos[t * 9 + 3] + soup.pos[t * 9 + 6]) / 3, (soup.pos[t * 9 + 1] + soup.pos[t * 9 + 4] + soup.pos[t * 9 + 7]) / 3, (soup.pos[t * 9 + 2] + soup.pos[t * 9 + 5] + soup.pos[t * 9 + 8]) / 3);
  const triCol = (t) => [0, 1, 2].map((k) => (soup.vcol[t * 9 + k] + soup.vcol[t * 9 + 3 + k] + soup.vcol[t * 9 + 6 + k]) / 3);
  const triArea = (t) => { const a = new THREE.Vector3().fromArray(soup.pos, t * 9), bb = new THREE.Vector3().fromArray(soup.pos, t * 9 + 3), c = new THREE.Vector3().fromArray(soup.pos, t * 9 + 6); return bb.sub(a).cross(c.sub(a)).length() / 2; };
  const p = new THREE.Vector3();
  // dominant colour of the upper body shell = paint
  const hist = new Map();
  const qk = (c) => c.map((x) => Math.round(Math.pow(Math.max(0, x), 1 / 2.2) * 12)).join(',');
  for (let t = 0; t < nT; t++) {
    if (wheelOf.has(t) || matRole[soup.tm[t]] !== 'solid') continue;
    cen(t, p);
    if (p.y < size.y * 0.3 || p.y > size.y * 0.8 || Math.abs(p.x) < size.x * 0.4) continue;
    // outward-facing outer skin only (not seats or the cabin)
    const a = new THREE.Vector3().fromArray(soup.pos, t * 9), bb = new THREE.Vector3().fromArray(soup.pos, t * 9 + 3), c = new THREE.Vector3().fromArray(soup.pos, t * 9 + 6);
    const nrm = bb.sub(a).cross(c.sub(a)).normalize();
    if (Math.abs(nrm.x) < 0.5) continue;
    const k = qk(triCol(t));
    hist.set(k, (hist.get(k) ?? 0) + triArea(t));
  }
  let paintKey = cfg.paintKey ?? [...hist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pk = paintKey.split(',').map(Number);
  const near = (c) => { const k = c.map((x) => Math.pow(Math.max(0, x), 1 / 2.2) * 12); return Math.hypot(k[0] - pk[0], k[1] - pk[1], k[2] - pk[2]) < (cfg.paintTol ?? 1.3); };
  for (let t = 0; t < nT; t++) {
    const mr = matRole[soup.tm[t]], m = soup.mats[soup.tm[t]];
    cen(t, p);
    if (wheelOf.has(t)) { const c = triCol(t); role[t] = (m.metalness ?? 0) > 0.4 || lum({ r: c[0], g: c[1], b: c[2] }) > 0.08 ? 'rim' : 'tyre'; continue; }
    if (mr === 'light') { role[t] = p.z > 0 ? 'head' : 'brake'; continue; }
    if (mr === 'glass' || mr === 'glassy') { role[t] = mr === 'glassy' && p.y < size.y * 0.5 ? (p.z > 0 ? 'head' : 'brake') : 'glass'; continue; }
    const c = triCol(t);
    if (near(c) && p.y > (cfg.paintMinY ?? 0.15)) { role[t] = 'paint'; continue; }
    role[t] = (m.metalness ?? 0) > 0.7 && lum({ r: c[0], g: c[1], b: c[2] }) > 0.25 ? 'chrome' : 'trim';
  }

  // ---- doors: clip the front side panels along clean seam planes behind the front arch
  const r0 = ok ? (wheels.FL.r + wheels.FR.r) / 2 : 0.33;
  const zf = ok ? (wheels.FL.c.z + wheels.FR.c.z) / 2 : size.z * 0.3;
  const zr = ok ? (wheels.RL.c.z + wheels.RR.c.z) / 2 : -size.z * 0.3;
  const zA = zf - r0 * (cfg.archK ?? 1.3);
  const doorLen = cfg.doorLen ?? (cfg.doors === 2 ? 0.48 : 0.39) * (zf - zr);
  const zB = zA - doorLen;
  const yLo = cfg.sill ?? r0 * 0.95, yHi = cfg.doorTop ?? size.y * 0.96;
  const xIn = (cfg.doorX ?? 0.6) * size.x / 2;
  // output triangle lists: arrays of {P:[9], C:[9], role}
  const out = { body: [], L: [], R: [], wheel: [] };
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  // clip polygon (array of {p:[3], c:[3]}) by plane: keep side where f(p) >= 0
  const clip = (poly, f) => {
    const inn = [], outt = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length];
      const fa = f(A.p), fb = f(B.p);
      if (fa >= 0) inn.push(A); else outt.push(A);
      if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); const X = { p: lerp(A.p, B.p, t), c: lerp(A.c, B.c, t) }; inn.push(X); outt.push(X); }
    }
    return [inn, outt];
  };
  const emit = (list, poly, rl) => { for (let i = 1; i + 1 < poly.length; i++) list.push({ P: [...poly[0].p, ...poly[i].p, ...poly[i + 1].p], C: [...poly[0].c, ...poly[i].c, ...poly[i + 1].c], role: rl }); };
  const planes = [(q) => zA - q[2], (q) => q[2] - zB, (q) => yHi - q[1], (q) => q[1] - yLo];
  // small parts fully inside the door volume (handles, mirrors, trims) move whole
  const wholeDoor = new Map();
  for (const c of comps) {
    if (wheelOf.has(c.tris[0])) continue;
    const cc = c.box.getCenter(new THREE.Vector3()), sz = c.box.getSize(new THREE.Vector3());
    if (sz.z < doorLen * 0.9 && sz.y < (yHi - yLo) * 0.9 && cc.z < zA && cc.z > zB && cc.y > yLo && cc.y < yHi && Math.abs(cc.x) > xIn) for (const t of c.tris) wholeDoor.set(t, cc.x > 0 ? 'L' : 'R');
  }
  let doorTris = 0;
  for (let t = 0; t < nT; t++) {
    const P = Array.from(soup.pos.subarray(t * 9, t * 9 + 9)), C = Array.from(soup.vcol.subarray(t * 9, t * 9 + 9));
    const tri = { P, C, role: role[t] };
    if (wheelOf.has(t)) { if (wheelOf.get(t) === 'FL') out.wheel.push(tri); continue; }
    if (cfg.noDoors) { out.body.push(tri); continue; }
    const wd = wholeDoor.get(t);
    if (wd) { out[wd].push(tri); doorTris++; continue; }
    cen(t, p);
    if (Math.abs(p.x) < xIn) { out.body.push(tri); continue; }
    let poly = [0, 1, 2].map((j) => ({ p: P.slice(j * 3, j * 3 + 3), c: C.slice(j * 3, j * 3 + 3) }));
    for (const f of planes) {
      if (poly.length < 3) break;
      const [inn, outt] = clip(poly, f);
      if (outt.length >= 3) emit(out.body, outt, role[t]);
      poly = inn;
    }
    if (poly.length >= 3) { emit(out[p.x > 0 ? 'L' : 'R'], poly, role[t]); doorTris++; }
  }

  // ---- assemble
  const root = new THREE.Group();
  const M = {
    paint: new THREE.MeshStandardMaterial({ name: 'paint', color: 0xffffff }),
    glass: new THREE.MeshStandardMaterial({ name: 'glass', color: 0x161c22, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2 }),
    trim: new THREE.MeshStandardMaterial({ name: 'trim', vertexColors: true, roughness: 0.6, metalness: 0.1 }),
    chrome: new THREE.MeshStandardMaterial({ name: 'chrome', vertexColors: true, roughness: 0.22, metalness: 1 }),
    head: new THREE.MeshStandardMaterial({ name: 'head', color: 0xf4f4f0, roughness: 0.15 }),
    brake: new THREE.MeshStandardMaterial({ name: 'brake', color: 0x8a1010, roughness: 0.2 }),
    rim: new THREE.MeshStandardMaterial({ name: 'rim', vertexColors: true, roughness: 0.28, metalness: 0.9 }),
    tyre: new THREE.MeshStandardMaterial({ name: 'tyre', vertexColors: true, roughness: 0.85, metalness: 0 }),
  };
  const mk = (parent, prefix, tris, offset) => {
    const by = new Map();
    for (const t of tris) { if (!by.has(t.role)) by.set(t.role, []); by.get(t.role).push(t); }
    for (const [rl, list] of by) {
      const Pa = new Float32Array(list.length * 9), Ca = new Float32Array(list.length * 9);
      list.forEach((t, i) => { for (let j = 0; j < 9; j++) { Pa[i * 9 + j] = t.P[j] - (offset ? offset[j % 3] : 0); Ca[i * 9 + j] = t.C[j]; } });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(Pa, 3));
      if (!['paint', 'glass', 'head', 'brake'].includes(rl)) g.setAttribute('color', new THREE.BufferAttribute(Ca, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, M[rl]); mesh.name = prefix + '_' + rl; parent.add(mesh);
    }
  };
  const bodyNode = new THREE.Group(); bodyNode.name = 'body'; root.add(bodyNode);
  mk(bodyNode, 'body', out.body);
  const pivots = {};
  for (const side of ['L', 'R']) {
    const tris = out[side];
    if (!tris.length) continue;
    let mx = side === 'L' ? -1e9 : 1e9;
    for (const t of tris) for (let j = 0; j < 3; j++) mx = side === 'L' ? Math.max(mx, t.P[j * 3]) : Math.min(mx, t.P[j * 3]);
    const pv = [mx, 0, zA];
    pivots[side] = pv;
    // door card: the inner trim panel, so an open door looks solid
    const sx = side === 'L' ? 1 : -1, xi = sx * (xIn + 0.02), belt = yLo + (yHi - yLo) * 0.48, dc = [0.09, 0.09, 0.1];
    const quad = [[xi, yLo, zA - 0.04], [xi, yLo, zB + 0.04], [xi, belt, zB + 0.04], [xi, belt, zA - 0.04]];
    const tri = (a, b2, c) => ({ P: [...a, ...b2, ...c], C: [...dc, ...dc, ...dc], role: 'trim' });
    if (side === 'L') { tris.push(tri(quad[0], quad[2], quad[1]), tri(quad[0], quad[3], quad[2])); } else { tris.push(tri(quad[0], quad[1], quad[2]), tri(quad[0], quad[2], quad[3])); }
    const node = new THREE.Group(); node.name = 'door' + side; node.position.set(...pv); root.add(node);
    mk(node, 'door' + side, tris, pv);
  }
  if (ok) {
    const wn = new THREE.Group(); wn.name = 'wheel'; root.add(wn);
    mk(wn, 'wheel', out.wheel, wheels.FL.c.toArray());
  }
  const seatY = cfg.seatY ?? Math.max(0.38, yLo + 0.12);
  root.userData = {
    car: {
      size: size.toArray(), radius: r0,
      wheels: ok ? Object.fromEntries(Object.entries(wheels).map(([q, w]) => [q, w.c.toArray()])) : null,
      doors: pivots, seat: [size.x * 0.2, seatY, zB + doorLen * 0.42], seatR: [-size.x * 0.2, seatY, zB + doorLen * 0.42],
      doorZ: [zA, zB],
    },
  };
  const counts = {}; for (const r of role) counts[r] = (counts[r] ?? 0) + 1;
  const stats = { tris: nT, wheelsFound: ok, wheelTris: wheelOf.size, doorTris, roles: Object.entries(counts).map(([k, v]) => k + ':' + v), paintKey, userData: root.userData.car };
  return { root, stats };
}

export async function exportGLB(root) {
  const buf = await new GLTFExporter().parseAsync(root, { binary: true });
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Render a quick preview of the processed car (side + 3/4) to a data URL. */
export function preview(root, openDoors = 0) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(900, 360);
  const sc = new THREE.Scene(); sc.background = new THREE.Color(0xdddddd);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); sc.add(dl);
  const out = [];
  const grid = new THREE.GridHelper(10, 20, 0x888888, 0xbbbbbb); sc.add(grid);
  const clone = root.clone(true);
  clone.traverse((o) => { if (o.isMesh && o.material.name === 'paint') { o.material = o.material.clone(); o.material.color.set('#2a62c9'); } });
  for (const n of ['doorL', 'doorR']) { const d = clone.getObjectByName(n); if (d) d.rotation.y = (n === 'doorL' ? -1 : 1) * openDoors; }
  const w = clone.getObjectByName('wheel');
  if (w) {
    w.removeFromParent();
    for (const [q, c] of Object.entries(root.userData.car.wheels)) { const x = w.clone(); x.position.fromArray(c); if (q[1] === 'R') x.rotation.y = Math.PI; clone.add(x); }
  }
  sc.add(clone);
  const cam = new THREE.PerspectiveCamera(30, 900 / 360, 0.1, 100);
  const views = [[8.5, 1.2, 0], [5, 2.8, 6]];
  const c = document.createElement('canvas'); c.width = 900; c.height = 720; const x = c.getContext('2d');
  views.forEach((v, i) => { cam.position.set(...v); cam.lookAt(0, 0.6, 0); r.render(sc, cam); x.drawImage(r.domElement, 0, i * 360); });
  r.dispose();
  return c.toDataURL('image/png');
}
