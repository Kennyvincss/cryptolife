// Ocean surface tuned for phones: no extra render passes. A standard PBR
// material (so sky reflections, sun glints and fog all work) with two
// scrolling normal-map layers, gentle vertex swell, depth-based colour and an
// animated foam line where the waves meet the beach.

import * as THREE from 'three';

export interface Ocean { mesh: THREE.Mesh; update(t: number): void }

export function buildOcean(opts: { shoreZ: number; level: number; x0: number; x1: number; z1: number }): Ocean {
  const { shoreZ, level, x0, x1, z1 } = opts;
  const z0 = shoreZ - 14; // starts under the sand so the beach line is defined by the slope
  const w = x1 - x0, d = z1 - z0;
  // denser rows near the shore, where the swell is visible
  const geo = new THREE.PlaneGeometry(w, d, 96, 64);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const v = (pos.getY(i) + d / 2) / d; // 0 at far edge .. 1 at shore edge (plane Y → world -Z)
    const near = 1 - Math.pow(1 - v, 3.2);
    pos.setY(i, -d / 2 + near * d);
  }
  geo.computeVertexNormals();

  const normals = new THREE.TextureLoader().load((import.meta.env.BASE_URL ?? '/') + 'assets/tex/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  normals.repeat.set(w / 18, d / 18);

  const m = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 0.07, metalness: 0, transparent: true,
    normalMap: normals, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 1.15,
  });
  const u = {
    uTime: { value: 0 }, uShore: { value: shoreZ },
    uShallow: { value: new THREE.Color('#2fb2a8') }, uDeep: { value: new THREE.Color('#0a3550') },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uShore; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 wp0 = modelMatrix * vec4(position, 1.0);
          float off = clamp((wp0.z - uShore) / 25.0, 0.0, 1.0);
          transformed.z += (sin(wp0.x * 0.045 + uTime * 0.7) * 0.16 + sin(wp0.z * 0.07 - uTime * 1.05) * 0.12 + sin((wp0.x + wp0.z) * 0.13 + uTime * 1.6) * 0.05) * off;
        }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uShore; uniform vec3 uShallow; uniform vec3 uDeep; varying vec3 vWPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float dz = vWPos.z - uShore;
        diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 45.0, dz));
        diffuseColor.a = mix(0.35, 0.96, smoothstep(-1.0, 14.0, dz));
        // lapping foam line
        float edge = dz - (sin(uTime * 0.9) * 1.3 + sin(vWPos.x * 0.12 + uTime * 0.6) * 0.5);
        float foamN = texture2D(normalMap, vWPos.xz * 0.11 + vec2(uTime * 0.015, 0.0)).r;
        float foam = (1.0 - smoothstep(-0.4, 2.6, edge)) * smoothstep(0.3, 0.65, foamN + 0.2);
        foam += (1.0 - smoothstep(0.0, 0.5, abs(edge - 5.0 - sin(uTime * 0.5) * 2.0))) * 0.25 * foamN;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.95), clamp(foam, 0.0, 0.9));
        diffuseColor.a = max(diffuseColor.a, clamp(foam, 0.0, 1.0));`)
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `
        vec3 n1 = texture2D( normalMap, vNormalMapUv + uTime * vec2( 0.011, 0.007 ) ).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D( normalMap, vNormalMapUv * 0.37 + uTime * vec2( -0.006, 0.009 ) ).xyz * 2.0 - 1.0;
        vec3 mapN = normalize( vec3( n1.xy + n2.xy, n1.z * n2.z ) );`);
  };
  m.customProgramCacheKey = () => 'cc_ocean';

  const mesh = new THREE.Mesh(geo, m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, level, (z0 + z1) / 2);
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  return { mesh, update: (t) => { u.uTime.value = t; } };
}
