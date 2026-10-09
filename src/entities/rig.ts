// Rigged, motion-captured characters: skinned glTF bodies driven by Mixamo
// mocap clips that are retargeted (world-space, rest-pose relative) onto each
// body at load time, so any clip plays on any body.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export type RigClip = 'idle' | 'walk' | 'run' | 'dance' | 'agree' | 'shake' | 'sad' | 'sneak';
export type Sex = 'm' | 'f';
/** Recolourable regions of a body. */
export type Part = 'skin' | 'hair' | 'top' | 'bottom' | 'shoes' | 'fixed';

export interface RigTemplate {
  scene: THREE.Object3D;
  clips: Partial<Record<RigClip, THREE.AnimationClip>>;
  /** Uniform scale that brings the model to 1.0 "look height" units (~1.75 m). */
  scale: number;
  /** Per-material recolour region (by material name). */
  parts: Map<string, Part>;
  /** Greyscale versions of tintable textures, shared by all clones. */
  grey: Map<string, THREE.Texture>;
  masks: Map<string, { mask: THREE.Texture; mean: THREE.Vector4; diffuse: THREE.Texture }>;
}

const norm = (n: string) => n.replace(/^mixamorig[:_]?/, '');

let templates: Record<Sex, RigTemplate> | null = null;
let loading: Promise<boolean> | null = null;
export const rigsReady = () => !!templates;
export const rigTemplate = (s: Sex) => templates![s];

interface Source { root: THREE.Object3D; clips: THREE.AnimationClip[]; restClip?: THREE.AnimationClip }

function bonesOf(root: THREE.Object3D) {
  const m = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if ((o as THREE.Bone).isBone || /Hips|Spine|Arm|Leg|Head|Neck|Shoulder|Hand|Foot|Toe/.test(o.name)) { const k = norm(o.name); if (!m.has(k)) m.set(k, o); } });
  return m;
}

function snapshot(root: THREE.Object3D) {
  const s: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  root.traverse((o) => s.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  return () => { for (const [o, p, q, sc] of s) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(sc); } };
}

/** World-space rotation + position of each named bone. */
function sampleWorld(root: THREE.Object3D, bones: Map<string, THREE.Object3D>) {
  root.updateMatrixWorld(true);
  const q = new Map<string, THREE.Quaternion>();
  const p = new Map<string, THREE.Vector3>();
  for (const [k, b] of bones) { q.set(k, b.getWorldQuaternion(new THREE.Quaternion())); p.set(k, b.getWorldPosition(new THREE.Vector3())); }
  return { q, p, hips: p.get('Hips')! };
}
type Pose = ReturnType<typeof sampleWorld>;

/** Character's forward (facing) direction in world space, from the hip joints. */
function facing(pose: Pose) {
  const left = pose.p.get('LeftUpLeg')!.clone().sub(pose.p.get('RightUpLeg')!).setY(0).normalize();
  return left.cross(new THREE.Vector3(0, 1, 0)).normalize();
}

// Limb chains straightened to a canonical T-pose so A-pose and T-pose rigs agree.
const CHAINS: [string, string, 'left' | 'right' | 'down'][] = [
  ['LeftShoulder', 'LeftArm', 'left'], ['LeftArm', 'LeftForeArm', 'left'], ['LeftForeArm', 'LeftHand', 'left'],
  ['RightShoulder', 'RightArm', 'right'], ['RightArm', 'RightForeArm', 'right'], ['RightForeArm', 'RightHand', 'right'],
  ['LeftUpLeg', 'LeftLeg', 'down'], ['LeftLeg', 'LeftFoot', 'down'], ['RightUpLeg', 'RightLeg', 'down'], ['RightLeg', 'RightFoot', 'down'],
];
/** Rest world rotations corrected to canonical T-pose: Wc = C·Wrest with C aligning each limb segment. */
function canonical(pose: Pose) {
  const fwd = facing(pose);
  const up = new THREE.Vector3(0, 1, 0);
  const left = up.clone().cross(fwd).normalize();
  const dirs = { left, right: left.clone().negate(), down: up.clone().negate() };
  const q = new Map(pose.q);
  for (const [a, b, d] of CHAINS) {
    const pa = pose.p.get(a), pb = pose.p.get(b), qa = pose.q.get(a);
    if (!pa || !pb || !qa) continue;
    const cur = pb.clone().sub(pa).normalize();
    const c = new THREE.Quaternion().setFromUnitVectors(cur, dirs[d]);
    q.set(a, c.multiply(qa));
  }
  return { q, fwd };
}

/**
 * Retarget `clip` from a source skeleton onto a target body:
 *   Δ = R·Ws(t)·Ws(rest)⁻¹·R⁻¹ ;  Wt(t) = Δ·Wt(rest) ;  local = Wt(parent)⁻¹·Wt(t)
 * where rests are canonical T-poses and R turns the source's facing onto the target's.
 */
