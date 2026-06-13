// Player-facing decision tools, kept pure (no DOM) so they stay unit-testable.
//
// The economy already simulates cargo demand, distance revenue, running costs,
// reliability, stockpiles and multi-stage chains. This module reads that state
// and answers the questions a railroad baron actually asks:
//   - Will this route make money, and why / why not?
//   - What should I haul from here, and where is the unmet demand?
//   - Which processors are idle for want of inputs?
// Everything here is an *estimate* derived from the same constants the live
// simulation uses, so previews line up with what actually happens.

import { cargoDef, CARGO_IDS } from './cargo';
import {
  BREAKDOWN_SCALE,
  LOAD_DAYS,
  MAIL_RATE,
  MONTH_DAYS,
  PASSENGER_RATE,
  REPAIR_COST,
  stationTier,
  townTier,
  trainType,
} from './config';
import { getStation } from './GameState';
import {
  industryDef,
  industryInputs,
  IndustryDef,
  TOWN_DEMANDS,
} from './industries';
import { findPath, pathLength } from './Pathfinding';
import { stationAccepts, stationsCovering } from './Economy';
import { GameState, Industry, Station } from './types';

const EPS = 0.001;

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** How many stations currently share (and thus split) a producer's output. */
function coveringCount(state: GameState, x: number, y: number): number {
  return Math.max(1, stationsCovering(state, x, y).length);
}

/** Whether a processor can currently produce (its inputs are in stock). */
export function processorCanRun(ind: Industry, def: IndustryDef): boolean {
  const recipe = def.recipe;
  if (!recipe) return false;
  if (recipe.requireAll) {
    return recipe.inputs.every((i) => (ind.stock[i.cargo] ?? 0) > EPS);
  }
  return recipe.inputs.some((i) => (ind.stock[i.cargo] ?? 0) > EPS);
}

/** Recipe inputs a processor is currently missing (drives "idle" warnings). */
export function missingInputs(ind: Industry, def: IndustryDef): string[] {
  const recipe = def.recipe;
  if (!recipe) return [];
  const empty = recipe.inputs.filter((i) => (ind.stock[i.cargo] ?? 0) <= EPS);
  if (recipe.requireAll) return empty.map((i) => i.cargo);
  // "any input" processors are only idle when every input is missing
  return empty.length === recipe.inputs.length ? empty.map((i) => i.cargo) : [];
}

/**
 * Units/day of `kind` that accumulate at this station from covered producers,
 * matching the live deposit split. Processor output counts only when the
 * processor actually has inputs, so estimates don't promise phantom cargo.
 */
export function emissionRate(state: GameState, station: Station, kind: string): number {
  const r = stationTier(station.level).radius;
  let rate = 0;
  for (const town of state.towns) {
    if (chebyshev(town.x, town.y, station.x, station.y) > r) continue;
    const mul = townTier(town.population).trafficMul;
    const share = 1 / coveringCount(state, town.x, town.y);
    if (kind === 'passengers') rate += town.population * PASSENGER_RATE * mul * share;
    else if (kind === 'mail') rate += town.population * MAIL_RATE * mul * share;
  }
  for (const ind of state.industries) {
    if (chebyshev(ind.x, ind.y, station.x, station.y) > r) continue;
    const def = industryDef(ind.kind);
    const share = 1 / coveringCount(state, ind.x, ind.y);
    for (const p of def.produces ?? []) {
      if (p.cargo === kind) rate += p.rate * share;
    }
    if (def.recipe && def.recipe.output === kind && processorCanRun(ind, def)) {
      rate += def.recipe.rate * share;
    }
  }
  return rate;
}

export interface CargoFlow {
  kind: string;
  fromId: number;
  toId: number;
  fromName: string;
  toName: string;
  /** delivered units per month after the capacity constraint is applied */
  unitsPerMonth: number;
  /** Manhattan haul distance used by the revenue formula */
  distance: number;
  revenue: number;
}

export interface RouteAnalysis {
  ok: boolean;
  reason?: string;
  distance: number;
  tripDays: number;
  tripsPerMonth: number;
  monthlyRevenue: number;
  monthlyRunningCost: number;
  monthlyRepairCost: number;
  monthlyProfit: number;
  capacityPerMonth: number;
  supplyPerMonth: number;
  limitedBy: 'supply' | 'capacity' | 'none';
  flows: CargoFlow[];
  completesChain: boolean;
  chainNote?: string;
  warnings: string[];
}

