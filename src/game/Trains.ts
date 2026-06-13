import {
  availableTrainTypes,
  BREAKDOWN_SCALE,
  LOAD_DAYS,
  REPAIR_COST,
  REPAIR_DAYS,
  STRANDED_RETRY_DAYS,
  TRAIN_SELL_FACTOR,
  trainType,
} from './config';
import { loadAtStation, unloadAtStation } from './Economy';
import { addMessage, earn, getStation, spend } from './GameState';
import { findPath } from './Pathfinding';
import { currentYear, GameState, Train, TrainTypeDef } from './types';

export interface TrainResult {
  ok: boolean;
  reason?: string;
  train?: Train;
}

/** Validate that every consecutive leg of the loop has a track connection. */
function validateRoute(state: GameState, stops: number[]): string | null {
  if (stops.length < 2) return 'A route needs at least 2 stations.';
  if (new Set(stops).size !== stops.length) return 'Each station may appear only once in a route.';
  for (let i = 0; i < stops.length; i++) {
    const a = getStation(state, stops[i]);
    const b = getStation(state, stops[(i + 1) % stops.length]);
    if (!a || !b) return 'Route references a missing station.';
    if (!findPath(state, a.x, a.y, b.x, b.y)) {
      return `No track connection between ${a.name} and ${b.name}.`;
    }
  }
  return null;
}

export function buyTrain(state: GameState, typeId: string, stops: number[]): TrainResult {
  const type = trainType(typeId);
  const year = currentYear(state);
  if (!availableTrainTypes(year).some((t) => t.id === typeId)) {
    return { ok: false, reason: `The ${type.name} is not available in ${year}.` };
  }
  if (state.cash < type.cost) {
    return { ok: false, reason: `Not enough cash: ${type.name} costs $${type.cost}.` };
  }
  const routeError = validateRoute(state, stops);
  if (routeError) return { ok: false, reason: routeError };

  const home = getStation(state, stops[0])!;
  const train: Train = {
    id: state.nextId++,
    name: `Train ${state.trains.length + 1}`,
    typeId,
    stops: [...stops],
    atStationId: home.id,
    targetStationId: null,
    path: [{ x: home.x, y: home.y }],
    pathPos: 0,
    state: 'loading',
    loadTimer: LOAD_DAYS,
    cargo: [],
    earnings: 0,
    monthRevenue: 0,
    revenueHistory: [],
    builtDay: state.day,
    x: home.x,
    y: home.y,
  };
  state.trains.push(train);
  spend(state, type.cost);
  addMessage(state, `${train.name} (${type.name}) purchased at ${home.name}.`);
  return { ok: true, train };
}

/** Reassign a train's route. The train finishes its current leg, then rejoins. */
export function assignRoute(state: GameState, trainId: number, stops: number[]): TrainResult {
  const train = state.trains.find((t) => t.id === trainId);
  if (!train) return { ok: false, reason: 'Train not found.' };
  const routeError = validateRoute(state, stops);
  if (routeError) return { ok: false, reason: routeError };
  train.stops = [...stops];
  if (train.state === 'stranded') {
    // Give a stranded train a chance to recover immediately.
    train.loadTimer = 0;
  }
  addMessage(state, `${train.name} assigned a new ${stops.length}-stop route.`);
  return { ok: true, train };
}

/** Sell a train for a fraction of its purchase price. Cargo is lost. */
export function sellTrain(state: GameState, trainId: number): TrainResult {
  const train = state.trains.find((t) => t.id === trainId);
  if (!train) return { ok: false, reason: 'Train not found.' };
  const refund = Math.round(trainType(train.typeId).cost * TRAIN_SELL_FACTOR);
  state.trains = state.trains.filter((t) => t.id !== trainId);
  earn(state, refund);
  addMessage(state, `${train.name} sold for $${refund.toLocaleString('en-US')}.`);
  return { ok: true, train };
}

function setTrainPos(train: Train): void {
  const i = Math.min(Math.floor(train.pathPos), train.path.length - 1);
  const frac = train.pathPos - i;
  const a = train.path[i];
  const b = train.path[Math.min(i + 1, train.path.length - 1)];
  train.x = a.x + (b.x - a.x) * frac;
  train.y = a.y + (b.y - a.y) * frac;
}

function nextStopId(state: GameState, train: Train): number {
  const at = train.stops.indexOf(train.atStationId);
  return train.stops[(at + 1) % train.stops.length];
}

