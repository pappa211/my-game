import { START_CASH, STATION_COST, STATION_RADIUS, TRACK_COST } from './config';
import { generateMap } from './MapGenerator';
import {
  GameMap,
  GameState,
  Industry,
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

export function newGame(seed: number): GameState {
  const world = generateMap(seed);
  const state = createState(world.map, world.towns, world.industries, seed);
  addMessage(state, 'Welcome to Rail Frontier! Build track, place stations and connect the frontier.');
  return state;
}

/** Create a game state from explicit world data (also used by tests). */
export function createState(
  map: GameMap,
  towns: Town[],
  industries: Industry[],
  seed: number,
): GameState {
  const maxEntityId = Math.max(0, ...towns.map((t) => t.id), ...industries.map((i) => i.id));
  return {
    seed,
    map,
    track: new Array(map.width * map.height).fill(0),
    towns,
    industries,
    stations: [],
    trains: [],
    cash: START_CASH,
    day: 0,
    finances: {
      month: { income: 0, expenses: 0 },
      lastMonth: { income: 0, expenses: 0 },
      total: { income: 0, expenses: 0 },
      monthIndex: 0,
    },
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

export function addMessage(state: GameState, text: string): void {
  state.messages.push({ day: state.day, text });
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
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
  if (terrain === Terrain.Water) return { ok: false, reason: 'Cannot build on water' };
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

export function canBuildStation(state: GameState, x: number, y: number): ActionResult {
  if (!inBounds(state.map, x, y)) return { ok: false, reason: 'Out of bounds' };
  if (terrainAt(state, x, y) === Terrain.Water) return { ok: false, reason: 'Cannot build on water' };
  if (townAt(state, x, y)) return { ok: false, reason: 'Tile occupied by a town' };
  if (industryAt(state, x, y)) return { ok: false, reason: 'Tile occupied by an industry' };
  if (stationAt(state, x, y)) return { ok: false, reason: 'A station already exists here' };
  if (state.cash < STATION_COST)
    return { ok: false, reason: `Not enough cash ($${STATION_COST} needed)`, cost: STATION_COST };
  return { ok: true, cost: STATION_COST };
}

export function buildStation(state: GameState, x: number, y: number): ActionResult {
  const check = canBuildStation(state, x, y);
  if (!check.ok) return check;
  const nearTown = state.towns.find(
    (t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= STATION_RADIUS,
  );
  const nearIndustry = state.industries.find(
    (i) => Math.max(Math.abs(i.x - x), Math.abs(i.y - y)) <= STATION_RADIUS,
  );
  const base = nearTown?.name ?? nearIndustry?.name ?? 'Waypoint';
  const count = state.stations.filter((s) => s.name.startsWith(base)).length;
  const station: Station = {
    id: state.nextId++,
    x,
    y,
    name: count > 0 ? `${base} #${count + 1}` : base,
    waiting: { passengers: 0, coal: 0 },
  };
  state.stations.push(station);
  spend(state, check.cost!);
  addMessage(state, `Station ${station.name} opened.`);
  return check;
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
