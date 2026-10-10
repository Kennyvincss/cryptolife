// Rigged, motion-captured people: Microsoft Rocketbox avatars (MIT) with
// Rocketbox mocap clips. Every avatar shares the same 3ds Max Biped skeleton,
// so clips play directly on any body. Bodies stream in on demand.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PEOPLE } from '../../shared/catalog.js';
import type { Look } from '../../shared/types.js';

export type RigClip = 'idle' | 'walk' | 'run' | 'dance' | 'talk' | 'phone' | 'wave' | 'sit' | 'cheer' | 'shrug' | 'look';
export type Sex = 'm' | 'f';

export interface RigTemplate {
  id: string;
  sex: Sex;
  scene: THREE.Object3D;
  clips: Partial<Record<RigClip, THREE.AnimationClip>>;
  /** Uniform scale that brings the model to its real height. */
  scale: number;
  /** Natural ground speed (m/s at timeScale 1) of the walk and run cycles, measured from the feet. */
  walkSpeed: number;
  runSpeed: number;
}

/** Biped bone names → the canonical (Mixamo-style) names the procedural poses use. */
const BIPED: Record<string, string> = {
  Pelvis: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head', HeadNub: 'HeadTop_End',
  L_Clavicle: 'LeftShoulder', L_UpperArm: 'LeftArm', L_Forearm: 'LeftForeArm', L_Hand: 'LeftHand',
  R_Clavicle: 'RightShoulder', R_UpperArm: 'RightArm', R_Forearm: 'RightForeArm', R_Hand: 'RightHand',
  L_Thigh: 'LeftUpLeg', L_Calf: 'LeftLeg', L_Foot: 'LeftFoot', L_Toe0: 'LeftToeBase',
  R_Thigh: 'RightUpLeg', R_Calf: 'RightLeg', R_Foot: 'RightFoot', R_Toe0: 'RightToeBase',
};
export function canonName(n: string) {
  const b = /^Bip01[_ ](.+)$/.exec(n);
  if (b) return BIPED[b[1].replace(/ /g, '_')] ?? n;
  return n.replace(/^mixamorig[:_]?/, '');
}

const base = () => (import.meta.env.BASE_URL ?? '/') + 'assets/people/';
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const anims: Partial<Record<Sex, THREE.AnimationClip[]>> = {};
const templates = new Map<string, RigTemplate>();
const pending = new Map<string, Promise<RigTemplate | null>>();
let animsLoading: Promise<boolean> | null = null;

export const rigsReady = () => !!anims.m && !!anims.f && [...templates.values()].some((t) => t.sex === 'm') && [...templates.values()].some((t) => t.sex === 'f');

/** The avatar id a look asks for. */
export function modelOf(look: Look): string {
  const list = PEOPLE[look.body === 'f' ? 'f' : 'm'];
  const i = look.model ?? (look.hairStyle ?? 0);
  return list[((i % list.length) + list.length) % list.length].id;
}

/** Template for a look: its own avatar when loaded, otherwise a loaded one of the same sex (and start loading it). */
export function rigTemplate(look: Look): RigTemplate {
  const id = modelOf(look);
  const t = templates.get(id);
  if (t) return t;
  void loadModel(id);
  const sex: Sex = look.body === 'f' ? 'f' : 'm';
  const same = [...templates.values()].filter((x) => x.sex === sex);
  return same[(look.hairStyle ?? 0) % same.length] ?? [...templates.values()][0];
}
export const modelLoaded = (look: Look) => templates.has(modelOf(look));

function sexOf(id: string): Sex { return PEOPLE.f.some((p) => p.id === id) ? 'f' : 'm'; }

