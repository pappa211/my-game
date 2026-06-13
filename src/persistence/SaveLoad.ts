import { GameState } from '../game/types';

const SAVE_KEY = 'rail-frontier-save-v3';
const AUTOSAVE_KEY = 'rail-frontier-autosave-v3';
const SAVE_VERSION = 3;

interface SaveFile {
  version: number;
  /** wall-clock ms when the save was written */
  savedAt: number;
  state: GameState;
}

/** Pure serialization — everything in GameState is plain JSON data. */
export function serialize(state: GameState): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt: Date.now(), state };
  return JSON.stringify(file);
}

export function deserialize(json: string): GameState {
  const file = JSON.parse(json) as SaveFile;
  if (!file || file.version !== SAVE_VERSION || !file.state) {
    throw new Error('Unrecognized save file format');
  }
  const s = file.state;
  if (!s.map || !Array.isArray(s.track) || !Array.isArray(s.stations)) {
    throw new Error('Save file is missing core state');
  }
  return s;
}

function read(key: string): { state: GameState; savedAt: number } | null {
  const json = localStorage.getItem(key);
  if (!json) return null;
  try {
    const file = JSON.parse(json) as SaveFile;
    return { state: deserialize(json), savedAt: file.savedAt ?? 0 };
  } catch {
    return null;
  }
}

export function saveToLocalStorage(state: GameState): void {
  localStorage.setItem(SAVE_KEY, serialize(state));
}

export function autosaveToLocalStorage(state: GameState): void {
  localStorage.setItem(AUTOSAVE_KEY, serialize(state));
}

/** The manual save slot (used by the Load button). */
export function loadFromLocalStorage(): GameState | null {
  return read(SAVE_KEY)?.state ?? null;
}

/** Newest of the manual save and the autosave (used on startup). */
export function loadNewestFromLocalStorage(): GameState | null {
  const manual = read(SAVE_KEY);
  const auto = read(AUTOSAVE_KEY);
  if (manual && auto) return auto.savedAt > manual.savedAt ? auto.state : manual.state;
  return (manual ?? auto)?.state ?? null;
}

export function hasSave(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
  localStorage.removeItem(AUTOSAVE_KEY);
}
