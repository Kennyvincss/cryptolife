// Static game catalogs. All names, brands and items are original to Crypto City.
// All prices are in SIMULATED dollars (in-game currency, not withdrawable).

import type { Career, ChallengeKind, Look, SkillId, Slot } from './types.js';

export const STARTING_CASH = 100;
export const GAME_MINUTE_MS = 1000; // 1 real second = 1 game minute (24 real minutes per game day)
export const DAY_MS = GAME_MINUTE_MS * 60 * 24;

// ---------- Tokens (simulated market) ----------
export interface TokenDef { sym: string; name: string; price: number; vol: number; sector: string; supply: number }
export const TOKENS: TokenDef[] = [
  { sym: 'SGLD', name: 'Satoshi Gold', price: 61250, vol: 0.5, sector: 'store-of-value', supply: 21_000_000 },
  { sym: 'ETHN', name: 'Etherion', price: 3120, vol: 0.65, sector: 'smart-contracts', supply: 120_000_000 },
  { sym: 'SOLR', name: 'Solaris', price: 148, vol: 0.9, sector: 'smart-contracts', supply: 560_000_000 },
  { sym: 'YLD', name: 'Yieldstone', price: 7.4, vol: 1.1, sector: 'defi', supply: 1_000_000_000 },
  { sym: 'LQD', name: 'Liquidity Labs', price: 2.15, vol: 1.2, sector: 'defi', supply: 2_000_000_000 },
  { sym: 'BLD', name: 'Builder Token', price: 0.86, vol: 1.3, sector: 'infra', supply: 5_000_000_000 },
  { sym: 'PXL', name: 'Pixelverse', price: 0.42, vol: 1.5, sector: 'nft', supply: 3_000_000_000 },
  { sym: 'MDOG', name: 'Moon Doge', price: 0.0031, vol: 2.4, sector: 'meme', supply: 420_000_000_000 },
  { sym: 'CITY', name: 'Crypto City Coin', price: 1.0, vol: 0.8, sector: 'governance', supply: 1_000_000_000 },
];
export const TRADE_FEE = 0.001; // 0.1%

// ---------- Properties ----------
export interface PropertyDef {
  id: string; name: string; tier: 'starter' | 'studio' | 'standard' | 'luxury' | 'penthouse' | 'mansion';
  building: string; price: number; rent: number; layout: 'small' | 'medium' | 'large'; slots: number; garage: number; desc: string;
}
export const PROPERTIES: PropertyDef[] = [
  { id: 'starter', name: 'Starter Apartment 3B', tier: 'starter', building: 'apt_starter', price: 0, rent: 0, layout: 'small', slots: 4, garage: 1, desc: 'A modest one-room start. Free for every new resident.' },
  { id: 'studio', name: 'Mempool Studio 9F', tier: 'studio', building: 'apt_starter', price: 2500, rent: 15, layout: 'small', slots: 6, garage: 1, desc: 'Brighter studio with better views.' },
  { id: 'standard', name: 'Merkle Residence 14A', tier: 'standard', building: 'apt_mid', price: 9000, rent: 45, layout: 'medium', slots: 10, garage: 2, desc: 'Two rooms plus a home office / trading room.' },
  { id: 'luxury', name: 'Summit Luxury 41', tier: 'luxury', building: 'apt_lux', price: 60000, rent: 220, layout: 'medium', slots: 14, garage: 3, desc: 'High-floor luxury apartment, premium finishes.' },
  { id: 'penthouse', name: 'Summit Penthouse', tier: 'penthouse', building: 'apt_lux', price: 280000, rent: 900, layout: 'large', slots: 20, garage: 5, desc: 'Top floor. Gaming room, home bar, gym and terrace.' },
  { id: 'mansion', name: 'Cold Storage Estate', tier: 'mansion', building: 'mansion', price: 1250000, rent: 3500, layout: 'large', slots: 24, garage: 10, desc: 'Private estate with pool terrace and big garage.' },
];
export const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

