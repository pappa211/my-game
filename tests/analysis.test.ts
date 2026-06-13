import { describe, expect, it } from 'vitest';
import {
  analyzeRoute,
  cargoSinks,
  demandedHere,
  emissionRate,
  missingInputs,
  oversupply,
  processorCanRun,
  shippingOpportunities,
  unservedDemand,
} from '../src/game/Analysis';
import { MAIL_RATE, PASSENGER_RATE, MONTH_DAYS, townTier, trainType } from '../src/game/config';
import { buildStation, buildTrack, newGame } from '../src/game/GameState';
import { industryDef } from '../src/game/industries';
import { update } from '../src/game/Simulation';
import { buyTrain } from '../src/game/Trains';
import { addStation, blankState, industry, layTrackRow, town } from './helpers';

describe('emissionRate', () => {
  it('matches the live passenger/mail generation at a covering station', () => {
    const state = blankState(30, 12, [town(900, 5, 5, 'Alpha', 1000)]);
    const s = addStation(state, 6, 5, 'Alpha Station');
    expect(emissionRate(state, s, 'passengers')).toBeCloseTo(1000 * PASSENGER_RATE, 6);
    expect(emissionRate(state, s, 'mail')).toBeCloseTo(1000 * MAIL_RATE, 6);
  });

  it('splits a producer output across every covering station', () => {
    const state = blankState(30, 12, [], [industry(900, 5, 5, 'coalMine', 'Pit')]);
    const a = addStation(state, 5, 5, 'Pit A');
    const b = addStation(state, 6, 5, 'Pit B'); // also covers the mine
    // coal rate is 8/day, shared by two stations → 4 each
    expect(emissionRate(state, a, 'coal')).toBeCloseTo(4, 6);
    expect(emissionRate(state, b, 'coal')).toBeCloseTo(4, 6);
  });

  it('reports zero potential output for a processor with no inputs', () => {
    const state = blankState(30, 12, [], [industry(900, 5, 5, 'steelMill', 'Works')]);
    const s = addStation(state, 5, 5, 'Works Halt');
    expect(emissionRate(state, s, 'steel')).toBe(0);
  });
});

describe('analyzeRoute', () => {
  it('estimates a profitable, capacity-limited passenger shuttle', () => {
    const state = blankState(30, 12, [
      town(900, 5, 5, 'Alpha', 1000),
      town(901, 20, 5, 'Beta', 1000),
    ]);
    const a = addStation(state, 6, 5, 'Alpha Station');
    const b = addStation(state, 19, 5, 'Beta Station');
    layTrackRow(state, 6, 19, 5);

    const r = analyzeRoute(state, [a.id, b.id], 'american');
    expect(r.ok).toBe(true);
    expect(r.distance).toBeCloseTo(26, 6); // 13 each way
    expect(r.tripsPerMonth).toBeGreaterThan(0);
    expect(r.monthlyRevenue).toBeGreaterThan(0);
    expect(r.monthlyRunningCost).toBeCloseTo(trainType('american').runningCost * MONTH_DAYS, 6);
    // passengers + mail in both directions
    expect(r.flows.length).toBe(4);
    // 1000-pop towns out-produce a single American's capacity
    expect(r.limitedBy).toBe('capacity');
    expect(r.completesChain).toBe(false);
  });

  it('flags a disconnected route with a clear reason', () => {
    const state = blankState(30, 12, [town(900, 5, 5, 'Alpha', 800)]);
    const a = addStation(state, 6, 5, 'A');
    const b = addStation(state, 19, 5, 'B'); // no track between
    const r = analyzeRoute(state, [a.id, b.id], 'american');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no track connection/i);
  });

  it('recognises a route that completes a supply chain and warns about idle mills', () => {
    const state = blankState(30, 12, [], [
      industry(900, 5, 5, 'coalMine', 'Pit'),
      industry(901, 20, 5, 'steelMill', 'Works'),
    ]);
    const a = addStation(state, 5, 5, 'Pit Halt');
    const b = addStation(state, 19, 5, 'Works Halt');
    layTrackRow(state, 5, 19, 5);

    const r = analyzeRoute(state, [a.id, b.id], 'mogul');
    expect(r.ok).toBe(true);
    expect(r.completesChain).toBe(true);
    expect(r.chainNote).toMatch(/steel/i);
    // mill needs coal AND iron; iron is never supplied here
    expect(r.warnings.join(' ')).toMatch(/idle/i);
  });

  it('warns when no cargo can move', () => {
    const state = blankState(30, 12);
    const a = addStation(state, 5, 5, 'A');
    const b = addStation(state, 10, 5, 'B');
    layTrackRow(state, 5, 10, 5);
    const r = analyzeRoute(state, [a.id, b.id], 'american');
    expect(r.ok).toBe(true);
    expect(r.supplyPerMonth).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/no cargo/i);
  });
});