const EMPTY_ANALYSIS = (reason: string): RouteAnalysis => ({
  ok: false,
  reason,
  distance: 0,
  tripDays: 0,
  tripsPerMonth: 0,
  monthlyRevenue: 0,
  monthlyRunningCost: 0,
  monthlyRepairCost: 0,
  monthlyProfit: 0,
  capacityPerMonth: 0,
  supplyPerMonth: 0,
  limitedBy: 'none',
  flows: [],
  completesChain: false,
  warnings: [],
});

/** The next stop after index `i` (looping) that accepts `kind`, or -1. */
function nextAccepting(state: GameState, stops: Station[], i: number, kind: string): number {
  for (let off = 1; off < stops.length; off++) {
    const j = (i + off) % stops.length;
    if (stationAccepts(state, stops[j], kind)) return j;
  }
  return -1;
}

/**
 * Estimate the monthly economics of running `typeId` over `stops` (a loop).
 * The binding constraint — too little cargo, or too little train — is the
 * single most useful thing this surfaces.
 */
export function analyzeRoute(state: GameState, stops: number[], typeId: string): RouteAnalysis {
  if (stops.length < 2) return EMPTY_ANALYSIS('A route needs at least 2 stations.');
  if (new Set(stops).size !== stops.length) {
    return EMPTY_ANALYSIS('Each station may appear only once in a route.');
  }
  const stations = stops.map((id) => getStation(state, id));
  if (stations.some((s) => !s)) return EMPTY_ANALYSIS('Route references a missing station.');
  const sts = stations as Station[];
  const type = trainType(typeId);

  const warnings: string[] = [];
  let distance = 0;
  for (let i = 0; i < sts.length; i++) {
    const a = sts[i];
    const b = sts[(i + 1) % sts.length];
    const path = findPath(state, a.x, a.y, b.x, b.y);
    if (!path) {
      return {
        ...EMPTY_ANALYSIS(`No track connection between ${a.name} and ${b.name}.`),
        warnings: [`Lay track to connect ${a.name} and ${b.name}.`],
      };
    }
    distance += pathLength(path);
  }

  const tripDays = distance / type.speed + sts.length * LOAD_DAYS;
  const tripsPerMonth = tripDays > 0 ? MONTH_DAYS / tripDays : 0;

  // Collect every deliverable (source stop, cargo) → first accepting stop.
  interface Raw { kind: string; from: number; to: number; supply: number; dist: number; }
  const raws: Raw[] = [];
  const emitsHere = sts.map(() => false);
  const acceptsHere = sts.map(() => false);
  for (let i = 0; i < sts.length; i++) {
    for (const kind of CARGO_IDS) {
      const r = emissionRate(state, sts[i], kind);
      if (r <= EPS) continue;
      const j = nextAccepting(state, sts, i, kind);
      if (j < 0) continue; // produced, but nowhere on this route wants it
      emitsHere[i] = true;
      acceptsHere[j] = true;
      raws.push({
        kind,
        from: i,
        to: j,
        supply: r * MONTH_DAYS,
        dist: manhattan(sts[i].x, sts[i].y, sts[j].x, sts[j].y),
      });
    }
  }

  const supplyPerMonth = raws.reduce((s, r) => s + r.supply, 0);
  const capacityPerMonth = type.capacity * tripsPerMonth;
  const scale = supplyPerMonth > capacityPerMonth && supplyPerMonth > 0
    ? capacityPerMonth / supplyPerMonth
    : 1;
  const limitedBy: RouteAnalysis['limitedBy'] =
    supplyPerMonth <= EPS ? 'none' : scale < 1 ? 'capacity' : 'supply';

  const flows: CargoFlow[] = raws.map((r) => {
    const def = cargoDef(r.kind);
    const units = r.supply * scale;
    return {
      kind: r.kind,
      fromId: sts[r.from].id,
      toId: sts[r.to].id,
      fromName: sts[r.from].name,
      toName: sts[r.to].name,
      unitsPerMonth: units,
      distance: r.dist,
      revenue: units * (def.base + def.perTile * r.dist) * state.economy,
    };
  });
  flows.sort((a, b) => b.revenue - a.revenue);

  const monthlyRevenue = flows.reduce((s, f) => s + f.revenue, 0);
  const monthlyRunningCost = type.runningCost * MONTH_DAYS;
  const movingDaysPerMonth = tripsPerMonth * (distance / type.speed);
  const breakdownsPerMonth = ((1 - type.reliability) / BREAKDOWN_SCALE) * movingDaysPerMonth;
  const monthlyRepairCost = breakdownsPerMonth * REPAIR_COST;
  const monthlyProfit = monthlyRevenue - monthlyRunningCost - monthlyRepairCost;

  // Does the route feed a processor (complete a chain link)?
  let completesChain = false;
  let chainNote: string | undefined;
  for (const f of flows) {
    const dest = getStation(state, f.toId);
    if (!dest) continue;
    const r = stationTier(dest.level).radius;
    const processor = state.industries.find(
      (ind) =>
        chebyshev(ind.x, ind.y, dest.x, dest.y) <= r &&
        industryDef(ind.kind).recipe &&
        industryInputs(industryDef(ind.kind)).includes(f.kind),
    );
    if (processor) {
      completesChain = true;
      const out = industryDef(processor.kind).recipe!.output;
      chainNote = `Feeds ${processor.name}: ${cargoDef(f.kind).label.toLowerCase()} → ${cargoDef(out).label.toLowerCase()}.`;
      break;
    }
  }

  // Warnings — the "why not" half of the decision.
  if (supplyPerMonth <= EPS) {
    warnings.push('No cargo will move on this route — no stop produces what another stop accepts.');
  }
  for (let i = 0; i < sts.length; i++) {
    if (!emitsHere[i] && !acceptsHere[i]) {
      warnings.push(`${sts[i].name} adds nothing — it neither ships nor receives cargo on this route.`);
    }
  }
  // Processors on the route that are currently starved of inputs.
  for (const s of sts) {
    const r = stationTier(s.level).radius;
    for (const ind of state.industries) {
      if (chebyshev(ind.x, ind.y, s.x, s.y) > r) continue;
      const def = industryDef(ind.kind);
      if (!def.recipe) continue;
      const miss = missingInputs(ind, def);
      if (miss.length > 0) {
        warnings.push(`${ind.name} is idle — needs ${miss.map((m) => cargoDef(m).label.toLowerCase()).join(' and ')}.`);
      }
    }
  }
  if (limitedBy === 'capacity' && scale < 0.6) {
    warnings.push('Cargo is piling up faster than this train can clear it — add another train or buy a higher-capacity engine.');
  } else if (limitedBy === 'supply' && supplyPerMonth > 0 && capacityPerMonth > supplyPerMonth * 2.2) {
    warnings.push('This engine is far larger than the cargo on offer — a cheaper, smaller engine would lift the same freight.');
  }

  return {
    ok: true,
    distance,
    tripDays,
    tripsPerMonth,
    monthlyRevenue,
    monthlyRunningCost,
    monthlyRepairCost,
    monthlyProfit,
    capacityPerMonth,
    supplyPerMonth,
    limitedBy,
    flows,
    completesChain,
    chainNote,
    warnings: [...new Set(warnings)],
  };
}

