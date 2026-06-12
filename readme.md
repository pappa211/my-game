# 🚂 Rail Frontier

A playable, original browser-based transport-management strategy game inspired by
classic rail tycoon mechanics. You run a young railway company on a procedurally
generated map: build track and stations, bridge rivers, buy trains, assign
routes, haul passengers and freight through multi-step cargo chains, grow the
towns you serve — and manage your bank loan while you do it.

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

1. **Find an opportunity** — the map always contains two towns close together,
   a coal mine within reach of a power plant, and a lumber camp near a sawmill.
2. **Build stations** (tool `3`, $500 each) near towns/industries. A station
   serves everything within 3 tiles (the radius is previewed while placing).
3. **Lay track** (tool `2`) connecting your stations. Click-drag to paint; a
   live cost readout follows the cursor. Plains cost $30/tile, forest $60,
   hills $120 — and track over water builds a **bridge** for $220/tile.
   Trains run **diagonally** between adjacent track tiles automatically.
4. **Buy a train** (tool `4`): pick one of four types, click your stations in
   order, press *Buy & Start*. If the stations aren't connected by track, the
   purchase is rejected with a clear message.
5. The train loops over its stops, loading cargo and earning revenue on every
   delivery (revenue scales with quantity and distance). Trains cost money per
   day to run; watch the net income in the top bar and the monthly chart in
   the **Finance** tab.
6. Short on cash? **Borrow from the bank** (Finance tab) in $5,000 steps up to
   $30,000 — interest is charged monthly until you repay.

**Cargo chains:**

- Towns generate **passengers** (scaled by population). Delivering passengers
  to another town earns money *and makes the destination town grow* — bigger
  towns generate more passengers.
- Coal mines produce **coal** → deliver to a power plant.
- Lumber camps produce **wood** → deliver to a sawmill, which converts it into
  **goods** waiting at the same station → haul the goods to any town.

**Controls:** pan with right/middle-drag, WASD or arrow keys · zoom with the
mouse wheel · click the **minimap** (bottom-left) to jump anywhere · tools on
keys `1–6` · `Space` pauses · `F` follows the selected train · `Esc`
cancels/deselects · `H` toggles help. Game speed: 1×/2×/4× buttons.

**Side panel tabs:** *Info* (contextual inspector), *Trains* (fleet list with
status and lifetime earnings — click to select & follow; trains can be sold
for 50% of their price from the Info panel), *Finance* (cash, company value,
12-month income/cost bar chart, bank loans).

**Save/Load:** the 💾/📂 buttons persist the full game state to browser
localStorage, and the game **autosaves every two minutes** to a separate slot
(startup resumes from whichever is newest). *New Game* prompts for a seed —
the same seed always generates the same world.

## What is implemented

- **Procedural map** — 164×140 tiles, value-noise terrain (plains, forest,
  hills, water), ≥15 named towns, four industry kinds (coal mines, power
  plants, lumber camps, sawmills), deterministic seeds, guaranteed starting
  opportunities.
- **Construction** — track with terrain-dependent cost, bridges over water,
  stations with catchment radius, bulldozing (stations on active routes are
  protected), live valid/invalid placement feedback with cost preview, funds
  checking.
- **Trains & routing** — four train types (cost/capacity/speed/running cost),
  multi-stop looping routes, **8-directional shortest-path routing (Dijkstra)
  over the track graph** with true diagonal distances, distance-correct
  movement, stranded-train detection with retry, route reassignment, selling.
- **Economy** — passenger demand from town population, two cargo chains
  (coal → power plant; wood → sawmill → goods → town), service-driven town
  growth, distance × quantity delivery revenue, per-train lifetime earnings,
  continuous running costs, bank loans with monthly interest, monthly
  income/expense ledger with 12-month history, company value.
- **Graphics** — per-tile terrain variation, animated water with shorelines,
  tree clusters, shaded hills, twin-rail track with sleepers, timber bridges,
  population-scaled building clusters for towns, distinct industry sprites,
  station platforms, multi-wagon trains colored by cargo with smoke particles,
  follow camera, minimap with viewport rectangle and click-to-jump.
- **UI** — canvas map with pan/zoom, six mouse tools, tabbed side panel
  (inspector / fleet list / finance dashboard with chart), message log,
  top-bar finances/date, help overlay.
- **Persistence** — JSON serialization of the whole `GameState` to
  localStorage with versioning, autosave, and corrupt-save handling.

## Architecture

```
index.html              page shell (toolbar, HUD, panel tabs, help overlay)
src/
  main.ts               bootstrap, game loop, action wiring, autosave
  style.css
  game/                 pure simulation — no DOM access
    types.ts            all state interfaces (plain JSON-serializable data)
    config.ts           tuning constants and train types
    rng.ts              seeded PRNG (mulberry32)
    MapGenerator.ts     terrain noise, town/industry placement
    GameState.ts        state creation, build actions, loans, finances
    Pathfinding.ts      8-directional Dijkstra over track + station tiles
    Trains.ts           purchase, sale, route validation, movement, arrivals
    Economy.ts          demand, cargo chains, town growth, revenue, costs
    Simulation.ts       per-tick orchestration (time, demand, interest, trains)
  ui/
    Renderer.ts         Canvas 2D rendering, camera, minimap, particles
    InputController.ts  mouse/keyboard, tool handling, minimap navigation
    HUD.ts              DOM panels, tabs, toolbar, finance chart, message log
    uiState.ts          UI-only state (tool, selection, tabs, route drafts)
  persistence/
    SaveLoad.ts         serialize/deserialize + manual & autosave slots
tests/
  pathfinding.test.ts   connected routes, corners, disconnection
  economy.test.ts       delivery revenue, running costs, construction costs,
                        demand, full simulated shuttle loop
  gameplay.test.ts      bridges, diagonal movement, wood→goods chain,
                        town growth, loans, selling trains
  saveload.test.ts      serialize/localStorage roundtrips, corrupt saves
  mapgen.test.ts        determinism, world content guarantees
```

The simulation (`src/game/`) never touches the DOM, so the whole game logic is
unit-testable headlessly; the UI layer reads state and calls action functions.

## Known limitations

- No signals or collisions — trains pass through each other.
- Bulldozing refunds nothing; demolishing a station requires removing it from
  routes first.
- Saves from the previous version (v1) are not migrated.
- Single manual save slot (plus the rolling autosave).

## Suggested next improvements

1. Station ratings that throttle demand when service is poor.
2. Multiple save slots; export/import save files.
3. Per-track occupancy / signals.
4. More cargo chains (iron + coal → steel → factory).
5. Sound effects and a quarterly newspaper with company milestones.
6. Competitor AI companies.
