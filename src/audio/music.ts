// Original, royalty-free music composed procedurally at runtime.
//
// Architecture note: `MusicSource` is the seam for a future licensed catalog
// (e.g. a streaming partner SDK). The game never scrapes or embeds third-party
// streams; today every track below is generated in-code and is free to play in
// shared spaces (clubs, cars, home speakers).

import * as THREE from 'three';
import { audio } from './audio.js';

export type Genre = 'lofi' | 'house' | 'synthwave' | 'jazz' | 'pop' | 'rock' | 'ambient' | 'dnb' | 'trap';
export interface TrackDef { id: number; title: string; artist: string; genre: Genre; bpm: number; seed: number; root: number }

export interface MusicSource {
  name: string;
  licensed: boolean;
  tracks(): TrackDef[];
}

export const ORIGINALS: TrackDef[] = [
  { id: 1, title: 'Mempool Mornings', artist: 'Lo-Fi Ledger', genre: 'lofi', bpm: 78, seed: 11, root: 57 },
  { id: 2, title: 'Block Brew Rain', artist: 'Lo-Fi Ledger', genre: 'lofi', bpm: 72, seed: 23, root: 55 },
  { id: 3, title: 'Liquidity Pool Party', artist: 'DJ Nova', genre: 'house', bpm: 124, seed: 37, root: 45 },
  { id: 4, title: 'Gwei Low', artist: 'DJ Nova', genre: 'house', bpm: 122, seed: 41, root: 48 },
  { id: 5, title: 'Neon Halving', artist: 'Satoshi Sunset', genre: 'synthwave', bpm: 104, seed: 53, root: 50 },
  { id: 6, title: 'Night Drive on Ring Road', artist: 'Satoshi Sunset', genre: 'synthwave', bpm: 98, seed: 67, root: 52 },
  { id: 7, title: 'Whale Lounge', artist: 'The Cold Storage Trio', genre: 'jazz', bpm: 92, seed: 71, root: 53 },
  { id: 8, title: 'Ledger Lines', artist: 'The Cold Storage Trio', genre: 'jazz', bpm: 110, seed: 83, root: 58 },
  { id: 9, title: 'Green Candles', artist: 'Moonshot Girls', genre: 'pop', bpm: 116, seed: 97, root: 60 },
  { id: 10, title: 'Seed Phrase (Never Tell)', artist: 'Moonshot Girls', genre: 'pop', bpm: 120, seed: 101, root: 57 },
  { id: 11, title: 'Hard Fork', artist: 'Proof of Riff', genre: 'rock', bpm: 132, seed: 113, root: 52 },
  { id: 12, title: 'Gas Wars', artist: 'Proof of Riff', genre: 'rock', bpm: 140, seed: 127, root: 50 },
  { id: 13, title: 'Cold Wallet', artist: 'Merkle Drift', genre: 'ambient', bpm: 70, seed: 131, root: 48 },
  { id: 14, title: 'Genesis Block', artist: 'Merkle Drift', genre: 'ambient', bpm: 64, seed: 149, root: 50 },
  { id: 15, title: 'Flash Loan', artist: 'Bytecode', genre: 'dnb', bpm: 172, seed: 151, root: 45 },
  { id: 16, title: 'Rug Pull Riddim', artist: 'Bytecode', genre: 'trap', bpm: 140, seed: 163, root: 43 },
  { id: 17, title: 'Diamond Hands', artist: 'Bytecode', genre: 'trap', bpm: 146, seed: 179, root: 46 },
  { id: 18, title: 'Sunrise Over Hash Park', artist: 'Lo-Fi Ledger', genre: 'lofi', bpm: 80, seed: 191, root: 60 },
];

export const originalsSource: MusicSource = { name: 'Crypto City FM Originals (royalty-free)', licensed: true, tracks: () => ORIGINALS };

