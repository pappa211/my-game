import { Point } from '../game/types';

export type Tool = 'inspect' | 'track' | 'station' | 'train' | 'route' | 'bulldoze' | 'upgrade';

export type PanelTab = 'info' | 'trains' | 'finance' | 'economy' | 'rankings';

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
  panelTab: PanelTab;
  /** station tier the station tool will place (0 depot, 1 station, 2 terminal) */
  stationLevel: number;
  /** camera tracks the selected train */
  follow: boolean;
  /** money spent during the current track-paint drag (cost readout) */
  dragSpent: number;
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
    panelTab: 'info',
    stationLevel: 1,
    follow: false,
    dragSpent: 0,
  };
}
