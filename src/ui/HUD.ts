import {
  CARGO_LABELS,
  MONTH_DAYS,
  STATION_RADIUS,
  TRACK_COST,
  TRAIN_TYPES,
  YEAR_DAYS,
  trainType,
} from '../game/config';
import {
  companyValue,
  industriesServed,
  townsServed,
} from '../game/Economy';
import { getStation, hasTrack, terrainAt } from '../game/GameState';
import { GameState, Terrain, Train } from '../game/types';
import { Tool, UiState } from './uiState';

const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Grass]: 'Plains',
  [Terrain.Forest]: 'Forest',
  [Terrain.Hill]: 'Hills',
  [Terrain.Water]: 'Water',
};

export interface HudActions {
  setTool: (tool: Tool) => void;
  newGame: () => void;
  save: () => void;
  load: () => void;
  confirmDraft: () => void;
  clearDraft: () => void;
  setDraftType: (typeId: string) => void;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  toggleHelp: () => void;
}

function money(n: number): string {
  return `$${Math.floor(n).toLocaleString('en-US')}`;
}

function dateString(day: number): string {
  const d = Math.floor(day);
  const year = Math.floor(d / YEAR_DAYS) + 1;
  const month = Math.floor((d % YEAR_DAYS) / MONTH_DAYS) + 1;
  const dom = (d % MONTH_DAYS) + 1;
  return `Year ${year}, Month ${month}, Day ${dom}`;
}

export class HUD {
  private getState: () => GameState;
  private ui: UiState;
  private actions: HudActions;
  private els: Record<string, HTMLElement> = {};
  private lastPanelHtml = '';
  private lastMessagesHtml = '';

  constructor(getState: () => GameState, ui: UiState, actions: HudActions) {
    this.getState = getState;
    this.ui = ui;
    this.actions = actions;
    for (const id of [
      'stat-cash', 'stat-date', 'stat-income', 'stat-expenses', 'stat-value',
      'panel-context', 'messages', 'help-overlay', 'btn-pause',
    ]) {
      this.els[id] = document.getElementById(id)!;
    }
    this.bind();
  }

  private bind(): void {
    document.querySelectorAll<HTMLButtonElement>('#toolbar [data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => this.actions.setTool(btn.dataset.tool as Tool));
    });
    document.querySelectorAll<HTMLButtonElement>('.speed').forEach((btn) => {
      btn.addEventListener('click', () => this.actions.setSpeed(Number(btn.dataset.speed)));
    });
    document.getElementById('btn-pause')!.addEventListener('click', () => this.actions.togglePause());
    document.getElementById('btn-save')!.addEventListener('click', () => this.actions.save());
    document.getElementById('btn-load')!.addEventListener('click', () => this.actions.load());
    document.getElementById('btn-new')!.addEventListener('click', () => this.actions.newGame());
    document.getElementById('btn-help')!.addEventListener('click', () => this.actions.toggleHelp());
    this.els['help-overlay'].addEventListener('click', () => this.actions.toggleHelp());

