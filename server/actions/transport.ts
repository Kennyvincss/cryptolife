// Vehicles, ride-hailing (NPC and player drivers), driver careers and fleets.

import { FLEET_FEE, PAINTS, PAINT_PRICE, RIMS, UPGRADE_PRICE, VEHICLE_BY_ID } from '../../shared/catalog.js';
import { FEATURES, FEATURE_BY_ZONE, doorOf, featureGeom, nearestCurb } from '../../shared/city.js';
import type { RideCategory, RideState, Vec3 } from '../../shared/types.js';
import type { UserRec } from '../db-core.js';
import type { Game } from '../game.js';
import { assert, clamp, pick, round2, uid } from '../util.js';

const CAT_MULT: Record<RideCategory, number> = { economy: 1, premium: 1.6, luxury: 3, player: 1.2 };
const CAT_CAR: Record<RideCategory, string[]> = { economy: ['pico', 'ledger'], premium: ['ampere', 'bastion'], luxury: ['regent'], player: ['ledger'] };
const PLATFORM_FEE = 0.15;

export function fareFor(a: Vec3, b: Vec3, cat: RideCategory) {
  const d = Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]);
  return round2((2 + d * 0.012) * CAT_MULT[cat]);
}
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export function register(g: Game) {
  const A = g.actions;
  const veh = (u: UserRec, id: string) => { const v = u.vehicles.find((x) => x.uid === id); assert(v, 'Vehicle not found'); return v; };

  // ---------- ownership ----------
  A['vehicle.buy'] = (u, { model, color }) => {
    const d = VEHICLE_BY_ID[model];
    assert(d, 'Unknown vehicle');
    g.requireZone(u, d.used ? 'usedcars' : 'dealership');
    assert(u.vehicles.length < 12, 'Garage full — sell a vehicle first');
    g.debit(u, d.price, 'purchase', `Bought ${d.name}`);
    const v = { uid: uid('v'), model, color: PAINTS.includes(color) ? color : d.color, rims: 'steel', engine: 0, handling: 0, damage: d.used ? 12 : 0, purchasePrice: d.price };
    u.vehicles.push(v);
    u.activeVehicle = v.uid;
    if (!u.achievements.includes('first_car')) { g.achieve(u, 'first_car'); g.log(u, 'car', `Bought a first vehicle: ${d.name}.`); }
    else g.log(u, 'car', `Added a ${d.name} to the garage.`);
    return v;
  };
  A['vehicle.setActive'] = (u, { id }) => { veh(u, id); u.activeVehicle = id; };
  A['vehicle.customize'] = (u, { id, color, rims, engine, handling }) => {
    g.requireZone(u, 'customs');
    const v = veh(u, id);
    let cost = 0;
    const parts: string[] = [];
    if (color && color !== v.color) { assert(PAINTS.includes(color), 'Unknown paint'); cost += PAINT_PRICE; parts.push('paint'); }
    if (rims && rims !== v.rims) { const r = RIMS.find((x) => x.id === rims); assert(r, 'Unknown rims'); cost += r.price; parts.push(r.name + ' rims'); }
    const eng = engine === undefined ? v.engine : clamp(Math.floor(engine), 0, 3);
    const han = handling === undefined ? v.handling : clamp(Math.floor(handling), 0, 3);
    assert(eng >= v.engine && han >= v.handling, 'Upgrades cannot be downgraded');
    for (let i = v.engine + 1; i <= eng; i++) cost += UPGRADE_PRICE[i];
    for (let i = v.handling + 1; i <= han; i++) cost += UPGRADE_PRICE[i];
    if (eng > v.engine) parts.push(`engine L${eng}`);
    if (han > v.handling) parts.push(`handling L${han}`);
    assert(cost > 0, 'Nothing to change');
    g.debit(u, cost, 'vehicle', `Gwei Customs: ${parts.join(', ')}`);
    if (color) v.color = color;
    if (rims) v.rims = rims;
    v.engine = eng; v.handling = han;
    return v;
  };
  A['vehicle.repairQuote'] = (u, { id }) => {
    const v = veh(u, id);
    return { cost: round2(v.damage * VEHICLE_BY_ID[v.model].price * 0.0015 + (v.damage > 0 ? 15 : 0)) };
  };
  A['vehicle.repair'] = (u, { id }) => {
    g.requireZone(u, 'customs');
    const v = veh(u, id);
    assert(v.damage > 0, 'Already in perfect condition');
    const cost = round2(v.damage * VEHICLE_BY_ID[v.model].price * 0.0015 + 15);
    g.debit(u, cost, 'vehicle', `Repair: ${VEHICLE_BY_ID[v.model].name}`);
    v.damage = 0;
  };
  A['vehicle.sell'] = (u, { id }) => {
    g.requireZone(u, 'usedcars', 'dealership');
    const v = veh(u, id);
    assert(!u.fleet?.drivers.some((d) => d.vehicle === v.uid), 'That vehicle is assigned to a fleet driver');
    const d = VEHICLE_BY_ID[v.model];
    const value = round2(d.price * 0.6 * (1 - v.damage / 200) + (v.engine + v.handling) * 200);
    u.vehicles = u.vehicles.filter((x) => x !== v);
    if (u.activeVehicle === v.uid) u.activeVehicle = u.vehicles[0]?.uid;
    g.credit(u, value, 'vehicle', `Sold ${d.name}`);
    return { value };
  };
  A['vehicle.damage'] = (u, { id, amount }) => {
    const v = u.vehicles.find((x) => x.uid === id);
    if (!v) return;
    g.rateLimit(u.id + ':dmg', 10, 10_000);
    v.damage = clamp(v.damage + clamp(Number(amount) || 0, 0, 15), 0, 100);
    if (u.ride && u.ride.role === 'driver') u.ride.damage = (u.ride.damage ?? 0) + (Number(amount) || 0);
    return { damage: v.damage };
  };
  A['vehicle.testDrive'] = (u, { model }) => {
    g.requireZone(u, 'dealership', 'usedcars');
    assert(VEHICLE_BY_ID[model], 'Unknown vehicle');
    return { model, seconds: 90 };
  };

  // ---------- rides (as passenger) ----------
  A['ride.places'] = () => FEATURES.map((f) => ({ zone: f.zone, name: f.name, door: featureGeom(f).door }));
  A['ride.quote'] = (u, { dest, category }) => {
    const d = doorOf(dest);
    assert(d, 'Unknown destination');
    const cat = (['economy', 'premium', 'luxury', 'player'].includes(category) ? category : 'economy') as RideCategory;
    const pickup = nearestCurb(u.lastPos[0], u.lastPos[2]);
    const drivers = [...g.presence.keys()].filter((id) => id !== u.id && g.db.users[id].driver.onDuty && !g.db.users[id].ride).length;
    return { fare: fareFor(pickup, d, cat), etaSec: 15 + Math.round(Math.random() * 15), playerDrivers: drivers };
  };
  A['ride.request'] = (u, { dest, category }) => {
    assert(!u.ride || ['completed', 'cancelled'].includes(u.ride.status), 'You already have an active ride');
    assert(g.zoneOf(u) === 'street', 'Step outside to request a ride.');
    const d = doorOf(dest);
    assert(d, 'Unknown destination');
    const cat = (['economy', 'premium', 'luxury', 'player'].includes(category) ? category : 'economy') as RideCategory;
    const pickup = nearestCurb(u.lastPos[0], u.lastPos[2]);
    assert(dist(pickup, d) > 30, "You're already there!");
    const fare = fareFor(pickup, d, cat);
    assert(u.cash >= fare, `Estimated fare is $${fare} — not enough funds.`);
    const ride: RideState = {
      id: uid('ride'), role: 'rider', status: 'searching', category: cat, pickup, pickupName: 'Your location', dest: d, destName: FEATURE_BY_ZONE[dest].name,
      fare, driverName: '', driverIsNpc: true, driverRating: 0, vehicleModel: '', vehicleColor: '', riderName: u.username, riderIsNpc: false, etaSec: 0, created: Date.now(),
    };
    u.ride = ride;
    if (cat === 'player') {
      const cands = [...g.presence.keys()].map((id) => g.db.users[id]).filter((x) => x.id !== u.id && x.driver.onDuty && (!x.ride || ['completed', 'cancelled'].includes(x.ride.status)) && !x.blocked.includes(u.id));
      cands.sort((a, b) => dist(a.lastPos, pickup) - dist(b.lastPos, pickup));
      const drv = cands[0];
      if (drv) {
        const v = drv.vehicles.find((x) => x.uid === drv.activeVehicle);
        drv.ride = { ...ride, role: 'driver', status: 'searching', pickupName: `@${u.username}`, riderName: u.username, riderIsNpc: false, vehicleModel: v?.model ?? 'ledger', vehicleColor: v?.color ?? '#333', driverName: drv.username, driverIsNpc: false };
        drv.ride.riderId = u.id;
        u.ride.driverId = drv.id;
        g.notify(drv, `🚕 Ride request from @${u.username} to ${ride.destName} — $${round2(fare * (1 - PLATFORM_FEE))} for you. Open Drive to accept.`, 'ride');
        g.pushMe(drv);
        setTimeout(() => {
          // fall back to an NPC driver if nobody accepts in time
          if (u.ride?.id === ride.id && u.ride.status === 'searching') {
            if (drv.ride?.id === ride.id) { drv.ride = undefined; g.pushMe(drv); }
            assignNpc(u, ride, 'economy');
            g.notify(u, 'No player driver accepted — an NPC driver is on the way instead.', 'ride');
            g.pushMe(u);
          }
        }, 25_000);
        return ride;
      }
      g.notify(u, 'No player drivers on duty right now — assigning an NPC driver.', 'ride');
    }
    assignNpc(u, ride, cat === 'player' ? 'economy' : cat);
    return ride;
  };
  function assignNpc(u: UserRec, ride: RideState, cat: RideCategory) {
    const model = pick(CAT_CAR[cat]);
    Object.assign(ride, {
      status: 'assigned', driverName: g.npcName(), driverIsNpc: true, driverRating: round2(4.3 + Math.random() * 0.7), vehicleModel: model,
      vehicleColor: pick(['#111114', '#f2f2f2', '#2d3a55', '#c8d1d8']), etaSec: 15 + Math.round(Math.random() * 15),
    });
  }
  A['ride.arrived'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'rider' && r.status === 'assigned' && r.driverIsNpc, 'No driver en route');
    r.status = 'arrived';
  };
  A['ride.board'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'rider' && r.status === 'arrived', 'Your ride has not arrived');
    r.status = 'onboard';
  };
  A['ride.complete'] = (u) => {
    // NPC-driven ride completion (player-driven rides are completed by the driver)
    const r = u.ride;
    assert(r && r.role === 'rider' && r.status === 'onboard' && r.driverIsNpc, 'No ride in progress');
    assert(dist(u.lastPos, r.dest) < 40, 'Not at the destination yet');
    g.debit(u, Math.min(r.fare, u.cash), 'ride', `CityRide ${r.category} to ${r.destName} (driver ${r.driverName}, NPC)`);
    r.status = 'completed';
    if (!u.achievements.includes('first_ride')) { g.achieve(u, 'first_ride'); g.log(u, 'ride', `Took a first CityRide to ${r.destName}.`); }
    return r;
  };
  A['ride.cancel'] = (u) => {
    const r = u.ride;
    assert(r && !['completed', 'cancelled'].includes(r.status), 'No active ride');
    assert(r.status !== 'onboard', "You can't cancel mid-ride");
    if (r.role === 'rider') {
      if (r.status === 'arrived' || (r.status === 'assigned' && Date.now() - r.created > 60_000)) g.debit(u, Math.min(1.5, u.cash), 'ride', 'Late cancellation fee');
      const drvId = r.driverId as string | undefined;
      const drv = drvId ? g.db.users[drvId] : null;
      if (drv?.ride?.id === r.id) { drv.ride.status = 'cancelled'; g.notify(drv, `@${u.username} cancelled the ride.`, 'ride'); g.pushMe(drv); }
    } else {
      const rider = r.riderId ? g.db.users[r.riderId] : null;
      if (rider?.ride?.id === r.id) { rider.ride = undefined; A['ride.request'](rider, { dest: zoneForDoor(r.dest), category: 'economy' }, g); g.notify(rider, 'Your player driver cancelled — reassigned to an NPC driver.', 'ride'); g.pushMe(rider); }
    }
    r.status = 'cancelled';
  };
  A['ride.rate'] = (u, { stars }) => {
    const r = u.ride;
    assert(r && r.status === 'completed' && !r.rated, 'Nothing to rate');
    const s = clamp(Math.round(Number(stars)), 1, 5);
    r.rated = true;
    const drvId = r.driverId as string | undefined;
    const drv = drvId ? g.db.users[drvId] : null;
    if (drv && !r.driverIsNpc) { drv.driver.ratingSum += s; drv.driver.ratingCount++; g.notify(drv, `@${u.username} rated your ride ${'★'.repeat(s)}`, 'ride'); g.pushMe(drv); }
    u.ride = undefined;
  };
  A['ride.dismiss'] = (u) => { if (u.ride && ['completed', 'cancelled'].includes(u.ride.status)) u.ride = undefined; };

  // ---------- driver career ----------
  A['driver.register'] = (u) => {
    g.requireZone(u, 'transport');
    assert(u.vehicles.some((v) => VEHICLE_BY_ID[v.model].seats > 1), 'You need a car with passenger seats (motorcycles don\'t count).');
    assert(!u.driver.registered, 'Already registered');
    u.driver.registered = true;
    g.log(u, 'driver', 'Registered as a CityRide driver.');
  };
  A['driver.duty'] = (u, { on }) => {
    assert(u.driver.registered, 'Register at CityRide HQ first');
    if (on) {
      const v = u.vehicles.find((x) => x.uid === u.activeVehicle);
      assert(v && VEHICLE_BY_ID[v.model].seats > 1, 'Select a car with passenger seats as your active vehicle');
      const p = g.presence.get(u.id);
      assert(p?.a === 'drive', 'Get in your car first');
    }
    u.driver.onDuty = !!on;
    if (!on && u.ride?.role === 'driver' && u.ride.status === 'searching') u.ride = undefined;
  };
  A['driver.accept'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'driver' && r.status === 'searching', 'No pending request');
    r.status = 'assigned';
    const rider = r.riderId ? g.db.users[r.riderId] : null;
    if (rider?.ride?.id === r.id) {
      Object.assign(rider.ride, { status: 'assigned', driverName: u.username, driverIsNpc: false, driverRating: u.driver.ratingCount ? round2(u.driver.ratingSum / u.driver.ratingCount) : 5, vehicleModel: r.vehicleModel, vehicleColor: r.vehicleColor, etaSec: Math.round(dist(u.lastPos, r.pickup) / 10) });
      g.notify(rider, `🚗 @${u.username} accepted your ride. Watch for a ${VEHICLE_BY_ID[r.vehicleModel]?.name ?? 'car'}.`, 'ride');
      g.pushMe(rider);
    }
  };
  A['driver.decline'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'driver' && r.status === 'searching', 'No pending request');
    u.ride = undefined;
  };
  A['driver.pickup'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'driver' && r.status === 'assigned', 'No pickup pending');
    const rider = r.riderId ? g.db.users[r.riderId] : null;
    const target = rider ? rider.lastPos : r.pickup;
    assert(dist(u.lastPos, target) < 16, 'Get closer to the passenger');
    r.status = 'onboard';
    r.pickedAt = Date.now();
    r.damage = 0;
    if (rider?.ride?.id === r.id) { rider.ride.status = 'onboard'; g.notify(rider, 'You are on board. Sit back and enjoy the ride.', 'ride'); g.pushMe(rider); }
  };
  A['driver.complete'] = (u) => {
    const r = u.ride;
    assert(r && r.role === 'driver' && r.status === 'onboard', 'No passenger on board');
    assert(dist(u.lastPos, r.dest) < 30, 'Drive to the destination first');
    const rider = r.riderId ? g.db.users[r.riderId] : null;
    let paid = r.fare;
    if (rider && rider.ride?.id === r.id) {
      paid = Math.min(r.fare, rider.cash);
      if (paid > 0) g.debit(rider, paid, 'ride', `CityRide with @${u.username} to ${r.destName}`, u.username);
      rider.ride.status = 'completed';
      if (!rider.achievements.includes('first_ride')) { g.achieve(rider, 'first_ride'); g.log(rider, 'ride', `Took a first CityRide with player driver @${u.username}.`); }
      g.pushMe(rider);
    }
    const earn = round2(paid * (1 - PLATFORM_FEE));
    g.credit(u, earn, 'driver', `Fare: ${r.riderName}${r.riderIsNpc ? ' (NPC)' : ''} to ${r.destName} (15% platform fee)`);
    u.driver.rides++;
    u.driver.earnings = round2(u.driver.earnings + earn);
    if (r.riderIsNpc) {
      // NPC passengers rate on care: damage during the trip lowers the score
      const dmg = r.damage ?? 0;
      const secs = (Date.now() - (r.pickedAt ?? Date.now())) / 1000;
      const stars = clamp(Math.round(5 - dmg / 6 - (secs > 150 ? 1 : 0)), 1, 5);
      u.driver.ratingSum += stars;
      u.driver.ratingCount++;
      g.notify(u, `${r.riderName} rated you ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`, 'ride');
    }
    g.addXp(u, 'driving', 35);
    g.addRep(u, 'driving', 1);
    if (u.driver.rides === 1) g.log(u, 'driver', `Completed a first CityRide fare and earned $${earn}.`);
    if (u.driver.rides >= 10) g.achieve(u, 'driver_10');
    r.status = 'completed';
    const res = { earn };
    u.ride = undefined;
    return res;
  };

  // ---------- fleet ----------
  A['fleet.create'] = (u, { name }) => {
    g.requireZone(u, 'transport');
    assert(!u.fleet, 'You already own a transport company');
    assert(u.driver.rides >= 5, 'Complete 5 rides as a driver before starting a company');
    const n = g.clean(name, 30) || `${u.username} Transport`;
    g.debit(u, FLEET_FEE, 'business', `Registered transport company ${n}`);
    u.fleet = { name: n, drivers: [], earnings: 0 };
    u.career = 'Transport Owner';
    g.log(u, 'driver', `Founded the transport company ${n}.`);
  };
  A['fleet.hire'] = (u, { vehicle }) => {
    assert(u.fleet, 'Start a company first');
    const v = veh(u, vehicle);
    assert(VEHICLE_BY_ID[v.model].seats > 1, 'Needs a car with passenger seats');
    assert(v.uid !== u.activeVehicle, 'You are using that car — set another active vehicle first');
    assert(!u.fleet.drivers.some((d) => d.vehicle === v.uid), 'Already assigned');
    const name = g.npcName();
    u.fleet.drivers.push({ name: name + ' (NPC)', vehicle: v.uid, hired: Date.now() });
    g.achieve(u, 'first_hire');
    g.log(u, 'hire', `Hired ${name} to drive for ${u.fleet.name}.`);
  };
  A['fleet.fire'] = (u, { vehicle }) => {
    assert(u.fleet, 'No company');
    u.fleet.drivers = u.fleet.drivers.filter((d) => d.vehicle !== vehicle);
  };
}

