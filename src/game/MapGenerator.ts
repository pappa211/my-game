import { emptyCargoRecord } from './cargo';
import { mulberry32 } from './rng';
import { GameMap, Industry, IndustryKind, Terrain, Town } from './types';

export const MAP_WIDTH = 260;
export const MAP_HEIGHT = 200;

const TOWN_TARGET = 32;
const TOWN_MIN = 24;

const NAME_PREFIX = [
  'Ash', 'Brook', 'Clay', 'Dun', 'Elder', 'Fair', 'Glen', 'Haver', 'Iron',
  'Kings', 'Lark', 'Mill', 'North', 'Oak', 'Pine', 'Quarry', 'Raven', 'Stone',
  'Thorn', 'Vale', 'West', 'Wolf', 'York', 'Salt', 'Cedar', 'Frost', 'Gold',
  'Red', 'Silver', 'Bear', 'Eagle', 'Maple', 'Birch', 'Granite', 'River',
];
const NAME_SUFFIX = [
  'ford', 'ton', 'bury', 'field', 'haven', 'wick', 'dale', 'mouth', 'bridge',
  'gate', 'stead', 'port', 'crest', 'hollow', 'march', 'ridge', 'valley', 'falls',
];

const INDUSTRY_SUFFIX: Record<IndustryKind, string> = {
  coalMine: 'Colliery',
  ironMine: 'Iron Mine',
  oilWell: 'Oil Field',
  lumberCamp: 'Lumber Camp',
  farm: 'Farm',
  ranch: 'Ranch',
  steelMill: 'Steel Works',
  factory: 'Factory',
  sawmill: 'Sawmill',
  mill: 'Mill',
  powerPlant: 'Power Co.',
  port: 'Port',
};

/** How many of each industry to scatter across the (large) map. */
const INDUSTRY_PLAN: { kind: IndustryKind; count: number; terrain: Terrain | 'coast' | 'any' }[] = [
  { kind: 'coalMine', count: 6, terrain: Terrain.Hill },
  { kind: 'ironMine', count: 4, terrain: Terrain.Hill },
  { kind: 'oilWell', count: 3, terrain: 'any' },
  { kind: 'lumberCamp', count: 5, terrain: Terrain.Forest },
  { kind: 'farm', count: 6, terrain: Terrain.Grass },
  { kind: 'ranch', count: 4, terrain: Terrain.Grass },
  { kind: 'steelMill', count: 3, terrain: 'any' },
  { kind: 'factory', count: 4, terrain: 'any' },
  { kind: 'sawmill', count: 4, terrain: 'any' },
  { kind: 'mill', count: 4, terrain: Terrain.Grass },
  { kind: 'powerPlant', count: 4, terrain: 'any' },
  { kind: 'port', count: 3, terrain: 'coast' },
];

export interface GeneratedWorld {
  map: GameMap;
  towns: Town[];
  industries: Industry[];
}

/** Bilinear value noise over a coarse random grid. Returns w*h floats in [0,1). */
function valueNoise(rand: () => number, w: number, h: number, cell: number): number[] {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid: number[] = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rand());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const out = new Array<number>(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = smooth(gx - ix);
      const fy = smooth(gy - iy);
      const a = grid[iy * gw + ix];
      const b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix];
      const d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
  }
  return out;
}