function retarget(src: Source, clip: THREE.AnimationClip, tgt: THREE.Object3D, name: string, opts: { rootMotion?: boolean; fps?: number } = {}) {
  const fps = opts.fps ?? 30;
  const sBones = bonesOf(src.root);
  const reset = snapshot(src.root);
  const mixer = new THREE.AnimationMixer(src.root);
  // source rest pose
  let sPose: Pose;
  if (src.restClip) { const a = mixer.clipAction(src.restClip); a.play(); mixer.setTime(0); sPose = sampleWorld(src.root, sBones); a.stop(); reset(); }
  else sPose = sampleWorld(src.root, sBones);
  const sRest = canonical(sPose);

  // target rest pose (bind pose of the template)
  const tBones = bonesOf(tgt);
  const tPose = sampleWorld(tgt, tBones);
  const tRest = canonical(tPose);
  const R = new THREE.Quaternion().setFromUnitVectors(sRest.fwd, tRest.fwd);
  if (sRest.fwd.dot(tRest.fwd) < -0.999) R.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const Rinv = R.clone().invert();
  const tHips = tBones.get('Hips')!;
  const order: THREE.Object3D[] = [];
  tHips.traverse((o) => order.push(o));
  const tRestW = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of order) tRestW.set(b, tRest.q.get(norm(b.name)) && tBones.get(norm(b.name)) === b ? tRest.q.get(norm(b.name))! : b.getWorldQuaternion(new THREE.Quaternion()));
  const hipsParentW = tHips.parent!.getWorldQuaternion(new THREE.Quaternion());
  const hipsParentInv = tHips.parent!.matrixWorld.clone().invert();
  const tHipsRest = tPose.hips.clone();
  const k = tHipsRest.y / Math.max(0.01, sPose.hips.y);

  const action = mixer.clipAction(clip);
  action.play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const qv = new Map<THREE.Object3D, Float32Array>();
  for (const b of order) qv.set(b, new Float32Array(n * 4));
  const pv = new Float32Array(n * 3);
  const W = new Map<THREE.Object3D, THREE.Quaternion>();
  const inv = new THREE.Quaternion(), d = new THREE.Quaternion(), local = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration - 1e-4, i / fps);
    times[i] = i === n - 1 ? clip.duration : t;
    mixer.setTime(t);
    const s = sampleWorld(src.root, sBones);
    W.clear();
    for (const b of order) {
      const pw = W.get(b.parent!) ?? (b === tHips ? hipsParentW : b.parent!.getWorldQuaternion(new THREE.Quaternion()));
      const key = norm(b.name);
      const sq = s.q.get(key), sr = sRest.q.get(key);
      let wb: THREE.Quaternion;
      if (sq && sr && key !== 'HeadTop_End' && !/Eye$/.test(key)) {
        d.copy(R).multiply(sq).multiply(inv.copy(sr).invert()).multiply(Rinv);
        wb = d.clone().multiply(tRestW.get(b)!);
      } else wb = pw.clone().multiply(b.quaternion);
      W.set(b, wb);
      local.copy(pw).invert().multiply(wb);
      local.toArray(qv.get(b)!, i * 4);
    }
    const dp = s.hips.clone().sub(sPose.hips).multiplyScalar(k).applyQuaternion(R);
    if (!opts.rootMotion) { dp.x = 0; dp.z = 0; }
    tHipsRest.clone().add(dp).applyMatrix4(hipsParentInv).toArray(pv, i * 3);
  }
  action.stop();
  reset();
  const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack(`${tHips.name}.position`, times, pv)];
  for (const b of order) {
    const v = qv.get(b)!;
    // skip bones that stay at their rest rotation for the whole clip
    const rest = b.quaternion.toArray();
    let moves = false;
    for (let i = 0; i < v.length && !moves; i++) if (Math.abs(v[i] - rest[i % 4]) > 1e-4) moves = true;
    if (moves || b === tHips) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v));
  }
  return new THREE.AnimationClip(name, times[n - 1], tracks);
}

function greyTexture(tex: THREE.Texture): THREE.Texture {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const size = Math.min(512, img.width);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, size, size);
  const d = x.getImageData(0, 0, size, size);
  let sum = 0;
  const L = new Float32Array(size * size);
  for (let i = 0; i < L.length; i++) { const l = 0.3 * d.data[i * 4] + 0.59 * d.data[i * 4 + 1] + 0.11 * d.data[i * 4 + 2]; L[i] = l; sum += l; }
  const gain = 215 / Math.max(1, sum / L.length); // normalise so the tint colour is what you see
  for (let i = 0; i < L.length; i++) { const v = Math.min(255, L[i] * gain); d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; }
  x.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  return t;
}

