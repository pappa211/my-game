import { STATION_RADIUS, trainType } from '../game/config';
import {
  canBuildStation,
  canBuildTrack,
  getStation,
  isTraversable,
  stationAt,
} from '../game/GameState';
import { GameState, Point, Terrain } from '../game/types';
import { UiState } from './uiState';

const TERRAIN_COLORS: Record<number, [string, string]> = {
  [Terrain.Grass]: ['#79a85e', '#71a056'],
  [Terrain.Forest]: ['#4a7a42', '#436f3c'],
  [Terrain.Hill]: ['#9a8f6a', '#908563'],
  [Terrain.Water]: ['#3e6f9e', '#3a6896'],
};

export interface Camera {
  /** top-left corner in tile coordinates */
  x: number;
  y: number;
  /** pixels per tile */
  zoom: number;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  camera: Camera = { x: 0, y: 0, zoom: 14 };

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

  render(state: GameState, ui: UiState): void {
    const { ctx, camera } = this;
    const z = camera.zoom;
    ctx.fillStyle = '#1c2330';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const x0 = Math.max(0, Math.floor(camera.x));
    const y0 = Math.max(0, Math.floor(camera.y));
    const x1 = Math.min(state.map.width - 1, Math.ceil(camera.x + this.canvas.width / z));
    const y1 = Math.min(state.map.height - 1, Math.ceil(camera.y + this.canvas.height / z));

    const sx = (tx: number) => (tx - camera.x) * z;
    const sy = (ty: number) => (ty - camera.y) * z;

    // Terrain
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = state.map.terrain[y * state.map.width + x];
        ctx.fillStyle = TERRAIN_COLORS[t][(x * 7 + y * 13) % 2];
        ctx.fillRect(sx(x), sy(y), z + 1, z + 1);
      }
    }

    // Terrain decorations at high zoom
    if (z >= 12) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const t = state.map.terrain[y * state.map.width + x];
          if (t === Terrain.Forest) {
            ctx.fillStyle = '#335c2e';
            ctx.beginPath();
            ctx.arc(sx(x) + z * 0.5, sy(y) + z * 0.45, z * 0.22, 0, Math.PI * 2);
            ctx.fill();
          } else if (t === Terrain.Hill) {
            ctx.strokeStyle = '#7a7050';
            ctx.lineWidth = Math.max(1, z * 0.08);
            ctx.beginPath();
            ctx.moveTo(sx(x) + z * 0.25, sy(y) + z * 0.7);
            ctx.lineTo(sx(x) + z * 0.5, sy(y) + z * 0.3);
            ctx.lineTo(sx(x) + z * 0.75, sy(y) + z * 0.7);
            ctx.stroke();
          }
        }
      }
    }

    // Track
    ctx.lineCap = 'round';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!isTraversable(state, x, y)) continue;
        const cx = sx(x) + z / 2;
        const cy = sy(y) + z / 2;
        const dirs: [number, number][] = [];
        if (isTraversable(state, x, y - 1)) dirs.push([0, -1]);
        if (isTraversable(state, x, y + 1)) dirs.push([0, 1]);
        if (isTraversable(state, x - 1, y)) dirs.push([-1, 0]);
        if (isTraversable(state, x + 1, y)) dirs.push([1, 0]);
        ctx.strokeStyle = '#3c3631';
        ctx.lineWidth = Math.max(2, z * 0.32);
        if (dirs.length === 0) {
          ctx.beginPath();
          ctx.moveTo(cx - z * 0.3, cy);
          ctx.lineTo(cx + z * 0.3, cy);
          ctx.stroke();
        } else {
          for (const [dx, dy] of dirs) {
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + (dx * z) / 2, cy + (dy * z) / 2);
            ctx.stroke();
          }
        }
        if (z >= 10) {
          ctx.strokeStyle = '#cfc8be';
          ctx.lineWidth = Math.max(1, z * 0.08);
          if (dirs.length === 0) {
            ctx.beginPath();
            ctx.moveTo(cx - z * 0.3, cy);
            ctx.lineTo(cx + z * 0.3, cy);
            ctx.stroke();
          } else {
            for (const [dx, dy] of dirs) {
              ctx.beginPath();
              ctx.moveTo(cx, cy);
              ctx.lineTo(cx + (dx * z) / 2, cy + (dy * z) / 2);
              ctx.stroke();
            }
          }
        }
      }
    }

    // Selected train's remaining path
    if (ui.selected?.kind === 'train') {
      const selectedId = ui.selected.id;
      const train = state.trains.find((t) => t.id === selectedId);
      if (train && train.path.length > 1 && train.state === 'moving') {
        ctx.strokeStyle = 'rgba(255, 220, 80, 0.55)';
        ctx.lineWidth = Math.max(2, z * 0.18);
        ctx.beginPath();
        for (let i = Math.floor(train.pathPos); i < train.path.length; i++) {
          const p = train.path[i];
          const px = sx(p.x) + z / 2;
          const py = sy(p.y) + z / 2;
          if (i === Math.floor(train.pathPos)) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }

    // Towns
    for (const town of state.towns) {
      if (town.x < x0 - 2 || town.x > x1 + 2 || town.y < y0 - 2 || town.y > y1 + 2) continue;
      const px = sx(town.x);
      const py = sy(town.y);
      ctx.fillStyle = '#8a5a3a';
      ctx.fillRect(px + z * 0.18, py + z * 0.4, z * 0.64, z * 0.5);
      ctx.fillStyle = '#b8412f';
      ctx.beginPath();
      ctx.moveTo(px + z * 0.08, py + z * 0.45);
      ctx.lineTo(px + z * 0.5, py + z * 0.08);
      ctx.lineTo(px + z * 0.92, py + z * 0.45);
      ctx.closePath();
      ctx.fill();
      if (z >= 9) {
        this.label(`${town.name} (${town.population})`, px + z / 2, py - 3);
      }
    }

    // Industries
    for (const ind of state.industries) {
      if (ind.x < x0 - 2 || ind.x > x1 + 2 || ind.y < y0 - 2 || ind.y > y1 + 2) continue;
      const px = sx(ind.x);
      const py = sy(ind.y);
      if (ind.kind === 'coalMine') {
        ctx.fillStyle = '#2e2e34';
        ctx.beginPath();
        ctx.moveTo(px + z * 0.1, py + z * 0.9);
        ctx.lineTo(px + z * 0.5, py + z * 0.1);
        ctx.lineTo(px + z * 0.9, py + z * 0.9);
        ctx.closePath();
        ctx.fill();
        if (z >= 10) {
          ctx.fillStyle = '#ddd';
          ctx.font = `bold ${Math.floor(z * 0.45)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText('C', px + z * 0.5, py + z * 0.82);
        }
      } else {
        ctx.fillStyle = '#caa53d';
        ctx.fillRect(px + z * 0.12, py + z * 0.2, z * 0.76, z * 0.68);
        ctx.fillStyle = '#5a4a16';
        ctx.font = `bold ${Math.floor(z * 0.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('⚡', px + z * 0.5, py + z * 0.72);
      }
      if (z >= 11) this.label(ind.name, px + z / 2, py - 3);
    }

    // Stations
    for (const station of state.stations) {
      if (station.x < x0 - 2 || station.x > x1 + 2 || station.y < y0 - 2 || station.y > y1 + 2) continue;
      const px = sx(station.x);
      const py = sy(station.y);
      ctx.fillStyle = '#2255cc';
      ctx.fillRect(px + z * 0.1, py + z * 0.1, z * 0.8, z * 0.8);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, z * 0.08);
      ctx.strokeRect(px + z * 0.1, py + z * 0.1, z * 0.8, z * 0.8);
      if (z >= 9) this.label(station.name, px + z / 2, py - 3, '#bcd2ff');
      if (
        ui.selected?.kind === 'station' &&
        (ui.selected as { id: number }).id === station.id
      ) {
        ctx.strokeStyle = '#ffdc50';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 2, py - 2, z + 4, z + 4);
      }
    }

    // Draft route stop markers
    if (ui.draft) {
      ui.draft.stops.forEach((stopId, i) => {
        const s = getStation(state, stopId);
        if (!s) return;
        const px = sx(s.x) + z / 2;
        const py = sy(s.y) + z / 2;
        ctx.fillStyle = '#ffdc50';
        ctx.beginPath();
        ctx.arc(px, py - z * 0.9, Math.max(7, z * 0.45), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#222';
        ctx.font = `bold ${Math.max(9, Math.floor(z * 0.5))}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), px, py - z * 0.9 + Math.max(3, z * 0.18));
      });
    }

    // Trains
    for (const train of state.trains) {
      const type = trainType(train.typeId);
      const px = sx(train.x) + z / 2;
      const py = sy(train.y) + z / 2;
      const i = Math.min(Math.floor(train.pathPos), train.path.length - 2);
      let angle = 0;
      if (train.path.length > 1 && i >= 0) {
        const a = train.path[i];
        const b = train.path[i + 1];
        angle = Math.atan2(b.y - a.y, b.x - a.x);
      }
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      const len = z * 0.95;
      const wid = z * 0.55;
      ctx.fillStyle = type.color;
      ctx.fillRect(-len / 2, -wid / 2, len, wid);
      ctx.strokeStyle = '#15181d';
      ctx.lineWidth = Math.max(1, z * 0.07);
      ctx.strokeRect(-len / 2, -wid / 2, len, wid);
      ctx.fillStyle = '#f4f0e6';
      ctx.fillRect(len * 0.12, -wid * 0.28, len * 0.22, wid * 0.56);
      ctx.restore();
      if (
        ui.selected?.kind === 'train' &&
        (ui.selected as { id: number }).id === train.id
      ) {
        ctx.strokeStyle = '#ffdc50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, z * 0.85, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Hover overlays
    if (ui.hover) {
      const { x, y } = ui.hover;
      if (x >= 0 && y >= 0 && x < state.map.width && y < state.map.height) {
        if (ui.tool === 'track' || ui.tool === 'station' || ui.tool === 'bulldoze') {
          const check =
            ui.tool === 'track'
              ? canBuildTrack(state, x, y)
              : ui.tool === 'station'
                ? canBuildStation(state, x, y)
                : { ok: stationAt(state, x, y) !== undefined || isTraversable(state, x, y) };
          ctx.strokeStyle = check.ok ? 'rgba(120, 255, 120, 0.9)' : 'rgba(255, 90, 90, 0.9)';
          ctx.lineWidth = 2;
          ctx.strokeRect(sx(x) + 1, sy(y) + 1, z - 2, z - 2);
          if (ui.tool === 'station') {
            const r = STATION_RADIUS;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.fillRect(sx(x - r), sy(y - r), z * (2 * r + 1), z * (2 * r + 1));
          }
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx(x) + 1, sy(y) + 1, z - 2, z - 2);
        }
      }
    }
  }

  private label(text: string, cx: number, cy: number, color = '#fff'): void {
    const { ctx } = this;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.85)';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  }
}