function zoneForDoor(d: Vec3) {
  for (const f of FEATURES) { const g = featureGeom(f).door; if (g[0] === d[0] && g[2] === d[2]) return f.zone; }
  return 'exchange';
}

export function fleetCycle(g: Game, u: UserRec) {
  if (!u.fleet || !u.fleet.drivers.length) return;
  // passive income only accrues while the owner has been active recently
  if (Date.now() - u.lastActive > 30 * 60_000) return;
  let total = 0;
  for (const d of u.fleet.drivers) {
    const v = u.vehicles.find((x) => x.uid === d.vehicle);
    if (!v) continue;
    const def = VEHICLE_BY_ID[v.model];
    const gross = (6 + Math.random() * 10) * (1 + (def.price > 15000 ? 0.4 : 0)) * (1 - v.damage / 150);
    const wage = gross * 0.4;
    v.damage = Math.min(100, v.damage + Math.random() * 3);
    total += gross - wage - 1.5;
  }
  total = round2(total);
  if (total > 0) { g.credit(u, total, 'business', `${u.fleet.name}: fleet earnings after driver wages & fuel`); u.fleet.earnings = round2(u.fleet.earnings + total); }
  g.addXp(u, 'driving', 5 * u.fleet.drivers.length);
}

/** Generate NPC passenger requests for on-duty player drivers. */
export function offerNpcRides(g: Game, u: UserRec) {
  if (!u.driver.onDuty || (u.ride && !['completed', 'cancelled'].includes(u.ride.status))) return;
  if (Math.random() > 0.25) return;
  const pos = u.lastPos;
  const angle = Math.random() * Math.PI * 2;
  const r = 60 + Math.random() * 120;
  const pickup = nearestCurb(pos[0] + Math.cos(angle) * r, pos[2] + Math.sin(angle) * r);
  const dest = pick(FEATURES.filter((f) => dist(featureGeom(f).door, pickup) > 120));
  const door = featureGeom(dest).door;
  const v = u.vehicles.find((x) => x.uid === u.activeVehicle);
  const fare = fareFor(pickup, door, 'economy');
  u.ride = {
    id: uid('ride'), role: 'driver', status: 'searching', category: 'economy', pickup, pickupName: 'Curbside pickup', dest: door, destName: dest.name,
    fare, driverName: u.username, driverIsNpc: false, driverRating: 0, vehicleModel: v?.model ?? 'ledger', vehicleColor: v?.color ?? '#333',
    riderName: g.npcName(), riderIsNpc: true, etaSec: 0, created: Date.now(),
  };
  g.notify(u, `🚕 New request: ${u.ride.riderName} (NPC) → ${dest.name}. Fare $${fare}.`, 'ride');
  g.pushMe(u);
  setTimeout(() => { if (u.ride?.status === 'searching' && u.ride.riderIsNpc) { u.ride = undefined; g.pushMe(u); } }, 30_000);
}