describe('opportunities and network signals', () => {
  it('lists shipping opportunities with nearby sinks', () => {
    const state = blankState(40, 12, [town(900, 30, 5, 'Beta', 700)], [
      industry(901, 5, 5, 'coalMine', 'Pit'),
      industry(902, 12, 5, 'powerPlant', 'Plant'),
    ]);
    const opps = shippingOpportunities(state, 5, 5, 3);
    const coal = opps.find((o) => o.kind === 'coal');
    expect(coal).toBeDefined();
    expect(coal!.rate).toBeGreaterThan(0);
    expect(coal!.sinks[0].name).toBe('Plant'); // nearest coal consumer
  });

  it('finds the nearest sinks for a cargo', () => {
    const state = blankState(40, 12, [], [
      industry(901, 10, 5, 'powerPlant', 'Near Plant'),
      industry(902, 35, 5, 'powerPlant', 'Far Plant'),
    ]);
    const sinks = cargoSinks(state, 'coal', 5, 5);
    expect(sinks[0].name).toBe('Near Plant');
  });

  it('reports demanded cargo at a town', () => {
    const state = blankState(30, 12, [town(900, 5, 5, 'Alpha', 600)]);
    const wants = demandedHere(state, 5, 5, 3);
    expect(wants).toContain('goods');
    expect(wants).toContain('food');
  });

  it('counts unserved demand at uncovered towns', () => {
    const state = blankState(30, 12, [town(900, 5, 5, 'Alpha', 600)]);
    const signals = unservedDemand(state);
    const goods = signals.find((s) => s.kind === 'goods');
    expect(goods?.count).toBe(1);
    expect(goods?.example).toBe('Alpha');
  });

  it('flags cargo piling up at a station', () => {
    const state = blankState(30, 12);
    const s = addStation(state, 5, 5, 'Yard'); // level 1, cap 220
    s.waiting.coal = 200; // ≥ 80% of cap
    const over = oversupply(state);
    expect(over[0].kind).toBe('coal');
    expect(over[0].pileups).toBe(1);
  });
});

describe('processor input helpers', () => {
  it('detects missing inputs for a requireAll processor', () => {
    const mill = industry(900, 5, 5, 'steelMill', 'Works');
    const def = industryDef('steelMill');
    expect(processorCanRun(mill, def)).toBe(false);
    expect(missingInputs(mill, def).sort()).toEqual(['coal', 'iron']);
    mill.stock.coal = 10;
    expect(missingInputs(mill, def)).toEqual(['iron']);
    mill.stock.iron = 10;
    expect(processorCanRun(mill, def)).toBe(true);
    expect(missingInputs(mill, def)).toEqual([]);
  });

  it('an "any input" processor is only idle when every input is missing', () => {
    const factory = industry(900, 5, 5, 'factory', 'Plant');
    const def = industryDef('factory');
    expect(missingInputs(factory, def).length).toBe(2); // both missing → idle
    factory.stock.steel = 5;
    expect(missingInputs(factory, def)).toEqual([]); // one input suffices
  });
});

