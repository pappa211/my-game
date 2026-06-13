import { Terrain, TrainTypeDef } from './types';

/** real-time seconds per game day at 1x speed */
export const DAY_SECONDS = 2;
export const MONTH_DAYS = 30;
export const YEAR_DAYS = 360;

export const TRACK_COST: Record<number, number> = {
  [Terrain.Grass]: 30,
  [Terrain.Forest]: 60,
  [Terrain.Hill]: 120,
  /** track over water is a bridge */
  [Terrain.Water]: 220,
};

/** days a train spends at a station to load/unload */
export const LOAD_DAYS = 0.4;
/** days between pathfinding retries when a train is stranded */
export const STRANDED_RETRY_DAYS = 1;

// ---- cargo generation ----
/** passengers generated per town inhabitant per day */
export const PASSENGER_RATE = 0.02;
/** mail generated per town inhabitant per day */
export const MAIL_RATE = 0.007;

/** population gained per unit of demanded cargo delivered to a town */
export const GROWTH_PER_DELIVERY = 0.05;
export const TOWN_MAX_POP = 9000;

// ---- town tiers ----
// Towns visibly upgrade as they grow; larger tiers generate more
// passenger/mail traffic (the volume multiplier) and read as bigger goals.
export interface TownTier {
  name: string;
  /** minimum population to reach this tier */
  minPop: number;
  /** multiplier on passenger/mail generation */
  trafficMul: number;
}

export const TOWN_TIERS: TownTier[] = [
  { name: 'Village', minPop: 0, trafficMul: 1.0 },
  { name: 'Town', minPop: 500, trafficMul: 1.0 },
  { name: 'City', minPop: 2000, trafficMul: 1.15 },
  { name: 'Metropolis', minPop: 5000, trafficMul: 1.3 },
];

/** The tier a town of this population currently occupies. */
export function townTier(population: number): TownTier {
  let tier = TOWN_TIERS[0];
  for (const t of TOWN_TIERS) if (population >= t.minPop) tier = t;
  return tier;
}

/** The next tier up, or null if already the largest. */
export function nextTownTier(population: number): TownTier | null {
  const i = TOWN_TIERS.indexOf(townTier(population));
  return TOWN_TIERS[i + 1] ?? null;
}

// ---- station tiers ----
export interface StationTier {
  level: number;
  name: string;
  radius: number;
  cost: number;
  /** max units of one cargo kind that can wait here */
  cargoCap: number;
}

export const STATION_TIERS: StationTier[] = [
  { level: 0, name: 'Depot', radius: 2, cost: 300, cargoCap: 120 },
  { level: 1, name: 'Station', radius: 3, cost: 700, cargoCap: 220 },
  { level: 2, name: 'Terminal', radius: 4, cost: 1500, cargoCap: 400 },
];

export function stationTier(level: number): StationTier {
  return STATION_TIERS[Math.max(0, Math.min(STATION_TIERS.length - 1, level))];
}

/** Default tier placed by the station tool, and legacy radius/cost aliases. */
export const DEFAULT_STATION_LEVEL = 1;
export const STATION_RADIUS = STATION_TIERS[DEFAULT_STATION_LEVEL].radius;
export const STATION_COST = STATION_TIERS[DEFAULT_STATION_LEVEL].cost;

// ---- finance ----
export const LOAN_STEP = 5000;
/** minimum credit line; the real limit also scales with company value */
export const LOAN_FLOOR = 30000;
export const LOAN_INTEREST_YEARLY = 0.1;
export const TRAIN_SELL_FACTOR = 0.5;

// ---- economy cycle ----
export const ECONOMY_MIN = 0.7;
export const ECONOMY_MAX = 1.35;
/** fraction of the gap to the target closed per day */
export const ECONOMY_DRIFT = 0.01;

// ---- breakdowns ----
/** base mean-days-between-failures at reliability 1.0 is this / (1-rel) */
export const BREAKDOWN_SCALE = 30;
export const REPAIR_DAYS = 0.8;
export const REPAIR_COST = 200;

export interface Period {
  id: string;
  label: string;
  startYear: number;
  startCash: number;
  blurb: string;
}

export const PERIODS: Period[] = [
  { id: 'pioneer', label: 'Pioneer Age', startYear: 1830, startCash: 20000, blurb: 'Wooden engines, open frontier.' },
  { id: 'steam', label: 'Steam Boom', startYear: 1880, startCash: 26000, blurb: 'Powerful steam, busy industry.' },
  { id: 'modern', label: 'Diesel Era', startYear: 1950, startCash: 32000, blurb: 'Diesels and dense networks.' },
];

export function getPeriod(id: string): Period {
  return PERIODS.find((p) => p.id === id) ?? PERIODS[0];
}

// ---- locomotive roster (era-gated) ----
export const TRAIN_TYPES: TrainTypeDef[] = [
  {
    id: 'pioneer', name: 'Pioneer 0-4-0', cost: 800, capacity: 28, speed: 5, runningCost: 20,
    color: '#b5533a', wagons: 2, reliability: 0.8, availableYear: 1830, obsoleteYear: 1875,
  },
  {
    id: 'american', name: 'American 4-4-0', cost: 1300, capacity: 42, speed: 7, runningCost: 28,
    color: '#d8413c', wagons: 3, reliability: 0.85, availableYear: 1848, obsoleteYear: 1905,
  },
  {
    id: 'mogul', name: 'Mogul 2-6-0', cost: 1900, capacity: 75, speed: 6, runningCost: 36,
    color: '#3a6fd8', wagons: 4, reliability: 0.86, availableYear: 1868, obsoleteYear: 1920,
  },
  {
    id: 'atlantic', name: 'Atlantic 4-4-2', cost: 2500, capacity: 50, speed: 11, runningCost: 42,
    color: '#3fae6a', wagons: 2, reliability: 0.88, availableYear: 1895, obsoleteYear: 1940,
  },
  {
    id: 'consolidation', name: 'Consolidation 2-8-0', cost: 2900, capacity: 115, speed: 6.5, runningCost: 50,
    color: '#8458c9', wagons: 5, reliability: 0.88, availableYear: 1902, obsoleteYear: 1950,
  },
  {
    id: 'hudson', name: 'Hudson 4-6-4', cost: 3900, capacity: 85, speed: 13, runningCost: 58,
    color: '#2bb5c9', wagons: 3, reliability: 0.9, availableYear: 1930, obsoleteYear: 1965,
  },
  {
    id: 'diesel', name: 'EMD Diesel', cost: 4700, capacity: 135, speed: 12, runningCost: 54,
    color: '#e0a030', wagons: 5, reliability: 0.95, availableYear: 1945, obsoleteYear: 1990,
  },
  {
    id: 'electric', name: 'Electric Express', cost: 6200, capacity: 165, speed: 16, runningCost: 66,
    color: '#5a9bd8', wagons: 6, reliability: 0.97, availableYear: 1968, obsoleteYear: 9999,
  },
];

export function trainType(id: string): TrainTypeDef {
  const t = TRAIN_TYPES.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown train type: ${id}`);
  return t;
}

/** Engines a player can buy in the given calendar year. */
export function availableTrainTypes(year: number): TrainTypeDef[] {
  return TRAIN_TYPES.filter((t) => year >= t.availableYear && year < t.obsoleteYear);
}

/** Cheapest engine available in a year — used as a sensible default selection. */
export function defaultTrainType(year: number): TrainTypeDef {
  const avail = availableTrainTypes(year);
  return avail[0] ?? TRAIN_TYPES[0];
}
