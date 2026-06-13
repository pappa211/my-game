import { describe, expect, it } from 'vitest';
import { cargoDef } from '../src/game/cargo';
import { trainType } from '../src/game/config';
import {
  chargeRunningCosts,
  generateProduction,
  stationAccepts,
  unloadAtStation,
} from '../src/game/Economy';
import { buildTrack } from '../src/game/GameState';
import { update } from '../src/game/Simulation';
import { Train } from '../src/game/types';
import { buyTrain } from '../src/game/Trains';
import { addStation, blankState, industry, layTrackRow, town } from './helpers';

function makeTrain(state: ReturnType<typeof blankState>, stops: number[]): Train {
  const train: Train = {
    id: state.nextId++,
    name: 'Test Train',
    typeId: 'american',
    stops,
    atStationId: stops[0],
    targetStationId: null,
    path: [{ x: 0, y: 0 }],
    pathPos: 0,
    state: 'loading',
    loadTimer: 0.4,
    cargo: [],
    earnings: 0,
    builtDay: 0,
    x: 0,
    y: 0,
  };
  state.trains.push(train);
  return train;
}

describe('Economy', () => {
  it('pays revenue when cargo is delivered to an accepting station', () => {
    const state = blankState(30, 12, [
      town(900, 2, 5, 'Alpha', 500),
      town(901, 20, 5, 'Beta', 500),
    ]);
    const a = addStation(state, 3, 5, 'Alpha Station');
    const b = addStation(state, 19, 5, 'Beta Station');
    const train = makeTrain(state, [a.id, b.id]);
    train.cargo = [{ kind: 'passengers', qty: 10, origin: a.id }];

    const cashBefore = state.cash;
    const revenue = unloadAtStation(state, train, b);

    expect(revenue).toBeGreaterThan(0);
    expect(state.cash).toBe(cashBefore + revenue);
    expect(train.cargo).toHaveLength(0);
    expect(state.finances.month.income).toBe(revenue);
    // distance-based: 16 tiles apart, passenger rate base 2.0 + 0.42/tile, economy 1
    const def = cargoDef('passengers');
    expect(revenue).toBe(Math.round(10 * (def.base + def.perTile * 16) * state.economy));
  });

  it('does not pay for cargo the station does not accept', () => {
    const state = blankState(30, 12, [town(900, 2, 5, 'Alpha', 500)]);
    const a = addStation(state, 3, 5, 'Alpha Station');
    const b = addStation(state, 19, 5, 'Nowhere'); // serves nothing
    expect(stationAccepts(state, b, 'passengers')).toBe(false);

    const train = makeTrain(state, [a.id, b.id]);
    train.cargo = [{ kind: 'passengers', qty: 10, origin: a.id }];
    const cashBefore = state.cash;
    const revenue = unloadAtStation(state, train, b);

    expect(revenue).toBe(0);
    expect(state.cash).toBe(cashBefore);
    expect(train.cargo).toHaveLength(1);
  });

  it('charges train running costs over time', () => {
    const state = blankState();
    const a = addStation(state, 2, 5, 'A');
    const b = addStation(state, 10, 5, 'B');
    const train = makeTrain(state, [a.id, b.id]);

    const cashBefore = state.cash;
    chargeRunningCosts(state, 2);
    const expected = trainType(train.typeId).runningCost * 2;
    expect(state.cash).toBeCloseTo(cashBefore - expected, 6);
    expect(state.finances.month.expenses).toBeCloseTo(expected, 6);
  });

  it('construction reduces cash by the terrain cost', () => {
    const state = blankState();
    const cashBefore = state.cash;
    const result = buildTrack(state, 4, 4);
    expect(result.ok).toBe(true);
    expect(state.cash).toBe(cashBefore - result.cost!);
  });

  it('rejects construction when funds are insufficient', () => {
    const state = blankState();
    state.cash = 5;
    const result = buildTrack(state, 4, 4);
    expect(result.ok).toBe(false);
    expect(state.cash).toBe(5);
  });

  it('towns generate passenger demand at covering stations', () => {
    const state = blankState(30, 12, [town(900, 5, 5, 'Alpha', 1000)]);
    const s = addStation(state, 6, 5, 'Alpha Station');
    generateProduction(state, 1); // one day
    expect(s.waiting.passengers).toBeCloseTo(1000 * 0.02, 6);
    expect(s.waiting.mail).toBeCloseTo(1000 * 0.007, 6);
  });

  it('full loop: a purchased train shuttles and earns delivery revenue', () => {
    const state = blankState(30, 12, [
      town(900, 2, 5, 'Alpha', 1000),
      town(901, 20, 5, 'Beta', 1000),
    ]);
    const a = addStation(state, 3, 5, 'Alpha Station');
    const b = addStation(state, 19, 5, 'Beta Station');
    layTrackRow(state, 4, 18, 5);

    const result = buyTrain(state, 'american', [a.id, b.id]);
    expect(result.ok).toBe(true);

    const incomeBefore = state.finances.total.income;
    for (let i = 0; i < 600; i++) update(state, 0.05); // 30 game days
    expect(state.finances.total.income).toBeGreaterThan(incomeBefore);
    const train = state.trains[0];
    expect(train.x).toBeGreaterThanOrEqual(3);
    expect(train.x).toBeLessThanOrEqual(19);
  });

  it('buying a train with disconnected stations fails with a clear reason', () => {
    const state = blankState(30, 12);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    const result = buyTrain(state, 'american', [a.id, b.id]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no track connection/i);
    expect(state.trains).toHaveLength(0);
  });
});
