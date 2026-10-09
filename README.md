# Crypto City

**An open-world crypto life simulator prototype.** A third-person 3D city you can walk, drive and live in, running on a persistent multiplayer server. The server is authoritative for every balance, trade, reward and ownership change.

> **Everything with money is simulated.** Cash, tokens, prices, news, salaries, fares, airdrops and prizes are in-game currency. They are not real crypto and can't be withdrawn. The wallet is labelled `SIM` everywhere, and the real-asset wallet shows as **not connected**.

---

## Quick start

```bash
npm install
npm run dev          # server on :8787 + Vite client on :5173 (open http://localhost:5173)
```

Production-style single process:

```bash
npm run build
npm start            # serves the built client and the game server on http://localhost:8787
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Server economy tests (trading, payments, zone gating, jobs, projects, DAOs, rides, reputation caps, vehicles) |
| `npm run typecheck` | TypeScript check for client, server and shared code |

Environment variables: `PORT` (default `8787`) and `CC_DATA_DIR` (where `db.json` is saved; default `server/data/`).

Create an account on the sign-in screen, design your character, pick a career focus (you can change it later), and you wake up in your starter apartment with **$100 in simulated funds**.

### Controls

| Key | Action |
|---|---|
| WASD / arrows | Move · Shift run · Space jump |
| Mouse | Look (click the world to lock the pointer, Esc to release) · wheel to zoom |
| **E / R** | Context interactions, shown bottom-right (Enter, Sit, Order, Sleep, Trade, Work…) |
| **F** | Enter or exit vehicles, board your CityRide |
| **G** | Open the profile of a nearby player |
| **P** | Phone · **M** map (click to set a GPS waypoint) · **T** chat (Tab switches between nearby and venue chat) · **H** help |
| 1–4 | Emotes: wave, dance, phone, talk · **C** resets the camera |
| In a car | W/S throttle, brake and reverse · A/D steer · Space handbrake · L headlights |

---

## What's in the playable build

### World and graphics (three.js, all assets procedural and original)
- **Crypto City** is a 5×4 block grid with 8 districts: Trading, Builder, DeFi, Social & Entertainment, Creator, Residential, Automotive, Convention, plus Hash Park.
- **28 enterable venues**, each with its own interior and real activities, plus 3 home layouts (small, medium and large).
- Textured roads with lane markings and crosswalks, raised sidewalks and curbs, generated building facades with lit windows at night, rooftop details, street lamps (the nearest ones cast real light at night), trees, benches, hydrants, working traffic signals and parked cars. Billboards carry original ads, one shows the live *simulated* price ticker, and a distant skyline and hills sit at the edge of the map.
- A day/night cycle (24 real minutes = 1 game day) drives a physically-based sky, sun and moon light, shadows, reflections from the sky environment map, fog, stars, and bloom on neon at night. Weather (clear, cloudy, rain) is derived from the shared clock, so every client sees the same sky.
- Characters are built procedurally with joints and animated procedurally: idle, walk, run, sit, sleep, dance (4 moves), drive, ride, phone, eat, talk, wave, workout and type. They have clothing layers, hairstyles, hats, glasses, watches, chains and bags. NPCs and remote players are merged into one mesh per joint to keep draw calls low.
- Vehicles are 9 original models in 8 body styles, including a motorcycle. They have extruded body profiles, clearcoat paint, glass cabins, spoked rims, working head and brake lights, arcade physics, collisions, damage, and engine audio (electric cars whine).
- NPC traffic follows right-hand lanes, turns at intersections, stops at red lights, follows the car ahead, brakes and honks for the player. Pedestrians walk the sidewalks and step aside. NPCs are always tagged **NPC**. Real players are tagged **PLAYER**.

### Everyday life
- **Homes.** Every resident gets a free starter apartment. You can rent or buy a studio, standard, luxury, penthouse or mansion at Keystone Realty. Bigger homes have more rooms and furniture spots.
- **Home interactions.** Sleep, lie down, sit on sofas, chairs and stools, change outfits at the wardrobe, edit your appearance at the mirror, use the computer (a desktop with all apps), grab a snack, cook, make coffee, shower or bath, read (research XP), watch CityNews on the TV, and play music on speakers. Visitors in the room hear speaker music.
- **Furniture.** 22 items at Nest & Node. Purchases go to storage, and you place them into spots with the Decorate toolbox. Placed items are interactive: trading rig, console and arcade (a playable Block Breaker), gym, home bar, pool table, aquarium, smart lights, lamp, trophy shelf showing your real achievements, and more.
- **Sleep** gives a "well rested" +10% XP bonus. The world clock is shared, so it only fast-forwards to morning when you're the only player online. Otherwise you rest while the city keeps running.
- **Restaurants.** Block Brew Café, Gas Fee Burgers, Genesis Grill and The Ledger (fine dining) have staff NPCs, seats and menus. Ordering puts the item in your hand, and you eat it when seated. Food is optional and only gives a temporary +10% XP bonus.
- **Nightlife.** Liquidity Nightclub has an animated dance floor, light beams, a DJ and dancing NPCs, a bar, and a VIP area gated by the server (reserve a table, or join a friend who has one). The Whale Club lounge requires a $50k net worth.
- **Fashion.** HODL Threads sells 35 items across 8 slots, with try-on preview on your character, colours and saved outfits.
- **Music.** The phone player has 18 **original, procedurally-composed tracks** in 9 genres, plus playlists, radio stations, volume, and play, pause and skip. Output can go to headphones, home speakers (positional, shared with others in the room) or car audio. Venues play stations synced to the clock, so everyone in a venue hears the same song.

### Vehicles and transport
- **Dealerships.** Moonshot Motors (new) and Second Block Used Cars. You can buy in any colour, take a 90-second test drive, and sell back for about 60% of list price, less damage.
- **Gwei Customs** sells paint, 5 rim styles, engine and handling upgrades (they change the physics) and damage repair.
- **Garage.** Set your active vehicle and have it parked at the nearest curb.
- **CityRide ride-hailing.** Choose a destination and an Economy, Premium, Luxury or Player-driver category, and you get a server quote. An NPC car physically drives to your curb. Press F to board, and it drives you along the road network. The fare is charged only when the server confirms you're at the destination. You can cancel (with a late-cancel fee) and rate the ride.
- **Driver career.** Register at CityRide HQ, go on duty in your car, and accept NPC or real-player requests. Pick passengers up at the yellow marker and drop them off to earn 85% of the fare. Your rating depends on damage and speed. After 5 rides you can found a **transport company** and hire NPC drivers for your spare cars.

### Crypto career (all simulated)
- **Exchange.** A simulated market of 9 original tokens (plus tokens launched by players). Prices follow a random-walk model with mean reversion and react to a world-event engine (rallies, crashes, upgrades, exploits, whale accumulation, chain launches, viral memes, VC waves, FUD and NFT seasons). It supports market, limit, stop-loss and take-profit orders (protective orders are one-cancels-other), slippage, a 0.1% fee, positions, unrealized and realized P&L, watchlists and candlestick charts. You can trade on the phone, at exchange desks and terminals, or at home. Trading XP gets a bonus at the exchange and with the trading rig.
- **Jobs.** 10 NPC employers, plus jobs posted by player startups. You apply, get a hiring decision, then accept or decline. **Shifts are real tasks the server checks:** code tracing and bug spotting, tokenomics valuation, scam moderation, trend-matched content, P&L calculation, and making change at the café. Correct work pays in full and wrong answers pay 30%. Shifts have a cooldown, and world events boost pay for some roles.
- **Projects and startups.** Register a project at Genesis Hub with a name, narrative, category, chain and seed. You can then manage the treasury, set budgets, hire NPC staff, post paid jobs for real players (their correct shifts add progress), and pitch VCs at Seed Round Tower (the odds depend on traction and market sentiment). Projects hit MVP, Testnet and Mainnet milestones and can launch a tradable token. Narratives that match trending topics grow faster. Underfunded projects struggle and then **fail**.
- **Airdrop Center.** 5 simulated protocol campaigns with real requirements: visits, staking, trade volume, holding at the snapshot, governance votes, posts and research quizzes. Outcomes vary, and some campaigns pay **nothing** (sybil filters, cancellations, rugs).
- **Yield Plaza (DeFi).** Lending and staking pools with different APR and risk. The Yieldstone Vault takes a principal haircut when an exploit event happens.
- **DAOs.** Create one at the Governance Hall, then join, deposit, propose grants and vote. Passed proposals pay out from the treasury. Governance runs in the database in this prototype.
- **Events.** City events rotate (summit, trading cup, hackathon, VC summit, MemeCon, club nights, DAO assembly), and players can host their own with venue, time, capacity, entry fee and an escrowed prize pool. Attendance is detected by presence at the venue. Trading competitions score realized P&L during the window, and hackathons score correct code challenges. The Convention Center has a main stage screen with a speaker NPC, seats, live audience reactions, a networking area, and **startup showcase booths that display real player projects**.
- **Leaderboards.** 10 categories, not just wealth. Trading score is P&L × consistency. KOL and social scores only count followers and likers at level 2+, so alt accounts don't inflate them. Wealth respects privacy settings.
- **Reputation.** Built from work, events, projects, trading consistency, community, driving and governance, and **capped per source per hour** so repeated low-value actions can't farm it.
- **Season summary.** A story generated *only* from your recorded journey log (first trade, jobs, friends made at events, launches, hires and so on) plus your stats.

### Social
- Unique usernames with look-alike protection (`0/o`, `1/l/i`, `5/s` and similar are treated as the same) and reserved names.
- **Payments by username.** The server resolves the name, shows the recipient's identity before you confirm, and enforces per-transfer and daily limits. You can also request money.
- Follow, friends (the server records where you met, which feeds the story), DMs, group chats, project team chats, DAO chats, nearby chat (30 m) and venue/event chat. Posts with #tags, likes, comments, trending topics and search. NPC citizens post about the news, so the feed isn't empty.
- Privacy controls for balance, net worth, vehicles and home, plus a friends-only DM option. Blocking hides content and stops payments. Reporting counts distinct reporters. Rate limits and a profanity filter are in place.
- Home invitations. Friends see each other on the minimap.

### UI
- Clean HUD: identity, level, reputation and buffs top-left; cash (`SIM`), portfolio, clock and notifications top-right; a rotating minimap with route line and district name bottom-left; contextual prompts and speedometer bottom-right.
- **Phone** with 18 working apps: Wallet, Market, Music, Messages, Social, CityRide, Map, Jobs, Projects, Events, News, Profile, Airdrops, DAOs, Leaders, Drive, Garage and Settings.
- Full-screen city map with click-to-waypoint, a road-following GPS route and a 3D beacon.

---

## Architecture

```
shared/          Types, catalogs (items, vehicles, properties, quests…), deterministic city layout
server/
  index.ts       Express (auth endpoints, static hosting) + WebSocket gateway
  game.ts        Authoritative state: accounts, ledger, XP, reputation, snapshots, rate limits, zones
  market.ts      Simulated market engine + world-event engine (news, modifiers)
  world.ts       World loop: orders, staking, quests, rides, projects, fleets, events, DAOs, rent, NPC posts, presence
  actions/       life · finance · work · social · transport  (every player intent is an action)
  challenges.ts  Server-generated work tasks (answers never leave the server)
  quests.ts      Airdrop progress hooks and snapshots
  tests/         node:test economy tests