export const STATIONS: Record<string, { name: string; tracks: number[] }> = {
  lofi: { name: 'Hash Park Lo-Fi', tracks: [1, 2, 18] },
  club: { name: 'Liquidity Club Mix', tracks: [3, 15, 4, 16, 17] },
  jazz: { name: 'Cold Storage Jazz', tracks: [7, 8] },
  pop: { name: 'City Pop 101.3', tracks: [9, 10, 5] },
  rock: { name: 'Proof of Riff Radio', tracks: [11, 12] },
  synthwave: { name: 'Neon Ring Road', tracks: [5, 6] },
  ambient: { name: 'Merkle Ambient', tracks: [13, 14] },
};

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11], penta: [0, 3, 5, 7, 10], mixo: [0, 2, 4, 5, 7, 9, 10],
};
const GENRE: Record<Genre, { scale: string; prog: number[][]; kick: string; snare: string; hat: string; bass: string; swing: number; lead: OscillatorType; pad: boolean; padCut: number }> = {
  lofi: { scale: 'dorian', prog: [[0, 3, 4, 2], [1, 4, 0, 5], [5, 3, 0, 4]], kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x.....x...x.....', swing: 0.18, lead: 'triangle', pad: true, padCut: 900 },
  house: { scale: 'minor', prog: [[0, 5, 3, 4], [0, 3, 5, 4]], kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: '..x...x...x...xx', swing: 0, lead: 'sawtooth', pad: true, padCut: 1600 },
  synthwave: { scale: 'minor', prog: [[0, 5, 2, 6], [0, 3, 5, 4]], kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'xxxxxxxxxxxxxxxx', swing: 0, lead: 'sawtooth', pad: true, padCut: 2200 },
  jazz: { scale: 'dorian', prog: [[1, 4, 0, 5], [0, 5, 1, 4]], kick: 'x.......x.......', snare: '........x.......', hat: 'x..x.xx..x.xx..x', bass: 'x...x...x...x...', swing: 0.3, lead: 'triangle', pad: true, padCut: 1200 },
  pop: { scale: 'major', prog: [[0, 4, 5, 3], [5, 3, 0, 4]], kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x...x.x.x...x.x.', swing: 0, lead: 'square', pad: true, padCut: 2000 },
  rock: { scale: 'mixo', prog: [[0, 6, 3, 0], [0, 3, 4, 3]], kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x.x.x.x.x.x.x.x.', swing: 0, lead: 'sawtooth', pad: false, padCut: 3000 },
  ambient: { scale: 'major', prog: [[0, 3, 5, 4], [0, 5, 3, 1]], kick: '................', snare: '................', hat: '................', bass: 'x...............', swing: 0, lead: 'sine', pad: true, padCut: 700 },
  dnb: { scale: 'minor', prog: [[0, 5, 3, 6]], kick: 'x.........x.....', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', bass: 'x.....x...x.x...', swing: 0, lead: 'square', pad: true, padCut: 1400 },
  trap: { scale: 'minor', prog: [[0, 5, 6, 4], [0, 3, 6, 5]], kick: 'x......x..x.....', snare: '........x.......', hat: 'xxxxxxxxxx.xxxxx', bass: 'x......x..x.....', swing: 0, lead: 'triangle', pad: true, padCut: 1100 },
};

function srng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export const BARS = 32;
export function trackSeconds(t: TrackDef) { return (BARS * 4 * 60) / t.bpm; }

interface Song {
  def: TrackDef; stepDur: number; steps: number;
  chordAt: (bar: number) => number[];
  bassAt: (step: number) => number | null;
  leadAt: (step: number) => number | null;
  section: (bar: number) => { drums: boolean; bass: boolean; pad: boolean; lead: boolean };
  g: (typeof GENRE)[Genre];
}

function compose(def: TrackDef): Song {
  const g = GENRE[def.genre];
  const r = srng(def.seed);
  const scale = SCALES[g.scale];
  const prog = g.prog[Math.floor(r() * g.prog.length)];
  const deg = (d: number, oct = 0) => def.root + scale[((d % scale.length) + scale.length) % scale.length] + 12 * (oct + Math.floor(d / scale.length));
  const chord = (d: number) => [deg(d), deg(d + 2), deg(d + 4), deg(d + 6)];
  // 2-bar motif + variation
  const motif: (number | null)[] = [];
  let cur = Math.floor(r() * 5);
  for (let i = 0; i < 32; i++) {
    const rest = r() < (def.genre === 'ambient' ? 0.75 : def.genre === 'jazz' ? 0.35 : 0.45);
    if (i % 2 === 1 && r() < 0.6) { motif.push(null); continue; }
    if (rest) { motif.push(null); continue; }
    cur += Math.floor(r() * 5) - 2;
    cur = Math.max(-2, Math.min(9, cur));
    motif.push(cur);
  }
  const variation = motif.map((m) => (m !== null && r() < 0.3 ? m + (r() < 0.5 ? 1 : -1) : m));
  const stepDur = 60 / def.bpm / 4;
  return {
    def, stepDur, steps: BARS * 16, g,
    chordAt: (bar) => chord(prog[bar % prog.length]),
    bassAt: (step) => {
      const s = step % 16;
      if (g.bass[s] !== 'x') return null;
      const bar = Math.floor(step / 16);
      const root = deg(prog[bar % prog.length], -2);
      return def.genre === 'synthwave' && s % 2 ? root + 12 : root;
    },
    leadAt: (step) => {
      const bar = Math.floor(step / 16);
      const m = (bar % 4 < 2 ? motif : variation)[step % 32];
      if (m === null) return null;
      const ch = prog[bar % prog.length];
      return deg(m + (m % 2 === 0 ? 0 : 0) + (ch % 2), 1);
    },
    section: (bar) => {
      if (bar < 4) return { drums: false, bass: def.genre === 'ambient', pad: true, lead: false };
      if (bar >= BARS - 2) return { drums: false, bass: false, pad: true, lead: false };
      if (bar < 12) return { drums: true, bass: true, pad: true, lead: false };
      if (bar >= 20 && bar < 22) return { drums: false, bass: true, pad: true, lead: true };
      return { drums: true, bass: true, pad: g.pad, lead: true };
    },
  };
}

class SongPlayer {
  private song: Song;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private out: GainNode;
  private delay: DelayNode;
  stopped = false;

  constructor(def: TrackDef, dest: AudioNode, offsetSec: number, private onEnd?: () => void) {
    this.song = compose(def);
    const ctx = audio.ctx!;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
    this.out.connect(dest);
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.song.stepDur * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const wet = ctx.createGain(); wet.gain.value = 0.25;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.out);
    const startStep = Math.max(0, Math.floor(offsetSec / this.song.stepDur));
    this.step = startStep;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private schedule() {
    const ctx = audio.ctx!;
    while (this.nextTime < ctx.currentTime + 0.15 && !this.stopped) {
      if (this.step >= this.song.steps) { this.stop(); this.onEnd?.(); return; }
      this.playStep(this.step, this.nextTime);
      const swing = this.step % 2 === 0 ? 1 + this.song.g.swing : 1 - this.song.g.swing;
      this.nextTime += this.song.stepDur * swing;
      this.step++;
    }
  }

  private playStep(step: number, t: number) {
    const s = this.song, g = s.g;
    const bar = Math.floor(step / 16), i = step % 16;
    const sec = s.section(bar);
    if (sec.drums) {
      if (g.kick[i] === 'x') this.kick(t);
      if (g.snare[i] === 'x') this.snare(t);
      if (g.hat[i] === 'x') this.hat(t, i % 4 === 2 ? 0.07 : 0.04);
      if (s.def.genre === 'trap' && i >= 12 && bar % 4 === 3) this.hat(t + s.stepDur / 2, 0.03);
    }
    if (sec.bass) { const n = s.bassAt(step); if (n !== null) this.bass(n, t, s.stepDur * (s.def.genre === 'ambient' ? 14 : 1.8)); }
    if (sec.pad && i === 0) this.pad(s.chordAt(bar), t, s.stepDur * 16);
    if (sec.lead) { const n = s.leadAt(step); if (n !== null) this.lead(n, t, s.stepDur * 1.6); }
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  private kick(t: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.002, 0.9, 0.28);
    o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.32);
  }
  private snare(t: number) {
    const ctx = audio.ctx!;
    const n = audio.noiseSource(false); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    const g = ctx.createGain(); this.env(g, t, 0.002, 0.45, 0.16);
    n.connect(f).connect(g).connect(this.out); n.start(t, Math.random()); n.stop(t + 0.2);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190; const g2 = ctx.createGain(); this.env(g2, t, 0.002, 0.25, 0.08);
    o.connect(g2).connect(this.out); o.start(t); o.stop(t + 0.1);
  }
  private hat(t: number, v: number) {
    const ctx = audio.ctx!;
    const n = audio.noiseSource(false); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain(); this.env(g, t, 0.001, v * 2.5, 0.04);
    n.connect(f).connect(g).connect(this.out); n.start(t, Math.random()); n.stop(t + 0.06);
  }
  private bass(m: number, t: number, d: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator(); o.type = this.song.def.genre === 'ambient' ? 'sine' : 'sawtooth'; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.song.def.genre === 'rock' ? 900 : 420;
    const g = ctx.createGain(); this.env(g, t, 0.01, 0.32, d);
    o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + d + 0.05);
  }
  private pad(notes: number[], t: number, d: number) {
    const ctx = audio.ctx!;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = this.song.g.padCut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + d * 0.25); g.gain.linearRampToValueAtTime(0.0001, t + d);
    f.connect(g).connect(this.out);
    for (const n of notes.slice(0, 3)) for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = this.song.def.genre === 'rock' ? 'square' : 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + d + 0.05);
    }
  }
  private lead(m: number, t: number, d: number) {
    const ctx = audio.ctx!;
    const o = ctx.createOscillator(); o.type = this.song.g.lead; o.frequency.value = mtof(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = ctx.createGain(); this.env(g, t, 0.01, this.song.g.lead === 'sine' ? 0.12 : 0.07, d);
    o.connect(f).connect(g); g.connect(this.out); g.connect(this.delay); o.start(t); o.stop(t + d + 0.05);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    const ctx = audio.ctx!;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    const o = this.out;
    setTimeout(() => o.disconnect(), 800);
  }
}

