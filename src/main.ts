import * as THREE from 'three';
import './ui/styles.css';
import { PROPERTY_BY_ID, VEHICLE_BY_ID } from '../shared/catalog.js';
import { FEATURE_BY_ZONE, PLAYER_SPAWN, nearestCurb, zoneName } from '../shared/city.js';
import type { Look } from '../shared/types.js';
import { api } from './api.js';
import { audio } from './audio/audio.js';
import { music, remoteMusic, venueMusic } from './audio/music.js';
import { Input, isTouchDevice } from './engine/input.js';
import { mountTouch } from './ui/touch.js';
import { enableLandscape } from './ui/orient.js';
import { Renderer } from './engine/renderer.js';
import { Environment } from './engine/sky.js';
import { Humanoid, randomLook, type Anim } from './entities/humanoid.js';
import { loadRigs } from './entities/rig.js';
import { fleet, loadCarModel } from './entities/carmodel.js';
import { CarEntry } from './systems/carentry.js';
import { Car } from './entities/vehicle.js';
import { act, connect, detectMode, sendPos, tokenKey } from './net/client.js';
import { emit, gameMinutes, on, store, timeOverride } from './state.js';
import { PlayerController } from './systems/controller.js';
import { Interactions } from './systems/interact.js';
import { RemotePlayers } from './systems/remote.js';
import { Pedestrians, Traffic, signalPhase } from './systems/traffic.js';
import { run, toast } from './ui/components.js';
import { HUD } from './ui/hud.js';
import { characterCreator, loginScreen } from './ui/login.js';
import { buildBaseMap, route } from './ui/map.js';
import { buildCity, type CityBuild } from './world/city.js';
import { setFacadeNight } from './world/facade.js';
import { Forest } from './world/trees.js';
import { surfaceUniforms } from './world/pbr.js';
import { foodItem } from './world/furniture.js';
import { buildInterior, type HomeData, type InteriorBuild } from './world/interiors.js';

// ------------------------------------------------------------------ setup
const R = new Renderer(document.body);
const scene = R.scene;
const env = new Environment(scene, R.renderer);
const input = new Input(R.renderer.domElement);
const interact = new Interactions();
api.interact = interact;

const loading = document.getElementById('loading');
const setLoading = (t: string) => { const el = document.getElementById('loading-text'); if (el) el.textContent = t; };

setLoading('Building Crypto City…');
const city: CityBuild = buildCity(R.quality === 'low');
scene.add(city.group);
const forest = new Forest();
forest.build(city.trees, { shadows: R.quality !== 'low', low: R.quality === 'low' });
city.group.add(forest.group);
buildBaseMap(city);
// traffic, pedestrians and parked cars are created once the character rigs and car model load
let traffic!: Traffic;
let peds!: Pedestrians;
scene.add(fleet.group);
function populate() {
  traffic = new Traffic(R.quality === 'low' ? 16 : 26);
  scene.add(traffic.group);
  peds = new Pedestrians(R.quality === 'low' ? 22 : 40);
  scene.add(peds.group);
  city.populateParked();
}
const remotes = new RemotePlayers();
scene.add(remotes.group);
env.setShadowSize(R.quality === 'high' ? 4096 : 2048);
env.setShadowExtent(R.quality === 'high' ? 90 : 70);

// light pool (fixed count avoids shader recompiles when switching zones)
const pool: THREE.PointLight[] = [];
for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 20, 2); scene.add(l); pool.push(l); }
const headlight = new THREE.SpotLight(0xfff4e0, 0, 60, 0.45, 0.5, 1.2);
scene.add(headlight, headlight.target);

let hud: HUD;
let player: PlayerController;
let carEntry: CarEntry;
let body: Humanoid;
let zone = 'street';
let interior: InteriorBuild | null = null;
let myCar: Car | null = null;
let myCarUid: string | null = null;
let testCar: { car: Car; until: number } | null = null;
let headlightsOn = false;
let waypoint: { x: number; z: number; label: string; route: { x: number; z: number }[] } | null = null;
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 120, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xb46bff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
beacon.visible = false;
scene.add(beacon);
let held: THREE.Object3D | null = null;
let heldModel: string | null = null;
let heldUntil = 0;
let lookKey = '';
let lastDamageSend = 0;

// rides
let rideCar: { car: Car; path: THREE.Vector3[]; idx: number; mode: 'pickup' | 'trip' | 'leave'; rideId: string } | null = null;
let npcPassenger: { h: Humanoid; rideId: string; boarded: boolean } | null = null;

// ------------------------------------------------------------------ zones
async function enterZone(z: string, home?: HomeData) {
  let data: any = null;
  if (!home) {
    pushPresence();
    data = await act('zone.enter', { zone: z });
    z = data.zone;
    home = data.home;
  }
  hud.fade(true);
  await new Promise((r) => setTimeout(r, 280));
  audio.sfx('door');
  if (player.mode === 'drive') leaveCar();
  player.stand();
  interior?.dispose();
  interior = buildInterior(z, home);
  scene.add(interior.group);
  city.group.visible = false; traffic.group.visible = false; peds.group.visible = false;
  if (myCar) myCar.root.visible = false;
  zone = z; store.zone = z;
  env.indoor = true;
  player.camBounds = interior.bounds;
  player.teleport(interior.spawn, interior.spawnRot);
  for (let i = 0; i < pool.length; i++) {
    const L = interior.lights[i];
    if (L) { pool[i].position.copy(L.pos); pool[i].color.setHex(L.color); pool[i].intensity = L.intensity * 1.3; pool[i].distance = L.distance * 1.5; }
    else pool[i].intensity = 0;
  }
  if (interior.music) venueMusic.setStation(interior.music.station, interior.music.pos, interior.music.volume);
  else venueMusic.setStation(null);
  if (music.output === 'car') music.setOutput('headphones');
  if (z === 'convention' || z === 'hackhouse') refreshCityLists();
  setTimeout(() => hud.fade(false), 120);
}

