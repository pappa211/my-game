import { isTraversable, tileIndex } from './GameState';
import { GameState, Point } from './types';

const DIRS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Minimal binary min-heap keyed on dist[]. */
class Heap {
  private items: number[] = [];
  constructor(private dist: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const { items, dist } = this;
    items.push(i);
    let c = items.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (dist[items[p]] <= dist[items[c]]) break;
      [items[p], items[c]] = [items[c], items[p]];
      c = p;
    }
  }
  pop(): number {
    const { items, dist } = this;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < items.length && dist[items[l]] < dist[items[m]]) m = l;
        if (r < items.length && dist[items[r]] < dist[items[m]]) m = r;
        if (m === p) break;
        [items[p], items[m]] = [items[m], items[p]];
        p = m;
      }
    }
    return top;
  }
}

/**
 * Shortest path over traversable tiles (track + stations), 8-directional with
 * true diagonal cost (Dijkstra). Returns the tile path including both
 * endpoints, or null if disconnected.
 */
export function findPath(
  state: GameState,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Point[] | null {
  const { width, height } = state.map;
  if (!isTraversable(state, sx, sy) || !isTraversable(state, tx, ty)) return null;
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];

  const start = tileIndex(state.map, sx, sy);
  const goal = tileIndex(state.map, tx, ty);
  const dist = new Float64Array(width * height).fill(Infinity);
  const parent = new Int32Array(width * height).fill(-1);
  const done = new Uint8Array(width * height);
  dist[start] = 0;
  parent[start] = start;
  const heap = new Heap(dist);
  heap.push(start);

  while (heap.size > 0) {
    const cur = heap.pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (cur === goal) break;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (done[ni] || !isTraversable(state, nx, ny)) continue;
      const nd = dist[cur] + cost;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        parent[ni] = cur;
        heap.push(ni);
      }
    }
  }

  if (parent[goal] === -1) return null;

  const path: Point[] = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: cur % width, y: Math.floor(cur / width) });
    cur = parent[cur];
  }
  path.push({ x: sx, y: sy });
  path.reverse();
  return path;
}

/** Length of a tile path in true distance (diagonal steps count √2). */
export function pathLength(path: Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return len;
}
