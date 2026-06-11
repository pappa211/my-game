# 🚂 Rail Frontier

A playable, original browser-based transport-management strategy game inspired by
classic rail tycoon mechanics. You run a young railway company on a procedurally
generated map: build track and stations, buy trains, assign routes, haul
passengers and coal, and grow your cash.

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

1. **Find an opportunity** — the map always contains two towns close together
   and a coal mine within reach of a power plant.
2. **Build stations** (tool `3`, $500 each) near towns/industries. A station
   serves everything within 3 tiles (the radius is previewed while placing).
3. **Lay track** (tool `2`) connecting your stations. Click-drag to paint.
   Plains cost $30/tile, forest $60, hills $120; water blocks construction.
4. **Buy a train** (tool `4`): pick a type, click your stations in order,
   press *Buy & Start*. If the stations aren't connected by track, the purchase
   is rejected with a clear message.
5. The train loops over its stops, loading passengers/coal and earning revenue
   on every delivery (revenue scales with quantity and distance). Trains cost
   money per day to run; watch monthly income vs. costs in the top bar.

**Cargo chains:** towns generate passengers (scaled by population); coal mines
produce coal; power plants consume coal. Deliver passengers to any other town
station, coal to a power-plant station.

**Controls:** pan with right/middle-drag, WASD or arrow keys · zoom with the
mouse wheel · tools on keys `1–6` · `Space` pauses · `Esc` cancels/deselects ·
`H` toggles help. Game speed: 1×/2×/4× buttons. Use *Inspect* (tool `1`) to
view tiles, stations (waiting cargo), towns, industries and trains (status,
cargo, route — a selected train's current path is drawn on the map).

**Save/Load:** the 💾/📂 buttons persist the full game state (map, cash, track,
stations, trains mid-journey, routes, date, finances) to browser localStorage.
*New Game* prompts for a seed — the same seed always generates the same world.

## What is implemented

- **Procedural map** — 164×140 tiles, value-noise terrain (plains, forest,
  hills, water), ≥15 named towns, ≥8 industries (coal mines + power plants),
  deterministic seeds, guaranteed starting opportunities (close town pair,
  mine near plant).
- **Construction** — track with terrain-dependent cost, stations with catchment
  radius, bulldozing (stations on active routes are protected), live
  valid/invalid placement feedback, funds checking.
- **Trains & routing** — two train types (cost/capacity/speed/running cost),
  multi-stop looping routes, **BFS pathfinding over the track graph** computed
  from station tiles, visible movement along track, stranded-train detection
  with retry when track is repaired, route reassignment.
- **Economy** — passenger demand from town population, a coal→power-plant cargo
  chain, distance × quantity delivery revenue, continuous running costs,
  monthly income/expense ledger, company value.
- **UI** — canvas map with pan/zoom, six mouse tools, side panel with
  contextual info, message log, top-bar finances/date, help overlay.
- **Persistence** — JSON serialization of the whole `GameState` to
  localStorage with versioning and corrupt-save handling.

## Architecture

```
index.html              page shell (toolbar, HUD, help overlay)
src/
  main.ts               bootstrap, game loop, action wiring
  style.css
  game/                 pure simulation — no DOM access
    types.ts            all state interfaces (plain JSON-serializable data)
    config.ts           tuning constants and train types
    rng.ts              seeded PRNG (mulberry32)
    MapGenerator.ts     terrain noise, town/industry placement
    GameState.ts        state creation, build actions, finances, messages
    Pathfinding.ts      BFS over track + station tiles
    Trains.ts           purchase, route validation, movement, arrivals
    Economy.ts          demand, loading/unloading, revenue, running costs
    Simulation.ts       per-tick orchestration (time, demand, costs, trains)
  ui/
    Renderer.ts         Canvas 2D rendering + camera
    InputController.ts  mouse/keyboard, tool handling
    HUD.ts              DOM panels, toolbar, message log
    uiState.ts          UI-only state (tool, selection, route drafts)
  persistence/
    SaveLoad.ts         serialize/deserialize + localStorage wrappers
tests/
  pathfinding.test.ts   connected routes, corners, disconnection
  economy.test.ts       delivery revenue, running costs, construction costs,
                        demand, full simulated shuttle loop
  saveload.test.ts      serialize/localStorage roundtrips, corrupt saves
  mapgen.test.ts        determinism, world content guarantees
```

The simulation (`src/game/`) never touches the DOM, so the whole game logic is
unit-testable headlessly; the UI layer reads state and calls action functions.

## Known limitations

- Track is a simple tile graph (4-directional, no signals, no collisions —
  trains pass through each other).
- No bridges or tunnels; water must be routed around.
- Bulldozing refunds nothing; demolishing a station requires removing it from
  routes first.
- One cargo chain (coal → power plant) plus passengers; no mail, goods, or
  industry growth.
- Towns are static (no population growth from service quality).
- Single save slot.

## Suggested next improvements

1. Bridges over water (higher cost) and diagonal track.
2. Industry/town growth driven by service quality; station ratings.
3. Multiple save slots + autosave; export/import save files.
4. Train collisions/signals or at least per-track occupancy.
5. More cargo chains (wood → factory → goods → towns).
6. Sound, animations, minimap, and a financial chart panel.
