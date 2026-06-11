import {
  CARGO_LABELS,
  CARGO_RATES,
  COAL_RATE,
  PASSENGER_RATE,
  STATION_CARGO_CAP,
  STATION_RADIUS,
  trainType,
} from './config';
import { addMessage, earn, getStation, spend } from './GameState';
import { CargoKind, GameState, Industry, Station, Town, Train } from './types';

function within(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= radius;
}

export function stationsCovering(state: GameState, x: number, y: number): Station[] {
  return state.stations.filter((s) => within(s.x, s.y, x, y, STATION_RADIUS));
}

export function townsServed(state: GameState, station: Station): Town[] {
  return state.towns.filter((t) => within(t.x, t.y, station.x, station.y, STATION_RADIUS));
}

export function industriesServed(state: GameState, station: Station): Industry[] {
  return state.industries.filter((i) => within(i.x, i.y, station.x, station.y, STATION_RADIUS));
}

/** Whether delivering this cargo kind at this station earns revenue. */
export function stationAccepts(state: GameState, station: Station, kind: CargoKind): boolean {
  if (kind === 'passengers') return townsServed(state, station).length > 0;
  return industriesServed(state, station).some((i) => i.kind === 'powerPlant');
}

/** Towns emit passengers and coal mines emit coal into covering stations. */
export function generateDemand(state: GameState, dtDays: number): void {
  for (const town of state.towns) {
    const covering = stationsCovering(state, town.x, town.y);
    if (covering.length === 0) continue;
    const produced = (town.population * PASSENGER_RATE * dtDays) / covering.length;
    for (const s of covering) {
      s.waiting.passengers = Math.min(STATION_CARGO_CAP, s.waiting.passengers + produced);
    }
  }
  for (const ind of state.industries) {
    if (ind.kind !== 'coalMine') continue;
    const covering = stationsCovering(state, ind.x, ind.y);
    if (covering.length === 0) continue;
    const produced = (COAL_RATE * dtDays) / covering.length;
    for (const s of covering) {
      s.waiting.coal = Math.min(STATION_CARGO_CAP, s.waiting.coal + produced);
    }
  }
}

/** Trains cost money to keep running, charged continuously. */
export function chargeRunningCosts(state: GameState, dtDays: number): void {
  let total = 0;
  for (const train of state.trains) {
    total += trainType(train.typeId).runningCost * dtDays;
  }
  if (total > 0) spend(state, total);
}

export function cargoCount(train: Train): number {
  return train.cargo.reduce((sum, b) => sum + b.qty, 0);
}

/**
 * Unload every batch this station accepts (except batches loaded here) and
 * pay revenue based on quantity and origin distance. Returns total revenue.
 */
export function unloadAtStation(state: GameState, train: Train, station: Station): number {
  let revenue = 0;
  const kept = [];
  for (const batch of train.cargo) {
    if (batch.origin !== station.id && stationAccepts(state, station, batch.kind)) {
      const origin = getStation(state, batch.origin);
      const dist = origin
        ? Math.abs(origin.x - station.x) + Math.abs(origin.y - station.y)
        : 0;
      const rate = CARGO_RATES[batch.kind];
      const pay = Math.round(batch.qty * (rate.base + rate.perTile * dist));
      revenue += pay;
      addMessage(
        state,
        `${train.name} delivered ${batch.qty} ${CARGO_LABELS[batch.kind]} to ${station.name} (+$${pay})`,
      );
    } else {
      kept.push(batch);
    }
  }
  train.cargo = kept;
  if (revenue > 0) earn(state, revenue);
  return revenue;
}

/** Load waiting cargo that some other stop on the train's route accepts. */
export function loadAtStation(state: GameState, train: Train, station: Station): void {
  const type = trainType(train.typeId);
  let space = type.capacity - cargoCount(train);
  const kinds: CargoKind[] = ['passengers', 'coal'];
  for (const kind of kinds) {
    if (space <= 0) break;
    const deliverable = train.stops.some((id) => {
      if (id === station.id) return false;
      const other = getStation(state, id);
      return other !== undefined && stationAccepts(state, other, kind);
    });
    if (!deliverable) continue;
    const qty = Math.min(Math.floor(station.waiting[kind]), space);
    if (qty <= 0) continue;
    station.waiting[kind] -= qty;
    const existing = train.cargo.find((b) => b.kind === kind && b.origin === station.id);
    if (existing) existing.qty += qty;
    else train.cargo.push({ kind, qty, origin: station.id });
    space -= qty;
  }
}

/** Rough company valuation: cash plus asset book value. */
export function companyValue(state: GameState): number {
  const trackTiles = state.track.reduce((a, b) => a + b, 0);
  const trainValue = state.trains.reduce(
    (sum, t) => sum + trainType(t.typeId).cost * 0.6,
    0,
  );
  return Math.floor(
    state.cash + trackTiles * 15 + state.stations.length * 400 + trainValue,
  );
}
