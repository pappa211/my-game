import { describe, expect, it } from 'vitest';
import {
  GROWTH_PER_DELIVERY,
  stationTier,
  TRACK_COST,
  TRAIN_SELL_FACTOR,
  trainType,
} from '../src/game/config';
import { generateProduction, stationAccepts, stationRadius, unloadAtStation } from '../src/game/Economy';
import {
  buildTrack,
  buildStation,
  loanLimit,
  repayLoan,
  takeLoan,
  tileIndex,
  upgradeStation,
} from '../src/game/GameState';
import { findPath, pathLength } from '../src/game/Pathfinding';
import { update } from '../src/game/Simulation';
import { Terrain, Train } from '../src/game/types';
import { buyTrain, sellTrain } from '../src/game/Trains';
import { addStation, blankState, industry, layTrackRow, town } from './helpers';

function makeTrain(state: ReturnType<typeof blankState>, stops: number[], cargo: Train['cargo'] = []): Train {
  const train: Train = {
    id: state.nextId++, name: 'T', typeId: 'american', stops,
    atStationId: stops[0], targetStationId: null, path: [{ x: 0, y: 0 }], pathPos: 0,
    state: 'loading', loadTimer: 0.4, cargo, earnings: 0, builtDay: 0, x: 0, y: 0,
  };
  state.trains.push(train);
  return train;
}

describe('Bridges', () => {
  it('allows track over water at the bridge cost', () => {
    const state = blankState();
    state.map.terrain[tileIndex(state.map, 5, 5)] = Terrain.Water;
    const cashBefore = state.cash;
    const result = buildTrack(state, 5, 5);
    expect(result.ok).toBe(true);
    expect(result.cost).toBe(TRACK_COST[Terrain.Water]);
    expect(state.cash).toBe(cashBefore - TRACK_COST[Terrain.Water]);
  });
});

describe('Diagonal track', () => {
  it('finds a pure diagonal path with √2 step cost', () => {
    const state = blankState();
    addStation(state, 2, 2, 'A');
    addStation(state, 6, 6, 'B');
    for (let i = 3; i <= 5; i++) state.track[tileIndex(state.map, i, i)] = 1;
    const path = findPath(state, 2, 2, 6, 6);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(pathLength(path!)).toBeCloseTo(4 * Math.SQRT2, 6);
  });

  it('trains move at ground speed on diagonals', () => {
    const state = blankState(30, 30);
    const a = addStation(state, 2, 2, 'A');
    const b = addStation(state, 12, 12, 'B');
    for (let i = 3; i <= 11; i++) state.track[tileIndex(state.map, i, i)] = 1;
    expect(buyTrain(state, 'american', [a.id, b.id]).ok).toBe(true);
    const train = state.trains[0];
    update(state, 0.5);
    expect(train.state).toBe('moving');
    const x0 = train.x, y0 = train.y;
    update(state, 1);
    const moved = Math.hypot(train.x - x0, train.y - y0);
    expect(moved).toBeGreaterThan(trainType('american').speed * 0.6);
  });
});

