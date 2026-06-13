import { missingInputs } from '../game/Analysis';
import { CARGO_BY_ID } from '../game/cargo';
import { stationTier, trainType } from '../game/config';
import { stationRadius } from '../game/Economy';
import {
  canBuildStation,
  canBuildTrack,
  getStation,
  hasTrack,
  isTraversable,
  stationAt,
} from '../game/GameState';
import { industryDef, industryInputs, industryOutputs, TOWN_DEMANDS } from '../game/industries';
import { positionBehind } from '../game/Trains';
import { GameState, Industry, Point, Terrain, Train } from '../game/types';
import { UiState } from './uiState';

function wagonColor(kind: string): string {
  return CARGO_BY_ID[kind]?.color ?? '#5a5e66';
}

/** Soft building tint per industry category, for the sprite base. */
const INDUSTRY_TINT: Record<string, string> = {
  coalMine: '#3a3a40',
  ironMine: '#6a5444',
  oilWell: '#2b2b33',
  lumberCamp: '#6e4f2f',
  farm: '#caa84a',
  ranch: '#b07a4a',
  steelMill: '#7a818a',
  factory: '#8a7d5a',
  sawmill: '#a3744a',
  mill: '#c08a4a',
  powerPlant: '#8d8d96',
  port: '#4a7a9a',
};

