import { cargoDef, CARGO_IDS } from './cargo';
import {
  GROWTH_PER_DELIVERY,
  MAIL_RATE,
  PASSENGER_RATE,
  stationTier,
  TOWN_MAX_POP,
  townTier,
  trainType,
} from './config';
import {
  industryAccepts,
  industryDef,
  industryInputs,
  IndustryDef,
  TOWN_DEMANDS,
} from './industries';
import { addMessage, earn, getStation, spend } from './GameState';
import { rivalPressure } from './Rivals';
import { GameState, Industry, Station, Town, Train } from './types';

function within(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= radius;
}

export function stationRadius(station: Station): number {
  return stationTier(station.level).radius;
}

/** Stations whose catchment covers (x,y). */
export function stationsCovering(state: GameState, x: number, y: number): Station[] {
  return state.stations.filter((s) => within(s.x, s.y, x, y, stationRadius(s)));
}

export function townsServed(state: GameState, station: Station): Town[] {
  const r = stationRadius(station);
  return state.towns.filter((t) => within(t.x, t.y, station.x, station.y, r));
}

export function industriesServed(state: GameState, station: Station): Industry[] {
  const r = stationRadius(station);
  return state.industries.filter((i) => within(i.x, i.y, station.x, station.y, r));
}

/** Whether delivering this cargo at this station earns revenue. */
export function stationAccepts(state: GameState, station: Station, kind: string): boolean {
  if (TOWN_DEMANDS.includes(kind) && townsServed(state, station).length > 0) return true;
  return industriesServed(state, station).some((i) => industryAccepts(industryDef(i.kind), kind));
}

function addWaiting(station: Station, kind: string, qty: number): void {
  const cap = stationTier(station.level).cargoCap;
  station.waiting[kind] = Math.min(cap, (station.waiting[kind] ?? 0) + qty);
}

/** Deposit produced cargo into every covering station, split evenly. */
function deposit(state: GameState, x: number, y: number, kind: string, qty: number): void {
  if (qty <= 0) return;
  const covering = stationsCovering(state, x, y);
  if (covering.length === 0) return;
  const each = qty / covering.length;
  for (const s of covering) addWaiting(s, kind, each);
}

function processIndustry(state: GameState, ind: Industry, def: IndustryDef, dtDays: number): void {
  const recipe = def.recipe;
  if (!recipe) return;
  let produced = 0;
  const budget = recipe.rate * dtDays;
  if (recipe.requireAll) {
    let limit = budget;
    for (const inp of recipe.inputs) {
      limit = Math.min(limit, (ind.stock[inp.cargo] ?? 0) / inp.per);
    }
    produced = Math.max(0, limit);
    for (const inp of recipe.inputs) ind.stock[inp.cargo] -= produced * inp.per;
  } else {
    let left = budget;
    for (const inp of recipe.inputs) {
      if (left <= 0) break;
      const possible = (ind.stock[inp.cargo] ?? 0) / inp.per;
      const make = Math.min(possible, left);
      if (make <= 0) continue;
      ind.stock[inp.cargo] -= make * inp.per;
      produced += make;
      left -= make;
    }
  }
  if (produced > 0) deposit(state, ind.x, ind.y, recipe.output, produced);
  // smoothed activity for display
  const ratio = budget > 0 ? produced / budget : 0;
  ind.activity += (ratio - ind.activity) * Math.min(1, dtDays);
}

/** Towns emit people/mail; primary industries emit raw cargo; processors convert. */
export function generateProduction(state: GameState, dtDays: number): void {
  for (const town of state.towns) {
    // A contested town the player has not yet connected loses traffic to a rival.
    let factor = 1;
    const pressure = rivalPressure(state, town.id);
    if (pressure > 0 && stationsCovering(state, town.x, town.y).length === 0) {
      factor = 1 - pressure;
    }
    // Larger towns generate proportionally more traffic (tier multiplier).
    const mul = townTier(town.population).trafficMul;
    deposit(state, town.x, town.y, 'passengers', town.population * PASSENGER_RATE * dtDays * factor * mul);
    deposit(state, town.x, town.y, 'mail', town.population * MAIL_RATE * dtDays * factor * mul);
    // service decays slowly; deliveries push it back up
    town.serviceLevel = Math.max(0, town.serviceLevel - 0.02 * dtDays);
  }
  for (const ind of state.industries) {
    const def = industryDef(ind.kind);
    for (const p of def.produces ?? []) {
      deposit(state, ind.x, ind.y, p.cargo, p.rate * dtDays);
    }
    if (def.recipe) processIndustry(state, ind, def, dtDays);
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
 * Unload every batch this station accepts (except batches loaded here) and pay
 * revenue based on quantity, haul distance and the current economy. Delivered
 * inputs feed the served industry's stockpile; delivered town-demand grows the
 * town.
 */
export function unloadAtStation(state: GameState, train: Train, station: Station): number {
  let revenue = 0;
  const kept = [];
  const served = industriesServed(state, station);
  for (const batch of train.cargo) {
    if (batch.origin === station.id || !stationAccepts(state, station, batch.kind)) {
      kept.push(batch);
      continue;
    }
    const origin = getStation(state, batch.origin);
    const dist = origin ? Math.abs(origin.x - station.x) + Math.abs(origin.y - station.y) : 0;
    const def = cargoDef(batch.kind);
    const pay = Math.round(batch.qty * (def.base + def.perTile * dist) * state.economy);
    revenue += pay;
    addMessage(state, `${train.name} delivered ${batch.qty} ${def.label.toLowerCase()} to ${station.name} (+$${pay})`, 'money');

    // feed an industry that consumes this cargo, else it is town demand
    const consumer = served.find((i) => industryInputs(industryDef(i.kind)).includes(batch.kind));
    if (consumer) {
      consumer.stock[batch.kind] = (consumer.stock[batch.kind] ?? 0) + batch.qty;
    } else {
      const towns = townsServed(state, station);
      const growth = (batch.qty * GROWTH_PER_DELIVERY) / Math.max(1, towns.length);
      const each = batch.qty / Math.max(1, towns.length);
      for (const t of towns) {
        t.population = Math.min(TOWN_MAX_POP, t.population + growth);
        t.serviceLevel = Math.min(1, t.serviceLevel + 0.05);
        t.deliveredThisMonth = (t.deliveredThisMonth ?? 0) + each;
      }
    }
  }
  train.cargo = kept;
  if (revenue > 0) {
    earn(state, revenue);
    train.earnings += revenue;
    train.monthRevenue = (train.monthRevenue ?? 0) + revenue;
  }
  return revenue;
}

/** Load waiting cargo that some other stop on the train's route accepts. */
export function loadAtStation(state: GameState, train: Train, station: Station): void {
  const type = trainType(train.typeId);
  let space = type.capacity - cargoCount(train);
  for (const kind of CARGO_IDS) {
    if (space <= 0) break;
    const deliverable = train.stops.some((id) => {
      if (id === station.id) return false;
      const other = getStation(state, id);
      return other !== undefined && stationAccepts(state, other, kind);
    });
    if (!deliverable) continue;
    const qty = Math.min(Math.floor(station.waiting[kind] ?? 0), space);
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
  const trainValue = state.trains.reduce((sum, t) => sum + trainType(t.typeId).cost * 0.6, 0);
  const stationValue = state.stations.reduce(
    (sum, s) => sum + stationTier(s.level).cost * 0.7,
    0,
  );
  return Math.floor(state.cash + trackTiles * 15 + stationValue + trainValue - state.loan);
}