export type Output = 'headphones' | 'speaker' | 'car';

/** The player's personal music (phone app). */
export class PersonalMusic {
  source: MusicSource = originalsSource;
  queue: number[] = ORIGINALS.map((t) => t.id);
  index = 0;
  playing = false;
  startedAt = 0;
  output: Output = 'headphones';
  speakerPos = new THREE.Vector3();
  volume = 0.8;
  playlists: { name: string; tracks: number[] }[] = [];
  private player: SongPlayer | null = null;
  private gain: GainNode | null = null;
  private panner: PannerNode | null = null;
  private carFilter: BiquadFilterNode | null = null;
  onChange?: () => void;

  constructor() {
    try { this.playlists = JSON.parse(localStorage.getItem('cc_playlists') ?? '[]'); } catch { this.playlists = []; }
    if (!this.playlists.length) this.playlists = [{ name: 'Chill', tracks: [1, 2, 13, 18] }, { name: 'Hype', tracks: [3, 15, 16, 17] }];
    this.volume = Number(localStorage.getItem('cc_mvol') ?? 0.8);
  }

  current() { return ORIGINALS.find((t) => t.id === this.queue[this.index]) ?? ORIGINALS[0]; }

  private ensureGraph() {
    const ctx = audio.ctx!;
    if (this.gain) return;
    this.gain = ctx.createGain();
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 3; this.panner.rolloffFactor = 1.2;
    this.carFilter = ctx.createBiquadFilter(); this.carFilter.type = 'lowpass'; this.carFilter.frequency.value = 6000;
    this.route();
  }
  private route() {
    if (!this.gain) return;
    this.gain.disconnect();
    this.gain.gain.value = this.volume;
    if (this.output === 'speaker') { this.gain.connect(this.panner!).connect(audio.musicBus); this.setSpeakerPos(this.speakerPos); }
    else if (this.output === 'car') this.gain.connect(this.carFilter!).connect(audio.musicBus);
    else this.gain.connect(audio.musicBus);
  }
  setOutput(o: Output, pos?: THREE.Vector3) {
    this.output = o;
    if (pos) this.speakerPos.copy(pos);
    if (audio.ctx) { this.ensureGraph(); this.route(); }
    this.onChange?.();
  }
  setSpeakerPos(p: THREE.Vector3) {
    this.speakerPos.copy(p);
    if (this.panner?.positionX) { this.panner.positionX.value = p.x; this.panner.positionY.value = p.y; this.panner.positionZ.value = p.z; }
  }
  setVolume(v: number) { this.volume = v; localStorage.setItem('cc_mvol', String(v)); if (this.gain) this.gain.gain.value = v; this.onChange?.(); }