describe('integration with a generated world', () => {
  // Real maps include ports (produce AND consume), multi-input mills and
  // disconnected stations — exercise the tools against that without throwing.
  it('analyses opportunities and a built route on a procedural map', () => {
    const state = newGame(7, 'steam');
    expect(state.towns.length).toBeGreaterThan(0);

    // No stations yet → every town's demand is unserved, nothing oversupplied.
    expect(unservedDemand(state).length).toBeGreaterThan(0);
    expect(oversupply(state)).toEqual([]);

    // Build a short line between the two closest towns.
    const a = state.towns[0];
    const b = [...state.towns]
      .slice(1)
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
    const sa = buildStation(state, a.x + 1, a.y);
    const sb = buildStation(state, b.x + 1, b.y);
    expect(sa.ok && sb.ok).toBe(true);

    // Opportunities at a town should be computable and finite.
    const opps = shippingOpportunities(state, a.x, a.y, 3);
    for (const o of opps) expect(Number.isFinite(o.rate)).toBe(true);

    // Lay a straight-ish connecting track and analyse the route.
    const stA = state.stations[0];
    const stB = state.stations[1];
    const x0 = Math.min(stA.x, stB.x);
    const x1 = Math.max(stA.x, stB.x);
    for (let x = x0; x <= x1; x++) buildTrack(state, x, stA.y);
    for (let y = Math.min(stA.y, stB.y); y <= Math.max(stA.y, stB.y); y++) buildTrack(state, stB.x, y);

    const r = analyzeRoute(state, [stA.id, stB.id], 'american');
    // Whether or not the hand-laid track connects, the analysis must not throw
    // and must return coherent, finite numbers.
    expect(typeof r.ok).toBe('boolean');
    expect(Number.isFinite(r.monthlyProfit)).toBe(true);
    expect(Number.isFinite(r.monthlyRevenue)).toBe(true);
    expect(r.monthlyRevenue).toBeGreaterThanOrEqual(0);

    // Run a while; analysis should stay stable as the economy drifts.
    for (let i = 0; i < 200; i++) update(state, 0.1);
    const r2 = analyzeRoute(state, [stA.id, stB.id], 'american');
    expect(Number.isFinite(r2.monthlyProfit)).toBe(true);
  });
});

describe('town tiers and monthly history', () => {
  it('larger towns climb tiers and generate more traffic', () => {
    expect(townTier(300).name).toBe('Village');
    expect(townTier(1000).name).toBe('Town');
    expect(townTier(1000).trafficMul).toBe(1.0);
    expect(townTier(3000).name).toBe('City');
    expect(townTier(3000).trafficMul).toBeGreaterThan(1.0);
    expect(townTier(6000).name).toBe('Metropolis');
  });

  it('archives per-train revenue and per-town deliveries at month rollover', () => {
    const state = blankState(30, 12, [
      town(900, 5, 5, 'Alpha', 1200),
      town(901, 22, 5, 'Beta', 1200),
    ]);
    const a = addStation(state, 6, 5, 'Alpha Station');
    const b = addStation(state, 21, 5, 'Beta Station');
    layTrackRow(state, 6, 21, 5);
    expect(buyTrain(state, 'american', [a.id, b.id]).ok).toBe(true);

    for (let i = 0; i < 800; i++) update(state, 0.05); // ~40 game days, crosses a month
    const train = state.trains[0];
    expect((train.revenueHistory ?? []).length).toBeGreaterThanOrEqual(1);
    const totalArchived = (state.towns[0].deliveryHistory ?? []).reduce((s, n) => s + n, 0)
      + (state.towns[1].deliveryHistory ?? []).reduce((s, n) => s + n, 0);
    expect(totalArchived).toBeGreaterThan(0);
  });
});
