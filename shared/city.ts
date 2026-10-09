// Deterministic city layout shared by client (renders it) and server
// (knows where places are for rides, zone checks and the map).

import type { Vec3 } from './types.js';

export const BLOCK = 80;
export const ROAD = 16;
export const PITCH = BLOCK + ROAD; // 96
export const COLS = 5;
export const ROWS = 4;
export const ORIGIN_X = -(COLS * PITCH) / 2; // -240
export const ORIGIN_Z = -(ROWS * PITCH) / 2; // -192
export const SIDEWALK = 4;

export type DistrictId = 'trading' | 'builder' | 'defi' | 'social' | 'creator' | 'residential' | 'automotive' | 'convention' | 'park';

export const DISTRICTS: Record<DistrictId, { name: string; color: string; tint: number }> = {
  trading: { name: 'Trading District', color: '#3fa7ff', tint: 0x3fa7ff },
  builder: { name: 'Builder District', color: '#ffb03f', tint: 0xffb03f },
  defi: { name: 'DeFi District', color: '#3fffb0', tint: 0x3fffb0 },
  social: { name: 'Social & Entertainment', color: '#ff4fa3', tint: 0xff4fa3 },
  creator: { name: 'Creator District', color: '#b46bff', tint: 0xb46bff },
  residential: { name: 'Residential District', color: '#9fd36b', tint: 0x9fd36b },
  automotive: { name: 'Automotive District', color: '#ff6b4f', tint: 0xff6b4f },
  convention: { name: 'Convention & Events', color: '#ffe14f', tint: 0xffe14f },
  park: { name: 'Hash Park', color: '#4fcf6b', tint: 0x4fcf6b },
};

// district per block [row][col]
export const BLOCK_DISTRICT: DistrictId[][] = [
  ['trading', 'trading', 'builder', 'builder', 'defi'],
  ['residential', 'social', 'social', 'creator', 'defi'],
  ['residential', 'park', 'convention', 'creator', 'automotive'],
  ['residential', 'residential', 'convention', 'automotive', 'automotive'],
];

export type InteriorKind =
  | 'exchange' | 'tradingfirm' | 'research' | 'whaleclub'
  | 'builderhub' | 'jobs' | 'vctower' | 'hackhouse'
  | 'defihub' | 'airdrop' | 'governance'
  | 'cafe' | 'burger' | 'grill' | 'finedining' | 'club' | 'boutique' | 'furniture'
  | 'nftgallery' | 'studio' | 'media'
  | 'residence' | 'realestate'
  | 'convention'
  | 'dealership' | 'usedcars' | 'customs' | 'transport';

export type Side = 'n' | 's' | 'e' | 'w';
export type Style = 'glass' | 'marble' | 'brick' | 'neon' | 'concrete' | 'villa' | 'industrial';

export interface Feature {
  zone: string;
  name: string;
  kind: InteriorKind;
  block: [number, number]; // [col,row]
  side: Side;
  at: number; // center offset along the side (0..72)
  w: number;
  d: number;
  h: number;
  style: Style;
  sign: string;
  blurb: string;
}

