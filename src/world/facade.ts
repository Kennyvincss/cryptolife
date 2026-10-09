// Realistic building facades without per-window geometry.
//
// Each facade style is one PBR material (real lighting, shadows, sky reflections)
// whose shader lays out floors and window bays procedurally in face-local metres:
//  - recessed windows with parallax reveals, frames and mullions, sills and lintels
//  - glass with physically based Fresnel reflections of the HDR environment
//  - interior mapping: a 3D room behind every window (walls, floor, ceiling lamp,
//    furniture, blinds), dim by day and randomly lit at night
//  - storefront ground floors, floor-slab bands, rain streaks and ground grime
// Geometry carries uv = face metres and aFacade = (face width, height, seed*4+flags).

import * as THREE from 'three';
import { pbrSet } from './pbr.js';

export type FacadeKind = 'curtain' | 'office' | 'brick' | 'plaster' | 'stone' | 'dark' | 'industrial';

interface Spec {
  wall: string; tile: number;          // texture set + tile size (m)
  bay: number; floorH: number;         // bay width, floor height (m)
  winW: number; winH: number; sill: number; // window size as fractions of bay / floor
  frame: number; mullion: number;      // frame width (m), vertical mullion count
  glassMetal: number; glassTint: [string, string];
  frameCol: string; tintA: string; tintB: string;
  band: number;                        // floor-slab band height (fraction of floor), 0 = none
  bandCol: string; ledge: number;      // stone sill/lintel strength
  roomDim: number;                     // interior visibility (0..1)
}

const SPECS: Record<FacadeKind, Spec> = {
  curtain: { wall: 'metal', tile: 3, bay: 1.6, floorH: 3.8, winW: 0.96, winH: 0.74, sill: 0.2, frame: 0.05, mullion: 0, glassMetal: 0.55, glassTint: ['#5d7f99', '#7d9a8c'], frameCol: '#2b2f35', tintA: '#ffffff', tintB: '#cfd6dd', band: 0.2, bandCol: '#1f2a33', ledge: 0, roomDim: 0.35 },
  office: { wall: 'concrete', tile: 4, bay: 2.2, floorH: 3.6, winW: 0.84, winH: 0.56, sill: 0.3, frame: 0.06, mullion: 1, glassMetal: 0.25, glassTint: ['#6f8494', '#8a9598'], frameCol: '#3a3d42', tintA: '#f2efe8', tintB: '#c9c6bf', band: 0.12, bandCol: '#d9d6cf', ledge: 0, roomDim: 0.8 },
  brick: { wall: 'brick', tile: 2, bay: 2.8, floorH: 3.2, winW: 0.42, winH: 0.5, sill: 0.3, frame: 0.07, mullion: 1, glassMetal: 0.05, glassTint: ['#8899a6', '#8899a6'], frameCol: '#e9e6df', tintA: '#ffffff', tintB: '#b9a79c', band: 0, bandCol: '#cfc6b8', ledge: 1, roomDim: 1 },
  plaster: { wall: 'plaster', tile: 4, bay: 3.0, floorH: 3.1, winW: 0.44, winH: 0.5, sill: 0.3, frame: 0.06, mullion: 1, glassMetal: 0.05, glassTint: ['#8899a6', '#8899a6'], frameCol: '#f4f2ee', tintA: '#f3e6cf', tintB: '#d7c7b4', band: 0.05, bandCol: '#ffffff', ledge: 0.6, roomDim: 1 },
  stone: { wall: 'stone', tile: 3, bay: 3.0, floorH: 3.8, winW: 0.5, winH: 0.6, sill: 0.25, frame: 0.07, mullion: 1, glassMetal: 0.1, glassTint: ['#6d7f8a', '#7d8a8a'], frameCol: '#2a2c2f', tintA: '#ffffff', tintB: '#d8d0c2', band: 0.06, bandCol: '#e6dfd2', ledge: 1, roomDim: 0.9 },
  dark: { wall: 'concrete', tile: 4, bay: 2.4, floorH: 3.6, winW: 0.8, winH: 0.6, sill: 0.25, frame: 0.05, mullion: 1, glassMetal: 0.3, glassTint: ['#4e5a66', '#5a5466'], frameCol: '#141518', tintA: '#5a5a60', tintB: '#45464d', band: 0.1, bandCol: '#2a2b30', ledge: 0, roomDim: 0.8 },
  industrial: { wall: 'brick', tile: 2, bay: 4.2, floorH: 4.6, winW: 0.66, winH: 0.46, sill: 0.35, frame: 0.05, mullion: 3, glassMetal: 0.1, glassTint: ['#7f8c8a', '#7f8c8a'], frameCol: '#2d3236', tintA: '#c7b9ab', tintB: '#8f8a84', band: 0, bandCol: '#9a948a', ledge: 0.5, roomDim: 0.7 },
};

