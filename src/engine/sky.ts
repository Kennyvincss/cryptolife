// Day/night cycle: physically based sky, procedural cloud layer, sun/moon light
// with stable (texel-snapped) soft shadows, image-based lighting from real
// photographed HDR environments (CC0, Poly Haven), fog, stars and weather.

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

export type Weather = 'clear' | 'cloudy' | 'rain';

/** Deterministic weather from the shared clock, so every client sees the same sky. */
export function weatherAt(gameMinutes: number): Weather {
  const slot = Math.floor(gameMinutes / 180); // 3 game-hour slots
  const h = Math.sin(slot * 12.9898) * 43758.5453;
  const r = h - Math.floor(h);
  return r < 0.15 ? 'rain' : r < 0.4 ? 'cloudy' : 'clear';
}

interface Hdri { tex: THREE.Texture; sunAz: number }

const CloudShader = {
  uniforms: {
    uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uCover: { value: 0.35 },
    uDay: { value: 1 }, uSunCol: { value: new THREE.Color(1, 0.95, 0.9) }, uSkyCol: { value: new THREE.Color(0.6, 0.7, 0.85) },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
  fragmentShader: /* glsl */ `
    uniform float uTime, uCover, uDay; uniform vec3 uSun, uSunCol, uSkyCol; varying vec3 vDir;
    float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
    void main() {
      vec3 d = normalize(vDir);
      if (d.y < 0.0) discard;
      vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0015);
      float base = fbm(uv);
      float detail = fbm(uv * 3.1 + 4.0);
      float c = smoothstep(1.0 - uCover - 0.18, 1.0 - uCover + 0.32, base * 0.75 + detail * 0.35);
      // self-shadowing: sample towards the sun
      vec2 toSun = normalize(uSun.xz + 1e-4) * 0.08;
      float occ = fbm(uv + toSun) * 0.75 + fbm((uv + toSun) * 3.1 + 4.0) * 0.35;
      float lit = clamp(1.0 - (occ - base * 0.75 - detail * 0.35) * 3.0, 0.35, 1.25);
      float silver = pow(max(dot(d, normalize(uSun)), 0.0), 8.0) * (1.0 - c) * 2.0;
      vec3 col = mix(uSkyCol * 0.85, uSunCol * lit, 0.75) + uSunCol * silver;
      col = mix(col * 0.12, col, uDay);
      float horizon = smoothstep(0.0, 0.18, d.y);
      gl_FragColor = vec4(col, c * horizon * 0.95);
    }`,
};

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbcd8ff, 0x50483c, 0.6);
  stars: THREE.Points;
  rain: THREE.LineSegments;
  clouds: THREE.Mesh;
  night = 0;
  weather: Weather = 'clear';
  private pmrem: THREE.PMREMGenerator;
  private skyEnv: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private lastEnvKey = '';
  private sunDir = new THREE.Vector3();
  private hdri: { day?: Hdri; sunset?: Hdri; night?: Hdri } = {};
  private shadowHalf = 80;
  indoor = false;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.003; u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.setShadowExtent(80);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xbfd4e6, 0.0011);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), new THREE.ShaderMaterial({ ...CloudShader, uniforms: THREE.UniformsUtils.clone(CloudShader.uniforms), transparent: true, depthWrite: false, side: THREE.BackSide, fog: false }));
    this.clouds.renderOrder = -1;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    const sg = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i < 2500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.multiplyScalar(1800);
      pts.push(v.x, v.y, v.z);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
    scene.add(this.stars);

    const rg = new THREE.BufferGeometry();
    const rp: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80;
      rp.push(x, y, z, x + 0.04, y - 0.9, z);
    }
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.22 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    void this.loadHdris();
  }

  /** Real photographed environments for reflections and ambient light. */
  private async loadHdris() {
    const base = (import.meta.env.BASE_URL ?? '/') + 'assets/hdri/';
    const prep = (t: THREE.DataTexture): Hdri => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      // find the sun (brightest texel) so the HDRI can be turned to match our sun
      const { width: w, height: hh, data } = t.image as { width: number; height: number; data: ArrayLike<number> };
      const half = t.type === THREE.HalfFloatType;
      let best = -1, bx = 0;
      for (let y = 0; y < hh / 2; y += 2) for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const v = half ? THREE.DataUtils.fromHalfFloat(data[i] as number) + THREE.DataUtils.fromHalfFloat(data[i + 1] as number) : (data[i] as number) + (data[i + 1] as number);
        if (v > best) { best = v; bx = x; }
      }
      const sunAz = (bx / w - 0.5) * Math.PI * 2; // equirect u → atan2(z, x)
      const rt = this.pmrem.fromEquirectangular(t);
      t.dispose();
      return { tex: rt.texture, sunAz };
    };
    try {
      const hdr = new HDRLoader().setDataType(THREE.HalfFloatType);
      const [day, sunset, night] = await Promise.all([
        hdr.loadAsync(base + 'pedestrian_overpass_1k.hdr'),
        hdr.loadAsync(base + 'venice_sunset_1k.hdr'),
        new EXRLoader().setDataType(THREE.HalfFloatType).loadAsync(base + 'night.exr'),
      ]);
      this.hdri = { day: prep(day), sunset: prep(sunset), night: prep(night) };
      this.lastEnvKey = '';
    } catch (e) {
      console.warn('[env] HDRI load failed, using sky reflections', e);
    }
  }

  setShadowSize(size: number) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
  }
  setShadowExtent(half: number) {
    this.shadowHalf = half;
    const c = this.sun.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = 600;
    c.updateProjectionMatrix();
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
    u.turbidity.value = 3 + cloudy * 12;
    u.rayleigh.value = 1.0 + cloudy * 2.5;
    const day = THREE.MathUtils.clamp((elev + 6) / 18, 0, 1);
    const golden = THREE.MathUtils.clamp(1 - Math.abs(elev - 4) / 14, 0, 1);
    this.night = 1 - day;

    // sun / moon light, shadow camera snapped to texels so shadows don't shimmer
    const sunUp = elev > -2;
    const lightDir = sunUp ? this.sunDir.clone() : new THREE.Vector3(-0.3, 0.8, 0.4).normalize();
    const tex = (this.shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const up = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const lx = new THREE.Vector3().crossVectors(up, lightDir).normalize(), ly = new THREE.Vector3().crossVectors(lightDir, lx);
    const a = Math.round(focus.dot(lx) / tex) * tex, b = Math.round(focus.dot(ly) / tex) * tex, c = focus.dot(lightDir);
    const snapped = lx.multiplyScalar(a).add(ly.multiplyScalar(b)).addScaledVector(lightDir, c);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(lightDir, 300);
    const warm = THREE.MathUtils.clamp(1 - elev / 25, 0, 1);
    if (sunUp) {
      this.sun.color.setRGB(1, 0.93 - warm * 0.3, 0.84 - warm * 0.5);
      this.sun.intensity = (0.6 + 5.4 * day) * (1 - cloudy * 0.7);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 1);
      this.sun.intensity = 0.3;
    }
    this.hemi.intensity = (0.05 + 0.25 * day) * (this.indoor ? 0.4 : 1) + cloudy * 0.35;
    this.hemi.color.setRGB(0.6 + 0.2 * day, 0.68 + 0.2 * day, 0.8 + 0.2 * day);
    this.hemi.groundColor.setRGB(0.2 * day + 0.04, 0.18 * day + 0.04, 0.16 * day + 0.05);
    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - cloudy) * 0.9;

    // fog / atmospheric perspective
    const fog = this.scene.fog as THREE.FogExp2;
    const dayFog = new THREE.Color().setRGB(0.66 - cloudy * 0.14, 0.74 - cloudy * 0.14, 0.84 - cloudy * 0.12);
    const nightFog = new THREE.Color(0x070a12);
    fog.color.copy(nightFog).lerp(dayFog, day);
    if (warm > 0.4 && sunUp) fog.color.lerp(new THREE.Color(0xe6a27a), (warm - 0.4) * 0.7 * day);
    fog.density = this.weather === 'rain' ? 0.0042 : cloudy ? 0.0016 : 0.0009;
    this.renderer.toneMappingExposure = this.indoor ? 1.0 : 0.95 + this.night * 0.55;

    // clouds
    const cu = (this.clouds.material as THREE.ShaderMaterial).uniforms;
    cu.uTime.value += dt;
    cu.uSun.value.copy(lightDir);
    cu.uCover.value = this.weather === 'rain' ? 0.85 : this.weather === 'cloudy' ? 0.6 : 0.3;
    cu.uDay.value = day;
    (cu.uSunCol.value as THREE.Color).copy(this.sun.color).multiplyScalar(sunUp ? 1.05 : 0.3);
    (cu.uSkyCol.value as THREE.Color).copy(fog.color);
    this.clouds.position.copy(camPos);
    this.clouds.visible = !this.indoor;

    // rain follows the camera
    this.rain.visible = this.weather === 'rain' && !this.indoor;
    if (this.rain.visible) {
      this.rain.position.set(camPos.x, camPos.y - 15, camPos.z);
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 2) {
        let y = pos.getY(i) - dt * 30;
        if (y < 0) y += 40;
        pos.setY(i, y); pos.setY(i + 1, y - 0.9);
      }
      pos.needsUpdate = true;
    }

    // image-based lighting: real HDRIs (day / golden hour / night), turned so their sun matches ours
    const h = this.hdri;
    const pick = !h.day ? null : elev > 14 ? h.day : elev > -3 ? h.sunset! : h.night!;
    const key = (pick ? (pick === h.day ? 'd' : pick === h.sunset ? 's' : 'n') : Math.round(elev / 4)) + ':' + this.weather + ':' + Math.round(azim / 10);
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      if (pick) {
        this.scene.environment = pick.tex;
        this.scene.environmentRotation.set(0, pick.sunAz - Math.atan2(lightDir.z, lightDir.x), 0);
      } else {
        this.skyScene.add(this.sky);
        const rt = this.pmrem.fromScene(this.skyScene, 0, 0.1, 5000);
        this.scene.add(this.sky);
        this.skyEnv?.dispose();
        this.skyEnv = rt;
        this.scene.environment = rt.texture;
      }
    }
    const envDay = pick === h.night ? 0.5 : 0.55 + 0.25 * day;
    this.scene.environmentIntensity = (this.indoor ? 0.35 : envDay) * (1 - cloudy * 0.25) * (pick ? 1 : 0.3) * (golden > 0.5 && pick === h.sunset ? 1.1 : 1);
    return this.night;
  }
}
