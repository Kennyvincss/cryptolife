// Web Audio engine: listener, buses, city ambience, engine sound and UI sfx.

import * as THREE from 'three';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  noise!: AudioBuffer;
  private amb?: { city: GainNode; rain: GainNode; birds: GainNode; crickets: GainNode; filter: BiquadFilterNode };
  private engine?: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  private nextChirp = 0;
  volumes = { master: 0.8, music: 0.7, sfx: 0.8, amb: 0.6 };

  constructor() {
    try { Object.assign(this.volumes, JSON.parse(localStorage.getItem('cc_vol') ?? '{}')); } catch { /* ignore */ }
  }

  /** Must be called from a user gesture. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(comp);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(comp);
    this.ambBus = ctx.createGain(); this.ambBus.connect(comp);
    this.applyVolumes();
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.ambBus.gain.value = this.volumes.amb;
    localStorage.setItem('cc_vol', JSON.stringify(this.volumes));
  }

  noiseSource(loop = true) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    return s;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    const mk = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.ambBus); return g; };
    const city = mk(), rain = mk(), birds = mk(), crickets = mk();
    // city rumble: brown-ish noise
    const n1 = this.noiseSource();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    n1.connect(lp).connect(city); n1.start();
    const n2 = this.noiseSource();
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 2500; hp.Q.value = 0.4;
    n2.connect(hp).connect(rain); n2.start();
    this.amb = { city, rain, birds, crickets, filter: lp };
  }

  updateListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setTargetAtTime(p.x, t, 0.05); l.positionY.setTargetAtTime(p.y, t, 0.05); l.positionZ.setTargetAtTime(p.z, t, 0.05);
      l.forwardX.setTargetAtTime(f.x, t, 0.05); l.forwardY.setTargetAtTime(f.y, t, 0.05); l.forwardZ.setTargetAtTime(f.z, t, 0.05);
      l.upX.setTargetAtTime(u.x, t, 0.05); l.upY.setTargetAtTime(u.y, t, 0.05); l.upZ.setTargetAtTime(u.z, t, 0.05);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  ambience(o: { indoor: boolean; night: number; rain: boolean; trafficNear: number }) {
    if (!this.ctx || !this.amb) return;
    const t = this.ctx.currentTime;
    const out = o.indoor ? 0.15 : 1;
    this.amb.city.gain.setTargetAtTime((0.12 + o.trafficNear * 0.25) * out, t, 0.5);
    this.amb.rain.gain.setTargetAtTime(o.rain ? 0.12 * (o.indoor ? 0.3 : 1) : 0, t, 1);
    if (!o.indoor && performance.now() > this.nextChirp) {
      this.nextChirp = performance.now() + (o.night > 0.6 ? 900 : 1800) + Math.random() * 3000;
      if (o.night > 0.6) this.cricket(); else if (o.night < 0.3 && !o.rain) this.bird();
    }
  }

  private bird() {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine';
    const t = ctx.currentTime;
    const f0 = 2500 + Math.random() * 1500;
    o.frequency.setValueAtTime(f0, t);
    for (let i = 0; i < 3; i++) { o.frequency.linearRampToValueAtTime(f0 * 1.3, t + i * 0.12 + 0.05); o.frequency.linearRampToValueAtTime(f0, t + i * 0.12 + 0.1); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.025, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.ambBus); o.start(t); o.stop(t + 0.45);
  }
  private cricket() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 4400; o.type = 'triangle';
      g.gain.setValueAtTime(0, t + i * 0.07); g.gain.linearRampToValueAtTime(0.012, t + i * 0.07 + 0.01); g.gain.linearRampToValueAtTime(0, t + i * 0.07 + 0.05);
      o.connect(g).connect(this.ambBus); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.06);
    }
  }

  /** Continuous engine tone; call every frame while driving (rpm 0..1). */
  engineSound(on: boolean, rpm = 0, electric = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (on && !this.engine) {
      const osc = ctx.createOscillator(); const osc2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass';
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.type = 'sawtooth'; osc2.type = 'square';
      osc.connect(filter); osc2.connect(filter); filter.connect(gain).connect(this.sfxBus);
      osc.start(); osc2.start();
      this.engine = { osc, osc2, gain, filter };
    }
    if (!this.engine) return;
    const t = ctx.currentTime;
    if (!on) {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.1);
      const e = this.engine; this.engine = undefined;
      setTimeout(() => { try { e.osc.stop(); e.osc2.stop(); } catch { /* */ } }, 500);
      return;
    }
    const base = electric ? 180 + rpm * 900 : 38 + rpm * 120;
    this.engine.osc.frequency.setTargetAtTime(base, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(base * (electric ? 1.5 : 0.5), t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(electric ? 1600 : 300 + rpm * 1400, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(electric ? 0.015 + rpm * 0.02 : 0.05 + rpm * 0.05, t, 0.1);
  }

  sfx(kind: 'click' | 'cash' | 'notify' | 'door' | 'horn' | 'error' | 'level') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const tone = (f: number, d: number, type: OscillatorType = 'sine', v = 0.15, at = 0) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(v, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + d);
      o.connect(g).connect(this.sfxBus); o.start(t + at); o.stop(t + at + d + 0.02);
    };
    switch (kind) {
      case 'click': tone(1200, 0.05, 'square', 0.04); break;
      case 'cash': tone(1318, 0.12, 'triangle', 0.12); tone(1760, 0.25, 'triangle', 0.12, 0.08); break;
      case 'notify': tone(880, 0.12, 'sine', 0.1); tone(1320, 0.18, 'sine', 0.08, 0.1); break;
      case 'door': { const n = this.noiseSource(false); const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); n.connect(f).connect(g).connect(this.sfxBus); n.start(t); n.stop(t + 0.35); break; }
      case 'horn': tone(392, 0.4, 'sawtooth', 0.08); tone(494, 0.4, 'sawtooth', 0.06); break;
      case 'error': tone(220, 0.2, 'square', 0.06); break;
      case 'level': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.09)); break;
    }
  }
}

export const audio = new AudioEngine();