const PARTS: Record<Sex, Record<string, Part>> = {
  m: { Wolf3D_Skin: 'skin', Wolf3D_Body: 'skin', Wolf3D_Beard: 'hair', Wolf3D_Outfit_Top: 'top', Wolf3D_Outfit_Bottom: 'bottom', Wolf3D_Outfit_Footwear: 'shoes', Wolf3D_Eye: 'fixed' },
  f: {},
};
/** Single-texture bodies recoloured through a generated mask. */
const MASKED = new Set(['Ch03_Body']);
const DROP = /Teeth|Headwear/;

function prepareBody(scene: THREE.Object3D, sex: Sex, targetHeight: number): RigTemplate {
  const parts = new Map<string, Part>();
  const grey = new Map<string, THREE.Texture>();
  const masks = new Map<string, { mask: THREE.Texture; mean: THREE.Vector4; diffuse: THREE.Texture }>();
  const drop: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    if (DROP.test(m.name) || DROP.test((m.material as THREE.Material).name)) { drop.push(m); return; }
    m.userData.shared = true;
    // Skinned bounds don't follow the animation: use a generous sphere around the rest pose.
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) { m.computeBoundingSphere(); m.boundingSphere!.radius *= 1.6; }
    for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      const p = PARTS[sex][mm.name] ?? 'fixed';
      parts.set(mm.name, p);
      mm.metalness = 0;
      mm.roughness = Math.max(0.55, mm.roughness);
      mm.metalnessMap = null;
      if (p !== 'fixed' && mm.map && !grey.has(mm.name)) grey.set(mm.name, greyTexture(mm.map));
      if (MASKED.has(mm.name) && mm.map && !masks.has(mm.name)) {
        const mk = buildMask(mm.map);
        masks.set(mm.name, mk);
        mm.map = mk.diffuse;
        mm.emissiveMap = null;
        mm.emissive.set(0);
      }
      mm.envMapIntensity = 0.6;
    }
  });
  for (const o of drop) o.removeFromParent();
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const scale = targetHeight / Math.max(0.1, box.max.y - box.min.y);
  return { scene, clips: {}, scale, parts, grey, masks };
}

/** Load bodies + mocap clips. Resolves false (procedural fallback) on any failure. */
export function loadRigs(): Promise<boolean> {
  if (loading) return loading;
  const base = (import.meta.env.BASE_URL ?? '/') + 'assets/chars/';
  const loader = new GLTFLoader();
  const get = (f: string) => loader.loadAsync(base + f);
  loading = (async () => {
    try {
      const [male, female, soldier, xbot, samba] = await Promise.all([get('male.glb'), get('female.glb'), get('anim_soldier.glb'), get('anim_xbot.glb'), get('anim_samba.glb')]);
      const clip = (g: { animations: THREE.AnimationClip[] }, n: string) => g.animations.find((a) => a.name === n)!;
      const S: Source = { root: soldier.scene, clips: soldier.animations, restClip: clip(soldier, 'TPose') };
      const X: Source = { root: xbot.scene, clips: xbot.animations };
      const D: Source = { root: samba.scene, clips: samba.animations, restClip: clip(samba, 'TPose') };
      const t: Record<Sex, RigTemplate> = { m: prepareBody(male.scene, 'm', 1.78), f: prepareBody(female.scene, 'f', 1.68) };
      for (const sex of ['m', 'f'] as Sex[]) {
        const b = t[sex].scene;
        t[sex].clips = {
          idle: retarget(S, clip(soldier, 'Idle'), b, 'idle'),
          walk: retarget(S, clip(soldier, 'Walk'), b, 'walk'),
          run: retarget(S, clip(soldier, 'Run'), b, 'run'),
          dance: retarget(D, clip(samba, 'SambaDance'), b, 'dance', { rootMotion: true }),
          agree: retarget(X, clip(xbot, 'agree'), b, 'agree'),
          shake: retarget(X, clip(xbot, 'headShake'), b, 'shake'),
          sad: retarget(X, clip(xbot, 'sad_pose'), b, 'sad'),
          sneak: retarget(X, clip(xbot, 'sneak_pose'), b, 'sneak'),
        };
      }
      templates = t;
      return true;
    } catch (e) {
      console.warn('[rig] falling back to procedural characters', e);
      return false;
    }
  })();
  return loading;
}