async function exitBuilding() {
  const r = await run(act<{ door: number[] | null }>('zone.exit'));
  if (!r) return;
  hud.fade(true);
  await new Promise((res) => setTimeout(res, 250));
  audio.sfx('door');
  player.stand();
  interior?.dispose(); interior = null;
  player.camBounds = null;
  city.group.visible = true; traffic.group.visible = true; peds.group.visible = true;
  if (myCar) myCar.root.visible = true;
  zone = 'street'; store.zone = 'street';
  env.indoor = false;
  venueMusic.setStation(null);
  if (music.output === 'speaker') music.setOutput('headphones');
  const d = r.door ?? PLAYER_SPAWN;
  const door = city.doors.find((dd) => Math.hypot(dd.pos.x - d[0], dd.pos.z - d[2]) < 0.5);
  const facing = door ? door.facing : 0;
  player.teleport(new THREE.Vector3(d[0] + Math.sin(facing) * 1.2, 0.15, d[2] + Math.cos(facing) * 1.2), facing);
  for (const l of pool) l.intensity = 0;
  setTimeout(() => hud.fade(false), 120);
}

// ------------------------------------------------------------------ vehicles
function spawnMyCar(uid: string, near?: THREE.Vector3) {
  const v = store.me!.vehicles.find((x) => x.uid === uid);
  if (!v) return;
  myCar?.dispose();
  myCar = new Car(v.model, v.color, v.rims);
  myCar.upgrades = { engine: v.engine, handling: v.handling };
  myCarUid = uid;
  const p = near ?? player.pos;
  const c = nearestCurb(p.x, p.z);
  const alongX = Math.abs(c[0] - Math.round(c[0] / 96) * 96) > 3; // on a horizontal road
  myCar.setPose(c[0], c[2], alongX ? Math.PI / 2 : 0);
  myCar.onImpact = (s) => { if (s > 6) audio.sfx('error'); };
  scene.add(myCar.root);
}
/** Instantly put the player in the driver's seat (used after the get-in sequence). */
function enterCar(car: Car) {
  player.car = car;
  player.mode = 'drive';
  if (music.playing) music.setOutput('car');
}
/** Walk to the door, open it, get in, close it, then drive. */
function getIn(car: Car) {
  if (carEntry.busy) return;
  player.stand();
  carEntry.enter(car, () => enterCar(car));
}
/** Stop, open the door, get out, close it. */
function getOut() {
  const c = player.car;
  if (!c || carEntry.busy) return;
  player.car = null;
  audio.engineSound(false);
  carEntry.exit(c, () => {
    const p = carEntry.exitPoint(c);
    player.mode = 'walk';
    player.teleport(p.setY(city.groundAt(p.x, p.z)), c.heading);
    if (music.output === 'car') music.setOutput('headphones');
  });
}
/** Instant exit (forced: test drive ended, zone change…). */
function leaveCar() {
  const c = player.car;
  if (!c) return;
  player.mode = 'walk';
  player.car = null;
  const side = new THREE.Vector3(Math.cos(c.heading), 0, -Math.sin(c.heading)).multiplyScalar(c.visual.dims.W / 2 + 0.8);
  player.teleport(c.pos.clone().add(side).setY(city.groundAt(c.pos.x + side.x, c.pos.z + side.z)), c.heading);
  c.speed = 0;
  audio.engineSound(false);
  audio.sfx('door');
  if (music.output === 'car') music.setOutput('headphones');
}

/** Cars the player took from the street (parked or traffic); left where they were parked. */
const borrowed: Car[] = [];
function keepBorrowed(car: Car) {
  if (!borrowed.includes(car)) borrowed.push(car);
  while (borrowed.length > 5) {
    const i = borrowed.findIndex((b) => b !== player.car && b.pos.distanceTo(player.pos) > 40);
    if (i < 0) break;
    borrowed[i].dispose(); borrowed.splice(i, 1);
  }
}
/** Something on the street the player can get into: own car, test car, a parked car or stopped traffic. */
function nearestEnterable(): { label: string; go: () => void } | null {
  const me = player.pos;
  const cands: { d: number; label: string; go: () => void }[] = [];
  if (myCar) cands.push({ d: myCar.pos.distanceTo(me) - 2, label: `Get in your ${VEHICLE_BY_ID[myCar.model].name}`, go: () => getIn(myCar!) });
  if (testCar) cands.push({ d: testCar.car.pos.distanceTo(me) - 1, label: 'Get in (test drive)', go: () => getIn(testCar!.car) });
  for (const b of borrowed) cands.push({ d: b.pos.distanceTo(me), label: 'Get in car', go: () => getIn(b) });
  for (let i = 0; i < city.parkedCars.length; i++) {
    const pc = city.parkedCars[i];
    cands.push({ d: pc.root.position.distanceTo(me), label: 'Get in parked car', go: () => {
      const car = new Car(pc.model, pc.color);
      car.setPose(pc.root.position.x, pc.root.position.z, pc.root.rotation.y);
      pc.root.removeFromParent();
      city.parkedCars.splice(city.parkedCars.indexOf(pc), 1);
      scene.add(car.root);
      keepBorrowed(car);
      getIn(car);
    } });
  }
  const tc = traffic?.stoppedNear(me, 4.2);
  if (tc) cands.push({ d: tc.pos.distanceTo(me), label: 'Take this car (driver gets out)', go: () => {
    traffic.take(tc);
    scene.add(tc.root);
    const side = new THREE.Vector3(1.6, 0, -0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), tc.heading).add(tc.pos);
    peds?.spawnAt(side.setY(0.15), player.pos);
    keepBorrowed(tc);
    getIn(tc);
  } });
  const best = cands.filter((c) => c.d < 3.6).sort((a, b) => a.d - b.d)[0];
  return best ?? null;
}