// ---------- Furniture ----------
export interface FurnitureDef { id: string; name: string; price: number; cat: string; model: string; use?: string; bonus?: string }
export const FURNITURE: FurnitureDef[] = [
  { id: 'plant', name: 'Fiddle Leaf Plant', price: 25, cat: 'Decor', model: 'plant' },
  { id: 'lamp', name: 'Arc Floor Lamp', price: 40, cat: 'Lighting', model: 'lamp', use: 'Toggle lamp' },
  { id: 'rug', name: 'Wool Rug', price: 60, cat: 'Decor', model: 'rug' },
  { id: 'bookshelf', name: 'Oak Bookshelf', price: 120, cat: 'Office', model: 'bookshelf', use: 'Read', bonus: '+research XP when reading' },
  { id: 'armchair', name: 'Lounge Armchair', price: 180, cat: 'Living', model: 'armchair', use: 'Sit' },
  { id: 'speaker', name: 'Bookshelf Speakers', price: 150, cat: 'Audio', model: 'speaker', use: 'Play music on speakers' },
  { id: 'tower_speaker', name: 'Tower Speakers', price: 900, cat: 'Audio', model: 'tower_speaker', use: 'Play music on speakers' },
  { id: 'smartlights', name: 'Smart Light Strip', price: 150, cat: 'Lighting', model: 'smartlights', use: 'Cycle colors' },
  { id: 'trophy', name: 'Trophy Shelf', price: 200, cat: 'Decor', model: 'trophy', use: 'View achievements' },
  { id: 'camera', name: 'Security Camera', price: 200, cat: 'Tech', model: 'camera', use: 'Check camera' },
  { id: 'art_small', name: 'Abstract Print', price: 300, cat: 'Art', model: 'art_small' },
  { id: 'aircon', name: 'Air Conditioner', price: 350, cat: 'Tech', model: 'aircon', use: 'Toggle A/C' },
  { id: 'tv55', name: '55" OLED TV', price: 400, cat: 'Living', model: 'tv55', use: 'Watch CityNews' },
  { id: 'console', name: 'Game Console', price: 500, cat: 'Gaming', model: 'console', use: 'Play Block Breaker' },
  { id: 'aquarium', name: 'Reef Aquarium', price: 600, cat: 'Decor', model: 'aquarium', use: 'Watch the fish' },
  { id: 'arcade', name: 'Arcade Cabinet', price: 700, cat: 'Gaming', model: 'arcade', use: 'Play Block Breaker' },
  { id: 'gym', name: 'Gym Rack', price: 800, cat: 'Fitness', model: 'gym', use: 'Work out' },
  { id: 'rig', name: 'Six-Monitor Trading Rig', price: 1200, cat: 'Office', model: 'rig', use: 'Use trading rig', bonus: '+25% trading XP' },
  { id: 'bar', name: 'Home Bar', price: 1500, cat: 'Living', model: 'bar', use: 'Mix a mocktail' },
  { id: 'tv85', name: '85" Cinema TV', price: 1800, cat: 'Living', model: 'tv85', use: 'Watch CityNews' },
  { id: 'pool', name: 'Pool Table', price: 2000, cat: 'Gaming', model: 'pool', use: 'Shoot pool' },
  { id: 'art_large', name: 'Generative Art Canvas', price: 5000, cat: 'Art', model: 'art_large' },
];
export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((f) => [f.id, f]));