src/
  engine/        Renderer + post-processing, sky/weather, input, procedural textures, geometry batching
  world/         City generator, colliders, interiors kit + venues, furniture library, in-world screens
  entities/      Humanoid (model + animation), vehicles (models + physics)
  systems/       Player controller & camera, interactions, traffic & pedestrians, remote players
  audio/         Web Audio engine (ambience, engine, sfx) and procedural music composer and player
  ui/            HUD, phone, apps, location panels, map, login & character creator, styles
  net/client.ts  WebSocket client (`act()` requests, presence, live pushes)
```

- **Server-authoritative economy.** The client sends intents such as `market.order`, `vehicle.buy` or `jobs.submit`. The server validates funds, ownership, location, cooldowns and rate limits, then pushes the new player snapshot back. The client never decides balances, rewards or outcomes.
- **Location gating.** Buying clothes needs you at the boutique, pitching needs you at the VC tower, and so on. Entering a building checks that the player's last reported position is near that door.
- **Persistence.** The whole world (accounts, ledgers, projects, DAOs, events, posts, market state) is saved as JSON every 15 seconds and on shutdown. Passwords are hashed with scrypt, and sessions use random tokens.
- **Performance.** Static city geometry is merged by material, and characters and vehicles are merged per joint or part. A fixed pool of 6 point lights is reused by street lamps and interiors, so shaders never recompile. Distant NPCs are culled. There are three quality levels (Settings).

---

## Honest limitations (what is *not* done yet)

| Area | Current state | Path forward |
|---|---|---|
| Real wallet / deposits / withdrawals | **Not implemented.** The wallet is simulated and labelled as such, and the Deposit/Withdraw buttons say so. | Integrate a reputable embedded-wallet provider server-side behind the existing `wallet.*` actions. Keep keys in the provider and never in the client. Add limits, recovery and fraud review. |
| Real trading / DEX | **Not implemented.** Only the simulated market exists. | Add a separate "real market" module that uses an authorized trading API. It must never be mixed with simulated balances. |
| Licensed music | Not integrated. All 18 tracks are original and generated in code (royalty-free). | `MusicSource` in `src/audio/music.ts` is the seam for a licensed catalog SDK. Shared playback in venues must follow that service's licensing rules. |
| AAA graphics | Everything is procedural (no imported art). It's lit with PBR, shadows, reflections and bloom, but stylised compared with a AAA title. | Swap in glTF characters (skinned meshes and mocap), cars and props. The builders are isolated per entity type to make that straightforward. |
| Anti-cheat | Economic outcomes are server-side, **but zone proximity trusts the position the client reports**. | Server-side movement validation (speed checks, interpolation) and authoritative physics for vehicles. |
| Multiplayer scale | One Node process holds the world in memory. It works for a handful to dozens of players. Presence is broadcast at 10 Hz. | Shard by district or instance, move persistence to a database (Postgres/Redis), and add interest management. |
| Vehicle damage | Shown as a condition percentage, which affects resale value and ride ratings. There's no visual deformation. | Damage decals and deformable panels. |
| Player passengers | A rider follows the player driver's car via presence; there's no shared physics. | Server-side vehicle simulation. |
| Mobile | Desktop keyboard and mouse only. | Touch controls. |

---

## Testing

```bash
npm test
```

There are 12 server tests covering registration and look-alike names, market and limit order accounting, username payments and blocking, location gating, building entry rules, verified job shifts, project failure, DAO membership voting, ride fare settlement, reputation caps, and vehicle purchase and customisation.
