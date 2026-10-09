// Day/night cycle, sun/moon lighting, environment reflections, fog, stars and weather.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type Weather = 'clear' | 'cloudy' | 'rain';

/** Deterministic weather from the shared clock, so every client sees the same sky. */
export function weatherAt(gameMinutes: number): Weather {
  const slot = Math.floor(gameMinutes / 180); // 3 game-hour slots
  const h = Math.sin(slot * 12.9898) * 43758.5453;
  const r = h - Math.floor(h);
  return r < 0.15 ? 'rain' : r < 0.4 ? 'cloudy' : 'clear';
}

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbcd8ff, 0x50483c, 0.6);
  stars: THREE.Points;
  rain: THREE.LineSegments;
  night = 0;
  weather: Weather = 'clear';
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private lastEnvKey = '';
  private sunDir = new THREE.Vector3();
  indoor = false;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.Fog(0xbfd4e6, 180, 1400);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    const sg = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.multiplyScalar(1800);
      pts.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    scene.add(this.stars);

    const rg = new THREE.BufferGeometry();
    const rp: number[] = [];
    for (let i = 0; i < 2500; i++) {
      const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80;
      rp.push(x, y, z, x + 0.05, y - 0.7, z);
    }
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.35 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    scene.add(this.rain);
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }

  update(gameMinutes: number, focus: THREE.Vector3, camPos: THREE.Vector3, dt: number) {
    const dayMin = ((gameMinutes % 1440) + 1440) % 1440;
    // sun path: rises 06:00, sets 19:30
    const t = (dayMin - 360) / (1170 - 360);
    const elev = Math.sin(Math.PI * t) * 62 - 4; // degrees
    const azim = 100 + t * 160;
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.weather = weatherAt(gameMinutes);
    const cloudy = this.weather !== 'clear' ? (this.weather === 'rain' ? 1 : 0.55) : 0;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 4 + cloudy * 14;
    u.rayleigh.value = 1.2 + cloudy * 2.5;
    const day = THREE.MathUtils.clamp((elev + 6) / 18, 0, 1);
    this.night = 1 - day;

    // sun / moon light
    const sunUp = elev > -2;
    const lightDir = sunUp ? this.sunDir.clone() : new THREE.Vector3(-0.3, 0.8, 0.4).normalize();
    this.sun.position.copy(focus).addScaledVector(lightDir, 150);
    this.sun.target.position.copy(focus);
    const warm = THREE.MathUtils.clamp(1 - elev / 25, 0, 1);
    if (sunUp) {
      this.sun.color.setRGB(1, 0.92 - warm * 0.25, 0.82 - warm * 0.45);
      this.sun.intensity = (0.5 + 4.2 * day) * (1 - cloudy * 0.6);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1);
      this.sun.intensity = 0.25;
    }
    this.hemi.intensity = (0.18 + 0.62 * day) * (this.indoor ? 0.5 : 1) + cloudy * 0.25;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.62 + 0.2 * day, 0.75 + 0.2 * day);
    this.hemi.groundColor.setRGB(0.18 * day + 0.05, 0.16 * day + 0.05, 0.14 * day + 0.06);
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - cloudy) * 0.9;
    const fog = this.scene.fog as THREE.Fog;
    const dayFog = new THREE.Color().setRGB(0.72 - cloudy * 0.2, 0.8 - cloudy * 0.2, 0.88 - cloudy * 0.2);
    const nightFog = new THREE.Color(0x0a0e1a);
    fog.color.copy(nightFog).lerp(dayFog, day);
    if (warm > 0.5 && sunUp) fog.color.lerp(new THREE.Color(0xe8a070), (warm - 0.5) * 0.6 * day);
    fog.near = this.weather === 'rain' ? 60 : 180;
    fog.far = this.weather === 'rain' ? 600 : 1400;
    this.renderer.toneMappingExposure = 0.55 + this.night * 0.45;

    // rain follows the camera
    this.rain.visible = this.weather === 'rain' && !this.indoor;
    if (this.rain.visible) {
      this.rain.position.set(camPos.x, camPos.y - 15, camPos.z);
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 2) {
        let y = pos.getY(i) - dt * 28;
        if (y < 0) y += 40;
        pos.setY(i, y); pos.setY(i + 1, y - 0.7);
      }
      pos.needsUpdate = true;
    }

    // refresh reflections when the sky changes noticeably
    const key = Math.round(elev / 4) + ':' + this.weather;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      this.skyScene.add(this.sky);
      const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 5000);
      this.scene.add(this.sky);
      this.envRT?.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = 0.05 + day * 0.1;
    }
    return this.night;
  }
}
