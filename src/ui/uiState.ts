import { Point } from '../game/types';

export type Tool = 'inspect' | 'track' | 'station' | 'train' | 'route' | 'bulldoze';

export type Selection =
  | { kind: 'tile'; x: number; y: number }
  | { kind: 'station'; id: number }
  | { kind: 'train'; id: number }
  | { kind: 'town'; id: number }
  | { kind: 'industry'; id: number }
  | null;

/** Draft state while picking stops for a new train or a route reassignment. */
export interface RouteDraft {
  mode: 'buy' | 'reassign';
  typeId: string;
  trainId: number | null;
  stops: number[];
}

export interface UiState {
  tool: Tool;
  hover: Point | null;
  selected: Selection;
  draft: RouteDraft | null;
  speed: number;
  paused: boolean;
  helpVisible: boolean;
}

export function createUiState(): UiState {
  return {
    tool: 'inspect',
    hover: null,
    selected: null,
    draft: null,
    speed: 1,
    paused: false,
    helpVisible: true,
  };
}