// ------------------------------------------------------------------ api
Object.assign(api, {
  sit: (p: THREE.Vector3, rot: number, anim: Anim = 'sit', seatH = 0.45) => player.sit(p, rot, anim, seatH),
  lie: (p: THREE.Vector3, rot: number) => player.lie(p, rot),
  stand: () => player.stand(),
  emote: (a: Anim | null, secs = 5) => player.setEmote(a, secs),
  isSeated: () => player.mode === 'seated',
  playerPos: () => player.pos.clone(),
  panel: (name: string, data?: any) => { input.unlock(); hud.openPanel(name, data); },
  closePanel: () => hud.closePanel(),
  toast,
  fade: async <T,>(fn: () => T | Promise<T>) => { hud.fade(true); await new Promise((r) => setTimeout(r, 400)); const r = await fn(); await new Promise((res) => setTimeout(res, 500)); hud.fade(false); return r; },
  exitBuilding,
  enterZone: (z: string) => enterZone(z).catch((e) => toast(e.message, 'warn')),
  hold: (model: string | null) => {
    if (held) { body.setHeld(null); held = null; }
    heldModel = model;
    if (model) { held = foodItem(model); body.setHeld(held); heldUntil = performance.now() + 25000; }
  },
  holding: () => heldModel,
  sleep: async () => {
    const r = await api.fade(async () => {
      player.lie(player.pos.clone().setY(0.62), player.heading);
      return run(act<{ advanced: boolean }>('home.sleep'));
    });
    if (r) toast(r.advanced ? 'You slept until morning. Well rested: +10% XP.' : 'You rested. Other residents are awake, so the shared city clock keeps running. Well rested: +10% XP.', 'ok');
    setTimeout(() => player.stand(), 1500);
  },
  setSpeakerMusic: (pos: THREE.Vector3 | null) => {
    if (!pos) { music.setOutput('headphones'); return; }
    music.setOutput('speaker', pos);
    if (!music.playing) music.play();
    toast('Playing on speakers — visitors in your home hear it too.', 'ok');
  },
  zone: () => zone,
  waypoint: (x: number, z: number, label: string) => setWaypoint(x, z, label),
  previewLook: (look: Look | null) => { body.setLook(look ?? store.me!.look); lookKey = JSON.stringify(look ?? store.me!.look); },
  callVehicle: (uid: string) => {
    if (zone !== 'street') { toast('Your vehicle will be waiting at the curb when you step outside.', 'ok'); pendingCar = uid; return; }
    spawnMyCar(uid);
    toast('Your vehicle is parked at the nearest curb. Press F next to it to drive.', 'ok');
  },
  testDrive: (model: string) => {
    pendingTest = model;
    exitBuilding();
  },
  setQuality: (q: 'low' | 'medium' | 'high') => { R.setQuality(q); env.setShadowSize(q === 'high' ? 4096 : 2048); env.setShadowExtent(q === 'high' ? 90 : 70); },
  placeAt: (p: THREE.Vector3, heading: number) => { player.stand(); player.teleport(p.clone().setY(0), heading); },
  teleportLocal: (x: number, z: number, y = 0) => { if (interior) player.teleport(new THREE.Vector3(3000 + x, y, z), Math.PI); },
});
let pendingCar: string | null = null;
let pendingTest: string | null = null;

function setWaypoint(x: number, z: number, label: string) {
  waypoint = { x, z, label, route: route({ x: player.pos.x, z: player.pos.z }, { x, z }) };
  beacon.position.set(x, 60, z);
  beacon.visible = true;
  toast(`GPS: route set to ${label}`, 'ok');
}

async function refreshCityLists() {
  try {
    store.events = await act('events.list');
    store.projects = await act('project.list');
  } catch { /* offline */ }
}

// ------------------------------------------------------------------ boot
async function boot() {
  setLoading('Connecting…');
  const rigs = Promise.all([loadRigs(), loadCarModel()]); // characters, mocap and cars stream in while we connect / log in
  await detectMode();
  loading?.classList.add('hidden');
  let token = localStorage.getItem(tokenKey());
  let isNew = false;
  if (!token) ({ token, isNew } = await loginScreen());
  try {
    await connect(token!);
  } catch {
    localStorage.removeItem(tokenKey());
    ({ token, isNew } = await loginScreen());
    await connect(token!);
  }
  const me = store.me!;
  setLoading('Loading characters…');
  loading?.classList.remove('hidden');
  await rigs;
  populate();
  loading?.classList.add('hidden');
  if (isNew) {
    const r = await characterCreator(me.look, me.career);
    await run(act('profile.setLook', { look: r.look }));
    await run(act('profile.setCareer', { career: r.career }));
  }
  start();
}