// ---------- Clothing ----------
export interface ClothingDef { id: string; slot: Slot; name: string; price: number; style: string; colors: string[] }
const BASIC = ['#f2f2f2', '#1c1c1f', '#3a5a8c', '#8c2f39', '#2f7d5b', '#d9a441', '#6b4ea8', '#e46f2e', '#9aa3ad', '#f07ca8'];
export const CLOTHING: ClothingDef[] = [
  { id: 'tee', slot: 'top', name: 'Basic Tee', price: 0, style: 'tee', colors: BASIC },
  { id: 'tank', slot: 'top', name: 'Tank Top', price: 20, style: 'tank', colors: BASIC },
  { id: 'hoodie', slot: 'top', name: 'Hoodie', price: 40, style: 'hoodie', colors: BASIC },
  { id: 'hodl_hoodie', slot: 'top', name: 'HODL Hoodie', price: 60, style: 'hoodie_logo', colors: ['#111114', '#f2f2f2', '#f7931a', '#4b5bdc'] },
  { id: 'shirt', slot: 'top', name: 'Button Shirt', price: 55, style: 'shirt', colors: BASIC },
  { id: 'jersey', slot: 'top', name: 'City FC Jersey', price: 75, style: 'jersey', colors: ['#d92b3a', '#1e4fd9', '#f2f2f2', '#121212'] },
  { id: 'blazer', slot: 'top', name: 'Founder Blazer', price: 180, style: 'blazer', colors: ['#1c1c1f', '#2d3a55', '#6b6f75', '#7a2734'] },
  { id: 'leather', slot: 'top', name: 'Leather Jacket', price: 220, style: 'jacket', colors: ['#141414', '#5a3420', '#7a1f2a'] },
  { id: 'whale_suit', slot: 'top', name: 'Whale Suit Jacket', price: 900, style: 'suit', colors: ['#0f1115', '#22262e', '#e8e4da', '#1d2b45'] },
  { id: 'jeans', slot: 'bottom', name: 'Jeans', price: 0, style: 'pants', colors: ['#2f4a7a', '#1b2233', '#6f89b5', '#1c1c1f'] },
  { id: 'shorts', slot: 'bottom', name: 'Shorts', price: 25, style: 'shorts', colors: BASIC },
  { id: 'joggers', slot: 'bottom', name: 'Joggers', price: 35, style: 'pants', colors: BASIC },
  { id: 'chinos', slot: 'bottom', name: 'Chinos', price: 45, style: 'pants', colors: ['#c8b48a', '#2f3b2f', '#1c1c1f', '#8a8f96'] },
  { id: 'skirt', slot: 'bottom', name: 'Pleated Skirt', price: 40, style: 'skirt', colors: BASIC },
  { id: 'suit_pants', slot: 'bottom', name: 'Suit Trousers', price: 160, style: 'pants', colors: ['#0f1115', '#22262e', '#e8e4da', '#1d2b45'] },
  { id: 'sneakers', slot: 'shoes', name: 'Sneakers', price: 0, style: 'sneaker', colors: ['#f2f2f2', '#1c1c1f', '#d92b3a'] },
  { id: 'runners', slot: 'shoes', name: 'Runners', price: 70, style: 'sneaker', colors: BASIC },
  { id: 'boots', slot: 'shoes', name: 'Boots', price: 110, style: 'boot', colors: ['#3b2618', '#141414', '#7a5a3a'] },
  { id: 'loafers', slot: 'shoes', name: 'Loafers', price: 150, style: 'loafer', colors: ['#141414', '#4a2a18'] },
  { id: 'moon_tops', slot: 'shoes', name: 'Moon High-Tops', price: 300, style: 'hightop', colors: ['#f7931a', '#9b5cff', '#00d18f', '#f2f2f2'] },
  { id: 'cap', slot: 'hat', name: 'Snapback Cap', price: 25, style: 'cap', colors: BASIC },
  { id: 'beanie', slot: 'hat', name: 'Beanie', price: 20, style: 'beanie', colors: BASIC },
  { id: 'bucket', slot: 'hat', name: 'Bucket Hat', price: 30, style: 'bucket', colors: BASIC },
  { id: 'shades', slot: 'glasses', name: 'Shades', price: 45, style: 'shades', colors: ['#111111'] },
  { id: 'round', slot: 'glasses', name: 'Round Frames', price: 60, style: 'round', colors: ['#c9a227', '#111111'] },
  { id: 'visor', slot: 'glasses', name: 'Laser Visor', price: 150, style: 'visor', colors: ['#ff2f6d', '#2fe0ff'] },
  { id: 'digital', slot: 'watch', name: 'Digital Watch', price: 80, style: 'watch', colors: ['#1c1c1f'] },
  { id: 'steel', slot: 'watch', name: 'Steel Chronograph', price: 1200, style: 'watch', colors: ['#c0c6cc'] },
  { id: 'gold_watch', slot: 'watch', name: 'Gold Perpetual', price: 9000, style: 'watch', colors: ['#d4af37'] },
  { id: 'silver_chain', slot: 'chain', name: 'Silver Chain', price: 300, style: 'chain', colors: ['#c0c6cc'] },
  { id: 'gold_chain', slot: 'chain', name: 'Gold Chain', price: 2500, style: 'chain', colors: ['#d4af37'] },
  { id: 'diamond_chain', slot: 'chain', name: 'Diamond Pendant', price: 25000, style: 'chain_pendant', colors: ['#e8f4ff'] },
  { id: 'backpack', slot: 'bag', name: 'Backpack', price: 60, style: 'backpack', colors: BASIC },
  { id: 'messenger', slot: 'bag', name: 'Messenger Bag', price: 90, style: 'messenger', colors: ['#3b2618', '#1c1c1f', '#2f4a7a'] },
  { id: 'designer_bag', slot: 'bag', name: 'Designer Tote', price: 3000, style: 'tote', colors: ['#d4af37', '#141414', '#7a1f2a'] },
];
export const CLOTHING_BY_ID = Object.fromEntries(CLOTHING.map((c) => [c.id, c]));
export const STARTER_WARDROBE = ['tee', 'jeans', 'sneakers'];

