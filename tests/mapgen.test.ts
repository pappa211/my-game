import { describe, expect, it } from 'vitest';
import { generateMap, MAP_HEIGHT, MAP_WIDTH } from '../src/game/MapGenerator';
import { Terrain } from '../src/game/types';

describe('MapGenerator', () => {
  it('is deterministic for the same seed', () => {
    const a = generateMap(1234);
    const b = generateMap(1234);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.towns).toEqual(b.towns);
    expect(a.industries).toEqual(b.industries);
  });

  it('differs across seeds', () => {
    const a = generateMap(1);
    const b = generateMap(2);
    expect(a.map.terrain).not.toEqual(b.map.terrain);
  });

  it('meets world content requirements across several seeds', () => {
    for (const seed of [1, 7, 42, 999, 31337]) {
      const world = generateMap(seed);
      expect(world.map.width).toBe(MAP_WIDTH);
      expect(world.map.height).toBe(MAP_HEIGHT);
      expect(world.towns.length).toBeGreaterThanOrEqual(15);
      expect(world.industries.length).toBeGreaterThanOrEqual(8);

      const mines = world.industries.filter((i) => i.kind === 'coalMine');
      const plants = world.industries.filter((i) => i.kind === 'powerPlant');
      expect(mines.length).toBeGreaterThanOrEqual(1);
      expect(plants.length).toBeGreaterThanOrEqual(1);

      // Starting opportunity: two towns within 12 tiles of each other.
      const closeTowns = world.towns.some((t, i) =>
        world.towns.some(
          (u, j) =>
            i !== j && Math.max(Math.abs(t.x - u.x), Math.abs(t.y - u.y)) <= 12,
        ),
      );
      expect(closeTowns).toBe(true);

      // Coal chain opportunity: a mine within 25 tiles of a plant.
      const chain = mines.some((m) =>
        plants.some((p) => Math.abs(m.x - p.x) + Math.abs(m.y - p.y) <= 25),
      );
      expect(chain).toBe(true);

      // Towns and industries never sit on water.
      for (const e of [...world.towns, ...world.industries]) {
        expect(world.map.terrain[e.y * world.map.width + e.x]).not.toBe(Terrain.Water);
      }

      // All terrain kinds appear and water doesn't drown the map.
      const counts = [0, 0, 0, 0];
      for (const t of world.map.terrain) counts[t]++;
      const total = world.map.terrain.length;
      expect(counts[Terrain.Grass]).toBeGreaterThan(0);
      expect(counts[Terrain.Forest]).toBeGreaterThan(0);
      expect(counts[Terrain.Hill]).toBeGreaterThan(0);
      expect(counts[Terrain.Water]).toBeGreaterThan(0);
      expect(counts[Terrain.Water] / total).toBeLessThan(0.6);
    }
  });
});