export function cloneBody(sex: Sex) {
  const t = templates![sex];
  const root = cloneSkinned(t.scene) as THREE.Object3D;
  const tinted = new Map<Part, THREE.MeshStandardMaterial[]>();
  const masked: THREE.MeshStandardMaterial[] = [];
  const owned: THREE.Material[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    const list = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
    const cloned = list.map((mm) => {
      const mk = t.masks.get(mm.name);
      if (mk) { const c = maskedMaterial(mm, mk.mask, mk.mean); masked.push(c); owned.push(c); return c; }
      const p = t.parts.get(mm.name) ?? 'fixed';
      if (p === 'fixed') return mm;
      const c = mm.clone();
      const g = t.grey.get(mm.name);
      if (g) c.map = g;
      if (!tinted.has(p)) tinted.set(p, []);
      tinted.get(p)!.push(c);
      owned.push(c);
      return c;
    });
    m.material = Array.isArray(m.material) ? cloned : cloned[0];
  });
  const key: Partial<Record<Part, 'cTop' | 'cBottom' | 'cSkin' | 'cHair'>> = { top: 'cTop', bottom: 'cBottom', skin: 'cSkin', hair: 'cHair' };
  const tint = (p: Part, hex: string) => {
    for (const m of tinted.get(p) ?? []) m.color.set(hex);
    const k = key[p];
    if (k) for (const m of masked) (m.userData.tints[k].value as THREE.Color).set(hex);
  };
  return { root, tint, owned, template: t };
}

// ---------------------------------------------------------------- per-pixel recolour mask
// Single-texture bodies get an RGB mask (R top, G bottom, B skin, white = hair) so
// clothes, skin and hair can be tinted independently in one draw call.

function rgb2hsv(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function buildMask(tex: THREE.Texture) {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const size = Math.min(512, img.width);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, size, size);
  const src = x.getImageData(0, 0, size, size);
  const out = x.createImageData(size, size);
  const base = x.createImageData(size, size);
  base.data.set(src.data);
  const sum = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  for (let i = 0; i < size * size; i++) {
    const r = src.data[i * 4] / 255, g = src.data[i * 4 + 1] / 255, b = src.data[i * 4 + 2] / 255;
    const [h, s, v] = rgb2hsv(r, g, b);
    let ch = -1;
    if (v < 0.2) ch = 3; // hair / dark
    else if (h >= 40 && h <= 70 && s > 0.35 && v > 0.55) ch = 1; // bottoms (yellow)
    else if (s < 0.16 && v > 0.3 && v < 0.9) ch = 0; // top (grey)
    else if ((h < 12 || h > 340) && s > 0.5) { // loud red accessories -> neutral charcoal
      const gv = 18 + v * 40;
      base.data[i * 4] = base.data[i * 4 + 1] = gv; base.data[i * 4 + 2] = gv + 4;
    }
    else if (h >= 8 && h <= 42 && s > 0.2 && v < 0.9) ch = 2; // skin
    out.data[i * 4 + 3] = 255; // opaque: canvas premultiplies alpha
    if (ch >= 0) {
      if (ch === 3) out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
      else out.data[i * 4 + ch] = 255;
      sum[ch] += 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b); cnt[ch]++;
    }
  }
  const dc = document.createElement('canvas');
  dc.width = dc.height = size;
  dc.getContext('2d')!.putImageData(base, 0, 0);
  const diffuse = new THREE.CanvasTexture(dc);
  diffuse.colorSpace = THREE.SRGBColorSpace;
  diffuse.flipY = tex.flipY;
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = tex.flipY;
  t.premultiplyAlpha = false;
  const mean = new THREE.Vector4(...sum.map((s, i) => Math.max(0.02, s / Math.max(1, cnt[i]))) as [number, number, number, number]);
  return { mask: t, mean, diffuse };
}

function maskedMaterial(base: THREE.MeshStandardMaterial, mask: THREE.Texture, mean: THREE.Vector4) {
  const m = base.clone();
  const u = {
    pMask: { value: mask }, pMean: { value: mean },
    cTop: { value: new THREE.Color(1, 1, 1) }, cBottom: { value: new THREE.Color(1, 1, 1) }, cSkin: { value: new THREE.Color(1, 1, 1) }, cHair: { value: new THREE.Color(1, 1, 1) },
  };
  m.userData.tints = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D pMask; uniform vec4 pMean; uniform vec3 cTop, cBottom, cSkin, cHair;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 pr = texture2D(pMask, vMapUv).rgb;
        float hw = min(pr.r, min(pr.g, pr.b));
        vec4 pm = vec4(pr - hw, hw);
        float tot = pm.r + pm.g + pm.b + pm.a;
        if (tot > 0.01) {
          float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 tint = (pm.r * cTop * (lum / pMean.x) + pm.g * cBottom * (lum / pMean.y) + pm.b * cSkin * (lum / pMean.z) + pm.a * cHair * (lum / pMean.w)) / tot;
          diffuseColor.rgb = mix(diffuseColor.rgb, tint, min(tot, 1.0));
        }
      }`);
  };
  m.customProgramCacheKey = () => 'cc_masked_body';
  return m;
}