    // Delegated clicks for buttons generated inside the side panel.
    this.els['panel-context'].addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;
      const action = target.dataset.action!;
      if (action === 'confirm-draft') this.actions.confirmDraft();
      else if (action === 'clear-draft') this.actions.clearDraft();
      else if (action === 'set-type') this.actions.setDraftType(target.dataset.type!);
    });
  }

  update(): void {
    const state = this.getState();
    const ui = this.ui;
    this.els['stat-cash'].textContent = `Cash ${money(state.cash)}`;
    (this.els['stat-cash'] as HTMLElement).classList.toggle('negative', state.cash < 0);
    this.els['stat-date'].textContent = dateString(state.day);
    this.els['stat-income'].textContent = `Income ${money(state.finances.month.income)}/mo`;
    this.els['stat-expenses'].textContent = `Costs ${money(state.finances.month.expenses)}/mo`;
    this.els['stat-value'].textContent = `Value ${money(companyValue(state))}`;
    this.els['btn-pause'].textContent = ui.paused ? '▶ Resume' : '⏸ Pause';

    document.querySelectorAll<HTMLButtonElement>('#toolbar [data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === ui.tool);
    });
    document.querySelectorAll<HTMLButtonElement>('.speed').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === ui.speed && !ui.paused);
    });

    this.els['help-overlay'].classList.toggle('hidden', !ui.helpVisible);

    const panelHtml = this.panelHtml(state);
    if (panelHtml !== this.lastPanelHtml) {
      this.els['panel-context'].innerHTML = panelHtml;
      this.lastPanelHtml = panelHtml;
    }

    const messagesHtml = state.messages
      .slice(-10)
      .reverse()
      .map((m) => `<div class="msg"><span class="msg-day">D${Math.floor(m.day) + 1}</span> ${escapeHtml(m.text)}</div>`)
      .join('');
    if (messagesHtml !== this.lastMessagesHtml) {
      this.els['messages'].innerHTML = messagesHtml;
      this.lastMessagesHtml = messagesHtml;
    }
  }

  private panelHtml(state: GameState): string {
    const ui = this.ui;
    if (ui.draft) return this.draftHtml(state);
    switch (ui.selected?.kind) {
      case 'train':
        return this.trainHtml(state, ui.selected.id);
      case 'station': {
        const s = getStation(state, ui.selected.id);
        if (!s) return this.toolHtml();
        const towns = townsServed(state, s).map((t) => t.name).join(', ') || 'none';
        const inds = industriesServed(state, s).map((i) => i.name).join(', ') || 'none';
        return `<h3>🏛 ${escapeHtml(s.name)}</h3>
          <p>Tile (${s.x}, ${s.y})</p>
          <p>Waiting: ${Math.floor(s.waiting.passengers)} passengers, ${Math.floor(s.waiting.coal)} coal</p>
          <p>Serves towns: ${escapeHtml(towns)}</p>
          <p>Serves industries: ${escapeHtml(inds)}</p>`;
      }
      case 'town': {
        const t = state.towns.find((t) => t.id === (ui.selected as { id: number }).id);
        if (!t) return this.toolHtml();
        return `<h3>🏘 ${escapeHtml(t.name)}</h3>
          <p>Population: ${t.population}</p>
          <p>Generates passenger demand at stations within ${STATION_RADIUS} tiles.</p>`;
      }
      case 'industry': {
        const i = state.industries.find((i) => i.id === (ui.selected as { id: number }).id);
        if (!i) return this.toolHtml();
        const desc =
          i.kind === 'coalMine'
            ? 'Produces coal. Build a station nearby and haul coal to a power plant.'
            : 'Consumes coal. Deliver coal here for revenue.';
        return `<h3>${i.kind === 'coalMine' ? '⛏' : '⚡'} ${escapeHtml(i.name)}</h3><p>${desc}</p>`;
      }
      case 'tile': {
        const { x, y } = ui.selected;
        const terrain = terrainAt(state, x, y);
        const track = hasTrack(state, x, y);
        const cost = terrain === Terrain.Water ? null : TRACK_COST[terrain];
        return `<h3>Tile (${x}, ${y})</h3>
          <p>Terrain: ${TERRAIN_NAMES[terrain]}</p>
          <p>${track ? 'Has track' : 'No track'}</p>
          <p>${cost === null ? 'Cannot build here.' : `Track cost: ${money(cost)}`}</p>`;
      }
      default:
        return this.toolHtml();
    }
  }

  private toolHtml(): string {
    const tips: Record<Tool, string> = {
      inspect: 'Click tiles, stations, towns, industries or trains to inspect them.',
      track: `Click or drag to lay track. Costs: plains $${TRACK_COST[Terrain.Grass]}, forest $${TRACK_COST[Terrain.Forest]}, hills $${TRACK_COST[Terrain.Hill]}. Water blocks track.`,
      station: `Click to place a station ($500). It serves towns and industries within ${STATION_RADIUS} tiles and connects to adjacent track.`,
      train: 'Pick a train type, click stations to define stops, then Confirm.',
      route: 'Click a train, then click stations for its new route, then Confirm.',
      bulldoze: 'Click or drag to remove track. Click stations to demolish them (must not be on a route).',
    };
    return `<h3>${this.ui.tool[0].toUpperCase() + this.ui.tool.slice(1)} tool</h3><p>${tips[this.ui.tool]}</p>
      <p class="hint">Pan: right-drag / WASD / arrows · Zoom: scroll · Pause: space · Help: H</p>`;
  }

  private draftHtml(state: GameState): string {
    const draft = this.ui.draft!;
    const stops = draft.stops
      .map((id, i) => {
        const s = getStation(state, id);
        return `<li>${i + 1}. ${escapeHtml(s?.name ?? '?')}</li>`;
      })
      .join('');
    const stopsHtml = stops
      ? `<ol class="stops">${stops}</ol>`
      : '<p class="hint">No stops yet — click stations on the map.</p>';
    if (draft.mode === 'buy') {
      const types = TRAIN_TYPES.map(
        (t) =>
          `<button data-action="set-type" data-type="${t.id}" class="type ${draft.typeId === t.id ? 'active' : ''}">
            ${t.name}<br><small>${money(t.cost)} · cap ${t.capacity} · spd ${t.speed} · ${money(t.runningCost)}/day</small>
          </button>`,
      ).join('');
      return `<h3>🚆 Buy Train</h3>${types}${stopsHtml}
        <button data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Buy &amp; Start</button>
        <button data-action="clear-draft">Clear</button>`;
    }
    const train = state.trains.find((t) => t.id === draft.trainId);
    if (!train) {
      return `<h3>🗺 Assign Route</h3><p class="hint">Click a train on the map to select it.</p>`;
    }
    return `<h3>🗺 Route for ${escapeHtml(train.name)}</h3>${stopsHtml}
      <button data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Assign Route</button>
      <button data-action="clear-draft">Clear</button>`;
  }

  private trainHtml(state: GameState, id: number): string {
    const train = state.trains.find((t) => t.id === id);
    if (!train) return this.toolHtml();
    const type = trainType(train.typeId);
    const status = this.trainStatus(state, train);
    const cargo =
      train.cargo.map((b) => `${b.qty} ${CARGO_LABELS[b.kind]}`).join(', ') || 'empty';
    const stops = train.stops
      .map((sid) => escapeHtml(getStation(state, sid)?.name ?? '?'))
      .join(' → ');
    return `<h3>🚆 ${escapeHtml(train.name)}</h3>
      <p>${type.name} · cap ${type.capacity} · ${money(type.runningCost)}/day</p>
      <p>Status: ${status}</p>
      <p>Cargo: ${cargo}</p>
      <p>Route: ${stops}</p>`;
  }

  private trainStatus(state: GameState, train: Train): string {
    if (train.state === 'moving') {
      const to = getStation(state, train.targetStationId ?? -1);
      return `en route to ${escapeHtml(to?.name ?? '?')}`;
    }
    const at = getStation(state, train.atStationId);
    if (train.state === 'loading') return `loading at ${escapeHtml(at?.name ?? '?')}`;
    return `⚠ stranded at ${escapeHtml(at?.name ?? '?')} — no track connection`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
