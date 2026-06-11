export enum Terrain {
  Grass = 0,
  Forest = 1,
  Hill = 2,
  Water = 3,
}

export interface GameMap {
  width: number;
  height: number;
  /** flat array, index = y * width + x, values are Terrain */
  terrain: number[];
}

export interface Point {
  x: number;
  y: number;
}

export interface Town {
  id: number;
  x: number;
  y: number;
  name: string;
  population: number;
}

export type IndustryKind = 'coalMine' | 'powerPlant';

export interface Industry {
  id: number;
  x: number;
  y: number;
  kind: IndustryKind;
  name: string;
}

export type CargoKind = 'passengers' | 'coal';

export interface Station {
  id: number;
  x: number;
  y: number;
  name: string;
  /** goods waiting to be picked up (fractional accumulation, floored on load) */
  waiting: Record<CargoKind, number>;
}

export interface TrainTypeDef {
  id: string;
  name: string;
  cost: number;
  capacity: number;
  /** tiles per game day */
  speed: number;
  /** money per game day */
  runningCost: number;
  color: string;
}

export interface CargoBatch {
  kind: CargoKind;
  qty: number;
  /** station id where the batch was loaded — used for distance-based revenue */
  origin: number;
}

export type TrainState = 'moving' | 'loading' | 'stranded';

export interface Train {
  id: number;
  name: string;
  typeId: string;
  /** ordered station ids; the train loops over them */
  stops: number[];
  /** station the train is currently at (or last departed from) */
  atStationId: number;
  /** station the current path leads to, null while parked */
  targetStationId: number | null;
  /** current leg as a list of tile coordinates */
  path: Point[];
  /** fractional index into path */
  pathPos: number;
  state: TrainState;
  /** days remaining for loading / stranded-retry */
  loadTimer: number;
  cargo: CargoBatch[];
  x: number;
  y: number;
}

export interface FinancePeriod {
  income: number;
  expenses: number;
}

export interface Finances {
  month: FinancePeriod;
  lastMonth: FinancePeriod;
  total: FinancePeriod;
  monthIndex: number;
}

export interface Message {
  day: number;
  text: string;
}

export interface GameState {
  seed: number;
  map: GameMap;
  /** flat 0/1 array parallel to map.terrain */
  track: number[];
  towns: Town[];
  industries: Industry[];
  stations: Station[];
  trains: Train[];
  cash: number;
  /** total game days elapsed (float) */
  day: number;
  finances: Finances;
  nextId: number;
  messages: Message[];
}
