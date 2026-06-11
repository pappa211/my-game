import { isTraversable, tileIndex } from './GameState';
import { GameState, Point } from './types';

/**
 * BFS over traversable tiles (track + stations), 4-directional.
 * Returns the tile path including both endpoints, or null if disconnected.
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
  const parent = new Int32Array(width * height).fill(-1);
  parent[start] = start;
  const queue: number[] = [start];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (parent[ni] !== -1) continue;
      if (!isTraversable(state, nx, ny)) continue;
      parent[ni] = cur;
      queue.push(ni);
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
