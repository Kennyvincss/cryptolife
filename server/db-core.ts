import type {
  CityEvent, ChatMessage, DaoRecord, JobListing, MeSnapshot, NewsItem, Post, ProjectRecord,
} from '../shared/types.js';

export interface UserRec extends Omit<MeSnapshot, 'followers' | 'netWorth' | 'level' | 'reputation' | 'repBreakdown' | 'realWallet'> {
  passHash: string;
  salt: string;
  sessions: string[];
  followerIds: string[];
  repEvents: { ts: number; src: string; pts: number }[];
  lastActive: number;
  lastPos: [number, number, number];
  lastZone: string;
  reports: number;
  postTimes: number[];
  likesReceived: number;
  likers: string[];
  airdropWins: number;
  dancedSecs: number;
  rep: Record<string, number>;
  vipUntil: number;
  homeInvites: { id: string; until: number }[];
  fleetLast: number;
  orderCount: number;
}

export interface DB {
  version: number;
  users: Record<string, UserRec>;
  usernames: Record<string, string>; // normalized -> id
  posts: Post[];
  chats: ChatMessage[];
  groups: Record<string, { id: string; name: string; members: string[]; owner: string }>;
  projects: Record<string, ProjectRecord>;
  daos: Record<string, DaoRecord>;
  events: Record<string, CityEvent>;
  jobs: Record<string, JobListing>;
  news: NewsItem[];
  reports: { ts: number; by: string; target: string; reason: string }[];
  market: { prices: Record<string, number>; open24: Record<string, number>; extraTokens: { sym: string; name: string; price: number; vol: number; sector: string; supply: number; launchedBy: string }[] };
  worldStart: number;
  timeOffset: number;
  season: { n: number; started: number };
}

export function emptyDb(): DB {
  return {
    version: 1,
    users: {},
    usernames: {},
    posts: [],
    chats: [],
    groups: {},
    projects: {},
    daos: {},
    events: {},
    jobs: {},
    news: [],
    reports: [],
    market: { prices: {}, open24: {}, extraTokens: [] },
    worldStart: Date.now(),
    timeOffset: 0,
    season: { n: 1, started: Date.now() },
  };
}