function start() {
  const me = store.me!;
  body = new Humanoid(me.look);
  lookKey = JSON.stringify(me.look);
  scene.add(body.root);
  player = new PlayerController(body, R.camera);
  carEntry = new CarEntry(player, (n) => audio.sfx(n));
  player.teleport(new THREE.Vector3(...PLAYER_SPAWN).setY(0.15), Math.PI / 2);
  hud = new HUD();
  hud.onMapClick = (x, z, label) => setWaypoint(x, z, label ?? 'Map marker');
  hud.onClearWaypoint = () => { waypoint = null; beacon.visible = false; toast('GPS destination cleared', 'ok'); };
  hud.onPromptTap = (k) => (k === 'W' ? player.stand() : input.tap('Key' + k));
  if (isTouchDevice()) {
    mountTouch(input, { phone: () => hud.togglePhone(), map: () => hud.toggleMap(), chat: () => hud.openChat(), blocked: () => hud.panelOpen || hud.mapOpen || hud.phoneOpen || hud.chatOpen });
    player.camDist = 3.6;
    enableLandscape();
    R.camera.far = 1300; R.camera.updateProjectionMatrix();
    if (window.innerHeight > window.innerWidth) toast('Turn your phone sideways to play in landscape.', 'ok');
  }
  hud.mapMarks = () => ({
    player: { x: zone === 'street' ? player.pos.x : doorPos().x, z: zone === 'street' ? player.pos.z : doorPos().z, heading: player.heading },
    waypoint, route: waypoint?.route,
    others: store.presence.filter((p) => p.z === 'street').map((p) => ({ x: p.p[0], z: p.p[2], friend: me.friends.includes(p.name) })),
    ride: rideCar ? { x: rideCar.car.pos.x, z: rideCar.car.pos.z } : null,
    pickup: store.me?.ride?.role === 'driver' && store.me.ride.status === 'assigned' ? { x: store.me.ride.pickup[0], z: store.me.ride.pickup[2] } : null,
  });
  // exterior interactables
  for (const d of city.doors) interact.add({ pos: d.pos, zone: 'street', key: 'E', radius: 2.4, label: `Enter ${d.name}`, action: () => api.enterZone(d.zone) });
  for (const b of city.benches) interact.add({ pos: b.pos, zone: 'street', radius: 1.3, label: 'Sit on bench', action: () => player.sit(b.pos.clone().add(new THREE.Vector3(Math.sin(b.rot) * 0.05, 0, Math.cos(b.rot) * 0.05)), b.rot, 'sit', 0.45 + 0.15) });

  on('me', (m) => {
    const k = JSON.stringify(m.look);
    if (k !== lookKey && !hud.panelOpen) { body.setLook(m.look); lookKey = k; }
  });
  on('acceptInvite', (ownerId: string) => enterZone('home:' + ownerId).catch((e) => toast(e.message, 'warn')));
  on('ui', () => { if (hud.blocking) input.unlock(); });
  on('notify', (n: any) => { if (n.kind === 'level') audio.sfx('level'); });
  window.addEventListener('mousedown', () => audio.init(), { once: true });
  window.addEventListener('keydown', () => audio.init(), { once: true });
  window.addEventListener('touchend', () => audio.init(), { once: true });

  // start at home
  enterZone('home:' + me.id).catch(() => {});
  hud.systemChat(isTouchDevice() ? 'Welcome to Crypto City. Left stick to move, drag right side to look, tap the prompts to interact, 📱 for your phone.' : 'Welcome to Crypto City. Press H for controls, P for your phone.');
  setInterval(() => { if (zone === 'convention' || zone === 'hackhouse') refreshCityLists(); }, 20000);
  requestAnimationFrame(loop);
  // debug handle (used by automated browser checks)
  (window as any).cc = {
    player, scene, R, env, city, store, hud, interact, fleet, get carEntry() { return carEntry; }, get traffic() { return traffic; }, get peds() { return peds; },
    get interior() { return interior; }, get zone() { return zone; },
    tp(z: string) { const d = city.doors.find((x) => x.zone === z); if (d) player.teleport(d.pos.clone().add(new THREE.Vector3(Math.sin(d.facing) * 2, 0, Math.cos(d.facing) * 2)), d.facing + Math.PI); },
    time(m: number | null) { timeOverride.minutes = m; },
    enter: (z: string) => enterZone(z),
  };
}

function doorPos() {
  let z = zone;
  if (z.startsWith('home:')) z = PROPERTY_BY_ID[store.me!.homeId]?.building ?? 'apt_starter';
  return city.doors.find((d) => d.zone === z)?.pos ?? new THREE.Vector3(...PLAYER_SPAWN);
}

// ------------------------------------------------------------------ rides (client simulation of NPC driving)
function pathTo(from: THREE.Vector3, to: THREE.Vector3) {
  return route({ x: from.x, z: from.z }, { x: to.x, z: to.z }).map((p) => new THREE.Vector3(p.x, 0, p.z));
}
function driveAlong(rc: NonNullable<typeof rideCar>, dt: number, speed = 11) {
  const c = rc.car;
  const target = rc.path[rc.idx];
  if (!target) return true;
  const d = target.clone().sub(c.pos); d.y = 0;
  const dist = d.length();
  if (dist < 2.5) { rc.idx++; return rc.idx >= rc.path.length; }
  const want = Math.atan2(d.x, d.z);
  let dh = want - c.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  c.heading += dh * Math.min(1, dt * 4);
  const v = Math.min(speed, dist * 1.2 + 2);
  c.pos.x += Math.sin(c.heading) * v * dt;
  c.pos.z += Math.cos(c.heading) * v * dt;
  c.speed = v;
  c.wheelSpin += (v / c.visual.dims.wheelR) * dt;
  for (const w of c.visual.wheels) w.spin.rotation.z = -c.wheelSpin * (w.spin.rotation.y < 0 ? -1 : 1);
  c.sync();
  return false;
}