  play(id?: number, queue?: number[]) {
    audio.init();
    if (!audio.ctx) return;
    this.ensureGraph();
    if (queue) this.queue = queue;
    if (id !== undefined) { const i = this.queue.indexOf(id); this.index = i >= 0 ? i : 0; if (i < 0) { this.queue = [id, ...this.queue]; this.index = 0; } }
    this.player?.stop();
    const def = this.current();
    this.player = new SongPlayer(def, this.gain!, 0, () => this.next());
    this.startedAt = Date.now();
    this.playing = true;
    this.onChange?.();
  }
  pause() { this.player?.stop(); this.player = null; this.playing = false; this.onChange?.(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  next() { this.index = (this.index + 1) % this.queue.length; if (this.playing || this.player) this.play(); else this.onChange?.(); }
  prev() { this.index = (this.index - 1 + this.queue.length) % this.queue.length; if (this.playing) this.play(); else this.onChange?.(); }
  savePlaylists() { localStorage.setItem('cc_playlists', JSON.stringify(this.playlists)); this.onChange?.(); }
  /** What other players in the same zone should hear (only when playing on speakers). */
  shared() { return this.playing && this.output === 'speaker' ? { track: this.current().id, t0: this.startedAt } : null; }
}

/** Positional music synced to the shared clock: venue stations and other players' home speakers. */
export class SyncedMusic {
  private player: SongPlayer | null = null;
  private panner: PannerNode | null = null;
  private gain: GainNode | null = null;
  private key = '';
  private trackEnd = 0;

  setStation(station: string | null, pos?: THREE.Vector3, volume = 1) {
    if (!station) { this.stop(); return; }
    const st = STATIONS[station];
    if (!st || !audio.ctx) return;
    const tracks = st.tracks.map((id) => ORIGINALS.find((t) => t.id === id)!);
    const cycle = tracks.reduce((s, t) => s + trackSeconds(t), 0);
    let at = (Date.now() / 1000) % cycle;
    let def = tracks[0];
    for (const t of tracks) { const len = trackSeconds(t); if (at < len) { def = t; break; } at -= len; }
    this.start('st:' + station + ':' + def.id, def, at, pos, volume, () => this.setStation(station, pos, volume));
  }

  setRemote(track: number | null, t0 = 0, pos?: THREE.Vector3) {
    if (track === null) { if (this.key.startsWith('rm:')) this.stop(); return; }
    const def = ORIGINALS.find((t) => t.id === track);
    if (!def || !audio.ctx) return;
    const at = (Date.now() - t0) / 1000;
    if (at > trackSeconds(def)) return;
    this.start('rm:' + track + ':' + t0, def, at, pos, 0.8);
  }

  private start(key: string, def: TrackDef, offset: number, pos: THREE.Vector3 | undefined, volume: number, onEnd?: () => void) {
    if (key === this.key && this.player && !this.player.stopped) { if (pos) this.setPos(pos); return; }
    this.stop();
    const ctx = audio.ctx!;
    this.gain = ctx.createGain(); this.gain.gain.value = volume;
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 6; this.panner.rolloffFactor = 0.8;
    this.gain.connect(this.panner).connect(audio.musicBus);
    if (pos) this.setPos(pos);
    this.player = new SongPlayer(def, this.gain, offset, onEnd);
    this.key = key;
    this.trackEnd = Date.now() + (trackSeconds(def) - offset) * 1000;
  }
  setPos(p: THREE.Vector3) { if (this.panner?.positionX) { this.panner.positionX.value = p.x; this.panner.positionY.value = p.y; this.panner.positionZ.value = p.z; } }
  duck(on: boolean) { if (this.gain && audio.ctx) this.gain.gain.setTargetAtTime(on ? 0.25 : 1, audio.ctx.currentTime, 0.3); }
  stop() {
    this.player?.stop(); this.player = null;
    const g = this.gain, p = this.panner;
    setTimeout(() => { g?.disconnect(); p?.disconnect(); }, 900);
    this.gain = null; this.panner = null; this.key = '';
    void this.trackEnd;
  }
}

export const music = new PersonalMusic();
export const venueMusic = new SyncedMusic();
export const remoteMusic = new SyncedMusic();