export const FEATURES: Feature[] = [
  { zone: 'exchange', name: 'Satoshi Square Exchange', kind: 'exchange', block: [0, 0], side: 's', at: 34, w: 40, d: 34, h: 72, style: 'glass', sign: 'EXCHANGE', blurb: 'Trade simulated tokens on the main floor.' },
  { zone: 'tradingfirm', name: 'Delta Neutral Capital', kind: 'tradingfirm', block: [0, 0], side: 'n', at: 22, w: 26, d: 24, h: 96, style: 'glass', sign: 'DELTA NEUTRAL', blurb: 'Prop trading firm. Analyst shifts available.' },
  { zone: 'research', name: 'Alpha Labs Research', kind: 'research', block: [1, 0], side: 's', at: 20, w: 28, d: 30, h: 60, style: 'concrete', sign: 'ALPHA LABS', blurb: 'Crypto research desk. Research shifts.' },
  { zone: 'whaleclub', name: 'The Whale Club', kind: 'whaleclub', block: [1, 0], side: 's', at: 54, w: 30, d: 28, h: 42, style: 'marble', sign: 'THE WHALE CLUB', blurb: 'Members lounge for net worth over $50,000.' },
  { zone: 'builderhub', name: 'Genesis Hub Coworking', kind: 'builderhub', block: [2, 0], side: 's', at: 22, w: 34, d: 30, h: 30, style: 'brick', sign: 'GENESIS HUB', blurb: 'Startup offices, dev shifts and project HQs.' },
  { zone: 'jobs', name: 'City Jobs Center', kind: 'jobs', block: [2, 0], side: 'e', at: 56, w: 22, d: 22, h: 18, style: 'concrete', sign: 'JOBS', blurb: 'Browse and apply for work.' },
  { zone: 'vctower', name: 'Seed Round Tower', kind: 'vctower', block: [3, 0], side: 's', at: 38, w: 36, d: 34, h: 124, style: 'glass', sign: 'SEED TOWER', blurb: 'Pitch your project to venture capital.' },
  { zone: 'hackhouse', name: 'Hackathon House', kind: 'hackhouse', block: [3, 0], side: 'w', at: 18, w: 26, d: 24, h: 22, style: 'industrial', sign: 'HACK HOUSE', blurb: 'Hackathon venue.' },
  { zone: 'defihub', name: 'Yield Plaza', kind: 'defihub', block: [4, 0], side: 's', at: 36, w: 40, d: 30, h: 48, style: 'glass', sign: 'YIELD PLAZA', blurb: 'Staking and lending center.' },
  { zone: 'airdrop', name: 'Airdrop Center', kind: 'airdrop', block: [4, 1], side: 'w', at: 24, w: 30, d: 30, h: 28, style: 'neon', sign: 'AIRDROP CENTER', blurb: 'Protocol quests and eligibility.' },
  { zone: 'governance', name: 'Governance Hall', kind: 'governance', block: [4, 1], side: 's', at: 54, w: 28, d: 24, h: 24, style: 'marble', sign: 'DAO HALL', blurb: 'Create and govern DAOs.' },
  { zone: 'cafe', name: 'Block Brew Café', kind: 'cafe', block: [2, 1], side: 'n', at: 13, w: 18, d: 16, h: 12, style: 'brick', sign: 'BLOCK BREW', blurb: 'Coffee and pastries.' },
  { zone: 'burger', name: 'Gas Fee Burgers', kind: 'burger', block: [2, 1], side: 'n', at: 35, w: 18, d: 16, h: 10, style: 'concrete', sign: 'GAS FEE BURGERS', blurb: 'Fast food, low fees.' },
  { zone: 'boutique', name: 'HODL Threads', kind: 'boutique', block: [2, 1], side: 'n', at: 59, w: 22, d: 20, h: 16, style: 'marble', sign: 'HODL THREADS', blurb: 'Clothing and accessories.' },
  { zone: 'club', name: 'Liquidity Nightclub', kind: 'club', block: [2, 1], side: 's', at: 36, w: 46, d: 34, h: 22, style: 'neon', sign: 'LIQUIDITY', blurb: 'Dance floor, DJ booth and VIP.' },
  { zone: 'grill', name: 'Genesis Grill', kind: 'grill', block: [1, 1], side: 'e', at: 18, w: 22, d: 22, h: 14, style: 'brick', sign: 'GENESIS GRILL', blurb: 'Casual dining.' },
  { zone: 'finedining', name: 'The Ledger', kind: 'finedining', block: [1, 1], side: 'e', at: 52, w: 24, d: 24, h: 18, style: 'marble', sign: 'THE LEDGER', blurb: 'Fine dining.' },
  { zone: 'furniture', name: 'Nest & Node Furniture', kind: 'furniture', block: [1, 1], side: 'w', at: 36, w: 30, d: 26, h: 14, style: 'concrete', sign: 'NEST & NODE', blurb: 'Furniture and home equipment.' },
  { zone: 'nftgallery', name: 'Mint Gallery', kind: 'nftgallery', block: [3, 1], side: 's', at: 20, w: 30, d: 28, h: 24, style: 'concrete', sign: 'MINT GALLERY', blurb: 'NFT exhibitions.' },
  { zone: 'studio', name: 'Meme Factory Studios', kind: 'studio', block: [3, 1], side: 's', at: 54, w: 28, d: 26, h: 30, style: 'neon', sign: 'MEME FACTORY', blurb: 'Content production. Creator shifts.' },
  { zone: 'media', name: 'CoinWire Media', kind: 'media', block: [3, 2], side: 'n', at: 30, w: 30, d: 26, h: 52, style: 'glass', sign: 'COINWIRE', blurb: 'Crypto media company. Community shifts.' },
  { zone: 'apt_starter', name: 'Mempool Apartments', kind: 'residence', block: [0, 1], side: 'e', at: 18, w: 26, d: 26, h: 30, style: 'brick', sign: 'MEMPOOL APTS', blurb: 'Starter and studio apartments.' },
  { zone: 'apt_mid', name: 'Merkle Residences', kind: 'residence', block: [0, 1], side: 'e', at: 54, w: 26, d: 26, h: 44, style: 'concrete', sign: 'MERKLE RESIDENCES', blurb: 'Standard apartments.' },
  { zone: 'realestate', name: 'Keystone Realty', kind: 'realestate', block: [0, 1], side: 's', at: 22, w: 22, d: 18, h: 12, style: 'marble', sign: 'KEYSTONE REALTY', blurb: 'Rent or buy homes.' },
  { zone: 'apt_lux', name: 'Summit Tower', kind: 'residence', block: [0, 2], side: 'e', at: 36, w: 30, d: 30, h: 88, style: 'glass', sign: 'SUMMIT TOWER', blurb: 'Luxury apartments and penthouses.' },
  { zone: 'mansion', name: 'Cold Storage Estate', kind: 'residence', block: [0, 3], side: 'n', at: 36, w: 40, d: 30, h: 12, style: 'villa', sign: 'COLD STORAGE ESTATE', blurb: 'Private mansion.' },
  { zone: 'convention', name: 'Crypto City Convention Center', kind: 'convention', block: [2, 2], side: 'n', at: 36, w: 60, d: 46, h: 26, style: 'glass', sign: 'CONVENTION CENTER', blurb: 'Conferences, competitions and launches.' },
  { zone: 'dealership', name: 'Moonshot Motors', kind: 'dealership', block: [4, 2], side: 'w', at: 36, w: 44, d: 30, h: 14, style: 'glass', sign: 'MOONSHOT MOTORS', blurb: 'New vehicle showroom.' },
  { zone: 'customs', name: 'Gwei Customs', kind: 'customs', block: [3, 3], side: 'n', at: 22, w: 30, d: 24, h: 10, style: 'industrial', sign: 'GWEI CUSTOMS', blurb: 'Paint, rims, upgrades and repairs.' },
  { zone: 'usedcars', name: 'Second Block Used Cars', kind: 'usedcars', block: [3, 3], side: 'n', at: 56, w: 26, d: 22, h: 8, style: 'industrial', sign: 'USED CARS', blurb: 'Affordable pre-owned vehicles.' },
  { zone: 'transport', name: 'CityRide HQ', kind: 'transport', block: [4, 3], side: 'w', at: 30, w: 28, d: 24, h: 16, style: 'concrete', sign: 'CITYRIDE', blurb: 'Driver registration and fleets.' },
];