function updateRides(dt: number) {
  const me = store.me!;
  const r = me.ride;
  // ---- passenger with NPC driver
  if (r && r.role === 'rider' && r.driverIsNpc && ['assigned', 'arrived', 'onboard'].includes(r.status)) {
    if (!rideCar || rideCar.rideId !== r.id) {
      rideCar?.car.dispose();
      const car = new Car(r.vehicleModel || 'ledger', r.vehicleColor || '#111');
      const pick = new THREE.Vector3(r.pickup[0], 0, r.pickup[2]);
      const start = pathTo(pick, pick.clone().add(new THREE.Vector3(140, 0, 90)));
      const sp = start[start.length - 2] ?? pick.clone().add(new THREE.Vector3(60, 0, 0));
      car.setPose(sp.x, sp.z, 0);
      scene.add(car.root);
      rideCar = { car, path: pathTo(sp, pick), idx: 0, mode: r.status === 'onboard' ? 'trip' : 'pickup', rideId: r.id };
      if (r.status === 'onboard') rideCar.path = pathTo(sp, new THREE.Vector3(r.dest[0], 0, r.dest[2]));
    }
    const rc = rideCar;
    if (rc.mode === 'pickup' && r.status === 'assigned') {
      if (driveAlong(rc, dt)) run(act('ride.arrived'));
    }
    if (r.status === 'onboard' && rc.mode !== 'trip') {
      rc.mode = 'trip';
      const dest = new THREE.Vector3(r.dest[0], 0, r.dest[2]);
      const curb = nearestCurb(dest.x, dest.z);
      rc.path = pathTo(rc.car.pos, new THREE.Vector3(curb[0], 0, curb[2]));
      rc.idx = 0;
      player.mode = 'passenger';
      body.root.visible = false;
    }
    if (rc.mode === 'trip' && player.mode === 'passenger') {
      const done = driveAlong(rc, dt, 13);
      player.pos.copy(rc.car.pos);
      body.root.position.copy(rc.car.pos);
      if (done) {
        player.mode = 'walk';
        body.root.visible = true;
        const side = new THREE.Vector3(Math.cos(rc.car.heading), 0, -Math.sin(rc.car.heading)).multiplyScalar(2.2);
        const p = rc.car.pos.clone().add(side);
        player.teleport(p.setY(city.groundAt(p.x, p.z)), rc.car.heading);
        run(act('ride.complete')).then((res) => { if (res) toast(`Arrived at ${r.destName}. Fare charged: $${r.fare} (simulated).`, 'money'); });
        rc.mode = 'leave';
        rc.path = pathTo(rc.car.pos, rc.car.pos.clone().add(new THREE.Vector3(200, 0, 0)));
        rc.idx = 0;
      }
    }
  } else if (rideCar && rideCar.mode !== 'leave') {
    // cancelled / completed elsewhere
    if (player.mode === 'passenger' && !(r && r.role === 'rider' && !r.driverIsNpc)) { player.mode = 'walk'; body.root.visible = true; }
    rideCar.mode = 'leave';
    rideCar.path = pathTo(rideCar.car.pos, rideCar.car.pos.clone().add(new THREE.Vector3(200, 0, 0)));
    rideCar.idx = 0;
  }
  if (rideCar?.mode === 'leave') {
    if (driveAlong(rideCar, dt) || rideCar.car.pos.distanceTo(player.pos) > 220) { rideCar.car.dispose(); rideCar = null; }
  }

  // ---- passenger with a PLAYER driver: follow their car
  if (r && r.role === 'rider' && !r.driverIsNpc && r.status === 'onboard') {
    const v = remotes.vehicleOf(r.driverName);
    if (v) { player.mode = 'passenger'; body.root.visible = false; player.pos.copy(v.position); body.root.position.copy(v.position); }
  } else if (player.mode === 'passenger' && !rideCar) { player.mode = 'walk'; body.root.visible = true; }

  // ---- we are the driver
  if (r && r.role === 'driver' && r.riderIsNpc && ['assigned', 'onboard'].includes(r.status)) {
    if (!npcPassenger || npcPassenger.rideId !== r.id) {
      npcPassenger?.h.dispose();
      const hm = new Humanoid(randomLook(r.id.length * 31 + r.fare * 100));
      hm.bake();
      hm.setNameTag(r.riderName, 'npc');
      const c = nearestCurb(r.pickup[0], r.pickup[2]);
      hm.root.position.set(c[0], 0.15, c[2]);
      scene.add(hm.root);
      npcPassenger = { h: hm, rideId: r.id, boarded: r.status === 'onboard' };
    }
    const np = npcPassenger;
    if (!np.boarded) {
      np.h.update(dt, 'wave');
      const car = player.car;
      if (car && car.pos.distanceTo(np.h.root.position) < 9 && Math.abs(car.speed) < 1.5 && r.status === 'assigned') {
        np.boarded = true;
        np.h.root.visible = false;
        run(act('driver.pickup')).then((ok) => { if (ok !== undefined) { toast(`${r.riderName} got in. Drive to ${r.destName}.`, 'ride'); setWaypoint(r.dest[0], r.dest[2], r.destName); } else { np.boarded = false; np.h.root.visible = true; } });
      }
    } else if (r.status === 'onboard') {
      const car = player.car;
      if (car && Math.hypot(car.pos.x - r.dest[0], car.pos.z - r.dest[2]) < 26 && Math.abs(car.speed) < 1.5) {
        np.boarded = false;
        run(act<{ earn: number }>('driver.complete')).then((res) => {
          if (res) { toast(`Fare complete: +$${res.earn} (simulated)`, 'money'); waypoint = null; beacon.visible = false; }
          np.h.root.position.set(r.dest[0], 0.15, r.dest[2]); np.h.root.visible = true;
          setTimeout(() => { if (npcPassenger === np) { np.h.dispose(); npcPassenger = null; } }, 6000);
        });
      }
    }
  } else if (npcPassenger && !(r && r.role === 'driver')) {
    const np = npcPassenger;
    if (!np.h.root.visible || np.boarded) { np.h.dispose(); npcPassenger = null; }
  }
}

