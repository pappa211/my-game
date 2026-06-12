import { buildStation, buildTrack, bulldoze, addMessage } from '../game/GameState';
import { GameState, Station, Train } from '../game/types';
import { Renderer } from './Renderer';
import { Tool, UiState } from './uiState';

export interface AppRefs {
  getState: () => GameState;
  ui: UiState;
  renderer: Renderer;
}

const PAN_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

const TOOL_KEYS: Record<string, Tool> = {
  '1': 'inspect',
  '2': 'track',
  '3': 'station',
  '4': 'train',
  '5': 'route',
  '6': 'bulldoze',
};

export class InputController {
  private app: AppRefs;
  private panning = false;
  private painting = false;
  private minimapDrag = false;
  private lastPaint: { x: number; y: number } | null = null;
  private downPos: { x: number; y: number } | null = null;
  private lastMouse: { x: number; y: number } | null = null;
  private keysDown = new Set<string>();

  constructor(app: AppRefs) {
    this.app = app;
    const canvas = app.renderer.canvas;

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.key.toLowerCase()));
  }

  /** Called every frame for smooth keyboard panning. */
  tick(dtSeconds: number): void {
    const cam = this.app.renderer.camera;
    let dx = 0;
    let dy = 0;
    for (const key of this.keysDown) {
      const dir = PAN_KEYS[key];
      if (dir) {
        dx += dir[0];
        dy += dir[1];
      }
    }
    if (dx !== 0 || dy !== 0) {
      const speed = 600 / cam.zoom; // tiles per second
      cam.x += dx * speed * dtSeconds;
      cam.y += dy * speed * dtSeconds;
      this.app.ui.follow = false;
      this.app.renderer.clampCamera(this.app.getState());
    }
  }

  private canvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.app.renderer.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onMouseDown(e: MouseEvent): void {
    const pos = this.canvasPos(e);
    this.downPos = pos;
    this.lastMouse = pos;
    if (e.button === 0 && e.target === this.app.renderer.canvas) {
      // minimap navigation takes priority over tools
      const world = this.app.renderer.minimapToWorld(this.app.getState(), pos.x, pos.y);
      if (world) {
        this.minimapDrag = true;
        this.jumpTo(world.x, world.y);
        return;
      }
    }
    if (e.button === 1 || e.button === 2) {
      this.panning = true;
      e.preventDefault();
      return;
    }
    if (e.button === 0) {
      const { ui } = this.app;
      if (ui.tool === 'track' || ui.tool === 'bulldoze') {
        this.painting = true;
        this.lastPaint = null;
        ui.dragSpent = 0;
        this.paintAt(pos.x, pos.y);
      }
    }
  }

  private jumpTo(x: number, y: number): void {
    this.app.ui.follow = false;
    this.app.renderer.centerOn(x, y);
    this.app.renderer.clampCamera(this.app.getState());
  }

  private onMouseMove(e: MouseEvent): void {
    const pos = this.canvasPos(e);
    const { renderer, ui, getState } = this.app;
    ui.hover = renderer.screenToTile(pos.x, pos.y);

    if (this.minimapDrag) {
      const world = renderer.minimapToWorld(getState(), pos.x, pos.y);
      if (world) this.jumpTo(world.x, world.y);
    } else if (this.panning && this.lastMouse) {
      renderer.camera.x -= (pos.x - this.lastMouse.x) / renderer.camera.zoom;
      renderer.camera.y -= (pos.y - this.lastMouse.y) / renderer.camera.zoom;
      ui.follow = false;
      renderer.clampCamera(getState());
    } else if (this.painting) {
      this.paintAt(pos.x, pos.y);
    }
    this.lastMouse = pos;
  }

  private onMouseUp(e: MouseEvent): void {
    const pos = this.canvasPos(e);
    if (e.button === 1 || e.button === 2) {
      this.panning = false;
      return;
    }
    if (e.button !== 0) return;
    if (this.minimapDrag) {
      this.minimapDrag = false;
      this.downPos = null;
      return;
    }
    const wasPainting = this.painting;
    this.painting = false;
    this.lastPaint = null;
    this.app.ui.dragSpent = 0;
    if (wasPainting) return;
    if (!this.downPos) return;
    const moved = Math.hypot(pos.x - this.downPos.x, pos.y - this.downPos.y);
    this.downPos = null;
    if (moved > 5) return;
    if (e.target !== this.app.renderer.canvas) return;
    this.clickAt(pos.x, pos.y);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { renderer, getState } = this.app;
    const cam = renderer.camera;
    const pos = this.canvasPos(e);
    const before = renderer.screenToTile(pos.x, pos.y);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    cam.zoom = Math.max(5, Math.min(34, cam.zoom * factor));
    // keep the tile under the cursor fixed
    cam.x = before.x + 0.5 - pos.x / cam.zoom;
    cam.y = before.y + 0.5 - pos.y / cam.zoom;
    renderer.clampCamera(getState());
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    if (PAN_KEYS[e.key] || PAN_KEYS[key]) {
      this.keysDown.add(PAN_KEYS[e.key] ? e.key : key);
      e.preventDefault();
      return;
    }
    const { ui } = this.app;
    if (TOOL_KEYS[e.key]) {
      this.setTool(TOOL_KEYS[e.key]);
    } else if (key === ' ') {
      ui.paused = !ui.paused;
      e.preventDefault();
    } else if (key === 'h') {
      ui.helpVisible = !ui.helpVisible;
    } else if (key === 'f') {
      if (ui.selected?.kind === 'train') ui.follow = !ui.follow;
    } else if (key === 'escape') {
      ui.draft = null;
      ui.selected = null;
      ui.follow = false;
      ui.helpVisible = false;
    }
  }

  setTool(tool: Tool): void {
    const { ui } = this.app;
    ui.tool = tool;
    ui.draft = null;
    if (tool === 'train') {
      ui.draft = { mode: 'buy', typeId: 'local', trainId: null, stops: [] };
    } else if (tool === 'route') {
      ui.draft = { mode: 'reassign', typeId: 'local', trainId: null, stops: [] };
    }
  }

  private paintAt(px: number, py: number): void {
    const { renderer, ui, getState } = this.app;
    const tile = renderer.screenToTile(px, py);
    if (this.lastPaint && this.lastPaint.x === tile.x && this.lastPaint.y === tile.y) return;
    this.lastPaint = tile;
    const state = getState();
    if (ui.tool === 'track') {
      const result = buildTrack(state, tile.x, tile.y);
      if (result.ok) {
        ui.dragSpent += result.cost ?? 0;
      } else if (result.reason?.startsWith('Not enough cash')) {
        addMessage(state, result.reason);
        this.painting = false;
      }
    } else if (ui.tool === 'bulldoze') {
      const result = bulldoze(state, tile.x, tile.y);
      if (!result.ok && result.reason && !result.reason.startsWith('Nothing')) {
        addMessage(state, result.reason);
      }
    }
  }

  private findStationNear(state: GameState, x: number, y: number): Station | undefined {
    return state.stations.find((s) => Math.abs(s.x - x) <= 1 && Math.abs(s.y - y) <= 1);
  }

  private findTrainNear(state: GameState, x: number, y: number): Train | undefined {
    let best: Train | undefined;
    let bestDist = 1.2;
    for (const t of state.trains) {
      const d = Math.hypot(t.x + 0.5 - (x + 0.5), t.y + 0.5 - (y + 0.5));
      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }
    return best;
  }

  private clickAt(px: number, py: number): void {
    const { renderer, ui, getState } = this.app;
    const state = getState();
    const tile = renderer.screenToTile(px, py);
    if (tile.x < 0 || tile.y < 0 || tile.x >= state.map.width || tile.y >= state.map.height) return;

    switch (ui.tool) {
      case 'inspect': {
        ui.panelTab = 'info';
        const train = this.findTrainNear(state, tile.x, tile.y);
        if (train) {
          ui.selected = { kind: 'train', id: train.id };
          return;
        }
        const station = state.stations.find((s) => s.x === tile.x && s.y === tile.y);
        if (station) {
          ui.selected = { kind: 'station', id: station.id };
          return;
        }
        const industry = state.industries.find((i) => i.x === tile.x && i.y === tile.y);
        if (industry) {
          ui.selected = { kind: 'industry', id: industry.id };
          return;
        }
        const town = state.towns.find((t) => t.x === tile.x && t.y === tile.y);
        if (town) {
          ui.selected = { kind: 'town', id: town.id };
          return;
        }
        ui.selected = { kind: 'tile', x: tile.x, y: tile.y };
        return;
      }
      case 'station': {
        const result = buildStation(state, tile.x, tile.y);
        if (!result.ok && result.reason) addMessage(state, result.reason);
        return;
      }
      case 'train': {
        if (!ui.draft) return;
        const station = this.findStationNear(state, tile.x, tile.y);
        if (!station) {
          addMessage(state, 'Click on a station to add it as a stop.');
          return;
        }
        if (ui.draft.stops.includes(station.id)) return;
        ui.draft.stops.push(station.id);
        return;
      }
      case 'route': {
        if (!ui.draft) return;
        if (ui.draft.trainId === null) {
          const train = this.findTrainNear(state, tile.x, tile.y);
          if (train) {
            ui.draft.trainId = train.id;
            ui.selected = { kind: 'train', id: train.id };
          } else {
            addMessage(state, 'Click on a train to reassign its route.');
          }
          return;
        }
        const station = this.findStationNear(state, tile.x, tile.y);
        if (!station) {
          addMessage(state, 'Click stations to build the new route, then Confirm.');
          return;
        }
        if (ui.draft.stops.includes(station.id)) return;
        ui.draft.stops.push(station.id);
        return;
      }
      case 'bulldoze':
      case 'track':
        return;
    }
  }
}