export const SKIN_TONES = ['#f6d7c3', '#ecc0a0', '#d9a57e', '#c58b62', '#a8704a', '#8a5636', '#6b3f26', '#4a2a19'];
export const HAIR_COLORS = ['#1a1412', '#3b2618', '#6b4a2b', '#a87b4f', '#d8b880', '#e6e0d4', '#b33a2a', '#4fb3ff', '#ff5fb3'];
export const EYE_COLORS = ['#3b2618', '#2f6b3a', '#2f5a9c', '#6b6f75'];
export const HAIR_STYLES = ['Buzz', 'Short', 'Spiky', 'Long', 'Bun', 'Afro', 'Bald', 'Ponytail'];

export function defaultLook(body: 'm' | 'f' = 'm'): Look {
  return {
    body,
    skin: SKIN_TONES[3],
    hairStyle: body === 'm' ? 1 : 3,
    hairColor: HAIR_COLORS[0],
    eyeColor: EYE_COLORS[0],
    height: body === 'm' ? 1 : 0.95,
    build: 1,
    outfit: { top: 'tee', bottom: 'jeans', shoes: 'sneakers' },
    colors: { top: '#f2f2f2', bottom: '#2f4a7a', shoes: '#f2f2f2' },
  };
}

// ---------- Vehicles ----------
export interface VehicleDef {
  id: string; name: string; cat: string; body: 'hatch' | 'sedan' | 'suv' | 'sports' | 'super' | 'luxury' | 'moto' | 'ev';
  price: number; top: number; accel: number; grip: number; seats: number; used?: boolean; electric?: boolean; color: string;
}
export const VEHICLES: VehicleDef[] = [
  { id: 'pico', name: 'Pico Hatch (Used)', cat: 'Economy', body: 'hatch', price: 650, top: 30, accel: 6, grip: 0.8, seats: 4, used: true, color: '#c8d1d8' },
  { id: 'scoot', name: 'Byte 125 Scooter (Used)', cat: 'Motorcycle', body: 'moto', price: 400, top: 26, accel: 7, grip: 0.75, seats: 1, used: true, color: '#d92b3a' },
  { id: 'ledger', name: 'Ledger Sedan', cat: 'Sedan', body: 'sedan', price: 4800, top: 40, accel: 8, grip: 0.9, seats: 4, color: '#2d3a55' },
  { id: 'byte', name: 'Byte R6 Motorcycle', cat: 'Motorcycle', body: 'moto', price: 6500, top: 52, accel: 15, grip: 0.85, seats: 1, color: '#111114' },
  { id: 'ampere', name: 'Ampere EV', cat: 'Electric', body: 'ev', price: 12000, top: 44, accel: 12, grip: 0.95, seats: 4, electric: true, color: '#f2f2f2' },
  { id: 'bastion', name: 'Bastion SUV', cat: 'SUV', body: 'suv', price: 18000, top: 40, accel: 7.5, grip: 0.9, seats: 5, color: '#2f3b2f' },
  { id: 'mirage', name: 'Mirage GT', cat: 'Sports', body: 'sports', price: 55000, top: 62, accel: 14, grip: 1.05, seats: 2, color: '#d92b3a' },
  { id: 'regent', name: 'Regent Luxe', cat: 'Luxury', body: 'luxury', price: 120000, top: 56, accel: 11, grip: 1.0, seats: 4, color: '#0f1115' },
  { id: 'halving', name: 'Halving X', cat: 'Supercar', body: 'super', price: 420000, top: 82, accel: 21, grip: 1.15, seats: 2, color: '#f7931a' },
];
export const VEHICLE_BY_ID = Object.fromEntries(VEHICLES.map((v) => [v.id, v]));
export const PAINTS = ['#f2f2f2', '#111114', '#c8d1d8', '#d92b3a', '#1e4fd9', '#f7931a', '#2f7d5b', '#9b5cff', '#ffd23f', '#00c2c7', '#5a3420', '#ff4fa3'];
export const RIMS = [
  { id: 'steel', name: 'Steel', price: 0 },
  { id: 'sport', name: 'Sport 5-Spoke', price: 400 },
  { id: 'mesh', name: 'Mesh', price: 900 },
  { id: 'gold', name: 'Gold Multi-Spoke', price: 2500 },
  { id: 'black', name: 'Blackout', price: 700 },
];
export const PAINT_PRICE = 250;
export const UPGRADE_PRICE = [0, 800, 2500, 7000];