function pushPresence() {
  const driving = player.mode === 'drive' && player.car;
  const a = driving ? 'drive' : player.mode === 'passenger' ? 'sit' : player.mode === 'lying' ? 'sleep' : body.anim;
  const p = driving ? player.car!.pos : player.pos;
  sendPos([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], +(driving ? player.car!.heading : player.heading).toFixed(3), a,
    driving ? { model: player.car!.model, color: player.car!.color, rims: player.car!.rims } : null, music.shared());
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
let posTimer = 0;
let screenTimer = 0;
let t = 0;
let lastRide = '';
// FPS governor: if the machine can't hold ~30 fps, step quality down once per level
// (only when the player hasn't chosen a quality themselves).
const gov = { frames: 0, time: 0, settle: 6, manual: localStorage.getItem('cc_quality_manual') === '1' };
function governor(rawDt: number) {
  if (gov.manual || zone !== 'street' || document.hidden) { gov.frames = 0; gov.time = 0; return; }
  if (gov.settle > 0) { gov.settle -= rawDt; return; }
  gov.frames++; gov.time += rawDt;
  if (gov.time < 4) return;
  const fps = gov.frames / gov.time;
  gov.frames = 0; gov.time = 0;
  if (fps < 27 && R.quality !== 'low') {
    const next = R.quality === 'high' ? 'medium' : 'low';
    api.setQuality(next);
    gov.settle = 4;
    toast(`Graphics lowered to ${next} to keep the game smooth (${Math.round(fps)} fps). Change it in Phone → Settings.`, 'ok');
  }
}

function loop(now: number) {
  requestAnimationFrame(loop);
  governor(Math.min(0.5, (now - last) / 1000));
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  const uiBlocked = hud.panelOpen || hud.mapOpen || hud.chatOpen;
  input.enabled = !uiBlocked;

  // hotkeys
  if (input.pressedAny('Escape')) {
    if (hud.mapOpen) hud.toggleMap(false); else if (hud.panelOpen) hud.closePanel(); else if (hud.phoneOpen) hud.togglePhone(false);
  }
  if (!hud.chatOpen) {
    if (input.pressedAny('KeyP')) { input.unlock(); hud.togglePhone(); }
    if (input.pressedAny('KeyM')) { input.unlock(); hud.toggleMap(); }
    if (input.pressedAny('KeyH')) hud.toggleHelp();
    if (input.pressedAny('KeyT') || input.pressedAny('Enter')) { input.unlock(); setTimeout(() => hud.openChat(), 0); }
  }
  if (!uiBlocked) {
    if (input.pressed('Digit1')) player.setEmote('wave', 3);
    if (input.pressed('Digit2')) { player.setEmote('dance', 30); body.danceMove++; }
    if (input.pressed('Digit3')) player.setEmote('phone', 8);
    if (input.pressed('Digit4')) player.setEmote('talk', 4);
    if (input.pressed('KeyC')) { player.camYaw = player.heading + Math.PI; player.camPitch = 0.28; }
    if (input.pressed('KeyL') && player.car) headlightsOn = !headlightsOn;
  }

  // interactions
  const opts = player.mode === 'drive' ? [] : interact.available(player.pos, zone);
  const extra: string[] = [];
  let fAction: (() => void) | null = null;
  let gAction: (() => void) | null = null;
  if (zone === 'street') {
    if (player.mode === 'drive') { extra.push(Math.abs(player.car?.speed ?? 0) > 1 ? 'F Stop & get out' : 'F Get out'); fAction = () => getOut(); }
    else if (player.mode === 'walk' || player.mode === 'seated') {
      const r = store.me?.ride;
      if (rideCar && r?.status === 'arrived' && rideCar.car.pos.distanceTo(player.pos) < 6.5) { extra.push('F Get in your CityRide'); fAction = () => run(act('ride.board')); }
      else {
        const en = nearestEnterable();
        if (en) { extra.push('F ' + en.label); fAction = en.go; }
      }
    }
  }
  const near = player.mode === 'walk' ? remotes.nearest(player.pos, zone, 2.6) : null;
  if (near && !opts.some((o) => o.key === 'G')) { extra.push(`G @${near.entry.name} — profile`); gAction = () => hud.togglePhone(true, 'social', { user: near.entry.name }); }
  if (player.mode === 'seated' || player.mode === 'lying') extra.push('W Stand up');
  hud.setPrompts(opts, extra);
  if (!uiBlocked) {
    for (const o of opts) if (input.pressed('Key' + o.key)) { o.action(); audio.sfx('click'); break; }
    if (fAction && input.pressed('KeyF')) fAction();
    if (gAction && input.pressed('KeyG') && !opts.some((o) => o.key === 'G')) gAction();
  }

  // player & world
  const groundAt = zone === 'street' ? city.groundAt : () => (interior ? 0 : 0);
  const colliders = zone === 'street' ? city.colliders : interior!.colliders;
  player.update(dt, input, colliders, groundAt, uiBlocked);
  // cars are solid on foot (parked, traffic, showroom)
  if (player.mode === 'walk') {
    fleet.push(player.pos, 0.38);
    if (zone === 'street' && peds) peds.push(player.pos, 0.35);
    body.root.position.copy(player.pos);
  }
  carEntry.update(dt);
  if (player.mode === 'drive' && player.car) {
    const c = player.car;
    // other cars (parked, traffic, showroom) are solid
    const fwd = new THREE.Vector3(Math.sin(c.heading), 0, Math.cos(c.heading));
    for (const off of [-c.visual.dims.L * 0.33, 0, c.visual.dims.L * 0.33]) {
      const pt = c.pos.clone().addScaledVector(fwd, off), before = pt.clone();
      if (fleet.push(pt, c.visual.dims.W * 0.45, c.root)) {
        c.pos.x += pt.x - before.x; c.pos.z += pt.z - before.z;
        const imp = Math.abs(c.speed); if (imp > 3) { c.damageAccum += imp * 0.5; audio.sfx('error'); }
        c.speed *= -0.25; c.sync();
      }
    }
    const hit = traffic.collide(c.pos, c.radius);
    if (hit) { c.pos.x += hit.dx; c.pos.z += hit.dz; const imp = Math.abs(c.speed); if (imp > 3) { c.damageAccum += imp * 0.6; audio.sfx('error'); } c.speed *= -0.3; c.sync(); }
    audio.engineSound(true, c.rpm, !!c.def.electric);
    const cond = myCar === c ? 100 - (store.me!.vehicles.find((v) => v.uid === myCarUid)?.damage ?? 0) : undefined;
    hud.setSpeed(Math.abs(c.speed) * 3.6, cond);
    if (c === myCar && c.damageAccum > 1 && now - lastDamageSend > 2000) {
      lastDamageSend = now;
      act('vehicle.damage', { id: myCarUid, amount: Math.min(15, c.damageAccum) }).catch(() => {});
      c.damageAccum = 0;
    }
  } else { hud.setSpeed(null); audio.engineSound(false); }

  if (heldModel && performance.now() > heldUntil) api.hold(null);
  if (heldModel && player.mode === 'seated' && !player.emoteAnim()) player.setEmote('eat', 10);

  // test drive timer
  if (testCar && performance.now() > testCar.until) {
    if (player.car === testCar.car) leaveCar();
    testCar.car.dispose(); testCar = null;
    toast('Test drive over. Visit Moonshot Motors to buy.', 'ok');
  }

  // environment & lights
  const gm = gameMinutes();
  const focus = player.mode === 'drive' && player.car ? player.car.pos : player.pos;
  const night = env.update(gm, focus, R.camera.position, dt);
  if (zone === 'street') city.ocean.update(now / 1000);
  setFacadeNight(night);
  forest.update(now / 1000, R.camera.position, R.quality === 'low' ? 220 : 380);
  surfaceUniforms.uWet.value += ((env.weather === 'rain' ? 1 : 0) - surfaceUniforms.uWet.value) * Math.min(1, dt * 0.05);
  for (const nm of city.nightMats) nm.m.emissiveIntensity = nm.base + (nm.night - nm.base) * night;
  // bloom works on linear HDR values: thresholds sit above lit surfaces so only lights and glints glow
  if (zone === 'street') { R.bloom.strength = 0.18 + night * 0.35; R.bloom.threshold = 2.2 - night * 1.2; R.bloom.radius = 0.5; }
  else { R.bloom.strength = zone === 'club' ? 0.45 : 0.14; R.bloom.threshold = zone === 'club' ? 3 : 7; R.bloom.radius = 0.4; }
  const ph = signalPhase(t);
  for (const axis of ['ns', 'ew'] as const) for (const k of ['r', 'y', 'g'] as const) city.signals[axis][k].emissiveIntensity = ph[axis] === k ? 4 : 0.05;
  if (zone === 'street') {
    // nearest street lamps get real lights at night
    if (night > 0.3) {
      const sorted = city.lamps.map((p) => ({ p, d: p.distanceToSquared(focus) })).sort((a, b) => a.d - b.d).slice(0, pool.length);
      sorted.forEach((s, i) => { pool[i].position.copy(s.p).setY(s.p.y - 0.4); pool[i].color.setHex(0xffd9a0); pool[i].intensity = 60 * night; pool[i].distance = 22; });
    } else for (const l of pool) l.intensity = 0;
    traffic.setHeadlights(night > 0.4);
    const obstacles = [{ pos: player.mode === 'drive' && player.car ? player.car.pos : player.pos, r: player.mode === 'drive' ? 1 : 0.4 }];
    const camDir = R.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    traffic.update(dt, t, focus, obstacles, () => audio.sfx('horn'), camDir);
    traffic.updateDrivers(dt, R.camera.position);
    peds.update(dt, R.camera.position, player.pos, player.car ? { pos: player.car.pos, speed: player.car.speed } : null, camDir);
  }
  if (player.car) {
    const on = headlightsOn || night > 0.45;
    player.car.setHeadlights(on);
    const c = player.car;
    headlight.intensity = on ? 120 : 0;
    headlight.position.set(c.pos.x + Math.sin(c.heading) * 2, 0.9, c.pos.z + Math.cos(c.heading) * 2);
    headlight.target.position.set(c.pos.x + Math.sin(c.heading) * 20, 0, c.pos.z + Math.cos(c.heading) * 20);
  } else headlight.intensity = 0;
  if (interior) {
    interior.update(dt, t, night);
    for (const n of interior.npcs) n.showTag(n.root.position.distanceToSquared(player.pos.clone().sub(interior.group.position)) < 36);
  }
  remotes.update(dt, zone);
  if (zone === 'street') updateRides(dt);

  // waypoint
  if (waypoint) {
    const d = Math.hypot(player.pos.x - waypoint.x, player.pos.z - waypoint.z);
    beacon.visible = zone === 'street';
    (beacon.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.sin(t * 3) * 0.06;
    hud.setWaypointLabel(zone === 'street' ? `📍 ${waypoint.label} — ${Math.round(d)} m` : null);
    if (zone === 'street' && d < 8) { toast(`Arrived: ${waypoint.label}`, 'ok'); waypoint = null; beacon.visible = false; hud.setWaypointLabel(null); }
    else if (zone === 'street' && Math.floor(t) % 3 === 0 && waypoint.route.length > 1) {
      const first = waypoint.route[1];
      if (Math.hypot(first.x - player.pos.x, first.z - player.pos.z) > 140) waypoint.route = route({ x: player.pos.x, z: player.pos.z }, waypoint);
    }
  } else hud.setWaypointLabel(null);

  // pending car delivery / test drive once outdoors
  if (zone === 'street' && pendingCar) { spawnMyCar(pendingCar); pendingCar = null; toast('Your vehicle is parked at the nearest curb. Press F next to it.', 'ok'); }
  if (zone === 'street' && pendingTest) {
    const car = new Car(pendingTest, VEHICLE_BY_ID[pendingTest].color, 'sport');
    const c = nearestCurb(player.pos.x, player.pos.z);
    car.setPose(c[0], c[2], 0);
    scene.add(car.root);
    testCar = { car, until: performance.now() + 90_000 };
    pendingTest = null;
    toast('Test car waiting at the curb — press F. You have 90 seconds.', 'ok');
  }
  // keep my car in sync with ownership (sold / changed)
  const me = store.me!;
  if (myCar && !me.vehicles.some((v) => v.uid === myCarUid)) { if (player.car === myCar) leaveCar(); myCar.dispose(); myCar = null; myCarUid = null; }
  if (myCar && myCarUid) {
    const v = me.vehicles.find((x) => x.uid === myCarUid);
    if (v && (v.color !== myCar.color || v.rims !== myCar.rims) && player.car !== myCar) { const p = myCar.pos.clone(), hd = myCar.heading; myCar.dispose(); myCar = new Car(v.model, v.color, v.rims); myCar.setPose(p.x, p.z, hd); scene.add(myCar.root); myCar.root.visible = zone === 'street'; }
  }
  // ride status changes
  const rk = me.ride ? me.ride.id + me.ride.status : '';
  if (rk !== lastRide) {
    lastRide = rk;
    const r = me.ride;
    if (r?.role === 'driver' && r.status === 'assigned') setWaypoint(r.pickup[0], r.pickup[2], 'Pickup: ' + r.riderName);
    if (r?.role === 'rider' && r.status === 'assigned' && !r.driverIsNpc) toast(`@${r.driverName} is driving to you.`, 'ride');
  }

  // audio
  audio.updateListener(R.camera);
  audio.ambience({ indoor: zone !== 'street', night, rain: env.weather === 'rain', trafficNear: zone === 'street' ? 1 : 0 });
  venueMusic.duck(music.playing && music.output === 'headphones');
  const shared = store.presence.find((p) => p.z === zone && p.mu);
  if (shared?.mu) remoteMusic.setRemote(shared.mu.track, shared.mu.t0, new THREE.Vector3(...shared.p).setY(1.5)); else remoteMusic.setRemote(null);
  if (music.output === 'car' && player.mode !== 'drive') music.setOutput('headphones');

  // network presence (10 Hz, wall-clock throttled so slow frame rates still report promptly)
  if (now - posTimer > 100) { posTimer = now; pushPresence(); }
  if (body.anim === 'dance' && zone === 'club') { danceSecs += dt; if (danceSecs > 20) { act('activity.dance', { secs: danceSecs }).catch(() => {}); danceSecs = 0; } }

  // screens & HUD
  screenTimer += dt;
  if (screenTimer > 1) { screenTimer = 0; for (const s of city.screens) s.draw(store.prices, Object.fromEntries(store.tokens.map((k) => [k.sym, k.open24])), t); hud.renderMoney(); }
  const marks = hud.mapMarks();
  hud.frame(marks, player.camYaw, zone, zone.startsWith('home:') ? (zone === 'home:' + me.id ? 'Home' : 'A friend’s home') : zoneName(zone));
  remotes.sync(store.presence);

  fleet.update(R.camera.position, R.quality === 'low' ? 160 : 260);
  R.render();
  input.endFrame();
}
let danceSecs = 0;

on('presence', () => { /* synced in loop */ });
emit('boot');
boot().catch((e) => { console.error(e); setLoading('Failed to start: ' + e.message); loading?.classList.remove('hidden'); });
