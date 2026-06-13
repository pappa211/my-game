import { emptyCargoRecord } from './cargo';
import {
  DEFAULT_STATION_LEVEL,
  getPeriod,
  LOAN_FLOOR,
  LOAN_STEP,
  stationTier,
  STATION_TIERS,
  TRACK_COST,
} from './config';
import { createRivals } from './Rivals';
import { generateMap } from './MapGenerator';
import {
  GameMap,
  GameState,
  Industry,
  Message,
  Station,
  Terrain,
  Town,
  Train,
} from './types';

export interface ActionResult {
  ok: boolean;
  reason?: string;
  cost?: number;
}

export function newGame(seed: number, periodId = 'steam'): GameState {
  const period = getPeriod(periodId);
  const world = generateMap(seed);
  const state = createState(world.map, world.towns, world.industries, seed, {
    startYear: period.startYear,
    startCash: period.startCash,
  });
  state.rivals = createRivals(state);
  addMessage(
    state,
    `Welcome to Rail Frontier, ${period.startYear}. Connect towns and industries and build a railroad empire.`,
  );
  return state;
}

export interface CreateOpts {
  startYear?: number;
  startCash?: number;
}

/** Create a game state from explicit world data (also used by tests). */
export function createState(
  map: GameMap,
  towns: Town[],
  industries: Industry[],
  seed: number,
  opts: CreateOpts = {},
): GameState {
  // Normalise so test fixtures and old worlds always have the new fields.
  for (const t of towns) if (t.serviceLevel === undefined) t.serviceLevel = 0;
  for (const i of industries) {
    if (!i.stock) i.stock = emptyCargoRecord();
    if (i.activity === undefined) i.activity = 0;
  }
  const maxEntityId = Math.max(0, ...towns.map((t) => t.id), ...industries.map((i) => i.id));
  return {
    seed,
    map,
    track: new Array(map.width * map.height).fill(0),
    towns,
    industries,
    stations: [],
    trains: [],
    cash: opts.startCash ?? 26000,
    loan: 0,
    startYear: opts.startYear ?? 1880,
    day: 0,
    economy: 1,
    economyTarget: 1,
    finances: {
      month: { income: 0, expenses: 0 },
      lastMonth: { income: 0, expenses: 0 },
      total: { income: 0, expenses: 0 },
      monthIndex: 0,
      history: [],
    },
    rivals: [],
    nextId: maxEntityId + 1,
    messages: [],
  };
}

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function terrainAt(state: GameState, x: number, y: number): Terrain {
  return state.map.terrain[tileIndex(state.map, x, y)] as Terrain;
}

export function hasTrack(state: GameState, x: number, y: number): boolean {
  return inBounds(state.map, x, y) && state.track[tileIndex(state.map, x, y)] === 1;
}

export function stationAt(state: GameState, x: number, y: number): Station | undefined {
  return state.stations.find((s) => s.x === x && s.y === y);
}

export function townAt(state: GameState, x: number, y: number): Town | undefined {
  return state.towns.find((t) => t.x === x && t.y === y);
}

export function industryAt(state: GameState, x: number, y: number): Industry | undefined {
  return state.industries.find((i) => i.x === x && i.y === y);
}

export function getStation(state: GameState, id: number): Station | undefined {
  return state.stations.find((s) => s.id === id);
}

export function getTrain(state: GameState, id: number): Train | undefined {
  return state.trains.find((t) => t.id === id);
}

/** Tiles trains can drive on: track or stations (stations are track nodes). */
export function isTraversable(state: GameState, x: number, y: number): boolean {
  return inBounds(state.map, x, y) && (hasTrack(state, x, y) || stationAt(state, x, y) !== undefined);
}

export function addMessage(state: GameState, text: string, kind: Message['kind'] = 'info'): void {
  state.messages.push({ day: state.day, text, kind });
  if (state.messages.length > 60) state.messages.splice(0, state.messages.length - 60);
}

/** Record income and add to cash. */
export function earn(state: GameState, amount: number): void {
  state.cash += amount;
  state.finances.month.income += amount;
  state.finances.total.income += amount;
}

/** Record an expense and subtract from cash. Does not check funds. */
export function spend(state: GameState, amount: number): void {
  state.cash -= amount;
  state.finances.month.expenses += amount;
  state.finances.total.expenses += amount;
}

export function canBuildTrack(state: GameState, x: number, y: number): ActionResult {
  if (!inBounds(state.map, x, y)) return { ok: false, reason: 'Out of bounds' };
  const terrain = terrainAt(state, x, y);
  if (townAt(state, x, y)) return { ok: false, reason: 'Tile occupied by a town' };
  if (industryAt(state, x, y)) return { ok: false, reason: 'Tile occupied by an industry' };
  if (hasTrack(state, x, y)) return { ok: false, reason: 'Track already built here' };
  if (stationAt(state, x, y)) return { ok: false, reason: 'A station occupies this tile' };
  const cost = TRACK_COST[terrain];
  if (state.cash < cost) return { ok: false, reason: `Not enough cash ($${cost} needed)`, cost };
  return { ok: true, cost };
}