/** Deterministic per-tile hash in [0,1) for visual variation. */
function tileHash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = (h * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const GRASS_SHADES = ['#7aa95f', '#74a259', '#7ead63', '#71a056'];
const FOREST_SHADES = ['#4d7c45', '#477540', '#52814a', '#43703c'];
const HILL_SHADES = ['#9d916c', '#968a66', '#a39871', '#908563'];
const WATER_BASE = '#3a6896';
const WATER_LIGHT = '#4674a4';
const SAND = '#c9bd8d';

interface SmokePuff {
  x: number;
  y: number;
  age: number;
  life: number;
  drift: number;
}

export interface Camera {
  /** top-left corner in tile coordinates */
  x: number;
  y: number;
  /** pixels per tile */
  zoom: number;
}

const MINIMAP_WIDTH = 190;
const MINIMAP_MARGIN = 12;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  camera: Camera = { x: 0, y: 0, zoom: 14 };

  private smoke: SmokePuff[] = [];
  private lastFrame = performance.now();
  private time = 0;

  private minimapTerrain: HTMLCanvasElement | null = null;
  private minimapSeed: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  centerOn(x: number, y: number): void {
    this.camera.x = x - this.canvas.width / this.camera.zoom / 2;
    this.camera.y = y - this.canvas.height / this.camera.zoom / 2;
  }

  screenToTile(px: number, py: number): Point {
    return {
      x: Math.floor(this.camera.x + px / this.camera.zoom),
      y: Math.floor(this.camera.y + py / this.camera.zoom),
    };
  }

  clampCamera(state: GameState): void {
    const viewW = this.canvas.width / this.camera.zoom;
    const viewH = this.canvas.height / this.camera.zoom;
    const margin = 6;
    this.camera.x = Math.max(-margin, Math.min(state.map.width - viewW + margin, this.camera.x));
    this.camera.y = Math.max(-margin, Math.min(state.map.height - viewH + margin, this.camera.y));
  }

  /** Minimap screen rectangle (bottom-left corner of the canvas). */
  minimapRect(state: GameState): { x: number; y: number; w: number; h: number } {
    const w = MINIMAP_WIDTH;
    const h = Math.round((w * state.map.height) / state.map.width);
    return { x: MINIMAP_MARGIN, y: this.canvas.height - h - MINIMAP_MARGIN, w, h };
  }

  /** Convert a screen point inside the minimap to world tile coords, or null. */
  minimapToWorld(state: GameState, px: number, py: number): Point | null {
    const r = this.minimapRect(state);
    if (px < r.x || py < r.y || px > r.x + r.w || py > r.y + r.h) return null;
    return {
      x: ((px - r.x) / r.w) * state.map.width,
      y: ((py - r.y) / r.h) * state.map.height,
    };
  }

  render(state: GameState, ui: UiState): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.time += dt;

    const { ctx, camera } = this;
    const z = camera.zoom;
    ctx.fillStyle = '#10151d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const x0 = Math.max(0, Math.floor(camera.x));
    const y0 = Math.max(0, Math.floor(camera.y));
    const x1 = Math.min(state.map.width - 1, Math.ceil(camera.x + this.canvas.width / z));
    const y1 = Math.min(state.map.height - 1, Math.ceil(camera.y + this.canvas.height / z));

    const sx = (tx: number) => (tx - camera.x) * z;
    const sy = (ty: number) => (ty - camera.y) * z;

    this.drawTerrain(state, x0, y0, x1, y1, sx, sy);
    this.drawTrack(state, x0, y0, x1, y1, sx, sy);
    this.drawRivalLinks(state, sx, sy);
    this.drawSelectedPath(state, ui, sx, sy);
    this.drawTowns(state, x0, y0, x1, y1, sx, sy);
    this.drawIndustries(state, x0, y0, x1, y1, sx, sy);
    this.drawStations(state, ui, x0, y0, x1, y1, sx, sy);
    this.drawChainLinks(state, ui, sx, sy);
    this.drawDraftMarkers(state, ui, sx, sy);
    this.drawTrains(state, ui, dt, sx, sy);
    this.drawSmoke(dt, sx, sy);
    this.drawHover(state, ui, sx, sy);
    this.drawMinimap(state);
  }

  // ---------------------------------------------------------------- terrain

  private drawTerrain(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const W = state.map.width;
    const terrain = state.map.terrain;
    // -1 marks out-of-bounds so map borders get neither shoreline nor sand.
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= W || y >= state.map.height ? -1 : terrain[y * W + x];

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = terrain[y * W + x];
        const h = tileHash(x, y);
        const px = sx(x);
        const py = sy(y);
        if (t === Terrain.Water) {
          ctx.fillStyle = WATER_BASE;
          ctx.fillRect(px, py, z + 1, z + 1);
          // animated shimmer bands
          const phase = Math.sin(this.time * 1.6 + (x + y * 1.7) * 0.9 + h * 6);
          if (phase > 0.55) {
            ctx.fillStyle = WATER_LIGHT;
            ctx.fillRect(px, py + z * 0.35, z + 1, z * 0.3);
          }
          // lighter rim where water meets land
          const isLand = (t: number) => t !== Terrain.Water && t !== -1;
          const landN = isLand(at(x, y - 1));
          const landS = isLand(at(x, y + 1));
          const landW = isLand(at(x - 1, y));
          const landE = isLand(at(x + 1, y));
          if (landN || landS || landW || landE) {
            ctx.fillStyle = 'rgba(180, 205, 225, 0.35)';
            const e = Math.max(1, z * 0.14);
            if (landN) ctx.fillRect(px, py, z + 1, e);
            if (landS) ctx.fillRect(px, py + z + 1 - e, z + 1, e);
            if (landW) ctx.fillRect(px, py, e, z + 1);
            if (landE) ctx.fillRect(px + z + 1 - e, py, e, z + 1);
          }
          continue;
        }

        const shades =
          t === Terrain.Forest ? FOREST_SHADES : t === Terrain.Hill ? HILL_SHADES : GRASS_SHADES;
        ctx.fillStyle = shades[Math.floor(h * shades.length)];
        ctx.fillRect(px, py, z + 1, z + 1);

        // sandy edge against water
        const waterN = at(x, y - 1) === Terrain.Water;
        const waterS = at(x, y + 1) === Terrain.Water;
        const waterW = at(x - 1, y) === Terrain.Water;
        const waterE = at(x + 1, y) === Terrain.Water;
        if (waterN || waterS || waterW || waterE) {
          ctx.fillStyle = SAND;
          const e = Math.max(1, z * 0.18);
          if (waterN) ctx.fillRect(px, py, z + 1, e);
          if (waterS) ctx.fillRect(px, py + z + 1 - e, z + 1, e);
          if (waterW) ctx.fillRect(px, py, e, z + 1);
          if (waterE) ctx.fillRect(px + z + 1 - e, py, e, z + 1);
        }
      }
    }

    // Decorations on a second pass so they sit above neighboring base tiles.
    if (z >= 9) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = terrain[y * W + x];
          const px = sx(x);
          const py = sy(y);
          if (t === Terrain.Forest) {
            const n = 2 + Math.floor(tileHash(x, y, 1) * 2);
            for (let k = 0; k < n; k++) {
              const ox = 0.2 + tileHash(x, y, 2 + k) * 0.6;
              const oy = 0.25 + tileHash(x, y, 7 + k) * 0.55;
              const r = z * (0.13 + tileHash(x, y, 12 + k) * 0.08);
              // canopy with darker rim
              ctx.fillStyle = '#2e5429';
              ctx.beginPath();
              ctx.arc(px + z * ox, py + z * oy + r * 0.25, r, 0, Math.PI * 2);
              ctx.fill();
              ctx.fillStyle = '#3f6f37';
              ctx.beginPath();
              ctx.arc(px + z * ox, py + z * oy, r, 0, Math.PI * 2);
              ctx.fill();
            }
          } else if (t === Terrain.Hill) {
            // skip some tiles so ridges don't form a uniform grid
            if (tileHash(x, y, 4) < 0.3) continue;
            const ox = 0.5 + (tileHash(x, y, 3) - 0.5) * 0.4;
            const oy = (tileHash(x, y, 5) - 0.5) * 0.3;
            const s = 0.22 + tileHash(x, y, 6) * 0.14;
            ctx.fillStyle = '#857a58';
            ctx.beginPath();
            ctx.moveTo(px + z * (ox - s * 1.3), py + z * (0.72 + oy));
            ctx.lineTo(px + z * ox, py + z * (0.72 + oy - s * 2));
            ctx.lineTo(px + z * (ox + s * 1.3), py + z * (0.72 + oy));
            ctx.closePath();
            ctx.fill();
            // lit face
            ctx.fillStyle = '#b0a37c';
            ctx.beginPath();
            ctx.moveTo(px + z * ox, py + z * (0.72 + oy - s * 2));
            ctx.lineTo(px + z * (ox + s * 1.3), py + z * (0.72 + oy));
            ctx.lineTo(px + z * (ox + s * 0.25), py + z * (0.72 + oy));
            ctx.closePath();
            ctx.fill();
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ track

  private drawTrack(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.lineCap = 'round';

    // Connections: each tile draws a half-segment toward every traversable
    // 8-neighbor; halves meet, forming continuous lines. Diagonals are
    // skipped when the same connection already exists via two orthogonals
    // (keeps junctions visually clean).
    const dirsAt = (x: number, y: number): [number, number][] => {
      const out: [number, number][] = [];
      const trav = (dx: number, dy: number) => isTraversable(state, x + dx, y + dy);
      for (const [dx, dy] of [
        [0, -1], [0, 1], [-1, 0], [1, 0],
      ] as [number, number][]) {
        if (trav(dx, dy)) out.push([dx, dy]);
      }
      for (const [dx, dy] of [
        [1, 1], [1, -1], [-1, 1], [-1, -1],
      ] as [number, number][]) {
        if (trav(dx, dy) && !(trav(dx, 0) && trav(0, dy))) out.push([dx, dy]);
      }
      return out;
    };

    const eachConnected = (
      fn: (cx: number, cy: number, dirs: [number, number][], x: number, y: number) => void,
    ) => {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!isTraversable(state, x, y)) continue;
          fn(sx(x) + z / 2, sy(y) + z / 2, dirsAt(x, y), x, y);
        }
      }
    };

    // Bridge decks under track on water.
    eachConnected((cx, cy, dirs, x, y) => {
      if (state.map.terrain[y * state.map.width + x] !== Terrain.Water) return;
      ctx.strokeStyle = '#6e5436';
      ctx.lineWidth = Math.max(3, z * 0.6);
      for (const [dx, dy] of dirs) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (dx * z) / 2, cy + (dy * z) / 2);
        ctx.stroke();
      }
      if (dirs.length === 0) {
        ctx.beginPath();
        ctx.moveTo(cx - z * 0.3, cy);
        ctx.lineTo(cx + z * 0.3, cy);
        ctx.stroke();
      }
      // pylons
      ctx.fillStyle = '#54402a';
      ctx.fillRect(cx - z * 0.32, cy + z * 0.18, z * 0.14, z * 0.22);
      ctx.fillRect(cx + z * 0.18, cy + z * 0.18, z * 0.14, z * 0.22);
    });

    // Ballast / sleeper bed.
    eachConnected((cx, cy, dirs) => {
      ctx.strokeStyle = '#4a4138';
      ctx.lineWidth = Math.max(2, z * 0.34);
      if (dirs.length === 0) {
        ctx.beginPath();
        ctx.moveTo(cx - z * 0.3, cy);
        ctx.lineTo(cx + z * 0.3, cy);
        ctx.stroke();
        return;
      }
      for (const [dx, dy] of dirs) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (dx * z) / 2, cy + (dy * z) / 2);
        ctx.stroke();
      }
    });

    if (z >= 9) {
      // Sleepers (ties) perpendicular to each connection.
      eachConnected((cx, cy, dirs) => {
        ctx.strokeStyle = '#6b5232';
        ctx.lineWidth = Math.max(1, z * 0.07);
        for (const [dx, dy] of dirs) {
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          // perpendicular
          const tx = -uy;
          const ty = ux;
          const half = (z / 2) * len;
          for (const f of [0.3, 0.75]) {
            const mx = cx + ux * half * f;
            const my = cy + uy * half * f;
            ctx.beginPath();
            ctx.moveTo(mx + tx * z * 0.16, my + ty * z * 0.16);
            ctx.lineTo(mx - tx * z * 0.16, my - ty * z * 0.16);
            ctx.stroke();
          }
        }
      });

      // Twin rails.
      eachConnected((cx, cy, dirs) => {
        ctx.strokeStyle = '#d7d2c8';
        ctx.lineWidth = Math.max(1, z * 0.055);
        const draw = (ax: number, ay: number, bx: number, by: number) => {
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        };
        if (dirs.length === 0) {
          draw(cx - z * 0.3, cy - z * 0.07, cx + z * 0.3, cy - z * 0.07);
          draw(cx - z * 0.3, cy + z * 0.07, cx + z * 0.3, cy + z * 0.07);
          return;
        }
        for (const [dx, dy] of dirs) {
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const tx = -uy * z * 0.09;
          const ty = ux * z * 0.09;
          const ex = cx + (dx * z) / 2;
          const ey = cy + (dy * z) / 2;
          draw(cx + tx, cy + ty, ex + tx, ey + ty);
          draw(cx - tx, cy - ty, ex - tx, ey - ty);
        }
      });
    } else {
      // Low zoom: a single light line keeps track readable.
      eachConnected((cx, cy, dirs) => {
        ctx.strokeStyle = '#cfc8be';
        ctx.lineWidth = Math.max(1, z * 0.1);
        for (const [dx, dy] of dirs) {
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + (dx * z) / 2, cy + (dy * z) / 2);
          ctx.stroke();
        }
      });
    }
  }

  private drawSelectedPath(
    state: GameState,
    ui: UiState,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    if (ui.selected?.kind !== 'train') return;
    const { ctx } = this;
    const z = this.camera.zoom;
    const selectedId = ui.selected.id;
    const train = state.trains.find((t) => t.id === selectedId);
    if (!train || train.path.length <= 1 || train.state !== 'moving') return;
    ctx.strokeStyle = 'rgba(255, 220, 80, 0.6)';
    ctx.lineWidth = Math.max(2, z * 0.16);
    ctx.setLineDash([z * 0.45, z * 0.3]);
    ctx.beginPath();
    for (let i = Math.floor(train.pathPos); i < train.path.length; i++) {
      const p = train.path[i];
      const px = sx(p.x) + z / 2;
      const py = sy(p.y) + z / 2;
      if (i === Math.floor(train.pathPos)) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ----------------------------------------------------------------- towns

  private drawTowns(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    const ROOFS = ['#b8412f', '#a8503c', '#8f4836', '#b85a2e'];
    for (const town of state.towns) {
      if (town.x < x0 - 2 || town.x > x1 + 2 || town.y < y0 - 2 || town.y > y1 + 2) continue;
      const cx = sx(town.x) + z / 2;
      const cy = sy(town.y) + z / 2;
      // building count grows with population; spread evenly around the
      // center and paint back-to-front so roofs overlap naturally
      const buildings = 2 + Math.min(8, Math.floor(town.population / 300));
      const placed = [];
      for (let k = 0; k < buildings; k++) {
        const a = ((k + tileHash(town.id, k, 5)) / buildings) * Math.PI * 2;
        const d = k === 0 ? 0 : (0.6 + tileHash(town.id, k, 6) * 0.6) * z;
        placed.push({
          k,
          bx: cx + Math.cos(a) * d,
          by: cy + Math.sin(a) * d * 0.75,
          bw: z * (0.42 + tileHash(town.id, k, 7) * 0.2),
          bh: z * (0.38 + tileHash(town.id, k, 8) * 0.18),
        });
      }
      placed.sort((p, q) => p.by - q.by);
      for (const { k, bx, by, bw, bh } of placed) {
        // wall
        ctx.fillStyle = '#b09a78';
        ctx.fillRect(bx - bw / 2, by - bh * 0.15, bw, bh * 0.65);
        // roof
        ctx.fillStyle = ROOFS[Math.floor(tileHash(town.id, k, 9) * ROOFS.length)];
        ctx.beginPath();
        ctx.moveTo(bx - bw * 0.62, by - bh * 0.12);
        ctx.lineTo(bx, by - bh * 0.62);
        ctx.lineTo(bx + bw * 0.62, by - bh * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      if (z >= 9) {
        this.label(`${town.name} · ${Math.floor(town.population)}`, cx, sy(town.y) - 5);
      }
    }
  }

  // ------------------------------------------------------------- industries

  private drawIndustries(
    state: GameState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    for (const ind of state.industries) {
      if (ind.x < x0 - 2 || ind.x > x1 + 2 || ind.y < y0 - 2 || ind.y > y1 + 2) continue;
      this.drawIndustry(ind, sx(ind.x), sy(ind.y), z);
      if (z >= 11) this.label(ind.name, sx(ind.x) + z / 2, sy(ind.y) - 4);
    }
  }

  /** Building base tinted by kind with the industry's glyph — distinct and cheap. */
  private drawIndustry(ind: Industry, px: number, py: number, z: number): void {
    const { ctx } = this;
    const def = industryDef(ind.kind);
    const tint = INDUSTRY_TINT[ind.kind] ?? '#7a7a82';

    // shadow + main block
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(px + z * 0.16, py + z * 0.32, z * 0.74, z * 0.62);
    ctx.fillStyle = tint;
    ctx.fillRect(px + z * 0.12, py + z * 0.28, z * 0.74, z * 0.6);
    // roof strip
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(px + z * 0.12, py + z * 0.28, z * 0.74, z * 0.12);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.strokeRect(px + z * 0.12, py + z * 0.28, z * 0.74, z * 0.6);

    // a smokestack for processors / power that have output activity
    if (def.recipe || ind.kind === 'powerPlant') {
      ctx.fillStyle = '#55555c';
      ctx.fillRect(px + z * 0.66, py + z * 0.1, z * 0.12, z * 0.3);
    }
    // glyph
    if (z >= 9) {
      ctx.fillStyle = '#fdfdfa';
      ctx.font = `${Math.floor(z * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.icon, px + z * 0.49, py + z * 0.62);
      ctx.textBaseline = 'alphabetic';
    }
    // activity lamp (green when producing) / idle lamp (amber when a
    // processor is starved of inputs) — makes stalled chains visible at a glance
    if (ind.activity > 0.05) {
      ctx.fillStyle = '#6fe06f';
      ctx.beginPath();
      ctx.arc(px + z * 0.2, py + z * 0.34, z * 0.06, 0, Math.PI * 2);
      ctx.fill();
    } else if (def.recipe && missingInputs(ind, def).length > 0) {
      ctx.fillStyle = '#f0b454';
      ctx.beginPath();
      ctx.arc(px + z * 0.2, py + z * 0.34, z * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --------------------------------------------------------- rival territory

  private drawRivalLinks(
    state: GameState,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    ctx.save();
    ctx.setLineDash([z * 0.5, z * 0.4]);
    ctx.lineWidth = Math.max(1.5, z * 0.1);
    for (const rival of state.rivals) {
      ctx.strokeStyle = rival.color + 'cc';
      for (const link of rival.links) {
        const a = state.towns.find((t) => t.id === link.a);
        const b = state.towns.find((t) => t.id === link.b);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(sx(a.x) + z / 2, sy(a.y) + z / 2);
        ctx.lineTo(sx(b.x) + z / 2, sy(b.y) + z / 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.setLineDash([]);
  }

  // ----------------------------------------------------- supply-chain overlay

  /**
   * When an industry is selected, draw faint directional arrows to its valid
   * upstream suppliers and downstream customers, coloured by the cargo that
   * flows along each link — so a chain reads at a glance on the map.
   */
  private drawChainLinks(
    state: GameState,
    ui: UiState,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    if (ui.selected?.kind !== 'industry') return;
    const selectedId = ui.selected.id;
    const sel = state.industries.find((i) => i.id === selectedId);
    if (!sel) return;
    const { ctx } = this;
    const z = this.camera.zoom;
    const def = industryDef(sel.kind);
    const inputs = industryInputs(def);
    const outputs = industryOutputs(def);
    const cx = sx(sel.x) + z / 2;
    const cy = sy(sel.y) + z / 2;

    const distTo = (p: { x: number; y: number }) => Math.hypot(p.x - sel.x, p.y - sel.y);
    const nearest = <T extends { x: number; y: number }>(arr: T[], n: number): T[] =>
      [...arr].sort((a, b) => distTo(a) - distTo(b)).slice(0, n);

    const color = (kind: string | undefined) => CARGO_BY_ID[kind ?? '']?.color ?? '#c9d4e6';

    // Arrow from A to B with the head at B, pulled back so it stays readable.
    const arrow = (axc: number, ayc: number, bxc: number, byc: number, col: string) => {
      const ang = Math.atan2(byc - ayc, bxc - axc);
      const pad = z * 0.6;
      const ax = axc + Math.cos(ang) * pad;
      const ay = ayc + Math.sin(ang) * pad;
      const bx = bxc - Math.cos(ang) * pad;
      const by = byc - Math.sin(ang) * pad;
      ctx.save();
      ctx.strokeStyle = col + 'cc';
      ctx.fillStyle = col + 'cc';
      ctx.lineWidth = Math.max(1.5, z * 0.08);
      ctx.setLineDash([z * 0.4, z * 0.28]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      const h = Math.max(6, z * 0.42);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(ang - 0.42) * h, by - Math.sin(ang - 0.42) * h);
      ctx.lineTo(bx - Math.cos(ang + 0.42) * h, by - Math.sin(ang + 0.42) * h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    // Upstream: industries that produce one of this industry's inputs.
    const upstream = nearest(
      state.industries.filter(
        (i) => i.id !== sel.id && industryOutputs(industryDef(i.kind)).some((o) => inputs.includes(o)),
      ),
      5,
    );
    for (const u of upstream) {
      const shared = industryOutputs(industryDef(u.kind)).find((o) => inputs.includes(o));
      arrow(sx(u.x) + z / 2, sy(u.y) + z / 2, cx, cy, color(shared));
    }

    // Downstream: industries and towns that consume one of this industry's outputs.
    const downInd = nearest(
      state.industries.filter(
        (i) => i.id !== sel.id && industryInputs(industryDef(i.kind)).some((inp) => outputs.includes(inp)),
      ),
      5,
    );
    for (const d of downInd) {
      const shared = outputs.find((o) => industryInputs(industryDef(d.kind)).includes(o));
      arrow(cx, cy, sx(d.x) + z / 2, sy(d.y) + z / 2, color(shared));
    }
    if (outputs.some((o) => TOWN_DEMANDS.includes(o))) {
      const shared = outputs.find((o) => TOWN_DEMANDS.includes(o));
      for (const t of nearest(state.towns, 4)) {
        arrow(cx, cy, sx(t.x) + z / 2, sy(t.y) + z / 2, color(shared));
      }
    }

    // Highlight the selected industry and, if it's a stalled processor, say why.
    ctx.strokeStyle = '#ffdc50';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx(sel.x) - 2, sy(sel.y) - 2, z + 4, z + 4);
    const miss = def.recipe ? missingInputs(sel, def) : [];
    if (miss.length > 0) {
      const text = `⚠ needs ${miss.map((m) => CARGO_BY_ID[m]?.label ?? m).join(' & ').toLowerCase()}`;
      this.label(text, cx, sy(sel.y) - 6, '#f0b454');
    }
  }

  // --------------------------------------------------------------- stations

  private drawStations(
    state: GameState,
    ui: UiState,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    for (const station of state.stations) {
      if (station.x < x0 - 4 || station.x > x1 + 4 || station.y < y0 - 4 || station.y > y1 + 4)
        continue;
      const px = sx(station.x);
      const py = sy(station.y);
      const selected = ui.selected?.kind === 'station' && ui.selected.id === station.id;

      if (selected) {
        // catchment area sized by tier
        const r = stationRadius(station);
        ctx.fillStyle = 'rgba(120, 170, 255, 0.13)';
        ctx.fillRect(sx(station.x - r), sy(station.y - r), z * (2 * r + 1), z * (2 * r + 1));
        ctx.strokeStyle = 'rgba(120, 170, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx(station.x - r), sy(station.y - r), z * (2 * r + 1), z * (2 * r + 1));
      }

      // platform widens with tier
      const plat = 0.7 + station.level * 0.12;
      const pad = (1 - plat) / 2;
      ctx.fillStyle = '#9b9b9b';
      ctx.fillRect(px + z * pad, py + z * 0.58, z * plat, z * 0.34);
      ctx.fillStyle = '#7d7d7d';
      ctx.fillRect(px + z * pad, py + z * 0.58, z * plat, z * 0.07);
      // building — bigger roof for higher tiers
      const bw = 0.5 + station.level * 0.12;
      ctx.fillStyle = '#d8cdb4';
      ctx.fillRect(px + z * (0.5 - bw / 2), py + z * 0.32, z * bw, z * 0.3);
      ctx.fillStyle = '#3a5f9e';
      ctx.beginPath();
      ctx.moveTo(px + z * (0.5 - bw / 2 - 0.06), py + z * 0.34);
      ctx.lineTo(px + z * 0.5, py + z * 0.08);
      ctx.lineTo(px + z * (0.5 + bw / 2 + 0.06), py + z * 0.34);
      ctx.closePath();
      ctx.fill();
      // tier pips on the roof
      if (z >= 12) {
        ctx.fillStyle = '#ffdc50';
        for (let p = 0; p <= station.level; p++) {
          ctx.beginPath();
          ctx.arc(px + z * (0.36 + p * 0.14), py + z * 0.2, z * 0.04, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (selected) {
        ctx.strokeStyle = '#ffdc50';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 2, py - 2, z + 4, z + 4);
      }
      if (z >= 9) this.label(station.name, px + z / 2, py - 4, '#cfe0ff');
    }
  }

  private drawDraftMarkers(
    state: GameState,
    ui: UiState,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    if (!ui.draft) return;
    const { ctx } = this;
    const z = this.camera.zoom;
    ui.draft.stops.forEach((stopId, i) => {
      const s = getStation(state, stopId);
      if (!s) return;
      const px = sx(s.x) + z / 2;
      const py = sy(s.y) + z / 2;
      ctx.fillStyle = '#ffdc50';
      ctx.strokeStyle = '#7a6312';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py - z * 0.95, Math.max(8, z * 0.45), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.font = `bold ${Math.max(10, Math.floor(z * 0.5))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), px, py - z * 0.95 + Math.max(3.5, z * 0.18));
    });
  }

  // ----------------------------------------------------------------- trains

  private drawTrains(
    state: GameState,
    ui: UiState,
    dt: number,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    const { ctx } = this;
    const z = this.camera.zoom;

    const drawCar = (
      x: number,
      y: number,
      angle: number,
      length: number,
      width: number,
      fill: string,
      isEngine: boolean,
    ) => {
      const px = sx(x) + z / 2;
      const py = sy(y) + z / 2;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-length / 2 + z * 0.05, -width / 2 + z * 0.06, length, width);
      ctx.fillStyle = fill;
      ctx.fillRect(-length / 2, -width / 2, length, width);
      ctx.strokeStyle = '#15181d';
      ctx.lineWidth = Math.max(1, z * 0.06);
      ctx.strokeRect(-length / 2, -width / 2, length, width);
      if (isEngine) {
        // cab window + chimney
        ctx.fillStyle = '#f4f0e6';
        ctx.fillRect(-length * 0.32, -width * 0.28, length * 0.2, width * 0.56);
        ctx.fillStyle = '#22262c';
        ctx.beginPath();
        ctx.arc(length * 0.3, 0, width * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    for (const train of state.trains) {
      const type = trainType(train.typeId);
      const i = Math.min(Math.floor(train.pathPos), train.path.length - 2);
      let angle = 0;
      if (train.path.length > 1 && i >= 0) {
        const a = train.path[i];
        const b = train.path[i + 1];
        angle = Math.atan2(b.y - a.y, b.x - a.x);
      }

      // wagons first so the engine overlaps them
      const gap = 0.72;
      for (let w = type.wagons; w >= 1; w--) {
        const pos =
          train.path.length > 1
            ? positionBehind(train, w * gap)
            : { x: train.x, y: train.y, angle };
        const batch = train.cargo[(w - 1) % Math.max(1, train.cargo.length)];
        const fill =
          train.cargo.length > 0 && batch ? wagonColor(batch.kind) : '#5a5e66';
        drawCar(pos.x, pos.y, pos.angle, z * 0.62, z * 0.42, fill, false);
      }
      drawCar(train.x, train.y, angle, z * 0.8, z * 0.5, type.color, true);

      // smoke from moving engines
      if (train.state === 'moving' && z >= 7 && Math.random() < dt * 14) {
        this.smoke.push({
          x: train.x + 0.5,
          y: train.y + 0.35,
          age: 0,
          life: 0.9 + Math.random() * 0.6,
          drift: (Math.random() - 0.5) * 0.4,
        });
      }

      const selected = ui.selected?.kind === 'train' && ui.selected.id === train.id;
      if (selected) {
        const px = sx(train.x) + z / 2;
        const py = sy(train.y) + z / 2;
        ctx.strokeStyle = '#ffdc50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, z * 0.9, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (train.state === 'stranded') {
        const px = sx(train.x) + z / 2;
        const py = sy(train.y) - z * 0.5;
        this.label('⚠', px, py, '#ffb74d');
      }
    }
  }

  private drawSmoke(dt: number, sx: (t: number) => number, sy: (t: number) => number): void {
    const { ctx } = this;
    const z = this.camera.zoom;
    this.smoke = this.smoke.filter((p) => (p.age += dt) < p.life);
    if (this.smoke.length > 400) this.smoke.splice(0, this.smoke.length - 400);
    for (const p of this.smoke) {
      const t = p.age / p.life;
      const px = sx(p.x - 0.5 + p.drift * t);
      const py = sy(p.y - 0.5 - t * 0.9);
      ctx.fillStyle = `rgba(225, 225, 228, ${0.35 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(px, py, z * (0.1 + t * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ hover

  private drawHover(
    state: GameState,
    ui: UiState,
    sx: (t: number) => number,
    sy: (t: number) => number,
  ): void {
    if (!ui.hover) return;
    const { ctx } = this;
    const z = this.camera.zoom;
    const { x, y } = ui.hover;
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return;

    if (ui.tool === 'track' || ui.tool === 'station' || ui.tool === 'bulldoze' || ui.tool === 'upgrade') {
      const check =
        ui.tool === 'track'
          ? canBuildTrack(state, x, y)
          : ui.tool === 'station'
            ? canBuildStation(state, x, y, ui.stationLevel)
            : ui.tool === 'upgrade'
              ? { ok: stationAt(state, x, y) !== undefined, cost: 0 }
              : { ok: stationAt(state, x, y) !== undefined || hasTrack(state, x, y), cost: 0 };
      ctx.strokeStyle = check.ok ? 'rgba(120, 255, 120, 0.9)' : 'rgba(255, 90, 90, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(x) + 1, sy(y) + 1, z - 2, z - 2);
      if (ui.tool === 'station') {
        const r = stationTier(ui.stationLevel).radius;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.fillRect(sx(x - r), sy(y - r), z * (2 * r + 1), z * (2 * r + 1));
      }
      // cost readout next to the cursor
      if (ui.tool === 'track' && check.ok && check.cost) {
        const total = ui.dragSpent > 0 ? ` (drag $${ui.dragSpent.toLocaleString('en-US')})` : '';
        this.label(`$${check.cost}${total}`, sx(x) + z / 2, sy(y) + z + 13, '#ffe9a8');
      } else if (ui.tool === 'track' && ui.dragSpent > 0) {
        this.label(`drag $${ui.dragSpent.toLocaleString('en-US')}`, sx(x) + z / 2, sy(y) + z + 13, '#ffe9a8');
      }
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx(x) + 1, sy(y) + 1, z - 2, z - 2);
    }
  }

  // ---------------------------------------------------------------- minimap

  private buildMinimapTerrain(state: GameState): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = state.map.width;
    c.height = state.map.height;
    const mctx = c.getContext('2d')!;
    const img = mctx.createImageData(c.width, c.height);
    const COLORS: Record<number, [number, number, number]> = {
      [Terrain.Grass]: [116, 162, 89],
      [Terrain.Forest]: [71, 117, 64],
      [Terrain.Hill]: [150, 138, 102],
      [Terrain.Water]: [58, 104, 150],
    };
    for (let i = 0; i < state.map.terrain.length; i++) {
      const [r, g, b] = COLORS[state.map.terrain[i]];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    return c;
  }

  private drawMinimap(state: GameState): void {
    const { ctx } = this;
    if (this.minimapSeed !== state.seed || !this.minimapTerrain) {
      this.minimapTerrain = this.buildMinimapTerrain(state);
      this.minimapSeed = state.seed;
    }
    const r = this.minimapRect(state);
    const scaleX = r.w / state.map.width;
    const scaleY = r.h / state.map.height;

    // frame
    ctx.fillStyle = 'rgba(12, 16, 22, 0.85)';
    ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.minimapTerrain, r.x, r.y, r.w, r.h);
    ctx.imageSmoothingEnabled = true;

    // track
    ctx.fillStyle = '#2c2620';
    const W = state.map.width;
    for (let i = 0; i < state.track.length; i++) {
      if (state.track[i] !== 1) continue;
      const tx = i % W;
      const ty = (i - tx) / W;
      ctx.fillRect(r.x + tx * scaleX, r.y + ty * scaleY, Math.max(1, scaleX), Math.max(1, scaleY));
    }
    // rival territory lines
    ctx.lineWidth = 1;
    for (const rival of state.rivals) {
      ctx.strokeStyle = rival.color;
      for (const link of rival.links) {
        const a = state.towns.find((t) => t.id === link.a);
        const b = state.towns.find((t) => t.id === link.b);
        if (!a || !b) continue;
        ctx.beginPath();
        ctx.moveTo(r.x + a.x * scaleX, r.y + a.y * scaleY);
        ctx.lineTo(r.x + b.x * scaleX, r.y + b.y * scaleY);
        ctx.stroke();
      }
    }
    // industries / towns / stations / trains
    for (const i of state.industries) {
      ctx.fillStyle = '#6f6f78';
      ctx.fillRect(r.x + i.x * scaleX - 1, r.y + i.y * scaleY - 1, 2, 2);
    }
    for (const t of state.towns) {
      ctx.fillStyle = '#e0a23c';
      ctx.fillRect(r.x + t.x * scaleX - 1, r.y + t.y * scaleY - 1, 3, 3);
    }
    for (const s of state.stations) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(r.x + s.x * scaleX - 1, r.y + s.y * scaleY - 1, 3, 3);
    }
    for (const t of state.trains) {
      ctx.fillStyle = '#ff5246';
      ctx.fillRect(r.x + t.x * scaleX - 1, r.y + t.y * scaleY - 1, 3, 3);
    }

    // viewport rectangle
    const vw = (this.canvas.width / this.camera.zoom) * scaleX;
    const vh = (this.canvas.height / this.camera.zoom) * scaleY;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + this.camera.x * scaleX, r.y + this.camera.y * scaleY, vw, vh);

    ctx.strokeStyle = '#3a4658';
    ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  }

  private label(text: string, cx: number, cy: number, color = '#fff'): void {
    const { ctx } = this;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(10, 14, 20, 0.7)';
    const r = 4;
    const x = cx - w / 2 - 5;
    const y = cy - 11;
    const bw = w + 10;
    const bh = 15;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, r);
    ctx.arcTo(x + bw, y + bh, x, y + bh, r);
    ctx.arcTo(x, y + bh, x, y, r);
    ctx.arcTo(x, y, x + bw, y, r);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  }
}
