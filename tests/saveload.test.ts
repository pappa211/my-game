import { beforeEach, describe, expect, it } from 'vitest';
import { buildStation, buildTrack, newGame } from '../src/game/GameState';
import { update } from '../src/game/Simulation';
import { buyTrain } from '../src/game/Trains';
import {
  clearSave,
  deserialize,
  loadFromLocalStorage,
  saveToLocalStorage,
  serialize,
} from '../src/persistence/SaveLoad';
import { addStation, blankState, layTrackRow } from './helpers';

// Minimal localStorage stub for the node test environment.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe('Save/Load', () => {
  beforeEach(() => {
    store.clear();
  });

  it('roundtrips a full generated game state through serialize/deserialize', () => {
    const state = newGame(42);
    buildTrack(state, 50, 50);
    buildTrack(state, 51, 50);
    buildStation(state, 49, 50);
    update(state, 3.5);

    const restored = deserialize(serialize(state));
    expect(restored).toEqual(state);
    expect(restored.map.terrain).toEqual(state.map.terrain);
    expect(restored.cash).toBe(state.cash);
    expect(restored.day).toBe(state.day);
    expect(restored.track).toEqual(state.track);
    expect(restored.stations).toEqual(state.stations);
    expect(restored.towns).toEqual(state.towns);
  });

  it('roundtrips trains and routes through localStorage', () => {
    const state = blankState(30, 12, [
      { id: 900, x: 2, y: 5, name: 'Alpha', population: 800 },
      { id: 901, x: 20, y: 5, name: 'Beta', population: 800 },
    ]);
    const a = addStation(state, 3, 5, 'A');
    const b = addStation(state, 19, 5, 'B');
    layTrackRow(state, 4, 18, 5);
    expect(buyTrain(state, 'local', [a.id, b.id]).ok).toBe(true);
    update(state, 2); // train is mid-journey with real path state

    saveToLocalStorage(state);
    const loaded = loadFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(state);
    expect(loaded!.trains[0].stops).toEqual([a.id, b.id]);
    expect(loaded!.trains[0].path.length).toBeGreaterThan(1);

    // Loaded state must keep simulating without error.
    update(loaded!, 5);
    expect(loaded!.day).toBeGreaterThan(state.day);
  });

  it('returns null when no save exists and after clearing', () => {
    expect(loadFromLocalStorage()).toBeNull();
    saveToLocalStorage(newGame(7));
    expect(loadFromLocalStorage()).not.toBeNull();
    clearSave();
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('rejects corrupt save data gracefully', () => {
    store.set('rail-frontier-save-v1', '{"version":99}');
    expect(loadFromLocalStorage()).toBeNull();
  });
});