// ---------- Food ----------
export interface MenuItem { id: string; name: string; price: number; kind: 'food' | 'drink'; model: string }
export const MENUS: Record<string, MenuItem[]> = {
  cafe: [
    { id: 'espresso', name: 'Espresso', price: 3, kind: 'drink', model: 'cup' },
    { id: 'latte', name: 'Oat Latte', price: 4.5, kind: 'drink', model: 'cup' },
    { id: 'matcha', name: 'Iced Matcha', price: 5, kind: 'drink', model: 'glass' },
    { id: 'croissant', name: 'Butter Croissant', price: 3.5, kind: 'food', model: 'pastry' },
    { id: 'avotoast', name: 'Avocado Toast', price: 8, kind: 'food', model: 'plate' },
  ],
  burger: [
    { id: 'burger', name: 'Gas Fee Burger', price: 6, kind: 'food', model: 'burger' },
    { id: 'fries', name: 'Layer-2 Fries', price: 3, kind: 'food', model: 'fries' },
    { id: 'combo', name: 'Gwei Combo', price: 9, kind: 'food', model: 'burger' },
    { id: 'shake', name: 'Moon Shake', price: 4, kind: 'drink', model: 'glass' },
  ],
  grill: [
    { id: 'salad', name: 'Harvest Salad', price: 12, kind: 'food', model: 'plate' },
    { id: 'pasta', name: 'Truffle Pasta', price: 18, kind: 'food', model: 'plate' },
    { id: 'steak', name: 'Flat Iron Steak', price: 28, kind: 'food', model: 'plate' },
    { id: 'mocktail', name: 'Citrus Mocktail', price: 7, kind: 'drink', model: 'glass' },
  ],
  finedining: [
    { id: 'tasting', name: 'Seven-Block Tasting Menu', price: 180, kind: 'food', model: 'plate' },
    { id: 'wagyu', name: 'A5 Wagyu', price: 320, kind: 'food', model: 'plate' },
    { id: 'dessert', name: 'Gold Leaf Dessert', price: 45, kind: 'food', model: 'plate' },
    { id: 'cider', name: 'Sparkling Cider Bottle', price: 60, kind: 'drink', model: 'bottle' },
  ],
  club: [
    { id: 'energy', name: 'Energy Drink', price: 8, kind: 'drink', model: 'can' },
    { id: 'clubmock', name: 'Neon Mocktail', price: 12, kind: 'drink', model: 'glass' },
    { id: 'bottle', name: 'VIP Bottle Service (alcohol-free)', price: 500, kind: 'drink', model: 'bottle' },
  ],
  whaleclub: [
    { id: 'whale_tea', name: 'Rare Oolong Service', price: 90, kind: 'drink', model: 'cup' },
    { id: 'caviar', name: 'Caviar Blinis', price: 400, kind: 'food', model: 'plate' },
  ],
};
export const VIP_PRICE = 250;

