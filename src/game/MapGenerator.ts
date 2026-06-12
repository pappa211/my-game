import { mulberry32 } from './rng';
import { GameMap, Industry, Terrain, Town } from './types';

export const MAP_WIDTH = 164;
export const MAP_HEIGHT = 140;

const TOWN_TARGET = 18;
const TOWN_MIN = 15;
const MINES = 4;
const PLANTS = 4;
const LUMBER_CAMPS = 3;
const SAWMILLS = 3;

const NAME_PREFIX = [
  'Ash', 'Brook', 'Clay', 'Dun', 'Elder', 'Fair', 'Glen', 'Haver', 'Iron',
  'Kings', 'Lark', 'Mill', 'North', 'Oak', 'Pine', 'Quarry', 'Raven', 'Stone',
  'Thorn', 'Vale', 'West', 'Wolf', 'York', 'Salt', 'Cedar', 'Frost',
];
const NAME_SUFFIX = [
  'ford', 'ton', 'bury', 'field', 'haven', 'wick', 'dale', 'mouth', 'bridge',
  'gate', 'stead', 'port', 'crest', 'hollow', 'march',
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

  const elev1 = valueNoise(rand, w, h, 28);
  const elev2 = valueNoise(rand, w, h, 9);
  const moisture = valueNoise(rand, w, h, 13);

  const terrain = new Array<number>(w * h);
  for (let i = 0; i < w * h; i++) {
    const e = elev1[i] * 0.65 + elev2[i] * 0.35;
    if (e < 0.34) terrain[i] = Terrain.Water;
    else if (e > 0.68) terrain[i] = Terrain.Hill;
    else if (moisture[i] > 0.62) terrain[i] = Terrain.Forest;
    else terrain[i] = Terrain.Grass;
  }

  const map: GameMap = { width: w, height: h, terrain };
  const occupied = new Set<number>();
  const idx = (x: number, y: number) => y * w + x;
  const inBounds = (x: number, y: number) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2;
  const isLand = (x: number, y: number) => terrain[idx(x, y)] !== Terrain.Water;

  let nextId = 1;
  const towns: Town[] = [];
  const industries: Industry[] = [];
  const usedNames = new Set<string>();

  const makeName = (): string => {
    for (let i = 0; i < 50; i++) {
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
      population: 200 + Math.floor(rand() * 900),
    });
  };

  const townDistOk = (x: number, y: number, minDist: number) =>
    towns.every((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) >= minDist);

  const canHost = (x: number, y: number) =>
    inBounds(x, y) && isLand(x, y) && !occupied.has(idx(x, y));

  // Place towns: random attempts, relaxing spacing if the map is tight.
  let minDist = 11;
  let attempts = 0;
  while (towns.length < TOWN_TARGET && attempts < 8000) {
    attempts++;
    if (attempts % 1500 === 0 && minDist > 6) minDist--;
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
      // Force one if the neighbourhood is all water.
      if (towns.length < 2) {
        const bx = Math.min(w - 3, a.x + 7);
        const by = a.y;
        terrain[idx(bx, by)] = Terrain.Grass;
        if (!occupied.has(idx(bx, by))) placeTown(bx, by);
      }
    }
  }
  // Hard guarantee of TOWN_MIN towns even on pathological seeds.
  while (towns.length < TOWN_MIN) {
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (occupied.has(idx(x, y))) continue;
    terrain[idx(x, y)] = Terrain.Grass;
    if (!townDistOk(x, y, 4)) continue;
    placeTown(x, y);
  }

  const placeIndustry = (x: number, y: number, kind: Industry['kind'], name: string) => {
    if (terrain[idx(x, y)] === Terrain.Water) terrain[idx(x, y)] = Terrain.Grass;
    occupied.add(idx(x, y));
    industries.push({ id: nextId++, x, y, kind, name });
  };

  // First power plant near the first town, first coal mine within reach of the
  // plant — a guaranteed coal chain opportunity.
  const anchor = towns[0];
  let plant0: Industry | null = null;
  for (let tries = 0; tries < 300 && !plant0; tries++) {
    const x = anchor.x + Math.round((rand() - 0.5) * 12);
    const y = anchor.y + Math.round((rand() - 0.5) * 12);
    if (canHost(x, y)) {
      placeIndustry(x, y, 'powerPlant', `${anchor.name} Power Co.`);
      plant0 = industries[industries.length - 1];
    }
  }
  if (!plant0) {
    const x = Math.min(w - 3, anchor.x + 3);
    placeIndustry(x, anchor.y + 2 < h - 2 ? anchor.y + 2 : anchor.y - 2, 'powerPlant', `${anchor.name} Power Co.`);
    plant0 = industries[industries.length - 1];
  }
  let mine0 = false;
  for (let tries = 0; tries < 400 && !mine0; tries++) {
    const angle = rand() * Math.PI * 2;
    const dist = 9 + rand() * 9;
    const x = Math.round(plant0.x + Math.cos(angle) * dist);
    const y = Math.round(plant0.y + Math.sin(angle) * dist);
    if (canHost(x, y)) {
      placeIndustry(x, y, 'coalMine', `${makeName()} Colliery`);
      mine0 = true;
    }
  }
  if (!mine0) {
    const x = Math.max(2, plant0.x - 10);
    placeIndustry(x, plant0.y, 'coalMine', `${makeName()} Colliery`);
  }

  // Remaining industries scattered across the map.
  let plants = 1;
  let mines = 1;
  let indAttempts = 0;
  while ((plants < PLANTS || mines < MINES) && indAttempts < 6000) {
    indAttempts++;
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (!canHost(x, y)) continue;
    if (mines < MINES && (terrain[idx(x, y)] === Terrain.Hill || rand() < 0.4)) {
      placeIndustry(x, y, 'coalMine', `${makeName()} Colliery`);
      mines++;
    } else if (plants < PLANTS) {
      // Plants prefer to be near a town so deliveries pair with passenger runs.
      const nearTown = towns.some(
        (t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 8,
      );
      if (!nearTown && indAttempts < 4000) continue;
      placeIndustry(x, y, 'powerPlant', `${makeName()} Power Co.`);
      plants++;
    }
  }

  // Wood chain: lumber camps prefer forest, each sawmill sits within reach of
  // a camp (and ideally near a town for the onward goods run).
  let camps = 0;
  let woodAttempts = 0;
  while (camps < LUMBER_CAMPS && woodAttempts < 6000) {
    woodAttempts++;
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (!canHost(x, y)) continue;
    if (terrain[idx(x, y)] !== Terrain.Forest && woodAttempts < 4000) continue;
    placeIndustry(x, y, 'lumberCamp', `${makeName()} Lumber Camp`);
    camps++;
  }
  // Fallback so the chain always exists.
  while (camps < 1) {
    const x = 2 + Math.floor(rand() * (w - 4));
    const y = 2 + Math.floor(rand() * (h - 4));
    if (!canHost(x, y)) continue;
    placeIndustry(x, y, 'lumberCamp', `${makeName()} Lumber Camp`);
    camps++;
  }
  const campList = industries.filter((i) => i.kind === 'lumberCamp');
  let sawmills = 0;
  let millAttempts = 0;
  while (sawmills < SAWMILLS && millAttempts < 6000) {
    millAttempts++;
    const camp = campList[sawmills % campList.length];
    const angle = rand() * Math.PI * 2;
    const dist = 8 + rand() * 14;
    const x = Math.round(camp.x + Math.cos(angle) * dist);
    const y = Math.round(camp.y + Math.sin(angle) * dist);
    if (!canHost(x, y)) continue;
    placeIndustry(x, y, 'sawmill', `${makeName()} Sawmill`);
    sawmills++;
  }
  if (sawmills === 0) {
    const camp = campList[0];
    const x = Math.max(2, Math.min(w - 3, camp.x + 9));
    const y = Math.max(2, Math.min(h - 3, camp.y));
    placeIndustry(x, y, 'sawmill', `${makeName()} Sawmill`);
  }

  return { map, towns, industries };
}
