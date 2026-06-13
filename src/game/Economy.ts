import {
  CARGO_LABELS,
  CARGO_RATES,
  COAL_RATE,
  GROWTH_PER_PASSENGER,
  PASSENGER_RATE,
  STATION_CARGO_CAP,
  STATION_RADIUS,
  TOWN_MAX_POP,
  trainType,
  WOOD_RATE,
  WOOD_TO_GOODS,
} from './config';
import { addMessage, earn, getStation, spend } from './GameState';
import { CARGO_KINDS, CargoKind, GameState, Industry, Station, Town, Train } from './types';

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
  switch (kind) {
    case 'passengers':
    case 'goods':
      return townsServed(state, station).length > 0;
    case 'coal':
      return industriesServed(state, station).some((i) => i.kind === 'powerPlant');
    case 'wood':
      return industriesServed(state, station).some((i) => i.kind === 'sawmill');
  }
}

function addWaiting(station: Station, kind: CargoKind, qty: number): void {
  station.waiting[kind] = Math.min(STATION_CARGO_CAP, station.waiting[kind] + qty);
}

/** Towns emit passengers; mines emit coal; lumber camps emit wood. */
export function generateDemand(state: GameState, dtDays: number): void {
  for (const town of state.towns) {
    const covering = stationsCovering(state, town.x, town.y);
    if (covering.length === 0) continue;
    const produced = (town.population * PASSENGER_RATE * dtDays) / covering.length;
    for (const s of covering) addWaiting(s, 'passengers', produced);
  }
  for (const ind of state.industries) {
    const kind: CargoKind | null =
      ind.kind === 'coalMine' ? 'coal' : ind.kind === 'lumberCamp' ? 'wood' : null;
    if (!kind) continue;
    const rate = kind === 'coal' ? COAL_RATE : WOOD_RATE;
    const covering = stationsCovering(state, ind.x, ind.y);
    if (covering.length === 0) continue;
    const produced = (rate * dtDays) / covering.length;
    for (const s of covering) addWaiting(s, kind, produced);
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
 * pay revenue based on quantity and origin distance. Side effects of the
 * cargo chains: delivered wood becomes goods at the sawmill's station, and
 * delivered passengers grow the towns the station serves.
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
      if (batch.kind === 'wood') {
        addWaiting(station, 'goods', batch.qty * WOOD_TO_GOODS);
      } else if (batch.kind === 'passengers') {
        const towns = townsServed(state, station);
        const growth = (batch.qty * GROWTH_PER_PASSENGER) / Math.max(1, towns.length);
        for (const t of towns) {
          t.population = Math.min(TOWN_MAX_POP, t.population + growth);
        }
      }
    } else {
      kept.push(batch);
    }
  }
  train.cargo = kept;
  if (revenue > 0) {
    earn(state, revenue);
    train.earnings += revenue;
  }
  return revenue;
}

/** Load waiting cargo that some other stop on the train's route accepts. */
export function loadAtStation(state: GameState, train: Train, station: Station): void {
  const type = trainType(train.typeId);
  let space = type.capacity - cargoCount(train);
  for (const kind of CARGO_KINDS) {
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

/** Rough company valuation: cash plus asset book value, minus the loan. */
export function companyValue(state: GameState): number {
  const trackTiles = state.track.reduce((a, b) => a + b, 0);
  const trainValue = state.trains.reduce(
    (sum, t) => sum + trainType(t.typeId).cost * 0.6,
    0,
  );
  return Math.floor(
    state.cash + trackTiles * 15 + state.stations.length * 400 + trainValue - state.loan,
  );
}