// ---------- Careers & skills ----------
export const CAREERS: { id: Career; skill: SkillId; desc: string }[] = [
  { id: 'Explorer', skill: 'community', desc: 'No pressure. Explore the city and decide later.' },
  { id: 'Crypto Trader', skill: 'trading', desc: 'Read the market, trade the exchange, climb the trading board.' },
  { id: 'Professional Investor', skill: 'investing', desc: 'Stake, lend and build a long-term portfolio.' },
  { id: 'Venture Capitalist', skill: 'investing', desc: 'Back player projects and grow a fund.' },
  { id: 'Startup Founder', skill: 'founder', desc: 'Create a project, hire a team and raise funding.' },
  { id: 'Software Developer', skill: 'dev', desc: 'Ship code for startups at Genesis Hub.' },
  { id: 'Community Manager', skill: 'community', desc: 'Grow and moderate communities.' },
  { id: 'KOL & Creator', skill: 'creator', desc: 'Post, grow followers and make content.' },
  { id: 'Crypto Researcher', skill: 'research', desc: 'Analyze tokenomics at Alpha Labs.' },
  { id: 'Airdrop Hunter', skill: 'research', desc: 'Complete protocol quests for (uncertain) rewards.' },
  { id: 'NFT Creator', skill: 'creator', desc: 'Make art and memes at the Creator District.' },
  { id: 'Driver', skill: 'driving', desc: 'Drive for CityRide and build your rating.' },
  { id: 'Transport Owner', skill: 'driving', desc: 'Run a fleet of drivers.' },
  { id: 'Event Organizer', skill: 'community', desc: 'Host conferences, parties and competitions.' },
  { id: 'DAO Contributor', skill: 'community', desc: 'Propose, vote and build in DAOs.' },
];
export const SKILLS: SkillId[] = ['trading', 'dev', 'community', 'research', 'driving', 'founder', 'creator', 'investing'];
export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}
export function xpForLevel(level: number): number {
  return (level - 1) ** 2 * 50;
}

// ---------- Jobs ----------
export interface JobTemplate { title: string; company: string; kind: ChallengeKind; pay: number; minLevel: number; skill: SkillId; minSkill: number; zone: string; description: string }
export const JOB_TEMPLATES: JobTemplate[] = [
  { title: 'Barista', company: 'Block Brew Café', kind: 'barista', pay: 14, minLevel: 1, skill: 'community', minSkill: 0, zone: 'cafe', description: 'Take orders and get them right. Good first job.' },
  { title: 'Junior Developer', company: 'Genesis Hub Labs', kind: 'dev', pay: 26, minLevel: 1, skill: 'dev', minSkill: 0, zone: 'builderhub', description: 'Read code, find what it outputs, fix bugs.' },
  { title: 'Senior Smart-Contract Engineer', company: 'Genesis Hub Labs', kind: 'dev', pay: 70, minLevel: 6, skill: 'dev', minSkill: 1200, zone: 'builderhub', description: 'Harder code reviews, better pay.' },
  { title: 'Research Associate', company: 'Alpha Labs', kind: 'research', pay: 24, minLevel: 1, skill: 'research', minSkill: 0, zone: 'research', description: 'Compute valuations from tokenomics.' },
  { title: 'Lead Analyst', company: 'Alpha Labs', kind: 'research', pay: 65, minLevel: 6, skill: 'research', minSkill: 1200, zone: 'research', description: 'Senior research desk.' },
  { title: 'Market Analyst', company: 'Delta Neutral Capital', kind: 'analyst', pay: 30, minLevel: 2, skill: 'trading', minSkill: 100, zone: 'tradingfirm', description: 'Compute price moves and position P&L.' },
  { title: 'Community Moderator', company: 'CoinWire Media', kind: 'community', pay: 20, minLevel: 1, skill: 'community', minSkill: 0, zone: 'media', description: 'Spot scams and spam in community chats.' },
  { title: 'Community Lead', company: 'CoinWire Media', kind: 'community', pay: 55, minLevel: 5, skill: 'community', minSkill: 900, zone: 'media', description: 'Run moderation for big communities.' },
  { title: 'Meme Producer', company: 'Meme Factory Studios', kind: 'creator', pay: 22, minLevel: 1, skill: 'creator', minSkill: 0, zone: 'studio', description: 'Write posts that match what the market is talking about.' },
  { title: 'Head of Content', company: 'Meme Factory Studios', kind: 'creator', pay: 60, minLevel: 5, skill: 'creator', minSkill: 900, zone: 'studio', description: 'Lead content strategy.' },
];
export const SHIFT_COOLDOWN_MS = 90_000;
export const CHALLENGE_SKILL: Record<ChallengeKind, SkillId> = { dev: 'dev', research: 'research', community: 'community', creator: 'creator', analyst: 'trading', barista: 'community' };

