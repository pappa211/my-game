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
  /** fractional — grows with service; floor for display */
  population: number;
  /** 0..1 quality of rail service, smoothed; drives growth */
  serviceLevel: number;
  /** demanded units delivered here in the current month (accumulator) */
  deliveredThisMonth?: number;
  /** completed-month delivered units, oldest first (capped at 12) */
  deliveryHistory?: number[];
}

export type IndustryKind =
  | 'coalMine'
  | 'ironMine'
  | 'oilWell'
  | 'lumberCamp'
  | 'farm'
  | 'ranch'
  | 'steelMill'
  | 'factory'
  | 'sawmill'
  | 'mill'
  | 'powerPlant'
  | 'port';

export interface Industry {
  id: number;
  x: number;
  y: number;
  kind: IndustryKind;
  name: string;
  /** raw inputs delivered here, awaiting processing */
  stock: Record<string, number>;
  /** smoothed output activity 0..1, for display */
  activity: number;
}

/** Cargo ids are plain strings defined in cargo.ts. */
export type CargoKind = string;

export interface Station {
  id: number;
  x: number;
  y: number;
  name: string;
  /** 0 = depot, 1 = station, 2 = terminal — see STATION_TIERS */
  level: number;
  /** goods waiting to be picked up (fractional accumulation, floored on load) */
  waiting: Record<string, number>;
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
  /** wagons drawn behind the engine */
  wagons: number;
  /** 0..1 — lower means more frequent breakdowns */
  reliability: number;
  /** first calendar year this engine can be bought */
  availableYear: number;
  /** year it stops being sold (existing units keep running) */
  obsoleteYear: number;
}

export interface CargoBatch {
  kind: CargoKind;
  qty: number;
  /** station id where the batch was loaded — used for distance-based revenue */
  origin: number;
}

export type TrainState = 'moving' | 'loading' | 'stranded' | 'broken';

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
  /** current leg as a list of tile coordinates (may include diagonal steps) */
  path: Point[];
  /** fractional index into path */
  pathPos: number;
  state: TrainState;
  /** days remaining for loading / stranded-retry / breakdown repair */
  loadTimer: number;
  cargo: CargoBatch[];
  /** lifetime delivery revenue */
  earnings: number;
  /** delivery revenue earned in the current month (accumulator) */
  monthRevenue?: number;
  /** completed-month delivery revenue, oldest first (capped at 12) */
  revenueHistory?: number[];
  /** game day the engine was purchased (for age / obsolescence) */
  builtDay: number;
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
  /** completed months, oldest first (capped) */
  history: FinancePeriod[];
}

export interface Message {
  day: number;
  text: string;
  /** soft category for colouring: info | money | warn | era */
  kind?: 'info' | 'money' | 'warn' | 'era';
}

/** A computer-controlled competing railroad. */
export interface Rival {
  id: number;
  name: string;
  color: string;
  cash: number;
  value: number;
  /** town-id pairs this rival has connected (territory it has claimed) */
  links: { a: number; b: number }[];
  /** days until the rival considers its next expansion */
  nextMoveIn: number;
}

export interface GameState {
  seed: number;
  map: GameMap;
  /** flat 0/1 array parallel to map.terrain (track over water = bridge) */
  track: number[];
  towns: Town[];
  industries: Industry[];
  stations: Station[];
  trains: Train[];
  cash: number;
  /** outstanding bond/loan principal */
  loan: number;
  /** calendar year the company was founded */
  startYear: number;
  /** total game days elapsed (float) */
  day: number;
  /** economic cycle multiplier on cargo revenue (≈0.7..1.3) */
  economy: number;
  /** target the economy drifts toward; re-rolled by events */
  economyTarget: number;
  finances: Finances;
  rivals: Rival[];
  nextId: number;
  messages: Message[];
}

/** Current in-game calendar year. */
export function currentYear(state: GameState): number {
  return state.startYear + Math.floor(state.day / 360);
}
