// Sign-in screen and character creator (with a live 3D preview).

import * as THREE from 'three';
import { CAREERS, PEOPLE, defaultLook } from '../../shared/catalog.js';
import type { Career, Look } from '../../shared/types.js';
import { Humanoid } from '../entities/humanoid.js';
import { auth, netMode, tokenKey } from '../net/client.js';
import { add, btn, h, input } from './dom.js';

export function loginScreen(): Promise<{ token: string; isNew: boolean }> {
  return new Promise((resolve) => {
    let mode: 'login' | 'register' = 'login';
    const user = input({ placeholder: 'Username (letters, numbers, _ — not an email)', maxlength: 16, autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
    const pass = input({ placeholder: 'Password (6+ characters)', type: 'password' });
    const err = h('div.err');
    const title = h('h2', 'Welcome back');
    const go = async () => {
      err.textContent = '';
      if (user.value.includes('@')) { err.textContent = 'Pick a username (3–16 letters, numbers or _) — email addresses aren’t used.'; return; }
      try {
        const r = await auth(mode, user.value.trim(), pass.value);
        localStorage.setItem(tokenKey(), r.token);
        el.remove();
        resolve({ token: r.token, isNew: mode === 'register' });
      } catch (e) { err.textContent = (e as Error).message; }
    };
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const toggle = h('a.link', { onclick: () => { mode = mode === 'login' ? 'register' : 'login'; title.textContent = mode === 'login' ? 'Welcome back' : 'Become a resident'; submit.textContent = mode === 'login' ? 'Sign in' : 'Create account'; toggle.textContent = mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'; } }, 'New here? Create an account');
    const submit = h('button.btn.primary.big', { onclick: go }, 'Sign in');
    const el = h('div.login',
      h('div.login-card',
        h('div.logo', h('span', 'CRYPTO'), h('b', 'CITY')),
        h('p.tag', 'Build your life. Make money. Explore the city. Meet people. Start businesses. Trade. Become whoever you want to be.'),
        netMode === 'local'
          ? h('div.modebadge.local', h('b', '● Offline single-player'), h('small', 'No game server is connected, so the city runs in your browser. Progress is saved on this device only. Multiplayer, chat with other players and leaderboards with others need a game server.'))
          : h('div.modebadge.online', h('b', '● Online'), h('small', 'Connected to the Crypto City server — multiplayer enabled.')),
        title, user, pass, submit, err, toggle,
        h('small.muted', 'Prototype build — every balance, price and reward is SIMULATED game currency. No real money or crypto is involved.')));
    document.body.append(el);
    user.focus();
  });
}

export function characterCreator(initial?: Look, career: Career = 'Explorer'): Promise<{ look: Look; career: Career }> {
  return new Promise((resolve) => {
    const L: Look = initial ? JSON.parse(JSON.stringify(initial)) : defaultLook('m');
    let car = career;
    // 3D preview
    const canvas = h('canvas.cc-preview') as HTMLCanvasElement;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(0, 1.25, 4.4);
    cam.lookAt(0, 0.95, 0);
    scene.add(new THREE.HemisphereLight(0xdde8ff, 0x403830, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(2, 3, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.5); rim.position.set(-2, 2, -3); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.4, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    let hm = new Humanoid(L);
    scene.add(hm.root);
    let rot = 0.4, alive = true, last = performance.now(), anim: 'idle' | 'wave' | 'dance' = 'wave';
    setTimeout(() => (anim = 'idle'), 2500);
    const loop = (t: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const w = canvas.clientWidth, hh = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== hh) { r.setSize(w, hh, false); cam.aspect = w / hh; cam.updateProjectionMatrix(); }
      hm.root.rotation.y = rot;
      hm.update(dt, anim);
      r.render(scene, cam);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    let drag = false, lx = 0;
    canvas.addEventListener('mousedown', (e) => { drag = true; lx = e.clientX; });
    window.addEventListener('mouseup', () => (drag = false));
    window.addEventListener('mousemove', (e) => { if (drag) { rot += (e.clientX - lx) * 0.01; lx = e.clientX; } });
    const rebuild = () => { scene.remove(hm.root); hm.dispose(); hm = new Humanoid(L); scene.add(hm.root); };

    const opts = h('div.cc-opts');
    const sw = (colors: string[], get: () => string, set: (c: string) => void) => h('div.swatches', colors.map((c) => h('span.swatch' + (get() === c ? '.on' : ''), { style: { background: c }, onclick: () => { set(c); rebuild(); draw(); } })));
    const draw = () => {
      opts.innerHTML = '';
      add(opts,
        h('h4', 'Body'), h('div.seg', btn('Masc', () => { L.body = 'm'; L.model = 0; rebuild(); draw(); }, L.body === 'm' ? 'on' : ''), btn('Fem', () => { L.body = 'f'; L.model = 0; rebuild(); draw(); }, L.body === 'f' ? 'on' : '')),
        h('h4', 'Who are you?'), h('div.chips', PEOPLE[L.body].map((p, i) => btn(p.name, () => { L.model = i; rebuild(); draw(); }, (L.model ?? 0) === i ? 'on small' : 'ghost small'))),
        h('label.field', h('span', 'Height'), h('input', { type: 'range', min: 0.9, max: 1.1, step: 0.01, value: L.height, onchange: (e: Event) => { L.height = Number((e.target as HTMLInputElement).value); rebuild(); } })),
        h('label.field', h('span', 'Build'), h('input', { type: 'range', min: 0.85, max: 1.2, step: 0.01, value: L.build, onchange: (e: Event) => { L.build = Number((e.target as HTMLInputElement).value); rebuild(); } })),
        h('h4', 'Career focus (you can change any time)'),
        h('div.careers', CAREERS.map((c) => h('div.career' + (car === c.id ? '.on' : ''), { onclick: () => { car = c.id; draw(); } }, h('b', c.id), h('small', c.desc)))),
        h('div.row', btn('Wave', () => { anim = 'wave'; setTimeout(() => (anim = 'idle'), 2000); }, 'ghost'), btn('Dance', () => { anim = anim === 'dance' ? 'idle' : 'dance'; }, 'ghost')),
        btn('Enter Crypto City', () => { alive = false; r.dispose(); el.remove(); resolve({ look: L, career: car }); }, 'primary big'),
      );
    };
    draw();
    const el = h('div.creator', h('div.cc-left', h('h2', 'Create your resident'), h('small.muted', 'Drag the preview to rotate. You start with a starter apartment and $100 in simulated funds.'), canvas), opts);
    document.body.append(el);
  });
}