export function buildTrack(state: GameState, x: number, y: number): ActionResult {
  const check = canBuildTrack(state, x, y);
  if (!check.ok) return check;
  state.track[tileIndex(state.map, x, y)] = 1;
  spend(state, check.cost!);
  return check;
}

export function canBuildStation(
  state: GameState,
  x: number,
  y: number,
  level = DEFAULT_STATION_LEVEL,
): ActionResult {
  const cost = stationTier(level).cost;
  if (!inBounds(state.map, x, y)) return { ok: false, reason: 'Out of bounds' };
  if (terrainAt(state, x, y) === Terrain.Water) return { ok: false, reason: 'Cannot build on water' };
  if (townAt(state, x, y)) return { ok: false, reason: 'Tile occupied by a town' };
  if (industryAt(state, x, y)) return { ok: false, reason: 'Tile occupied by an industry' };
  if (stationAt(state, x, y)) return { ok: false, reason: 'A station already exists here' };
  if (state.cash < cost) return { ok: false, reason: `Not enough cash ($${cost} needed)`, cost };
  return { ok: true, cost };
}

export function buildStation(
  state: GameState,
  x: number,
  y: number,
  level = DEFAULT_STATION_LEVEL,
): ActionResult {
  const check = canBuildStation(state, x, y, level);
  if (!check.ok) return check;
  const tier = stationTier(level);
  const nearTown = state.towns.find(
    (t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= tier.radius,
  );
  const nearIndustry = state.industries.find(
    (i) => Math.max(Math.abs(i.x - x), Math.abs(i.y - y)) <= tier.radius,
  );
  const base = nearTown?.name ?? nearIndustry?.name ?? 'Waypoint';
  const count = state.stations.filter((s) => s.name.startsWith(base)).length;
  const station: Station = {
    id: state.nextId++,
    x,
    y,
    level,
    name: count > 0 ? `${base} #${count + 1}` : base,
    waiting: emptyCargoRecord(),
  };
  state.stations.push(station);
  spend(state, check.cost!);
  addMessage(state, `${tier.name} ${station.name} opened.`);
  return check;
}

/** Upgrade a station to the next tier, charging the price difference. */
export function upgradeStation(state: GameState, id: number): ActionResult {
  const station = getStation(state, id);
  if (!station) return { ok: false, reason: 'Station not found.' };
  if (station.level >= STATION_TIERS.length - 1) {
    return { ok: false, reason: 'Already the largest station tier.' };
  }
  const next = stationTier(station.level + 1);
  const diff = next.cost - stationTier(station.level).cost;
  if (state.cash < diff) return { ok: false, reason: `Upgrade costs $${diff.toLocaleString('en-US')}.` };
  station.level += 1;
  spend(state, diff);
  addMessage(state, `${station.name} upgraded to ${next.name} (radius ${next.radius}).`);
  return { ok: true, cost: diff };
}

export function bulldoze(state: GameState, x: number, y: number): ActionResult {
  const station = stationAt(state, x, y);
  if (station) {
    const usedBy = state.trains.find((t) => t.stops.includes(station.id));
    if (usedBy) {
      return { ok: false, reason: `${station.name} is used by ${usedBy.name}'s route` };
    }
    state.stations = state.stations.filter((s) => s.id !== station.id);
    addMessage(state, `Station ${station.name} demolished.`);
    return { ok: true, cost: 0 };
  }
  if (hasTrack(state, x, y)) {
    state.track[tileIndex(state.map, x, y)] = 0;
    return { ok: true, cost: 0 };
  }
  return { ok: false, reason: 'Nothing to bulldoze here' };
}

/** Credit line scales with the company's book value. */
export function loanLimit(state: GameState): number {
  const assets =
    state.track.reduce((a, b) => a + b, 0) * 15 +
    state.stations.reduce((s, st) => s + stationTier(st.level).cost * 0.7, 0);
  return Math.max(LOAN_FLOOR, Math.round((assets * 0.5 + state.cash * 0.2) / LOAN_STEP) * LOAN_STEP);
}

export function takeLoan(state: GameState): ActionResult {
  const limit = loanLimit(state);
  if (state.loan + LOAN_STEP > limit) {
    return { ok: false, reason: `Credit limit is $${limit.toLocaleString('en-US')}.` };
  }
  state.loan += LOAN_STEP;
  state.cash += LOAN_STEP;
  addMessage(state, `Issued $${LOAN_STEP.toLocaleString('en-US')} in bonds.`, 'money');
  return { ok: true };
}

export function repayLoan(state: GameState): ActionResult {
  if (state.loan <= 0) return { ok: false, reason: 'No outstanding bonds.' };
  const amount = Math.min(LOAN_STEP, state.loan);
  if (state.cash < amount) {
    return { ok: false, reason: `Need $${amount.toLocaleString('en-US')} cash to repay.` };
  }
  state.loan -= amount;
  state.cash -= amount;
  addMessage(state, `Repaid $${amount.toLocaleString('en-US')} of bonds.`, 'money');
  return { ok: true };
}
