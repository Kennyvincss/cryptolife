// Types shared by client and server. The server is authoritative for everything
// in MeSnapshot; the client only renders it and sends action requests.

export type Vec3 = [number, number, number];

export type Slot = 'top' | 'bottom' | 'shoes' | 'hat' | 'glasses' | 'watch' | 'chain' | 'bag';

export interface Look {
  body: 'm' | 'f';
  /** Which person (index into PEOPLE[body]). */
  model?: number;
  skin: string;
  hairStyle: number;
  hairColor: string;
  eyeColor: string;
  height: number; // 0.9 .. 1.1 multiplier
  build: number; // 0.85 .. 1.2
  outfit: Partial<Record<Slot, string>>; // clothing item ids
  colors: Partial<Record<Slot, string>>;
}

export type SkillId = 'trading' | 'dev' | 'community' | 'research' | 'driving' | 'founder' | 'creator' | 'investing';

export type Career =
  | 'Explorer'
  | 'Crypto Trader'
  | 'Professional Investor'
  | 'Venture Capitalist'
  | 'Startup Founder'
  | 'Software Developer'
  | 'Community Manager'
  | 'KOL & Creator'
  | 'Crypto Researcher'
  | 'Airdrop Hunter'
  | 'NFT Creator'
  | 'Driver'
  | 'Transport Owner'
  | 'Event Organizer'
  | 'DAO Contributor';

export interface Privacy {
  showBalance: boolean;
  showPortfolio: boolean;
  showVehicles: boolean;
  showHome: boolean;
  allowDMs: 'everyone' | 'friends';
}

export interface TxRecord {
  id: string;
  ts: number;
  kind: string; // 'transfer_in' | 'transfer_out' | 'purchase' | 'salary' | 'trade' | 'fee' | ...
  amount: number; // signed, in simulated USD
  memo: string;
  counterparty?: string;
  status: 'completed' | 'pending' | 'failed';
}

export type OrderType = 'market' | 'limit' | 'stop' | 'take_profit';
export interface Order {
  id: string;
  sym: string;
  side: 'buy' | 'sell';
  type: OrderType;
  qty: number;
  price?: number; // trigger/limit price
  reserved: number; // cash or qty reserved
  ts: number;
}
export interface Fill {
  id: string;
  sym: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  fee: number;
  pnl?: number; // realized pnl on sells
  ts: number;
  orderType: OrderType;
}

export interface OwnedVehicle {
  uid: string;
  model: string;
  color: string;
  rims: string;
  engine: number; // upgrade level 0..3
  handling: number;
  damage: number; // 0..100
  purchasePrice: number;
}

export interface Placement {
  slot: number;
  item: string;
}

export interface OwnedProperty {
  id: string; // property catalog id
  mode: 'own' | 'rent' | 'starter';
  since: number;
  placements: Placement[];
}

export interface JobState {
  listingId: string;
  title: string;
  company: string;
  kind: ChallengeKind;
  pay: number;
  zone: string;
  since: number;
  shifts: number;
  lastShift: number;
  projectId?: string;
}

export type ChallengeKind = 'dev' | 'research' | 'community' | 'creator' | 'analyst' | 'barista';

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  prompt: string;
  code?: string;
  options: string[];
  multi: boolean;
}

export interface Stake {
  id: string;
  pool: string;
  sym: string; // asset staked ('USD' for lending)
  amount: number;
  apr: number;
  since: number;
  accrued: number;
}

export interface AirdropProgress {
  questId: string;
  accepted: number;
  done: Record<string, boolean>;
  baseline: Record<string, number>;
  status: 'active' | 'eligible' | 'paid' | 'nothing' | 'expired';
  reward?: number;
}

export interface RideState {
  id: string;
  role: 'rider' | 'driver';
  status: 'searching' | 'assigned' | 'arrived' | 'onboard' | 'completed' | 'cancelled';
  category: RideCategory;
  pickup: Vec3;
  pickupName: string;
  dest: Vec3;
  destName: string;
  fare: number;
  driverName: string;
  driverIsNpc: boolean;
  driverRating: number;
  vehicleModel: string;
  vehicleColor: string;
  riderName: string;
  riderIsNpc: boolean;
  etaSec: number;
  created: number;
  rated?: boolean;
  riderId?: string;
  driverId?: string;
  pickedAt?: number;
  damage?: number;
}
export type RideCategory = 'economy' | 'premium' | 'luxury' | 'player';

export interface JourneyEntry {
  ts: number;
  kind: string;
  text: string;
}

