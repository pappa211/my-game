import { LOAD_DAYS, STRANDED_RETRY_DAYS, trainType } from './config';
import { loadAtStation, unloadAtStation } from './Economy';
import { addMessage, getStation, spend } from './GameState';
import { findPath } from './Pathfinding';
import { GameState, Train } from './types';

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
    const type = trainType(train.typeId);
    train.pathPos += type.speed * dtDays;
    const last = train.path.length - 1;
    if (train.pathPos >= last) {
      train.pathPos = last;
      setTrainPos(train);
      arriveAtStation(state, train);
    } else {
      setTrainPos(train);
    }
  }
}
