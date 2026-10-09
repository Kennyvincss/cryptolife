// A rigged, mocap-animated body for one character. Plays retargeted clips with
// cross-fades and layers simple procedural poses (sit, drive, phone, wave…) on top.

import * as THREE from 'three';
import type { Look } from '../../shared/types.js';
import { cloneBody, type RigClip, type Sex } from './rig.js';
import type { Anim } from './humanoid.js';

const CLIP_FOR: Record<Anim, RigClip> = {
  idle: 'idle', walk: 'walk', run: 'run', dance: 'dance', talk: 'agree', wave: 'idle', phone: 'idle',
  sit: 'idle', drive: 'idle', ride: 'idle', eat: 'idle', type: 'idle', sleep: 'idle', workout: 'idle',
};
const SEATED = new Set<Anim>(['sit', 'drive', 'ride', 'eat', 'type']);

const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _pw = new THREE.Quaternion(), _rw = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class RigBody {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  private actions = new Map<RigClip, THREE.AnimationAction>();
  private current: RigClip = 'idle';
  private bones = new Map<string, THREE.Bone>();
  private owned: THREE.Material[];
  private w = new Map<Anim, number>(); // overlay pose weights
  private phase = Math.random() * 10;
  /** Seconds of animation to accumulate before updating (distance LOD for crowds). */
  animStep = 0;
  private acc = 0;
  hipHeight: number;
  head = new THREE.Group();
  hand = new THREE.Group();
  danceOffset = 0;

  constructor(public look: Look, private character: THREE.Object3D) {
    const sex: Sex = look.body === 'f' ? 'f' : 'm';
    const b = cloneBody(sex);
    this.root = b.root;
    this.owned = b.owned;
    const H = look.height ?? 1;
    const W = THREE.MathUtils.clamp(look.build ?? 1, 0.85, 1.2);
    this.root.scale.set(b.template.scale * H * (0.9 + W * 0.1), b.template.scale * H, b.template.scale * H * (0.9 + W * 0.1));
    b.tint('skin', look.skin);
    b.tint('hair', look.hairColor);
    b.tint('top', look.colors.top ?? '#eeeeee');
    b.tint('bottom', look.colors.bottom ?? '#2f4a7a');
    b.tint('shoes', look.colors.shoes ?? '#f2f2f2');
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) { const k = o.name.replace(/^mixamorig[:_]?/, ''); if (!this.bones.has(k)) this.bones.set(k, o as THREE.Bone); }
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const [k, clip] of Object.entries(b.template.clips) as [RigClip, THREE.AnimationClip][]) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions.set(k, a);
    }
    const idle = this.actions.get('idle')!;
    idle.setEffectiveWeight(1);
    idle.time = Math.random() * idle.getClip().duration;
    this.mixer.update(0);

    // Attachment frames on the head and right hand, aligned with the character's
    // axes in the idle pose so procedural props (hair, hats, phone) sit correctly.
    this.character.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
    const charQ = this.character.getWorldQuaternion(new THREE.Quaternion());
    const charS = this.character.getWorldScale(new THREE.Vector3()).x;
    const attach = (bone: THREE.Bone | undefined, g: THREE.Group, offset: THREE.Vector3, scale: number) => {
      if (!bone) return;
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const bs = bone.getWorldScale(new THREE.Vector3()).x;
      g.quaternion.copy(bq.invert().multiply(charQ));
      g.scale.setScalar((scale * charS) / bs);
      g.position.copy(offset.clone().multiplyScalar(charS).applyQuaternion(charQ).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()).invert()).divideScalar(bs));
      bone.add(g);
    };
    const headB = this.bones.get('Head'), top = this.bones.get('HeadTop_End');
    const headLen = headB && top ? headB.getWorldPosition(new THREE.Vector3()).distanceTo(top.getWorldPosition(new THREE.Vector3())) / charS : 0.2;
    attach(headB, this.head, new THREE.Vector3(0, headLen * 0.5, 0.01 * H), (headLen / 0.21) * 0.95);
    attach(this.bones.get('RightHand'), this.hand, new THREE.Vector3(0, -0.06 * H, 0.02 * H), H);
    const hips = this.bones.get('Hips');
    this.hipHeight = hips ? hips.getWorldPosition(new THREE.Vector3()).y - this.character.getWorldPosition(new THREE.Vector3()).y : 0.95 * H;
    if (this.hipHeight < 0.3) this.hipHeight = 0.95 * H;
  }

  /** Rotate `bone` by `angle` about `axis` given in character space (applied after the clip). */
  private turn(name: string, axis: THREE.Vector3, angle: number) {
    const b = this.bones.get(name);
    if (!b || Math.abs(angle) < 1e-4) return;
    b.parent!.getWorldQuaternion(_pw);
    this.character.getWorldQuaternion(_rw);
    _ax.copy(axis).applyQuaternion(_rw);
    _q.setFromAxisAngle(_ax, angle);
    // local' = Pw⁻¹ · R · Pw · local
    const pinv = _pw.clone().invert();
    b.quaternion.premultiply(pinv.multiply(_q).multiply(_pw));
    b.updateMatrixWorld(true);
  }

  update(dt: number, anim: Anim, speed: number) {
    this.acc += dt;
    if (this.acc < this.animStep) return;
    dt = this.acc;
    this.acc = 0;
    this.phase += dt;

    const want = CLIP_FOR[anim] ?? 'idle';
    if (want !== this.current) {
      const from = this.actions.get(this.current), to = this.actions.get(want);
      if (to) {
        to.reset();
        if (want === 'dance') to.time = this.danceOffset % to.getClip().duration;
        to.setEffectiveWeight(1);
        to.play();
        if (from) to.crossFadeFrom(from, 0.25, false);
        this.current = want;
      }
    }
    const a = this.actions.get(this.current);
    if (a) {
      if (this.current === 'walk') a.timeScale = THREE.MathUtils.clamp(speed / 1.6, 0.6, 1.45);
      else if (this.current === 'run') a.timeScale = THREE.MathUtils.clamp(speed / 5, 0.75, 1.3);
      else a.timeScale = anim === 'sleep' ? 0.3 : 1;
    }
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);

    // ease overlay weights
    const k = 1 - Math.exp(-dt * 10);
    for (const key of ['sit', 'drive', 'ride', 'eat', 'type', 'phone', 'wave', 'workout', 'sleep'] as Anim[]) {
      const cur = this.w.get(key) ?? 0;
      const target = key === anim ? 1 : 0;
      const v = cur + (target - cur) * k;
      this.w.set(key, v < 0.002 ? 0 : v);
    }
    const W = (a: Anim) => this.w.get(a) ?? 0;
    const seat = W('sit') + W('eat') + W('type');
    const drive = W('drive'), ride = W('ride');
    const legs = seat + drive + ride;
    if (legs > 0) {
      const thigh = -1.5 * seat - 1.3 * drive - 1.2 * ride;
      const knee = 1.5 * seat + 1.15 * drive + 1.5 * ride;
      for (const s of ['Left', 'Right']) { this.turn(`${s}UpLeg`, X, thigh); this.turn(`${s}Leg`, X, knee); }
      if (ride) { this.turn('LeftUpLeg', Z, 0.3 * ride); this.turn('RightUpLeg', Z, -0.3 * ride); }
      // relaxed arms on the lap
      const lap = seat * (1 - W('eat') - W('type'));
      for (const s of ['Left', 'Right']) { this.turn(`${s}Arm`, X, -0.45 * lap); this.turn(`${s}ForeArm`, X, -0.7 * lap); }
    }
    if (drive + ride > 0) {
      const d = drive + ride;
      this.turn('Spine', X, -0.12 * drive + 0.3 * ride);
      this.turn('LeftArm', X, -1.05 * d); this.turn('RightArm', X, -1.05 * d);
      this.turn('LeftArm', Z, -0.25 * d); this.turn('RightArm', Z, 0.25 * d);
      this.turn('LeftForeArm', X, -0.45 * d); this.turn('RightForeArm', X, -0.45 * d);
    }
    const type = W('type');
    if (type) {
      const t = Math.sin(this.phase * 16) * 0.05;
      for (const s of ['Left', 'Right']) { this.turn(`${s}Arm`, X, -0.55 * type); this.turn(`${s}ForeArm`, X, (-1.0 + t) * type); }
      this.turn('Head', X, 0.2 * type);
    }
    const eat = W('eat');
    if (eat) {
      const e = (Math.sin(this.phase * 1.6) + 1) / 2;
      this.turn('RightArm', X, (-0.6 - e * 0.5) * eat); this.turn('RightForeArm', X, (-1.2 - e * 0.9) * eat);
      this.turn('LeftArm', X, -0.4 * eat); this.turn('LeftForeArm', X, -0.9 * eat);
    }
    const phone = W('phone');
    if (phone) {
      this.turn('RightArm', X, -0.55 * phone); this.turn('RightArm', Z, 0.25 * phone);
      this.turn('RightForeArm', X, -1.75 * phone); this.turn('RightForeArm', Z, 0.35 * phone);
      this.turn('Head', X, 0.38 * phone);
    }
    const wave = W('wave');
    if (wave) {
      const s = Math.sin(this.phase * 7);
      this.turn('RightArm', Z, -2.45 * wave);
      this.turn('RightForeArm', Z, (-0.4 + s * 0.35) * wave);
    }
    const wo = W('workout');
    if (wo) {
      const s = (Math.sin(this.phase * 5) + 1) / 2;
      this.turn('LeftArm', Z, (0.4 + s * 2.2) * wo); this.turn('RightArm', Z, -(0.4 + s * 2.2) * wo);
      for (const sd of ['Left', 'Right']) { this.turn(`${sd}UpLeg`, X, -0.7 * s * wo); this.turn(`${sd}Leg`, X, 1.2 * s * wo); }
    }
  }

  bodyOffset(anim: Anim) {
    if (SEATED.has(anim)) return -this.hipHeight + 0.5;
    if (anim === 'workout') return -((Math.sin(this.phase * 5) + 1) / 2) * 0.22;
    return 0;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const m of this.owned) m.dispose();
    this.root.removeFromParent();
  }
}
