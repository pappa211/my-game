import { CargoKind, Terrain, TrainTypeDef } from './types';

/** real-time seconds per game day at 1x speed */
export const DAY_SECONDS = 2;
export const MONTH_DAYS = 30;
export const YEAR_DAYS = 360;

export const START_CASH = 15000;

/** stations serve towns/industries within this Chebyshev distance */
export const STATION_RADIUS = 3;
export const STATION_COST = 500;

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

/** passengers generated per town inhabitant per day */
export const PASSENGER_RATE = 0.02;
/** coal units produced per mine per day */
export const COAL_RATE = 8;
/** wood units produced per lumber camp per day */
export const WOOD_RATE = 7;
/** max units of one cargo kind waiting at a station */
export const STATION_CARGO_CAP = 150;

/** goods that appear at a sawmill's station per unit of wood delivered */
export const WOOD_TO_GOODS = 0.75;

/** population gained by served towns per passenger delivered */
export const GROWTH_PER_PASSENGER = 0.08;
export const TOWN_MAX_POP = 5000;

/** loans are taken and repaid in steps; interest is charged monthly */
export const LOAN_STEP = 5000;
export const LOAN_MAX = 30000;
export const LOAN_INTEREST_YEARLY = 0.1;

/** fraction of the purchase price refunded when selling a train */
export const TRAIN_SELL_FACTOR = 0.5;

export const CARGO_RATES: Record<CargoKind, { base: number; perTile: number }> = {
  passengers: { base: 2, perTile: 0.4 },
  coal: { base: 3, perTile: 0.5 },
  wood: { base: 3, perTile: 0.45 },
  goods: { base: 4, perTile: 0.6 },
};

export const CARGO_LABELS: Record<CargoKind, string> = {
  passengers: 'passengers',
  coal: 'coal',
  wood: 'wood',
  goods: 'goods',
};

export const TRAIN_TYPES: TrainTypeDef[] = [
  {
    id: 'local',
    name: 'Local Runner',
    cost: 900,
    capacity: 40,
    speed: 6,
    runningCost: 25,
    color: '#d8413c',
    wagons: 2,
  },
  {
    id: 'express',
    name: 'Swift Express',
    cost: 2100,
    capacity: 30,
    speed: 10,
    runningCost: 45,
    color: '#3fae6a',
    wagons: 1,
  },
  {
    id: 'heavy',
    name: 'Heavy Hauler',
    cost: 1400,
    capacity: 80,
    speed: 4.5,
    runningCost: 35,
    color: '#3a6fd8',
    wagons: 3,
  },
  {
    id: 'giant',
    name: 'Iron Giant',
    cost: 3200,
    capacity: 150,
    speed: 3.5,
    runningCost: 60,
    color: '#8458c9',
    wagons: 4,
  },
];

export function trainType(id: string): TrainTypeDef {
  const t = TRAIN_TYPES.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown train type: ${id}`);
  return t;
}
