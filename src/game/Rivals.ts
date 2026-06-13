import { addMessage } from './GameState';
import { mulberry32 } from './rng';
import { GameState, Rival } from './types';

const RIVAL_NAMES = [
  'Continental Pacific',
  'Union & Western',
  'Great Northern Lines',
  'Atlantic Trunk Rail',
  'Midland Consolidated',
];
const RIVAL_COLORS = ['#c94f8a', '#4fb0c9', '#c9a14f', '#7d8a4f'];

const MAX_LINKS = 7;

/** Two competing railroads, deterministically seeded from the world seed. */
export function createRivals(state: GameState): Rival[] {
  const rand = mulberry32((state.seed ^ 0x9e3779b9) >>> 0);
  const count = 2;
  const names = [...RIVAL_NAMES];
  const rivals: Rival[] = [];
  for (let i = 0; i < count; i++) {
    const ni = Math.floor(rand() * names.length);
    const name = names.splice(ni, 1)[0] ?? `Rival ${i + 1}`;
    rivals.push({
      id: 1000 + i,
      name,
      color: RIVAL_COLORS[i % RIVAL_COLORS.length],
      cash: 12000 + Math.floor(rand() * 8000),
      value: 14000 + Math.floor(rand() * 10000),
      links: [],
      nextMoveIn: 40 + rand() * 80,
    });
  }
  return rivals;
}

function linkExists(rival: Rival, a: number, b: number): boolean {
  return rival.links.some(
    (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a),
  );
}

function anyRivalLink(state: GameState, a: number, b: number): boolean {
  return state.rivals.some((r) => linkExists(r, a, b));
}

/**
 * Rival territory pressure on a town's output: a contested town the player does
 * not yet serve sends some of its traffic to the competitor.
 */
export function rivalPressure(state: GameState, townId: number): number {
  for (const r of state.rivals) {
    if (r.links.some((l) => l.a === townId || l.b === townId)) return 0.35;
  }
  return 0;
}

export function updateRivals(state: GameState, dtDays: number): void {
  if (state.rivals.length === 0) return;
  const rand = Math.random;
  for (const rival of state.rivals) {
    // value compounds with network size and the economy
    const growth = (8 + rival.links.length * 6) * dtDays * state.economy;
    rival.value += growth;
    rival.cash += growth * 0.4;

    rival.nextMoveIn -= dtDays;
    if (rival.nextMoveIn > 0 || rival.links.length >= MAX_LINKS) continue;
    rival.nextMoveIn = 70 + rand() * 90;

    // pick a profitable, unclaimed town pair within reach
    const towns = state.towns;
    let best: { a: number; b: number; score: number } | null = null;
    for (let i = 0; i < towns.length; i++) {
      for (let j = i + 1; j < towns.length; j++) {
        const a = towns[i];
        const b = towns[j];
        const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (dist < 6 || dist > 60) continue;
        if (anyRivalLink(state, a.id, b.id)) continue;
        const score = (a.population + b.population) / dist + rand() * 200;
        if (!best || score > best.score) best = { a: a.id, b: b.id, score };
      }
    }
    if (best) {
      rival.links.push({ a: best.a, b: best.b });
      rival.value += 3000;
      const an = towns.find((t) => t.id === best!.a)?.name ?? '?';
      const bn = towns.find((t) => t.id === best!.b)?.name ?? '?';
      addMessage(state, `${rival.name} opened a line between ${an} and ${bn}.`, 'warn');
    }
  }
}

/** Player + rivals ranked by company value (caller supplies player value). */
export function rankings(
  state: GameState,
  playerValue: number,
): { name: string; value: number; color: string; isPlayer: boolean }[] {
  const rows = [
    { name: 'Your Railroad', value: playerValue, color: '#ffd54a', isPlayer: true },
    ...state.rivals.map((r) => ({ name: r.name, value: Math.floor(r.value), color: r.color, isPlayer: false })),
  ];
  rows.sort((a, b) => b.value - a.value);
  return rows;
}