/** Shared, per-frame uniforms for every facade material. */
export const facadeUniforms = { uNight: { value: 0 } };

export function setFacadeNight(n: number) { facadeUniforms.uNight.value = n; }

const mats = new Map<FacadeKind, THREE.MeshStandardMaterial>();

export function facadeMaterial(kind: FacadeKind, lowQuality = false): THREE.MeshStandardMaterial {
  const hit = mats.get(kind);
  if (hit) return hit;
  const s = SPECS[kind];
  const set = pbrSet(s.wall, s.tile);
  const m = new THREE.MeshStandardMaterial({
    map: set.map, normalMap: set.normalMap, roughnessMap: set.orm, metalnessMap: set.orm, aoMap: set.orm,
    normalScale: new THREE.Vector2(1, 1), roughness: 1, metalness: 1, envMapIntensity: 1,
  });
  const c = (h: string) => new THREE.Color(h);
  const u = {
    ...facadeUniforms,
    uBay: { value: s.bay }, uFloorH: { value: s.floorH },
    uWin: { value: new THREE.Vector3(s.winW, s.winH, s.sill) },
    uFrame: { value: new THREE.Vector2(s.frame, s.mullion) },
    uGlassMetal: { value: s.glassMetal },
    uGlassA: { value: c(s.glassTint[0]) }, uGlassB: { value: c(s.glassTint[1]) },
    uFrameCol: { value: c(s.frameCol) }, uTintA: { value: c(s.tintA) }, uTintB: { value: c(s.tintB) },
    uBand: { value: s.band }, uBandCol: { value: c(s.bandCol) }, uLedge: { value: s.ledge }, uRoomDim: { value: s.roomDim },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aFacade;
        varying vec2 vFUv; varying vec3 vFData; varying vec3 vFWPos; varying vec3 vFWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFUv = uv; vFData = aFacade;
        vFWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vFWNrm = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        ${lowQuality ? '#define FACADE_LOW' : ''}
        uniform float uNight, uBay, uFloorH, uGlassMetal, uBand, uLedge, uRoomDim;
        uniform vec3 uWin, uGlassA, uGlassB, uFrameCol, uTintA, uTintB, uBandCol;
        uniform vec2 uFrame;
        varying vec2 vFUv; varying vec3 vFData; varying vec3 vFWPos; varying vec3 vFWNrm;
        float fh1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
        float fh2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fh2(i), fh2(i + vec2(1, 0)), f.x), mix(fh2(i + vec2(0, 1)), fh2(i + vec2(1, 1)), f.x), f.y); }
        // interior mapping: colour seen through a window into a W x H x D room
        vec3 room(vec2 p, vec3 vt, float W, float H, float D, float rnd, float shop) {
          vec3 r = normalize(-vt);
          r.z = min(r.z, -0.05);
          float tx = r.x > 0.0 ? (W - p.x) / max(r.x, 1e-4) : -p.x / min(r.x, -1e-4);
          float ty = r.y > 0.0 ? (H - p.y) / max(r.y, 1e-4) : -p.y / min(r.y, -1e-4);
          float tz = -D / r.z;
          float t = min(min(tx, ty), tz);
          vec3 h = vec3(p, 0.0) + r * t;
          vec3 paint = mix(vec3(0.82, 0.79, 0.73), mix(vec3(0.66, 0.70, 0.74), vec3(0.78, 0.70, 0.62), fract(rnd * 3.7)), step(0.55, fract(rnd * 7.1)));
          vec3 c = paint;
          if (t == tz && shop > 0.5) {
            // shop back wall: lit shelving with stock
            float sy = fract(h.y / 0.55), row = floor(h.y / 0.55);
            c = vec3(0.86, 0.84, 0.8);
            if (h.y > 0.4 && h.y < 2.6) {
              if (sy < 0.08) c = vec3(0.35, 0.33, 0.3);
              else { float item = floor(h.x / 0.32 + row * 7.0); vec3 stock = 0.45 + 0.45 * cos(6.2831 * (fract(item * 0.137 + rnd) + vec3(0.0, 0.33, 0.67))); if (fract(item * 0.71) > 0.25 && sy < 0.75) c = stock; }
            }
          } else if (t == tz) {
            float fx = fract(rnd * 13.7) * W * 0.55;
            if (h.y < 0.85 && h.x > fx && h.x < fx + W * 0.4) c = mix(vec3(0.16, 0.14, 0.13), vec3(0.35, 0.3, 0.26), fract(rnd * 9.1));
            if (h.y > 1.35 && h.y < 1.95 && abs(h.x - W * (0.3 + 0.4 * fract(rnd * 5.3))) < 0.35) c = mix(vec3(0.25, 0.32, 0.4), vec3(0.6, 0.42, 0.3), fract(rnd * 5.1));
            if (h.y < 2.1 && abs(h.x - W * 0.85) < 0.15 && fract(rnd * 2.9) > 0.5) c = vec3(0.2, 0.32, 0.18); // plant
          } else if (t == ty) {
            if (r.y > 0.0) { c = vec3(0.88); vec2 lp = vec2(h.x - W * 0.5, h.z + D * 0.45); if (abs(lp.x) < 0.45 && abs(lp.y) < 0.3) c = vec3(mix(1.3, 4.0, uNight)); }
            else c = shop > 0.5 ? mix(vec3(0.55, 0.53, 0.5), vec3(0.42, 0.3, 0.2), step(0.5, fract(rnd * 3.3))) : mix(vec3(0.36, 0.25, 0.17), vec3(0.42, 0.42, 0.44), step(0.5, fract(rnd * 3.3)));
          }
          float depth = clamp(-h.z / D, 0.0, 1.0);
          c *= mix(1.0, 0.5, depth);
          float edge = min(min(h.x, W - h.x), min(h.y, H - h.y));
          c *= mix(0.65, 1.0, smoothstep(0.0, 0.45, edge));
          return c;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // ---- facade layout ----
        float fW = vFData.x, fHt = vFData.y;
        float fSeed = floor(vFData.z / 4.0), fFlags = mod(vFData.z, 4.0);
        float shop = mod(fFlags, 2.0), plainGround = step(1.5, fFlags);
        vec2 fuv = vFUv;
        vec3 Nw = normalize(vFWNrm);
        vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-5, 0.0, 0.0));
        vec3 Vw = normalize(cameraPosition - vFWPos);
        vec3 vt = vec3(dot(Vw, Tw), Vw.y, max(dot(Vw, Nw), 0.02));
        float bseed = fh1(fSeed + 0.37);
        vec3 wallTint = mix(uTintA, uTintB, bseed);
        float gF = 4.4; // ground floor height
        float upper = step(gF, fuv.y);
        float isGlass = 0.0, isFrame = 0.0, isBlind = 0.0;
        vec3 inter = vec3(0.0); vec3 glassCol = mix(uGlassA, uGlassB, fh1(fSeed * 1.7));
        float wallShade = 1.0;
        bool vertical = abs(Nw.y) < 0.5;
        if (vertical) {
          // bays centred on the face, solid piers at the corners
          float bays = max(1.0, floor((fW - 1.2) / uBay));
          float margin = (fW - bays * uBay) * 0.5;
          float bu = (fuv.x - margin) / uBay;
          float bayIdx = floor(bu), fu = fract(bu);
          float inBays = step(0.0, bu) * step(bu, bays);
          float fy = fuv.y - gF;
          float floorIdx = floor(fy / uFloorH), fv = fract(fy / uFloorH);
          float topSolid = step(fuv.y, fHt - 1.3);
          // floor-slab band
          if (uBand > 0.0 && upper > 0.5 && fv < uBand) { wallTint = mix(wallTint, uBandCol, 0.85); wallShade = 0.95; }
          float x0 = 0.5 - uWin.x * 0.5, x1 = 0.5 + uWin.x * 0.5, y0 = uWin.z, y1 = uWin.z + uWin.y;
          vec2 cell = vec2(fu * uBay, fv * uFloorH);
          vec2 w0 = vec2(x0 * uBay, y0 * uFloorH), w1 = vec2(x1 * uBay, y1 * uFloorH);
          float rnd = fh2(vec2(bayIdx + fSeed * 3.1, floorIdx + fSeed * 1.3 + Nw.x * 7.0 + Nw.z * 13.0));
          bool shopFront = false;
          if (upper < 0.5 && shop > 0.5 && inBays > 0.5) {
            // storefront: wide glazing between piers, fascia band above
            shopFront = true;
            cell = vec2(fu * uBay, fuv.y);
            w0 = vec2(0.22, 0.35); w1 = vec2(uBay - 0.22, 3.15);
            if (fuv.y > 3.35 && fuv.y < 4.15) { wallTint = vec3(0.12, 0.12, 0.13); wallShade = 1.0; }
          }
          float winOn = inBays * topSolid * (shopFront ? 1.0 : upper);
          if (plainGround > 0.5 && upper < 0.5) winOn = 0.0;
          // sill / lintel ledges and rain streaks below windows
          if (winOn > 0.5 && !shopFront) {
            float overX = step(w0.x - 0.08, cell.x) * step(cell.x, w1.x + 0.08);
            if (uLedge > 0.0 && overX > 0.5 && cell.y < w0.y && cell.y > w0.y - 0.09) { wallTint = mix(wallTint, vec3(0.86, 0.83, 0.78), uLedge); wallShade = 1.08; }
            if (uLedge > 0.5 && overX > 0.5 && cell.y > w1.y && cell.y < w1.y + 0.16) { wallTint = mix(wallTint, vec3(0.8, 0.77, 0.72), 0.8); }
            float underX = step(w0.x, cell.x) * step(cell.x, w1.x);
            if (underX > 0.5 && cell.y < w0.y - 0.09) wallShade *= 1.0 - 0.18 * fnoise(vec2(cell.x * 6.0, cell.y * 0.8 + rnd * 9.0)) * smoothstep(0.0, w0.y, cell.y);
          }
          if (winOn > 0.5 && cell.x > w0.x && cell.x < w1.x && cell.y > w0.y && cell.y < w1.y) {
            // recessed glazing: parallax test for the reveal
            float dep = shopFront ? 0.08 : 0.14;
            vec2 q = cell - vt.xy / vt.z * dep;
            if (q.x < w0.x || q.x > w1.x || q.y < w0.y || q.y > w1.y) {
              wallShade *= 0.55; // window reveal, in shade
            } else {
              vec2 wl = q - w0, ws = w1 - w0;
              float fr = uFrame.x;
              bool frame = wl.x < fr || wl.y < fr || ws.x - wl.x < fr || ws.y - wl.y < fr;
              float nm = shopFront ? 0.0 : uFrame.y;
              if (nm > 0.0) { float mx = fract(wl.x / ws.x * (nm + 1.0)); if (min(mx, 1.0 - mx) * ws.x / (nm + 1.0) < fr * 0.5) frame = true; }
              if (frame) { isFrame = 1.0; }
              else {
                isGlass = 1.0;
                // blinds / curtains
                float blind = step(0.45, fract(rnd * 17.3)) * fract(rnd * 31.7) * 0.75;
                if (!shopFront && wl.y > ws.y * (1.0 - blind)) isBlind = 1.0;
                float lit = step(1.0 - (shopFront ? 0.85 : 0.38), fract(rnd * 23.1));
                vec3 lampCol = mix(vec3(1.0, 0.82, 0.6), vec3(0.85, 0.9, 1.0), step(0.7, fract(rnd * 41.3)));
                float dayLevel = (shopFront ? 0.4 : 0.32) * (1.0 - uNight);
                float nightLevel = uNight * (0.04 + lit * 1.25);
#ifdef FACADE_LOW
                vec3 rc = vec3(0.5);
#else
                vec3 rc = room(vec2(q.x - w0.x, q.y - w0.y), vt, ws.x, shopFront ? 3.4 : uFloorH * 0.95, shopFront ? 7.0 : 4.5, rnd, shopFront ? 1.0 : 0.0);
#endif
                inter = rc * (dayLevel * uRoomDim + nightLevel * lampCol);
                if (isBlind > 0.5) inter = mix(vec3(0.78, 0.74, 0.66), vec3(0.9, 0.86, 0.8), fract(rnd * 3.0)) * (0.55 * (1.0 - uNight) + uNight * (0.03 + lit * 0.9) * lampCol);
              }
            }
          }
          // grime: darker near the ground and under the roof edge
          wallShade *= mix(0.78, 1.0, smoothstep(0.0, 2.5, fuv.y));
          wallShade *= mix(0.88, 1.0, smoothstep(0.0, 1.5, fHt - fuv.y));
        }
        // macro variation breaks texture tiling
        float macro = fnoise(vFWPos.xz * 0.05 + vFWPos.y * 0.03) * 0.25 + fnoise(vFWPos.xy * 0.21 + vFWPos.zy * 0.17) * 0.12;
        diffuseColor.rgb *= wallTint * wallShade * (0.86 + macro);
        if (isFrame > 0.5) diffuseColor.rgb = uFrameCol;
        if (isGlass > 0.5) diffuseColor.rgb = isBlind > 0.5 ? vec3(0.03) : glassCol * mix(0.06, 0.9, uGlassMetal);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (isGlass > 0.5 || isFrame > 0.5) normal = nonPerturbedNormal;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (isGlass > 0.5) roughnessFactor = isBlind > 0.5 ? 0.6 : 0.04;
        if (isFrame > 0.5) roughnessFactor = 0.45;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        if (isGlass > 0.5) metalnessFactor = isBlind > 0.5 ? 0.0 : uGlassMetal;
        if (isFrame > 0.5) metalnessFactor = 0.5;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += inter;`);
  };
  m.customProgramCacheKey = () => 'facade_' + kind + (lowQuality ? '_low' : '');
  mats.set(kind, m);
  return m;
}

// ------------------------------------------------------------------ geometry

export interface FaceOpts { seed: number; shop?: boolean; plainGround?: boolean }

/**
 * One vertical rectangular wall face. `n` is the outward normal (axis-aligned),
 * (cx, cz) the face centre, width along the face, from y0 to y1.
 * Height is measured from `base` (the building's ground) for the facade layout.
 */
export function wallFace(cx: number, cz: number, n: [number, number], width: number, y0: number, y1: number, base: number, o: FaceOpts) {
  const t = new THREE.Vector3(0, 1, 0).cross(new THREE.Vector3(n[0], 0, n[1])); // u direction
  const hw = width / 2;
  const P = (s: number, y: number) => [cx + t.x * s, y, cz + t.z * s];
  const pos = [...P(-hw, y0), ...P(hw, y0), ...P(hw, y1), ...P(-hw, y1)];
  const H = y1 - base;
  const uv = [0, y0 - base, width, y0 - base, width, y1 - base, 0, y1 - base];
  const flags = (o.shop ? 1 : 0) + (o.plainGround ? 2 : 0);
  const fd = [width, H, o.seed * 4 + flags];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([n[0], 0, n[1], n[0], 0, n[1], n[0], 0, n[1], n[0], 0, n[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFacade', new THREE.Float32BufferAttribute([...fd, ...fd, ...fd, ...fd], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** The four walls of an axis-aligned block (x,z centre, w along x, d along z). */
export function boxWalls(x: number, z: number, w: number, d: number, y0: number, y1: number, base: number, o: FaceOpts & { shopSides?: ('n' | 's' | 'e' | 'w')[] }) {
  const sides: ['n' | 's' | 'e' | 'w', number, number, [number, number], number][] = [
    ['s', x, z + d / 2, [0, 1], w], ['n', x, z - d / 2, [0, -1], w],
    ['e', x + w / 2, z, [1, 0], d], ['w', x - w / 2, z, [-1, 0], d],
  ];
  return sides.map(([side, cx, cz, n, width], i) => wallFace(cx, cz, n, width, y0, y1, base, { ...o, seed: o.seed * 4 + i, shop: o.shop && (!o.shopSides || o.shopSides.includes(side)) }));
}