export function blockOrigin(c: number, r: number): [number, number] {
  return [ORIGIN_X + c * PITCH + ROAD / 2, ORIGIN_Z + r * PITCH + ROAD / 2];
}

export interface FeatureGeom {
  cx: number;
  cz: number;
  sx: number; // extent along x
  sz: number;
  rot: number; // y rotation so local -z faces the street (front)
  door: Vec3;
  front: Side;
}

export function featureGeom(f: Feature): FeatureGeom {
  const [bx, bz] = blockOrigin(f.block[0], f.block[1]);
  const lo = SIDEWALK;
  const hi = BLOCK - SIDEWALK;
  let cx = 0, cz = 0, sx = 0, sz = 0, rot = 0;
  let door: Vec3 = [0, 0, 0];
  switch (f.side) {
    case 'n':
      cx = bx + lo + f.at; cz = bz + lo + f.d / 2; sx = f.w; sz = f.d; rot = 0;
      door = [cx, 0, bz + lo - 1.2];
      break;
    case 's':
      cx = bx + lo + f.at; cz = bz + hi - f.d / 2; sx = f.w; sz = f.d; rot = Math.PI;
      door = [cx, 0, bz + hi + 1.2];
      break;
    case 'w':
      cx = bx + lo + f.d / 2; cz = bz + lo + f.at; sx = f.d; sz = f.w; rot = -Math.PI / 2;
      door = [bx + lo - 1.2, 0, cz];
      break;
    case 'e':
      cx = bx + hi - f.d / 2; cz = bz + lo + f.at; sx = f.d; sz = f.w; rot = Math.PI / 2;
      door = [bx + hi + 1.2, 0, cz];
      break;
  }
  return { cx, cz, sx, sz, rot, door, front: f.side };
}

