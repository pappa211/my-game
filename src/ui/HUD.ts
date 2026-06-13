import {
  CARGO_LABELS,
  LOAN_INTEREST_YEARLY,
  LOAN_MAX,
  LOAN_STEP,
  MONTH_DAYS,
  STATION_COST,
  STATION_RADIUS,
  TRACK_COST,
  TRAIN_SELL_FACTOR,
  TRAIN_TYPES,
  YEAR_DAYS,
  trainType,
} from '../game/config';
import {
  cargoCount,
  companyValue,
  industriesServed,
  townsServed,
} from '../game/Economy';
import { getStation, hasTrack, terrainAt } from '../game/GameState';
import { CARGO_KINDS, GameState, IndustryKind, Terrain, Train } from '../game/types';
import { PanelTab, Tool, UiState } from './uiState';

const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Grass]: 'Plains',
  [Terrain.Forest]: 'Forest',
  [Terrain.Hill]: 'Hills',
  [Terrain.Water]: 'Water',
};

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const INDUSTRY_INFO: Record<IndustryKind, { icon: string; desc: string }> = {
  coalMine: {
    icon: '⛏',
    desc: 'Produces coal. Build a station nearby and haul coal to a power plant.',
  },
  powerPlant: {
    icon: '⚡',
    desc: 'Consumes coal. Deliver coal here for revenue.',
  },
  lumberCamp: {
    icon: '🪵',
    desc: 'Produces wood. Build a station nearby and haul wood to a sawmill.',
  },
  sawmill: {
    icon: '🪚',
    desc: 'Consumes wood and turns it into goods — pick the goods up here and deliver them to a town.',
  },
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
  selectTrain: (id: number) => void;
  toggleFollow: () => void;
  sellTrain: (id: number) => void;
  takeLoan: () => void;
  repayLoan: () => void;
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.floor(n)).toLocaleString('en-US')}`;
}

function dateString(day: number): string {
  const d = Math.floor(day);
  const year = Math.floor(d / YEAR_DAYS) + 1;
  const month = Math.floor((d % YEAR_DAYS) / MONTH_DAYS);
  const dom = (d % MONTH_DAYS) + 1;
  return `${MONTH_NAMES[month % 12]} ${dom}, Year ${year}`;
}

const STATUS_ICON: Record<Train['state'], string> = {
  moving: '▶',
  loading: '⏳',
  stranded: '⚠',
};

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
    document.querySelectorAll<HTMLButtonElement>('#paneltabs [data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.ui.panelTab = btn.dataset.tab as PanelTab;
      });
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
      else if (action === 'select-train') this.actions.selectTrain(Number(target.dataset.id));
      else if (action === 'toggle-follow') this.actions.toggleFollow();
      else if (action === 'sell-train') this.actions.sellTrain(Number(target.dataset.id));
      else if (action === 'take-loan') this.actions.takeLoan();
      else if (action === 'repay-loan') this.actions.repayLoan();
    });
  }

  update(): void {
    const state = this.getState();
    const ui = this.ui;
    this.els['stat-cash'].textContent = `💰 ${money(state.cash)}`;
    this.els['stat-cash'].classList.toggle('negative', state.cash < 0);
    this.els['stat-date'].textContent = `📅 ${dateString(state.day)}`;
    const net = state.finances.month.income - state.finances.month.expenses;
    this.els['stat-income'].textContent = `Net ${money(net)}/mo`;
    this.els['stat-income'].classList.toggle('negative', net < 0);
    this.els['stat-expenses'].textContent =
      state.loan > 0 ? `Loan ${money(state.loan)}` : 'No loan';
    this.els['stat-value'].textContent = `Value ${money(companyValue(state))}`;
    this.els['btn-pause'].textContent = ui.paused ? '▶ Resume' : '⏸ Pause';

    document.querySelectorAll<HTMLButtonElement>('#toolbar [data-tool]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === ui.tool);
    });
    document.querySelectorAll<HTMLButtonElement>('.speed').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.speed) === ui.speed && !ui.paused);
    });
    document.querySelectorAll<HTMLButtonElement>('#paneltabs [data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === ui.panelTab);
    });

    this.els['help-overlay'].classList.toggle('hidden', !ui.helpVisible);

    const panelHtml =
      ui.panelTab === 'trains'
        ? this.trainsTabHtml(state)
        : ui.panelTab === 'finance'
          ? this.financeTabHtml(state)
          : this.infoTabHtml(state);
    if (panelHtml !== this.lastPanelHtml) {
      this.els['panel-context'].innerHTML = panelHtml;
      this.lastPanelHtml = panelHtml;
    }

    const messagesHtml = state.messages
      .slice(-12)
      .reverse()
      .map((m) => `<div class="msg"><span class="msg-day">${dateString(m.day)}</span> ${escapeHtml(m.text)}</div>`)
      .join('');
    if (messagesHtml !== this.lastMessagesHtml) {
      this.els['messages'].innerHTML = messagesHtml;
      this.lastMessagesHtml = messagesHtml;
    }
  }

  // -------------------------------------------------------------- info tab

  private infoTabHtml(state: GameState): string {
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
        const waiting = CARGO_KINDS
          .map((k) => ({ k, n: Math.floor(s.waiting[k]) }))
          .filter((e) => e.n > 0)
          .map((e) => `${e.n} ${CARGO_LABELS[e.k]}`)
          .join(', ') || 'nothing';
        return `<h3>🚉 ${escapeHtml(s.name)}</h3>
          <p>Waiting: ${waiting}</p>
          <p>Serves towns: ${escapeHtml(towns)}</p>
          <p>Serves industries: ${escapeHtml(inds)}</p>`;
      }
      case 'town': {
        const t = state.towns.find((t) => t.id === (ui.selected as { id: number }).id);
        if (!t) return this.toolHtml();
        return `<h3>🏘 ${escapeHtml(t.name)}</h3>
          <p>Population: ${Math.floor(t.population)}</p>
          <p>Generates passengers and accepts passengers &amp; goods at stations
          within ${STATION_RADIUS} tiles. Good passenger service makes the town grow.</p>`;
      }
      case 'industry': {
        const i = state.industries.find((i) => i.id === (ui.selected as { id: number }).id);
        if (!i) return this.toolHtml();
        const info = INDUSTRY_INFO[i.kind];
        return `<h3>${info.icon} ${escapeHtml(i.name)}</h3><p>${info.desc}</p>`;
      }
      case 'tile': {
        const { x, y } = ui.selected;
        const terrain = terrainAt(state, x, y);
        const track = hasTrack(state, x, y);
        const cost = TRACK_COST[terrain];
        const what = terrain === Terrain.Water ? 'Bridge' : 'Track';
        return `<h3>Tile (${x}, ${y})</h3>
          <p>Terrain: ${TERRAIN_NAMES[terrain]}</p>
          <p>${track ? 'Has track' : 'No track'}</p>
          <p>${what} cost: ${money(cost)}</p>`;
      }
      default:
        return this.toolHtml();
    }
  }

  private toolHtml(): string {
    const tips: Record<Tool, string> = {
      inspect: 'Click tiles, stations, towns, industries or trains to inspect them.',
      track: `Click or drag to lay track. Plains $${TRACK_COST[Terrain.Grass]}, forest $${TRACK_COST[Terrain.Forest]}, hills $${TRACK_COST[Terrain.Hill]}, bridges over water $${TRACK_COST[Terrain.Water]}. Trains can run diagonally between adjacent track tiles.`,
      station: `Click to place a station ($${STATION_COST}). It serves towns and industries within ${STATION_RADIUS} tiles and connects to adjacent track.`,
      train: 'Pick a train type, click stations to define stops, then Confirm.',
      route: 'Click a train, then click stations for its new route, then Confirm.',
      bulldoze: 'Click or drag to remove track. Click stations to demolish them (must not be on a route).',
    };
    return `<h3>${this.ui.tool[0].toUpperCase() + this.ui.tool.slice(1)} tool</h3><p>${tips[this.ui.tool]}</p>
      <p class="hint">Pan: right-drag / WASD / arrows · Zoom: scroll · Minimap: click to jump ·
      Pause: space · Follow train: F · Help: H</p>`;
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
            <span class="swatch" style="background:${t.color}"></span>${t.name}<br>
            <small>${money(t.cost)} · cap ${t.capacity} · spd ${t.speed} · ${money(t.runningCost)}/day</small>
          </button>`,
      ).join('');
      return `<h3>🚆 Buy Train</h3>${types}${stopsHtml}
        <button class="primary" data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Buy &amp; Start</button>
        <button data-action="clear-draft">Clear</button>`;
    }
    const train = state.trains.find((t) => t.id === draft.trainId);
    if (!train) {
      return `<h3>🗺 Assign Route</h3><p class="hint">Click a train on the map to select it.</p>`;
    }
    return `<h3>🗺 Route for ${escapeHtml(train.name)}</h3>${stopsHtml}
      <button class="primary" data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Assign Route</button>
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
    const sellPrice = Math.round(type.cost * TRAIN_SELL_FACTOR);
    return `<h3>🚆 ${escapeHtml(train.name)}</h3>
      <p><span class="swatch" style="background:${type.color}"></span>${type.name} · cap ${type.capacity} · ${money(type.runningCost)}/day</p>
      <p>Status: ${status}</p>
      <p>Cargo (${cargoCount(train)}/${type.capacity}): ${cargo}</p>
      <p>Lifetime earnings: ${money(train.earnings)}</p>
      <p>Route: ${stops}</p>
      <button data-action="toggle-follow">${this.ui.follow ? '🎥 Stop following' : '🎥 Follow train'}</button>
      <button class="danger" data-action="sell-train" data-id="${train.id}">Sell for ${money(sellPrice)}</button>`;
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

  // ------------------------------------------------------------ trains tab

  private trainsTabHtml(state: GameState): string {
    if (state.trains.length === 0) {
      return `<h3>🚆 Trains</h3><p class="hint">No trains yet. Use the Buy Train tool (key 4).</p>`;
    }
    const rows = state.trains
      .map((t) => {
        const type = trainType(t.typeId);
        const selected = this.ui.selected?.kind === 'train' && this.ui.selected.id === t.id;
        return `<button class="trainrow ${selected ? 'active' : ''} ${t.state === 'stranded' ? 'stranded' : ''}"
            data-action="select-train" data-id="${t.id}">
          <span class="swatch" style="background:${type.color}"></span>
          <span class="trainrow-name">${escapeHtml(t.name)}</span>
          <span class="trainrow-status">${STATUS_ICON[t.state]}</span>
          <span class="trainrow-earn">${money(t.earnings)}</span>
        </button>`;
      })
      .join('');
    return `<h3>🚆 Trains (${state.trains.length})</h3>
      <p class="hint">Lifetime earnings shown. Click to select &amp; follow.</p>${rows}`;
  }

  // ----------------------------------------------------------- finance tab

  private financeTabHtml(state: GameState): string {
    const f = state.finances;
    const bars = [...f.history, f.month];
    const max = Math.max(100, ...bars.map((b) => Math.max(b.income, b.expenses)));
    const chart = bars
      .map((b, i) => {
        const hi = Math.round((b.income / max) * 100);
        const he = Math.round((b.expenses / max) * 100);
        const cur = i === bars.length - 1 ? ' current' : '';
        return `<div class="chart-month${cur}" title="Income ${money(b.income)} · Costs ${money(b.expenses)}">
          <div class="bar income" style="height:${hi}%"></div>
          <div class="bar expense" style="height:${he}%"></div>
        </div>`;
      })
      .join('');
    const net = f.month.income - f.month.expenses;
    const interest = Math.round((state.loan * LOAN_INTEREST_YEARLY) / 12);
    return `<h3>📊 Finances</h3>
      <table class="fin">
        <tr><td>Cash</td><td>${money(state.cash)}</td></tr>
        <tr><td>Company value</td><td>${money(companyValue(state))}</td></tr>
        <tr><td>This month income</td><td>${money(f.month.income)}</td></tr>
        <tr><td>This month costs</td><td>${money(f.month.expenses)}</td></tr>
        <tr><td>This month net</td><td class="${net < 0 ? 'neg' : 'pos'}">${money(net)}</td></tr>
        <tr><td>Last month net</td><td>${money(f.lastMonth.income - f.lastMonth.expenses)}</td></tr>
        <tr><td>All-time net</td><td>${money(f.total.income - f.total.expenses)}</td></tr>
      </table>
      <h4>Monthly history <span class="legend"><i class="inc"></i>income <i class="exp"></i>costs</span></h4>
      <div class="chart">${chart}</div>
      <h4>Bank</h4>
      <p>Loan: ${money(state.loan)} of ${money(LOAN_MAX)} max${state.loan > 0 ? ` · interest ${money(interest)}/mo` : ''}</p>
      <button data-action="take-loan" ${state.loan + LOAN_STEP > LOAN_MAX ? 'disabled' : ''}>Borrow ${money(LOAN_STEP)}</button>
      <button data-action="repay-loan" ${state.loan <= 0 || state.cash < Math.min(LOAN_STEP, state.loan) ? 'disabled' : ''}>Repay ${money(state.loan > 0 ? Math.min(LOAN_STEP, state.loan) : LOAN_STEP)}</button>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
