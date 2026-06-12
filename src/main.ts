import { DAY_SECONDS } from './game/config';
import { addMessage, newGame, repayLoan, takeLoan } from './game/GameState';
import { update } from './game/Simulation';
import { GameState } from './game/types';
import { assignRoute, buyTrain, sellTrain } from './game/Trains';
import { hashSeed } from './game/rng';
import {
  autosaveToLocalStorage,
  loadFromLocalStorage,
  loadNewestFromLocalStorage,
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

let state: GameState = loadNewestFromLocalStorage() ?? newGame(Date.now() >>> 0);
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
    ui.follow = false;
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
      ui.follow = false;
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
  selectTrain: (id) => {
    ui.selected = { kind: 'train', id };
    ui.panelTab = 'info';
    ui.follow = true;
  },
  toggleFollow: () => {
    ui.follow = !ui.follow;
  },
  sellTrain: (id) => {
    const result = sellTrain(state, id);
    if (!result.ok && result.reason) addMessage(state, result.reason);
    if (result.ok && ui.selected?.kind === 'train' && ui.selected.id === id) {
      ui.selected = null;
      ui.follow = false;
    }
  },
  takeLoan: () => {
    const result = takeLoan(state);
    if (!result.ok && result.reason) addMessage(state, result.reason);
  },
  repayLoan: () => {
    const result = repayLoan(state);
    if (!result.ok && result.reason) addMessage(state, result.reason);
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

// Console/debug access (used by automated smoke tests).
if (import.meta.env.DEV) {
  void import('./game/GameState').then((gs) =>
    import('./game/Trains').then((tr) => {
      (window as unknown as Record<string, unknown>).__rail = {
        getState,
        ui,
        renderer,
        buildTrack: gs.buildTrack,
        buildStation: gs.buildStation,
        buyTrain: tr.buyTrain,
      };
    }),
  );
}

// Autosave so a closed tab never loses more than a couple of minutes.
const AUTOSAVE_SECONDS = 120;
let autosaveTimer = 0;

let last = performance.now();
function frame(now: number): void {
  const dtSeconds = Math.min((now - last) / 1000, 0.1);
  last = now;
  input.tick(dtSeconds);
  if (!ui.paused) {
    update(state, (dtSeconds / DAY_SECONDS) * ui.speed);
    autosaveTimer += dtSeconds;
    if (autosaveTimer >= AUTOSAVE_SECONDS) {
      autosaveTimer = 0;
      autosaveToLocalStorage(state);
    }
  }
  if (ui.follow && ui.selected?.kind === 'train') {
    const followId = ui.selected.id;
    const train = state.trains.find((t) => t.id === followId);
    if (train) renderer.centerOn(train.x, train.y);
    else ui.follow = false;
  }
  renderer.render(state, ui);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
