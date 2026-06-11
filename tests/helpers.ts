import { createState, tileIndex } from '../src/game/GameState';
import { GameMap, GameState, Industry, Terrain, Town } from '../src/game/types';

/** A flat all-grass world for deterministic unit tests. */
export function blankState(
  width = 24,
  height = 12,
  towns: Town[] = [],
  industries: Industry[] = [],
): GameState {
  const map: GameMap = {
    width,
    height,
    terrain: new Array(width * height).fill(Terrain.Grass),
  };
  return createState(map, towns, industries, 1);
}

/** Lay a straight horizontal run of track from x0..x1 (inclusive) at row y. */
export function layTrackRow(state: GameState, x0: number, x1: number, y: number): void {
  for (let x = x0; x <= x1; x++) {
    state.track[tileIndex(state.map, x, y)] = 1;
  }
}

export function addStation(state: GameState, x: number, y: number, name: string) {
  const station = {
    id: state.nextId++,
    x,
    y,
    name,
    waiting: { passengers: 0, coal: 0 },
  };
  state.stations.push(station);
  return station;
}
