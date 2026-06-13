import { describe, expect, it } from 'vitest';
import {
  GROWTH_PER_PASSENGER,
  LOAN_MAX,
  LOAN_STEP,
  TRACK_COST,
  TRAIN_SELL_FACTOR,
  WOOD_TO_GOODS,
  trainType,
} from '../src/game/config';
import { stationAccepts, unloadAtStation } from '../src/game/Economy';
import {
  buildTrack,
  repayLoan,
  takeLoan,
  tileIndex,
} from '../src/game/GameState';
import { findPath, pathLength } from '../src/game/Pathfinding';
import { update } from '../src/game/Simulation';
import { Terrain, Train } from '../src/game/types';
import { buyTrain, sellTrain } from '../src/game/Trains';
import { addStation, blankState, layTrackRow } from './helpers';

function makeTrain(state: ReturnType<typeof blankState>, stops: number[]): Train {
  const train: Train = {
    id: state.nextId++,
    name: 'Test Train',
    typeId: 'local',
    stops,
    atStationId: stops[0],
    targetStationId: null,
    path: [{ x: 0, y: 0 }],
    pathPos: 0,
    state: 'loading',
    loadTimer: 0.4,
    cargo: [],
    earnings: 0,
    x: 0,
    y: 0,
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

  it('trains can cross a bridge between stations', () => {
    const state = blankState(30, 12);
    for (let x = 8; x <= 12; x++) state.map.terrain[tileIndex(state.map, x, 5)] = Terrain.Water;
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    for (let x = 4; x <= 18; x++) state.track[tileIndex(state.map, x, 5)] = 1;
    expect(findPath(state, 3, 5, 19, 5)).not.toBeNull();
    expect(buyTrain(state, 'local', [a.id, b.id]).ok).toBe(true);
  });
});

describe('Diagonal track', () => {
  it('finds and prefers a diagonal path when one exists', () => {
    const state = blankState();
    addStation(state, 2, 2, 'A');
    addStation(state, 6, 6, 'B');
    // a staircase of track tiles — only diagonal steps connect them
    for (let i = 3; i <= 5; i++) state.track[tileIndex(state.map, i, i)] = 1;
    const path = findPath(state, 2, 2, 6, 6);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5); // pure diagonal: (2,2)..(6,6)
    expect(pathLength(path!)).toBeCloseTo(4 * Math.SQRT2, 6);
  });

  it('shortest-path beats a longer orthogonal detour', () => {
    const state = blankState();
    addStation(state, 2, 2, 'A');
    addStation(state, 5, 5, 'B');
    // both a diagonal and an L-shaped connection exist
    for (let i = 3; i <= 4; i++) state.track[tileIndex(state.map, i, i)] = 1;
    layTrackRow(state, 3, 5, 2);
    for (let y = 3; y <= 4; y++) state.track[tileIndex(state.map, 5, y)] = 1;
    const path = findPath(state, 2, 2, 5, 5);
    expect(pathLength(path!)).toBeCloseTo(3 * Math.SQRT2, 6);
  });

  it('trains move at the same ground speed on diagonals', () => {
    const state = blankState(30, 30);
    const a = addStation(state, 2, 2, 'A');
    const b = addStation(state, 12, 12, 'B');
    for (let i = 3; i <= 11; i++) state.track[tileIndex(state.map, i, i)] = 1;
    expect(buyTrain(state, 'local', [a.id, b.id]).ok).toBe(true);
    const train = state.trains[0];
    // get the train rolling (finish loading), then measure one day of travel
    update(state, 0.5);
    expect(train.state).toBe('moving');
    const x0 = train.x;
    const y0 = train.y;
    update(state, 1);
    const moved = Math.hypot(train.x - x0, train.y - y0);
    expect(moved).toBeCloseTo(trainType('local').speed, 1);
  });
});

describe('Wood → goods chain', () => {
  it('sawmill stations accept wood and emit goods on delivery', () => {
    const state = blankState(30, 12, [], [
      { id: 900, x: 20, y: 5, kind: 'sawmill', name: 'Mill' },
    ]);
    const a = addStation(state, 3, 5, 'Camp Halt');
    const b = addStation(state, 19, 5, 'Mill Halt');
    expect(stationAccepts(state, b, 'wood')).toBe(true);
    expect(stationAccepts(state, b, 'goods')).toBe(false); // no town nearby

    const train = makeTrain(state, [a.id, b.id]);
    train.cargo = [{ kind: 'wood', qty: 20, origin: a.id }];
    const revenue = unloadAtStation(state, train, b);
    expect(revenue).toBeGreaterThan(0);
    expect(train.earnings).toBe(revenue);
    expect(b.waiting.goods).toBeCloseTo(20 * WOOD_TO_GOODS, 6);
  });

  it('towns accept goods', () => {
    const state = blankState(30, 12, [
      { id: 900, x: 20, y: 5, name: 'Alpha', population: 500 },
    ]);
    const s = addStation(state, 19, 5, 'Alpha Station');
    expect(stationAccepts(state, s, 'goods')).toBe(true);
  });
});

describe('Town growth', () => {
  it('delivered passengers grow the destination town', () => {
    const state = blankState(30, 12, [
      { id: 900, x: 2, y: 5, name: 'Alpha', population: 500 },
      { id: 901, x: 20, y: 5, name: 'Beta', population: 500 },
    ]);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    const train = makeTrain(state, [a.id, b.id]);
    train.cargo = [{ kind: 'passengers', qty: 30, origin: a.id }];
    unloadAtStation(state, train, b);
    const beta = state.towns[1];
    expect(beta.population).toBeCloseTo(500 + 30 * GROWTH_PER_PASSENGER, 6);
  });
});

describe('Loans', () => {
  it('borrowing adds cash and principal up to the limit', () => {
    const state = blankState();
    const cashBefore = state.cash;
    expect(takeLoan(state).ok).toBe(true);
    expect(state.cash).toBe(cashBefore + LOAN_STEP);
    expect(state.loan).toBe(LOAN_STEP);
    while (state.loan < LOAN_MAX) expect(takeLoan(state).ok).toBe(true);
    expect(takeLoan(state).ok).toBe(false);
  });

  it('repaying reduces principal and requires cash', () => {
    const state = blankState();
    takeLoan(state);
    expect(repayLoan(state).ok).toBe(true);
    expect(state.loan).toBe(0);
    expect(repayLoan(state).ok).toBe(false); // nothing left to repay
    takeLoan(state);
    state.cash = 10;
    expect(repayLoan(state).ok).toBe(false); // can't afford
    expect(state.loan).toBe(LOAN_STEP);
  });

  it('charges monthly interest while a loan is outstanding', () => {
    const state = blankState();
    takeLoan(state);
    const cashBefore = state.cash;
    update(state, 31); // cross a month boundary
    expect(state.cash).toBeLessThan(cashBefore);
    expect(state.finances.history.length).toBe(1);
  });
});

describe('Selling trains', () => {
  it('refunds a fraction of the purchase price and removes the train', () => {
    const state = blankState(30, 12);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    layTrackRow(state, 4, 18, 5);
    const bought = buyTrain(state, 'heavy', [a.id, b.id]);
    expect(bought.ok).toBe(true);
    const cashBefore = state.cash;
    const result = sellTrain(state, bought.train!.id);
    expect(result.ok).toBe(true);
    expect(state.trains).toHaveLength(0);
    expect(state.cash).toBe(cashBefore + Math.round(trainType('heavy').cost * TRAIN_SELL_FACTOR));
  });
});
