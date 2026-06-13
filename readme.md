# 🚂 Rail Frontier

A playable, original browser-based **railroad-tycoon strategy game** inspired by
*Railroad Tycoon 3*. Found a railroad company in a chosen era, build a network
across a large procedurally generated map connecting towns, mines, farms,
factories and ports, run freight and passengers through multi-stage cargo
chains, ride the boom/bust economy, manage bonds and company value, and out-grow
rival railroads that expand and claim territory as the decades pass.

Built with **TypeScript + Vite + Canvas 2D**, no backend, no runtime dependencies.
Tested with **Vitest**.

## Run it

```bash
npm install
npm run dev      # dev server — open the printed URL (http://localhost:5173)
```

Other commands:

```bash
npm test         # run the automated test suite (Vitest)
npm run build    # type-check (tsc) + production build into dist/
npm run preview  # serve the production build
```

## How to play

A help overlay opens on first launch (press `H` to reopen it).

1. **Pick an era and find profitable routes.** New Game lets you start in the
   Pioneer Age (1830), Steam Boom (1880) or Diesel Era (1950). Inspect towns and
   industries (Info tab) to see what each produces and demands.
2. **Build stations** (tool `3`). Choose a tier — **Depot** (radius 2),
   **Station** (radius 3) or **Terminal** (radius 4); bigger tiers reach further
   and stockpile more cargo. Tool `7` upgrades an existing station in place.
3. **Lay track** (tool `2`), click-dragging to paint. Terrain sets the cost;
   track over water builds a bridge. Trains run **diagonally** automatically and
   route over the shortest path.
4. **Buy a locomotive** (tool `4`). Only **era-appropriate** engines are for
   sale, and faster, stronger ones unlock as the years advance (you're notified
   when one arrives). Each engine has its own cost, capacity, speed, running
   cost and **reliability** — unreliable engines break down and need repairs.
5. **Move freight and passengers.** Revenue scales with quantity, haul distance
   and the **current economy**. Well-served towns grow; bigger towns generate
   more traffic.
6. **Run the company.** Issue **bonds** against a value-scaled credit line
   (Finance tab), watch the boom/bust **economy** swing revenue, and track the
   **Rivals** tab — competitors expand their own networks and claim territory
   (dashed lines on the map). Connect a contested town before they take its
   traffic, and out-value them in the rankings.

### Cargo & supply chains

Towns generate **passengers** and **mail** and demand passengers, mail, goods,
food and lumber. Industries form multi-stage chains:

- **coal** (mine) + **iron** (mine) → **steel** (steel mill) → **goods**
  (factory) → towns
- **logs** (lumber camp) → **lumber** (sawmill) → factories & towns
- **grain** (farm) or **livestock** (ranch) → **food** (food mill) → towns
- **oil** (well) and **coal** → **power plants** (pure consumers, pay well)
- **ports** (coastal) import goods, mail and passengers, and accept raw
  materials for export

Processors hold an input **stockpile** and convert it to output over time, so a
steel mill only ships steel once you keep feeding it coal *and* iron.

**Controls:** pan with right/middle-drag, WASD or arrows · zoom with the wheel ·
click the **minimap** to jump · tools on keys `1–7` · `Space` pauses · `F`
follows the selected train · `Esc` cancels · `H` toggles help. Speed: 1×/2×/4×.

**Side-panel tabs:** *Info* (contextual inspector), *Fleet* (train list with
status/earnings — click to follow, or sell), *Cargo* (traffic report, cargo
catalogue, supply-chain guide, industry census), *Finance* (cash, value,
economy, 12-month chart, bonds) and *Rivals* (company rankings).

**Save/Load:** the 💾/📂 buttons persist the full game state to localStorage, and
the game **autosaves every two minutes** (startup resumes from the newest save).

## What is implemented

- **Large procedural map** — 260×200 tiles of value-noise terrain (plains,
  forest, hills, water), ≥24 named towns and ~50 industries across **12 kinds**,
  deterministic seeds, guaranteed early opportunities.