// ---------- DeFi ----------
export const POOLS = [
  { id: 'lend_usd', name: 'City Lending — sUSD', sym: 'USD', apr: 0.06, risk: 'Low' },
  { id: 'stake_ethn', name: 'Etherion Staking', sym: 'ETHN', apr: 0.045, risk: 'Low' },
  { id: 'stake_solr', name: 'Solaris Staking', sym: 'SOLR', apr: 0.07, risk: 'Medium' },
  { id: 'stake_yld', name: 'Yieldstone Vault', sym: 'YLD', apr: 0.18, risk: 'High — protocol risk' },
  { id: 'stake_city', name: 'CITY Governance Staking', sym: 'CITY', apr: 0.1, risk: 'Medium' },
];
// APR is annualized over GAME time; one game day accrues apr/365.

// ---------- Airdrop quests ----------
export type QuestTaskKind = 'trade_volume' | 'hold' | 'visit' | 'vote' | 'research' | 'post' | 'stake';
export interface QuestDef {
  id: string; protocol: string; desc: string; durationMin: number; // real minutes
  tasks: { id: string; kind: QuestTaskKind; label: string; amount?: number; sym?: string; zone?: string; tag?: string }[];
  // reward distribution: probability of outcomes
  outcomes: { p: number; reward: number; label: string }[];
}
export const QUESTS: QuestDef[] = [
  {
    id: 'q_yieldstone', protocol: 'Yieldstone', desc: 'Early-user campaign for the Yieldstone vault.', durationMin: 20,
    tasks: [
      { id: 't1', kind: 'visit', label: 'Visit Yield Plaza', zone: 'defihub' },
      { id: 't2', kind: 'stake', label: 'Stake any amount of YLD', sym: 'YLD' },
      { id: 't3', kind: 'trade_volume', label: 'Trade $50 of volume', amount: 50 },
    ],
    outcomes: [{ p: 0.15, reward: 400, label: 'Large allocation' }, { p: 0.55, reward: 60, label: 'Small allocation' }, { p: 0.3, reward: 0, label: 'Not eligible after sybil filter' }],
  },
  {
    id: 'q_pixelverse', protocol: 'Pixelverse', desc: 'Community points season for collectors.', durationMin: 15,
    tasks: [
      { id: 't1', kind: 'visit', label: 'Visit Mint Gallery', zone: 'nftgallery' },
      { id: 't2', kind: 'post', label: 'Post about #pixelverse', tag: 'pixelverse' },
      { id: 't3', kind: 'hold', label: 'Hold at least 50 PXL at snapshot', sym: 'PXL', amount: 50 },
    ],
    outcomes: [{ p: 0.1, reward: 250, label: 'Top collector tier' }, { p: 0.6, reward: 35, label: 'Community tier' }, { p: 0.3, reward: 0, label: 'Points did not convert' }],
  },
  {
    id: 'q_citydao', protocol: 'CITY Governance', desc: 'Reward active governance participants.', durationMin: 25,
    tasks: [
      { id: 't1', kind: 'visit', label: 'Visit Governance Hall', zone: 'governance' },
      { id: 't2', kind: 'vote', label: 'Vote on any DAO proposal' },
      { id: 't3', kind: 'hold', label: 'Hold 20 CITY at snapshot', sym: 'CITY', amount: 20 },
    ],
    outcomes: [{ p: 0.25, reward: 180, label: 'Active governor' }, { p: 0.6, reward: 40, label: 'Participant' }, { p: 0.15, reward: 0, label: 'Below threshold' }],
  },
  {
    id: 'q_builder', protocol: 'Builder Network', desc: 'Testnet campaign — research the protocol and trade.', durationMin: 18,
    tasks: [
      { id: 't1', kind: 'research', label: 'Pass the protocol research quiz' },
      { id: 't2', kind: 'trade_volume', label: 'Trade $100 of volume', amount: 100 },
      { id: 't3', kind: 'visit', label: 'Visit Genesis Hub', zone: 'builderhub' },
    ],
    outcomes: [{ p: 0.2, reward: 300, label: 'Testnet OG' }, { p: 0.45, reward: 50, label: 'Tester' }, { p: 0.35, reward: 0, label: 'Campaign cancelled — no token' }],
  },
  {
    id: 'q_moondoge', protocol: 'Moon Doge "Dogedrop"', desc: 'Unverified meme campaign. High chance of nothing.', durationMin: 10,
    tasks: [
      { id: 't1', kind: 'post', label: 'Post about #moondoge', tag: 'moondoge' },
      { id: 't2', kind: 'hold', label: 'Hold 10,000 MDOG at snapshot', sym: 'MDOG', amount: 10000 },
    ],
    outcomes: [{ p: 0.05, reward: 800, label: 'Lucky whale' }, { p: 0.15, reward: 20, label: 'Dust' }, { p: 0.8, reward: 0, label: 'Rugged — nothing distributed' }],
  },
];