export interface Opportunity {
  kind: string;
  /** units/day available within reach */
  rate: number;
  /** nearest places that pay for this cargo */
  sinks: { name: string; distance: number }[];
}

/** Nearest destinations (towns or industries) that pay to receive `kind`. */
export function cargoSinks(
  state: GameState,
  kind: string,
  x: number,
  y: number,
  max = 3,
): { name: string; distance: number }[] {
  const sinks: { name: string; distance: number }[] = [];
  if (TOWN_DEMANDS.includes(kind)) {
    for (const t of state.towns) {
      sinks.push({ name: t.name, distance: manhattan(t.x, t.y, x, y) });
    }
  }
  for (const ind of state.industries) {
    if (industryInputs(industryDef(ind.kind)).includes(kind)) {
      sinks.push({ name: ind.name, distance: manhattan(ind.x, ind.y, x, y) });
    }
  }
  return sinks.sort((a, b) => a.distance - b.distance).slice(0, max);
}

/**
 * What a station (or a prospective station at a point) could profitably ship:
 * every cargo produced within `radius`, paired with where it could go. Drives
 * the "recommended cargo opportunities" hint on the inspector.
 */
export function shippingOpportunities(
  state: GameState,
  x: number,
  y: number,
  radius: number,
): Opportunity[] {
  const rates: Record<string, number> = {};
  for (const town of state.towns) {
    if (chebyshev(town.x, town.y, x, y) > radius) continue;
    const mul = townTier(town.population).trafficMul;
    rates.passengers = (rates.passengers ?? 0) + town.population * PASSENGER_RATE * mul;
    rates.mail = (rates.mail ?? 0) + town.population * MAIL_RATE * mul;
  }
  for (const ind of state.industries) {
    if (chebyshev(ind.x, ind.y, x, y) > radius) continue;
    const def = industryDef(ind.kind);
    for (const p of def.produces ?? []) rates[p.cargo] = (rates[p.cargo] ?? 0) + p.rate;
    if (def.recipe) rates[def.recipe.output] = (rates[def.recipe.output] ?? 0) + def.recipe.rate;
  }
  const out: Opportunity[] = [];
  for (const kind of CARGO_IDS) {
    const rate = rates[kind] ?? 0;
    if (rate <= EPS) continue;
    out.push({ kind, rate, sinks: cargoSinks(state, kind, x, y) });
  }
  return out.sort((a, b) => b.rate - a.rate);
}