/** Speed the feet travel over the ground in a looping in-place cycle (m/s, in template units). */
function cycleSpeed(scene: THREE.Object3D, clip: THREE.AnimationClip) {
  const mixer = new THREE.AnimationMixer(scene);
  const a = mixer.clipAction(clip); a.play();
  let lf: THREE.Object3D | null = null, rf: THREE.Object3D | null = null;
  scene.traverse((o) => { const c = canonName(o.name); if (c === 'LeftFoot') lf = o; if (c === 'RightFoot') rf = o; });
  if (!lf || !rf) { a.stop(); return 0; }
  let maxGap = 0;
  const n = 40, pl = new THREE.Vector3(), pr = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    mixer.setTime((clip.duration * i) / n);
    scene.updateMatrixWorld(true);
    (lf as THREE.Object3D).getWorldPosition(pl); (rf as THREE.Object3D).getWorldPosition(pr);
    maxGap = Math.max(maxGap, Math.hypot(pl.x - pr.x, pl.z - pr.z));
  }
  a.stop(); mixer.uncacheRoot(scene);
  // two steps per cycle; a step covers about the widest foot spread
  return (2 * maxGap * 1.15) / clip.duration;
}

function prepare(id: string, scene: THREE.Object3D): RigTemplate {
  const sex = sexOf(id);
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.userData.shared = true;
    m.frustumCulled = true;
    if (m.isSkinnedMesh) { m.computeBoundingSphere(); m.boundingSphere!.radius *= 1.6; }
    for (const mm of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      mm.metalness = 0;
      mm.roughness = /opacity|hair/i.test(mm.name) ? 0.6 : 0.72;
      mm.envMapIntensity = 0.55;
      if (/opacity/i.test(mm.name)) { mm.alphaTest = 0.45; mm.transparent = false; mm.side = THREE.DoubleSide; }
    }
  });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const h = box.max.y - box.min.y;
  // Rocketbox people are modelled at real size; just normalise units
  const scale = h > 0.5 && h < 2.5 ? 1 : 1.75 / Math.max(0.01, h);
  const clips: RigTemplate['clips'] = {};
  for (const c of anims[sex] ?? []) clips[c.name as RigClip] = c;
  const t: RigTemplate = { id, sex, scene, clips, scale, walkSpeed: 1.4, runSpeed: 3.5 };
  if (clips.walk) t.walkSpeed = cycleSpeed(scene, clips.walk) || 1.4;
  if (clips.run) t.runSpeed = cycleSpeed(scene, clips.run) || 3.5;
  return t;
}

async function loadAnims() {
  animsLoading ??= (async () => {
    const [m, f] = await Promise.all([loader.loadAsync(base() + 'anims_m.glb'), loader.loadAsync(base() + 'anims_f.glb')]);
    // keep only skeleton tracks (drop the exporter's motion-extraction helper)
    for (const c of [...m.animations, ...f.animations]) c.tracks = c.tracks.filter((t) => t.name.startsWith('Bip01'));
    anims.m = m.animations; anims.f = f.animations;
    return true;
  })();
  return animsLoading;
}

export function loadModel(id: string): Promise<RigTemplate | null> {
  const t = templates.get(id);
  if (t) return Promise.resolve(t);
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      try {
        await loadAnims();
        const g = await loader.loadAsync(base() + id + '.glb');
        const tpl = prepare(id, g.scene);
        templates.set(id, tpl);
        return tpl;
      } catch (e) { console.warn('[rig] could not load', id, e); return null; }
    })();
    pending.set(id, p);
  }
  return p;
}

/**
 * Load the clips plus a starting cast: the given looks' avatars and a few
 * others of each sex for the crowd. Remaining avatars stream in afterwards.
 * Resolves false (procedural fallback) on failure.
 */
export async function loadRigs(first: string[] = [], castPerSex = 4): Promise<boolean> {
  try {
    await loadAnims();
    const pick = (s: Sex) => PEOPLE[s].map((p) => p.id).sort(() => Math.random() - 0.5).slice(0, castPerSex);
    const ids = [...new Set([...first, ...pick('m'), ...pick('f')])];
    await Promise.all(ids.map(loadModel));
    if (!rigsReady()) return false;
    // stream the rest in the background
    setTimeout(() => { for (const s of ['m', 'f'] as Sex[]) for (const p of PEOPLE[s]) void loadModel(p.id); }, 4000);
    return true;
  } catch (e) {
    console.warn('[rig] falling back to procedural characters', e);
    return false;
  }
}

export function cloneBody(look: Look) {
  const t = rigTemplate(look);
  const root = cloneSkinned(t.scene) as THREE.Object3D;
  return { root, template: t };
}
