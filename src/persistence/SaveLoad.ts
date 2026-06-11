import { GameState } from '../game/types';

const SAVE_KEY = 'rail-frontier-save-v1';
const SAVE_VERSION = 1;

interface SaveFile {
  version: number;
  state: GameState;
}

/** Pure serialization — everything in GameState is plain JSON data. */
export function serialize(state: GameState): string {
  const file: SaveFile = { version: SAVE_VERSION, state };
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

export function saveToLocalStorage(state: GameState): void {
  localStorage.setItem(SAVE_KEY, serialize(state));
}

export function loadFromLocalStorage(): GameState | null {
  const json = localStorage.getItem(SAVE_KEY);
  if (!json) return null;
  try {
    return deserialize(json);
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

export function clearSave(): void {
  localStorage.removeItem(SAVE_KEY);
}
