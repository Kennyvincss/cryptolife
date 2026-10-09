// Rendering pipeline. On laptops/desktops ('high') this is a cinematic HDR chain:
// scene → MSAA HDR target → GTAO ambient occlusion → bloom → AgX filmic tone
// mapping → colour grade (contrast, split-toning, vignette, grain).
// Phones ('low') skip the expensive passes.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { setMaxAnisotropy } from './textures.js';
import { view } from '../ui/orient.js';
import { on } from '../state.js';

export type Quality = 'low' | 'medium' | 'high';

/** Final grade in display space: gentle S-curve, split toning, vignette, film grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.04 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.025 },
    uShadowTint: { value: new THREE.Vector3(-0.012, 0.0, 0.018) },
    uHighlightTint: { value: new THREE.Vector3(0.018, 0.008, -0.012) },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uContrast, uSaturation, uVignette, uGrain, uAspect;
    uniform vec3 uShadowTint, uHighlightTint; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 0.37) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c += uShadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + uHighlightTint * smoothstep(0.5, 1.0, l);
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d) * 1.25);
      c += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 3000);
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  gtao: GTAOPass;
  grade: ShaderPass;
  quality: Quality;
  private target: THREE.WebGLRenderTarget;

  constructor(container: HTMLElement) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.quality = (localStorage.getItem('cc_quality_v2') as Quality) || (coarse ? 'low' : 'high');
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'gl';
    setMaxAnisotropy(Math.min(16, this.renderer.capabilities.getMaxAnisotropy()));

    this.target = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: this.quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(this.renderer, this.target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.85;
    // AO at half resolution: big saving, the denoiser hides the difference
    const gtaoSetSize = this.gtao.setSize.bind(this.gtao);
    this.gtao.setSize = (w: number, h: number) => gtaoSetSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.25, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    on('viewresize', () => this.resize());
    this.resize();
  }

  applyQuality() {
    const q = this.quality;
    const pr = Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 1);
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloom.enabled = q !== 'low';
    this.gtao.enabled = q === 'high';
    this.grade.enabled = q !== 'low';
    this.target.samples = q === 'low' ? 0 : 4;
    this.resize();
  }
  setQuality(q: Quality) {
    this.quality = q;
    localStorage.setItem('cc_quality_v2', q);
    this.applyQuality();
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }

  resize() {
    const w = view.rotated ? view.w : window.innerWidth, h = view.rotated ? view.h : window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
  }

  render() {
    this.grade.uniforms.uTime.value = performance.now() / 1000 % 100;
    this.composer.render();
  }
}