export const PROJECT_CATEGORIES = ['DeFi', 'Infrastructure', 'NFT', 'Gaming', 'Social', 'Meme', 'Payments', 'AI x Crypto', 'DAO Tooling'];
export const CHAINS = ['Etherion', 'Solaris', 'Builder Network', 'City Chain'];
export const NPC_HIRES = [
  { role: 'Developer', salary: 30 },
  { role: 'Designer', salary: 20 },
  { role: 'Community Manager', salary: 18 },
  { role: 'Researcher', salary: 22 },
  { role: 'Marketer', salary: 20 },
  { role: 'KOL', salary: 35 },
];
export const PROJECT_FEE = 50;
export const DAO_FEE = 25;
export const DRIVER_FEE = 0; // registration is free; needs a vehicle
export const FLEET_FEE = 5000;

export const ACHIEVEMENTS: Record<string, string> = {
  first_trade: 'First Trade',
  first_profit: 'In the Green',
  first_job: 'Employed',
  ten_shifts: 'Reliable Worker',
  first_car: 'Got Wheels',
  moved_up: 'Moving Up',
  homeowner: 'Homeowner',
  first_project: 'Founder',
  project_launch: 'Mainnet!',
  raised: 'Raised a Round',
  first_hire: 'First Hire',
  first_ride: 'CityRider',
  driver_10: 'Road Warrior',
  airdrop_win: 'Airdrop Hunter',
  dao_founder: 'DAO Founder',
  voter: 'Governor',
  event_attendee: 'Networker',
  event_host: 'Host',
  competition_win: 'Competition Podium',
  first_post: 'Hello World',
  influencer: '100 Likes',
  dancer: 'Dance Floor Regular',
  foodie: 'Foodie',
  staker: 'Staker',
  friend: 'Made a Friend',
  whale: 'Whale Club Member',
};