export function generateMap(seed: number): GeneratedWorld {
  const rand = mulberry32(seed);
  const w = MAP_WIDTH;
  const h = MAP_HEIGHT;

  const elev1 = valueNoise(rand, w, h, 36);
  const elev2 = valueNoise(rand, w, h, 11);
  const moisture = valueNoise(rand, w, h, 16);

  const terrain = new Array<number>(w * h);
  for (let i = 0; i < w * h; i++) {
    const e = elev1[i] * 0.65 + elev2[i] * 0.35;
    if (e < 0.34) terrain[i] = Terrain.Water;
    else if (e > 0.69) terrain[i] = Terrain.Hill;
    else if (moisture[i] > 0.62) terrain[i] = Terrain.Forest;
    else terrain[i] = Terrain.Grass;
  }

  const map: GameMap = { width: w, height: h, terrain };
  const occupied = new Set<number>();
  const idx = (x: number, y: number) => y * w + x;
  const inBounds = (x: number, y: number) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
  const isLand = (x: number, y: number) => terrain[idx(x, y)] !== Terrain.Water;
  const isCoast = (x: number, y: number) =>
    isLand(x, y) &&
    (terrain[idx(x + 1, y)] === Terrain.Water ||
      terrain[idx(x - 1, y)] === Terrain.Water ||
      terrain[idx(x, y + 1)] === Terrain.Water ||
      terrain[idx(x, y - 1)] === Terrain.Water);

  let nextId = 1;
  const towns: Town[] = [];
  const industries: Industry[] = [];
  const usedNames = new Set<string>();

  const makeName = (): string => {
    for (let i = 0; i < 80; i++) {
      const name =
        NAME_PREFIX[Math.floor(rand() * NAME_PREFIX.length)] +
        NAME_SUFFIX[Math.floor(rand() * NAME_SUFFIX.length)];
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `Settlement ${nextId}`;
  };

  const placeTown = (x: number, y: number) => {
    terrain[idx(x, y)] = Terrain.Grass;
    occupied.add(idx(x, y));
    towns.push({
      id: nextId++,
      x,
      y,
      name: makeName(),
      population: 250 + Math.floor(rand() * 1100),
      serviceLevel: 0,
    });
  };

  const townDistOk = (x: number, y: number, minDist: number) =>
    towns.every((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) >= minDist);

  const canHost = (x: number, y: number) =>
    inBounds(x, y) && isLand(x, y) && !occupied.has(idx(x, y));

  // Place towns: random attempts, relaxing spacing if the map is tight.
  let minDist = 13;
  let attempts = 0;
  while (towns.length < TOWN_TARGET && attempts < 16000) {
    attempts++;
    if (attempts % 2500 === 0 && minDist > 7) minDist--;
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (!canHost(x, y) || terrain[idx(x, y)] === Terrain.Hill) continue;
    if (!townDistOk(x, y, minDist)) continue;
    placeTown(x, y);

    // Guarantee a starting opportunity: give the first town a close neighbour.
    if (towns.length === 1) {
      const a = towns[0];
      for (let tries = 0; tries < 200 && towns.length < 2; tries++) {
        const angle = rand() * Math.PI * 2;
        const dist = 6 + rand() * 4;
        const bx = Math.round(a.x + Math.cos(angle) * dist);
        const by = Math.round(a.y + Math.sin(angle) * dist);
        if (canHost(bx, by)) placeTown(bx, by);
      }
      if (towns.length < 2) {
        const bx = Math.min(w - 3, a.x + 7);
        const by = a.y;
        terrain[idx(bx, by)] = Terrain.Grass;
        if (!occupied.has(idx(bx, by))) placeTown(bx, by);
      }
    }
  }
  while (towns.length < TOWN_MIN) {
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (occupied.has(idx(x, y))) continue;
    terrain[idx(x, y)] = Terrain.Grass;
    if (!townDistOk(x, y, 4)) continue;
    placeTown(x, y);
  }

  const placeIndustry = (x: number, y: number, kind: IndustryKind): Industry => {
    if (terrain[idx(x, y)] === Terrain.Water && kind !== 'port') terrain[idx(x, y)] = Terrain.Grass;
    occupied.add(idx(x, y));
    const ind: Industry = {
      id: nextId++,
      x,
      y,
      kind,
      name: `${makeName()} ${INDUSTRY_SUFFIX[kind]}`,
      stock: emptyCargoRecord(),
      activity: 0,
    };
    industries.push(ind);
    return ind;
  };

  const terrainMatch = (x: number, y: number, want: Terrain | 'coast' | 'any'): boolean => {
    if (want === 'any') return true;
    if (want === 'coast') return isCoast(x, y);
    return terrain[idx(x, y)] === want;
  };

  // Place an industry of a kind near an anchor point (for guaranteed chains).
  const placeNear = (kind: IndustryKind, ax: number, ay: number, minR: number, maxR: number): Industry | null => {
    for (let tries = 0; tries < 400; tries++) {
      const angle = rand() * Math.PI * 2;
      const dist = minR + rand() * (maxR - minR);
      const x = Math.round(ax + Math.cos(angle) * dist);
      const y = Math.round(ay + Math.sin(angle) * dist);
      if (kind === 'port' ? isCoast(x, y) && !occupied.has(idx(x, y)) : canHost(x, y)) {
        return placeIndustry(x, y, kind);
      }
    }
    // forced fallback on land
    for (let tries = 0; tries < 400; tries++) {
      const x = Math.max(2, Math.min(w - 3, ax + Math.round((rand() - 0.5) * maxR * 2)));
      const y = Math.max(2, Math.min(h - 3, ay + Math.round((rand() - 0.5) * maxR * 2)));
      if (canHost(x, y)) return placeIndustry(x, y, kind);
    }
    return null;
  };

  // Guaranteed early chains around the anchor town so the player always has a
  // profitable opening: a coal→power run and a farm→mill→town food run.
  const anchor = towns[0];
  placeNear('powerPlant', anchor.x, anchor.y, 4, 9);
  placeNear('coalMine', anchor.x, anchor.y, 9, 16);
  placeNear('mill', anchor.x, anchor.y, 4, 9);
  placeNear('farm', anchor.x, anchor.y, 8, 15);

  // Remaining industries from the plan, biased to preferred terrain.
  const remaining: Record<string, number> = {};
  for (const p of INDUSTRY_PLAN) {
    remaining[p.kind] = p.count - industries.filter((i) => i.kind === p.kind).length;
  }
  for (const p of INDUSTRY_PLAN) {
    let placed = 0;
    const need = Math.max(0, remaining[p.kind]);
    let tries = 0;
    while (placed < need && tries < 9000) {
      tries++;
      const x = 2 + Math.floor(rand() * (w - 4));
      const y = 2 + Math.floor(rand() * (h - 4));
      if (p.terrain === 'coast') {
        if (!isCoast(x, y) || occupied.has(idx(x, y))) continue;
      } else {
        if (!canHost(x, y)) continue;
        if (tries < 6000 && !terrainMatch(x, y, p.terrain)) continue;
      }
      placeIndustry(x, y, p.kind);
      placed++;
    }
  }

  return { map, towns, industries };
}