describe('Supply chains', () => {
  it('a steel mill turns delivered coal + iron into steel', () => {
    const state = blankState(30, 12, [], [industry(900, 20, 5, 'steelMill', 'Mill')]);
    const a = addStation(state, 3, 5, 'Pit');
    const b = addStation(state, 19, 5, 'Mill Halt');
    expect(stationAccepts(state, b, 'coal')).toBe(true);
    expect(stationAccepts(state, b, 'iron')).toBe(true);

    const train = makeTrain(state, [a.id, b.id], [
      { kind: 'coal', qty: 20, origin: a.id },
      { kind: 'iron', qty: 20, origin: a.id },
    ]);
    const revenue = unloadAtStation(state, train, b);
    expect(revenue).toBeGreaterThan(0);
    const mill = state.industries[0];
    expect(mill.stock.coal).toBe(20);
    expect(mill.stock.iron).toBe(20);

    generateProduction(state, 1);
    expect(b.waiting.steel).toBeGreaterThan(0);
    expect(mill.stock.coal).toBeLessThan(20);
  });

  it('a food mill accepts either grain or livestock', () => {
    const state = blankState(30, 12, [], [industry(900, 20, 5, 'mill', 'Mill')]);
    const a = addStation(state, 3, 5, 'Farm');
    const b = addStation(state, 19, 5, 'Mill Halt');
    expect(stationAccepts(state, b, 'grain')).toBe(true);
    expect(stationAccepts(state, b, 'livestock')).toBe(true);
    const train = makeTrain(state, [a.id, b.id], [{ kind: 'grain', qty: 14, origin: a.id }]);
    unloadAtStation(state, train, b);
    generateProduction(state, 1);
    expect(b.waiting.food).toBeGreaterThan(0);
  });

  it('a power plant pays for coal but produces nothing', () => {
    const state = blankState(30, 12, [], [industry(900, 20, 5, 'powerPlant', 'Power')]);
    const a = addStation(state, 3, 5, 'Pit');
    const b = addStation(state, 19, 5, 'Plant');
    const train = makeTrain(state, [a.id, b.id], [{ kind: 'coal', qty: 30, origin: a.id }]);
    const cashBefore = state.cash;
    const revenue = unloadAtStation(state, train, b);
    expect(revenue).toBeGreaterThan(0);
    expect(state.cash).toBe(cashBefore + revenue);
    generateProduction(state, 1);
    expect(b.waiting.steel ?? 0).toBe(0);
  });
});

describe('Town growth', () => {
  it('delivered food grows the destination town', () => {
    const state = blankState(30, 12, [town(900, 20, 5, 'Beta', 600)]);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    expect(stationAccepts(state, b, 'food')).toBe(true);
    const train = makeTrain(state, [a.id, b.id], [{ kind: 'food', qty: 20, origin: a.id }]);
    unloadAtStation(state, train, b);
    const beta = state.towns[0];
    expect(beta.population).toBeCloseTo(600 + 20 * GROWTH_PER_DELIVERY, 6);
    expect(beta.serviceLevel).toBeGreaterThan(0);
  });
});

describe('Stations', () => {
  it('upgrading a station raises its tier, radius and charges the difference', () => {
    const state = blankState(30, 30);
    const r = buildStation(state, 10, 10);
    expect(r.ok).toBe(true);
    const st = state.stations[0];
    const before = stationRadius(st);
    const cashBefore = state.cash;
    expect(upgradeStation(state, st.id).ok).toBe(true);
    expect(stationRadius(st)).toBeGreaterThan(before);
    const diff = stationTier(2).cost - stationTier(1).cost;
    expect(state.cash).toBe(cashBefore - diff);
  });
});

describe('Finance', () => {
  it('bonds add cash up to a value-scaled limit and can be repaid', () => {
    const state = blankState();
    expect(loanLimit(state)).toBeGreaterThanOrEqual(30000);
    const cashBefore = state.cash;
    expect(takeLoan(state).ok).toBe(true);
    expect(state.cash).toBe(cashBefore + 5000);
    expect(state.loan).toBe(5000);
    expect(repayLoan(state).ok).toBe(true);
    expect(state.loan).toBe(0);
  });
});

describe('Locomotive eras', () => {
  it('rejects engines not yet invented and allows period-appropriate ones', () => {
    const state = blankState(30, 12);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    layTrackRow(state, 4, 18, 5);
    expect(buyTrain(state, 'electric', [a.id, b.id]).reason).toMatch(/not available/i);
    expect(buyTrain(state, 'american', [a.id, b.id]).ok).toBe(true);
  });
});

describe('Selling trains', () => {
  it('refunds a fraction of the purchase price and removes the train', () => {
    const state = blankState(30, 12);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    layTrackRow(state, 4, 18, 5);
    const bought = buyTrain(state, 'mogul', [a.id, b.id]);
    expect(bought.ok).toBe(true);
    const cashBefore = state.cash;
    expect(sellTrain(state, bought.train!.id).ok).toBe(true);
    expect(state.trains).toHaveLength(0);
    expect(state.cash).toBe(cashBefore + Math.round(trainType('mogul').cost * TRAIN_SELL_FACTOR));
  });
});
