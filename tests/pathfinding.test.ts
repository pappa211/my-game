import { describe, expect, it } from 'vitest';
import { tileIndex } from '../src/game/GameState';
import { findPath } from '../src/game/Pathfinding';
import { addStation, blankState, layTrackRow } from './helpers';

describe('Pathfinding', () => {
  it('finds a route over connected track between two stations', () => {
    const state = blankState();
    addStation(state, 2, 5, 'A');
    addStation(state, 10, 5, 'B');
    layTrackRow(state, 3, 9, 5);

    const path = findPath(state, 2, 5, 10, 5);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 2, y: 5 });
    expect(path![path!.length - 1]).toEqual({ x: 10, y: 5 });
    expect(path!.length).toBe(9); // straight line, both endpoints included
  });

  it('routes around corners', () => {
    const state = blankState();
    addStation(state, 2, 2, 'A');
    addStation(state, 6, 6, 'B');
    layTrackRow(state, 3, 6, 2);
    for (let y = 3; y <= 5; y++) state.track[tileIndex(state.map, 6, y)] = 1;

    const path = findPath(state, 2, 2, 6, 6);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual({ x: 6, y: 6 });
    // every step must be 4-directionally adjacent
    for (let i = 1; i < path!.length; i++) {
      const d = Math.abs(path![i].x - path![i - 1].x) + Math.abs(path![i].y - path![i - 1].y);
      expect(d).toBe(1);
    }
  });

  it('rejects disconnected stations', () => {
    const state = blankState();
    addStation(state, 2, 5, 'A');
    addStation(state, 10, 5, 'B');
    layTrackRow(state, 3, 9, 5);
    state.track[tileIndex(state.map, 6, 5)] = 0; // break the line

    expect(findPath(state, 2, 5, 10, 5)).toBeNull();
  });

  it('rejects stations with no track at all', () => {
    const state = blankState();
    addStation(state, 2, 5, 'A');
    addStation(state, 10, 5, 'B');
    expect(findPath(state, 2, 5, 10, 5)).toBeNull();
  });
});
