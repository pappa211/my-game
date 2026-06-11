import { DAY_SECONDS } from './game/config';
import { addMessage, newGame } from './game/GameState';
import { update } from './game/Simulation';
import { GameState } from './game/types';
import { assignRoute, buyTrain } from './game/Trains';
import { hashSeed } from './game/rng';
import {
  loadFromLocalStorage,
  saveToLocalStorage,
} from './persistence/SaveLoad';
import { HUD } from './ui/HUD';
import { InputController } from './ui/InputController';
import { Renderer } from './ui/Renderer';
import { createUiState } from './ui/uiState';
import './style.css';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const ui = createUiState();

let state: GameState = loadFromLocalStorage() ?? newGame(Date.now() >>> 0);
const getState = () => state;

function centerOnStart(): void {
  const anchor = state.towns[0];
  if (anchor) renderer.centerOn(anchor.x, anchor.y);
}

const input = new InputController({ getState, ui, renderer });

const hud = new HUD(getState, ui, {
  setTool: (tool) => input.setTool(tool),
  newGame: () => {
    const answer = window.prompt('Seed for the new world (any text or number):', String(Date.now() % 100000));
    if (answer === null) return;
    const seed = /^\d+$/.test(answer.trim()) ? Number(answer.trim()) >>> 0 : hashSeed(answer);
    state = newGame(seed);
    ui.selected = null;
    ui.draft = null;
    centerOnStart();
  },
  save: () => {
    saveToLocalStorage(state);
    addMessage(state, 'Game saved.');
  },
  load: () => {
    const loaded = loadFromLocalStorage();
    if (loaded) {
      state = loaded;
      ui.selected = null;
      ui.draft = null;
      addMessage(state, 'Game loaded.');
    } else {
      addMessage(state, 'No saved game found.');
    }
  },
  confirmDraft: () => {
    if (!ui.draft) return;
    if (ui.draft.mode === 'buy') {
      const result = buyTrain(state, ui.draft.typeId, ui.draft.stops);
      if (result.ok && result.train) {
        ui.draft.stops = [];
        ui.selected = { kind: 'train', id: result.train.id };
        input.setTool('inspect');
      } else if (result.reason) {
        addMessage(state, result.reason);
      }
    } else if (ui.draft.trainId !== null) {
      const result = assignRoute(state, ui.draft.trainId, ui.draft.stops);
      if (result.ok) {
        ui.selected = { kind: 'train', id: ui.draft.trainId };
        input.setTool('inspect');
      } else if (result.reason) {
        addMessage(state, result.reason);
      }
    }
  },
  clearDraft: () => {
    if (ui.draft) {
      ui.draft.stops = [];
      if (ui.draft.mode === 'reassign') ui.draft.trainId = null;
    }
  },
  setDraftType: (typeId) => {
    if (ui.draft) ui.draft.typeId = typeId;
  },
  setSpeed: (speed) => {
    ui.speed = speed;
    ui.paused = false;
  },
  togglePause: () => {
    ui.paused = !ui.paused;
  },
  toggleHelp: () => {
    ui.helpVisible = !ui.helpVisible;
  },
});

function fitCanvas(): void {
  const main = document.getElementById('main')!;
  const rect = main.getBoundingClientRect();
  const side = document.getElementById('sidepanel')!.getBoundingClientRect();
  renderer.resize(Math.max(200, rect.width - side.width), Math.max(200, rect.height));
}

window.addEventListener('resize', fitCanvas);
fitCanvas();
centerOnStart();

let last = performance.now();
function frame(now: number): void {
  const dtSeconds = Math.min((now - last) / 1000, 0.1);
  last = now;
  input.tick(dtSeconds);
  if (!ui.paused) {
    update(state, (dtSeconds / DAY_SECONDS) * ui.speed);
  }
  renderer.render(state, ui);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