/** Cargo a station (or point) demands but cannot yet receive locally. */
export function demandedHere(state: GameState, x: number, y: number, radius: number): string[] {
  const kinds = new Set<string>();
  for (const town of state.towns) {
    if (chebyshev(town.x, town.y, x, y) > radius) continue;
    for (const d of TOWN_DEMANDS) kinds.add(d);
  }
  for (const ind of state.industries) {
    if (chebyshev(ind.x, ind.y, x, y) > radius) continue;
    for (const i of industryInputs(industryDef(ind.kind))) kinds.add(i);
  }
  return CARGO_IDS.filter((k) => kinds.has(k));
}

export interface NetworkSignal {
  kind: string;
  /** count of demand sinks the network can't reach (unserved) */
  count: number;
  example?: string;
}

/** Demand points (towns / industries) with no station in catchment, per cargo. */
export function unservedDemand(state: GameState): NetworkSignal[] {
  const covered = (x: number, y: number) => stationsCovering(state, x, y).length > 0;
  const tally: Record<string, { count: number; example?: string }> = {};
  const bump = (kind: string, name: string) => {
    const t = (tally[kind] ??= { count: 0 });
    t.count += 1;
    if (!t.example) t.example = name;
  };
  for (const town of state.towns) {
    if (covered(town.x, town.y)) continue;
    for (const d of TOWN_DEMANDS) bump(d, town.name);
  }
  for (const ind of state.industries) {
    if (covered(ind.x, ind.y)) continue;
    for (const i of industryInputs(industryDef(ind.kind))) bump(i, ind.name);
  }
  return Object.entries(tally)
    .map(([kind, t]) => ({ kind, count: t.count, example: t.example }))
    .sort((a, b) => b.count - a.count);
}

export interface OversupplySignal {
  kind: string;
  waiting: number;
  /** stations where this cargo is stacked near capacity */
  pileups: number;
}

/** Cargo stacking up at stations (produced, but nothing is hauling it away). */
export function oversupply(state: GameState): OversupplySignal[] {
  const tally: Record<string, { waiting: number; pileups: number }> = {};
  for (const s of state.stations) {
    const cap = stationTier(s.level).cargoCap;
    for (const kind of CARGO_IDS) {
      const w = s.waiting[kind] ?? 0;
      if (w <= EPS) continue;
      const t = (tally[kind] ??= { waiting: 0, pileups: 0 });
      t.waiting += w;
      if (w >= cap * 0.8) t.pileups += 1;
    }
  }
  return Object.entries(tally)
    .map(([kind, t]) => ({ kind, waiting: t.waiting, pileups: t.pileups }))
    .filter((s) => s.pileups > 0)
    .sort((a, b) => b.waiting - a.waiting);
}