export const FEATURE_BY_ZONE: Record<string, Feature> = Object.fromEntries(FEATURES.map((f) => [f.zone, f]));

export function zoneName(zone: string): string {
  if (zone === 'street') return 'Crypto City streets';
  if (zone.startsWith('home:')) return 'a private home';
  return FEATURE_BY_ZONE[zone]?.name ?? zone;
}

export function doorOf(zone: string): Vec3 | null {
  const f = FEATURE_BY_ZONE[zone];
  return f ? featureGeom(f).door : null;
}

export function districtAt(x: number, z: number): DistrictId | null {
  const c = Math.floor((x - ORIGIN_X) / PITCH);
  const r = Math.floor((z - ORIGIN_Z) / PITCH);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
  return BLOCK_DISTRICT[r][c];
}

// Road centerlines
export const ROAD_X: number[] = Array.from({ length: COLS + 1 }, (_, i) => ORIGIN_X + i * PITCH);
export const ROAD_Z: number[] = Array.from({ length: ROWS + 1 }, (_, i) => ORIGIN_Z + i * PITCH);

/** Snap a point to the nearest road curb-side position (used for ride pickups). */
export function nearestCurb(x: number, z: number): Vec3 {
  let best: Vec3 = [x, 0, z];
  let bd = Infinity;
  for (const rx of ROAD_X) {
    const cz = Math.min(Math.max(z, ROAD_Z[0]), ROAD_Z[ROAD_Z.length - 1]);
    for (const off of [-4, 4]) {
      const d = Math.hypot(x - (rx + off), z - cz);
      if (d < bd) { bd = d; best = [rx + off, 0, cz]; }
    }
  }
  for (const rz of ROAD_Z) {
    const cx = Math.min(Math.max(x, ROAD_X[0]), ROAD_X[ROAD_X.length - 1]);
    for (const off of [-4, 4]) {
      const d = Math.hypot(x - cx, z - (rz + off));
      if (d < bd) { bd = d; best = [cx, 0, rz + off]; }
    }
  }
  return best;
}

export const CITY_BOUNDS = {
  minX: ROAD_X[0] - 40,
  maxX: ROAD_X[ROAD_X.length - 1] + 40,
  minZ: ROAD_Z[0] - 40,
  maxZ: ROAD_Z[ROAD_Z.length - 1] + 40,
};

export const PLAYER_SPAWN: Vec3 = (() => {
  const d = featureGeom(FEATURE_BY_ZONE['apt_starter']).door;
  return [d[0] + 2, 0, d[2]];
})();