- **Data-driven economy** — a cargo catalogue and industry-recipe catalogue
  drive production, multi-stage processing with industry stockpiles,
  town demand and service-driven growth, and a live boom/bust **economy
  multiplier** on revenue.
- **Construction** — terrain-priced track, bridges over water, three station
  tiers with in-place upgrades, bulldozing, live placement/cost feedback.
- **Trains & routing** — an **era-gated locomotive roster** (1830→1968) with
  cost/capacity/speed/running-cost/**reliability** and obsolescence, 8-direction
  shortest-path routing with true diagonal distances, multi-stop loops,
  **breakdowns** and repairs, route reassignment, selling, lifetime earnings.
- **Finance** — bonds against a value-scaled credit line with monthly interest,
  company valuation, monthly income/expense ledger with 12-month history.
- **Competition** — rival railroads that grow, expand their networks and claim
  town-pair **territory** (shown on the map and minimap), suppressing a
  contested town's traffic until you connect it; live **company rankings**.
- **Events & eras** — monthly economic booms/recessions, boom-towns and fires,
  and locomotive-availability announcements as the calendar advances.
- **Graphics** — varied terrain with animated water/shorelines, tree clusters
  and hills, twin-rail track with sleepers and timber bridges, population-scaled
  towns, distinct sprites for all twelve industries with activity lamps, tiered
  station buildings, cargo-coloured multi-wagon trains with smoke, follow
  camera, and a minimap with industries, rival lines and a viewport rectangle.
- **Reports** — tabbed dashboards for fleet, cargo/traffic, finance and rivals.
- **Persistence** — versioned JSON serialization with manual + autosave slots
  and corrupt-save handling.

## Architecture

```
index.html              page shell (toolbar, HUD, panel tabs, help overlay)
src/
  main.ts               bootstrap, game loop, action wiring, autosave
  game/                 pure simulation — no DOM access
    types.ts            all state interfaces (plain JSON-serializable data)
    cargo.ts            data-driven cargo catalogue
    industries.ts       industry definitions + production recipes
    config.ts           tuning, station tiers, periods, locomotive roster
    rng.ts              seeded PRNG (mulberry32)
    MapGenerator.ts     terrain noise, town/industry placement
    GameState.ts        state creation, build/upgrade actions, bonds, finances
    Pathfinding.ts      8-directional Dijkstra over track + station tiles
    Trains.ts           purchase (era-gated), movement, breakdowns, arrivals
    Economy.ts          production, processing chains, growth, revenue, costs
    Events.ts           economic cycle + monthly one-off events
    Rivals.ts           competing railroads, territory claims, rankings
    Simulation.ts       per-tick orchestration (time, economy, events, rivals)
  ui/
    Renderer.ts         Canvas 2D rendering, camera, minimap, particles
    InputController.ts  mouse/keyboard, tools, minimap navigation
    HUD.ts              DOM panels, tabs, reports, toolbar, message log
    uiState.ts          UI-only state (tool, tier, selection, tabs, drafts)
  persistence/
    SaveLoad.ts         serialize/deserialize + manual & autosave slots
tests/                  pathfinding, economy, gameplay, mapgen, saveload (Vitest)
```

The simulation (`src/game/`) never touches the DOM, so the whole game logic is
unit-testable headlessly; the UI layer reads state and calls action functions.

## Known limitations

- Rival networks are abstract (territory + value), not per-tile track on the map.
- No signals/collisions — trains pass through each other.
- Bulldozing refunds nothing; a station must be off all routes before demolition.
- Saves from previous versions are not migrated (the format is versioned).

## Suggested next improvements

1. On-map rival track and trains competing for the same cargo.
2. Scenario goals and victory conditions per era.
3. Station ratings that throttle demand when service is poor.
4. Stock market: buy/sell shares in your company and rivals.
5. Sound effects and a periodic newspaper of company milestones.