export interface MeSnapshot {
  id: string;
  username: string;
  look: Look;
  career: Career;
  level: number;
  xp: number;
  skills: Record<SkillId, number>; // xp per skill
  reputation: number;
  repBreakdown: Record<string, number>;
  followers: number;
  following: string[];
  friends: string[];
  friendRequests: string[];
  blocked: string[];
  cash: number;
  holdings: Record<string, number>;
  costBasis: Record<string, number>;
  orders: Order[];
  fills: Fill[];
  watchlist: string[];
  txs: TxRecord[];
  paymentRequests: { id: string; from: string; amount: number; memo: string; ts: number }[];
  properties: OwnedProperty[];
  homeId: string;
  furniture: Record<string, number>; // item id -> count owned
  vehicles: OwnedVehicle[];
  activeVehicle?: string;
  wardrobe: string[];
  outfits: { name: string; outfit: Look['outfit']; colors: Look['colors'] }[];
  job?: JobState;
  applications: { listingId: string; status: 'pending' | 'offered' | 'rejected'; ts: number }[];
  driver: { registered: boolean; onDuty: boolean; rides: number; ratingSum: number; ratingCount: number; earnings: number };
  fleet?: { name: string; drivers: { name: string; vehicle: string; hired: number }[]; earnings: number };
  ride?: RideState;
  stakes: Stake[];
  airdrops: AirdropProgress[];
  projects: string[];
  daos: string[];
  events: string[];
  privacy: Privacy;
  buffs: { rested: number; fed: number }; // expiry timestamps (ms)
  achievements: string[];
  journey: JourneyEntry[];
  netWorth: number;
  created: number;
  realWallet: { connected: false; note: string };
}

export interface PublicProfile {
  id: string;
  username: string;
  career: Career;
  level: number;
  reputation: number;
  followers: number;
  following: number;
  achievements: string[];
  skills: Record<SkillId, number>;
  projects: { id: string; name: string }[];
  balance?: number;
  netWorth?: number;
  vehicles?: string[];
  home?: string;
  driverRating?: number;
  look: Look;
  online: boolean;
  isFriend: boolean;
  followsYou: boolean;
  youFollow: boolean;
}

export interface PresenceEntry {
  id: string;
  name: string;
  p: Vec3;
  r: number;
  a: string; // animation
  z: string; // zone
  look: Look;
  veh?: { model: string; color: string; rims: string };
  mu?: { track: number; t0: number } | null; // speaker music shared in a zone
}

export interface NewsItem {
  id: string;
  ts: number;
  title: string;
  body: string;
  tags: string[];
  kind: 'market' | 'project' | 'airdrop' | 'city' | 'event' | 'player';
  simulated: true;
}

export interface Post {
  id: string;
  author: string;
  authorId: string;
  text: string;
  tags: string[];
  ts: number;
  likes: string[];
  comments: { author: string; text: string; ts: number }[];
}

export interface ChatMessage {
  id: string;
  ch: string; // 'dm:<a>:<b>' | 'group:<id>' | 'nearby' | 'zone:<zone>' | 'project:<id>'
  from: string;
  fromId: string;
  text: string;
  ts: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  narrative: string;
  category: string;
  chain: string;
  founderId: string;
  founder: string;
  members: { id: string; name: string; role: string; npc: boolean; salary: number }[];
  treasury: number;
  users: number;
  community: number;
  progress: number;
  reputation: number;
  budget: { dev: number; marketing: number; community: number };
  milestones: string[];
  status: 'active' | 'struggling' | 'failed' | 'launched';
  equitySold: number;
  token?: string;
  ledger: { ts: number; text: string; amount: number }[];
  created: number;
  cycles: number;
}

export interface DaoRecord {
  id: string;
  name: string;
  purpose: string;
  members: string[];
  treasury: number;
  proposals: {
    id: string;
    title: string;
    body: string;
    amount: number;
    recipient: string;
    by: string;
    yes: string[];
    no: string[];
    ends: number;
    status: 'open' | 'passed' | 'rejected' | 'executed';
  }[];
  history: { ts: number; text: string }[];
}

export interface CityEvent {
  id: string;
  name: string;
  kind: 'conference' | 'hackathon' | 'trading_competition' | 'token_launch' | 'vc_summit' | 'meme_convention' | 'dao_assembly' | 'party' | 'meetup';
  description: string;
  venue: string; // zone id
  start: number;
  end: number;
  capacity: number;
  fee: number;
  prize: number;
  rules: string;
  organizer: string;
  organizerId: string | null; // null = city
  registered: string[];
  attended: string[];
  baseline: Record<string, number>; // for trading competitions
  results?: { name: string; score: number; prize: number }[];
  status: 'scheduled' | 'live' | 'ended';
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  kind: ChallengeKind;
  pay: number;
  minLevel: number;
  skill: SkillId;
  minSkill: number;
  zone: string;
  description: string;
  projectId?: string;
  postedBy?: string;
  open: boolean;
}

export interface MarketToken {
  sym: string;
  name: string;
  price: number;
  open24: number;
  vol: number;
  sector: string;
  launchedBy?: string;
}