function depart(state: GameState, train: Train): void {
  const from = getStation(state, train.atStationId);
  const toId = nextStopId(state, train);
  const to = getStation(state, toId);
  if (!from || !to) {
    train.state = 'stranded';
    train.loadTimer = STRANDED_RETRY_DAYS;
    return;
  }
  if (to.id === from.id) {
    // Degenerate single-station loop; just keep loading.
    train.state = 'loading';
    train.loadTimer = LOAD_DAYS;
    return;
  }
  const path = findPath(state, from.x, from.y, to.x, to.y);
  if (!path) {
    if (train.state !== 'stranded') {
      addMessage(state, `${train.name}: no track connection from ${from.name} to ${to.name}. Waiting.`);
    }
    train.state = 'stranded';
    train.loadTimer = STRANDED_RETRY_DAYS;
    return;
  }
  train.targetStationId = to.id;
  train.path = path;
  train.pathPos = 0;
  train.state = 'moving';
  setTrainPos(train);
}

export function arriveAtStation(state: GameState, train: Train): void {
  const station = getStation(state, train.targetStationId ?? -1);
  train.targetStationId = null;
  if (!station) {
    train.state = 'stranded';
    train.loadTimer = STRANDED_RETRY_DAYS;
    return;
  }
  train.atStationId = station.id;
  unloadAtStation(state, train, station);
  loadAtStation(state, train, station);
  train.state = 'loading';
  train.loadTimer = LOAD_DAYS;
}

/** Random mechanical failure while moving. Returns true if the train broke. */
function maybeBreakdown(state: GameState, train: Train, type: TrainTypeDef, dtDays: number): boolean {
  const perDay = (1 - type.reliability) / BREAKDOWN_SCALE;
  if (Math.random() < perDay * dtDays) {
    train.state = 'broken';
    train.loadTimer = REPAIR_DAYS;
    spend(state, REPAIR_COST);
    addMessage(state, `🔧 ${train.name} broke down — repairs cost $${REPAIR_COST}.`, 'warn');
    return true;
  }
  return false;
}

export function updateTrains(state: GameState, dtDays: number): void {
  for (const train of state.trains) {
    if (train.state === 'loading' || train.state === 'stranded') {
      train.loadTimer -= dtDays;
      if (train.loadTimer <= 0) {
        // Top up cargo that accumulated while parked, then go.
        if (train.state === 'loading') {
          const here = getStation(state, train.atStationId);
          if (here) loadAtStation(state, train, here);
        }
        depart(state, train);
      }
      continue;
    }
    if (train.state === 'broken') {
      train.loadTimer -= dtDays;
      if (train.loadTimer <= 0) train.state = 'moving';
      continue;
    }
    const type = trainType(train.typeId);
    if (maybeBreakdown(state, train, type, dtDays)) continue;
    // Advance by true distance so diagonal segments don't speed the train up.
    let remaining = type.speed * dtDays;
    const last = train.path.length - 1;
    while (remaining > 0 && train.pathPos < last) {
      const i = Math.floor(train.pathPos);
      const a = train.path[i];
      const b = train.path[Math.min(i + 1, last)];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const distToNext = (i + 1 - train.pathPos) * segLen;
      if (remaining >= distToNext) {
        train.pathPos = i + 1;
        remaining -= distToNext;
      } else {
        train.pathPos += remaining / segLen;
        remaining = 0;
      }
    }
    if (train.pathPos >= last) {
      train.pathPos = last;
      setTrainPos(train);
      arriveAtStation(state, train);
    } else {
      setTrainPos(train);
    }
  }
}

/**
 * Position a given true distance behind the train along its current path —
 * used by the renderer to place wagons. Clamps at the path start.
 */
export function positionBehind(train: Train, dist: number): { x: number; y: number; angle: number } {
  let i = Math.min(Math.floor(train.pathPos), train.path.length - 1);
  let frac = train.pathPos - i;
  let left = dist;
  while (left > 0 && (i > 0 || frac > 0)) {
    const a = train.path[Math.max(0, i)];
    const b = train.path[Math.min(i + 1, train.path.length - 1)];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const avail = frac * segLen;
    if (left <= avail) {
      frac -= left / segLen;
      left = 0;
    } else {
      left -= avail;
      i -= 1;
      frac = 1;
      if (i < 0) {
        i = 0;
        frac = 0;
        break;
      }
    }
  }
  const a = train.path[i];
  const b = train.path[Math.min(i + 1, train.path.length - 1)];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
