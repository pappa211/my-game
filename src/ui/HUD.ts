import { CARGOS, cargoDef } from '../game/cargo';
import {
  availableTrainTypes,
  LOAN_INTEREST_YEARLY,
  LOAN_STEP,
  MONTH_DAYS,
  STATION_TIERS,
  stationTier,
  TRACK_COST,
  TRAIN_SELL_FACTOR,
  trainType,
  YEAR_DAYS,
} from '../game/config';
import {
  cargoCount,
  companyValue,
  industriesServed,
  stationRadius,
  townsServed,
} from '../game/Economy';
import { getStation, hasTrack, loanLimit, terrainAt } from '../game/GameState';
import {
  industryDef,
  industryInputs,
  industryOutputs,
} from '../game/industries';
import { rankings } from '../game/Rivals';
import { currentYear, GameState, Terrain, Train } from '../game/types';
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
  upgradeStation: (id: number) => void;
  setStationLevel: (level: number) => void;
}

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.floor(n)).toLocaleString('en-US')}`;
}

function dateString(state: GameState): string {
  const d = Math.floor(state.day);
  const month = Math.floor((d % YEAR_DAYS) / MONTH_DAYS);
  const dom = (d % MONTH_DAYS) + 1;
  return `${MONTH_NAMES[month % 12]} ${dom}, ${currentYear(state)}`;
}

function economyLabel(e: number): string {
  if (e >= 1.12) return '📈 Boom';
  if (e <= 0.85) return '📉 Bust';
  return '◦ Stable';
}

const STATUS_ICON: Record<Train['state'], string> = {
  moving: '▶',
  loading: '⏳',
  stranded: '⚠',
  broken: '🔧',
};

function swatch(color: string): string {
  return `<span class="swatch" style="background:${color}"></span>`;
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
      'stat-cash', 'stat-date', 'stat-econ', 'stat-income', 'stat-value',
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
      else if (action === 'upgrade-station') this.actions.upgradeStation(Number(target.dataset.id));
      else if (action === 'set-level') this.actions.setStationLevel(Number(target.dataset.level));
    });
  }

  update(): void {
    const state = this.getState();
    const ui = this.ui;
    this.els['stat-cash'].textContent = `💰 ${money(state.cash)}`;
    this.els['stat-cash'].classList.toggle('negative', state.cash < 0);
    this.els['stat-date'].textContent = `📅 ${dateString(state)}`;
    this.els['stat-econ'].textContent = economyLabel(state.economy);
    const net = state.finances.month.income - state.finances.month.expenses;
    this.els['stat-income'].textContent = `Net ${money(net)}/mo`;
    this.els['stat-income'].classList.toggle('negative', net < 0);
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

    const panelHtml = this.panelHtml(state);
    if (panelHtml !== this.lastPanelHtml) {
      this.els['panel-context'].innerHTML = panelHtml;
      this.lastPanelHtml = panelHtml;
    }

    const messagesHtml = state.messages
      .slice(-14)
      .reverse()
      .map(
        (m) =>
          `<div class="msg ${m.kind ?? 'info'}"><span class="msg-day">${dateString({ ...state, day: m.day } as GameState)}</span> ${escapeHtml(m.text)}</div>`,
      )
      .join('');
    if (messagesHtml !== this.lastMessagesHtml) {
      this.els['messages'].innerHTML = messagesHtml;
      this.lastMessagesHtml = messagesHtml;
    }
  }

  private panelHtml(state: GameState): string {
    switch (this.ui.panelTab) {
      case 'trains': return this.trainsTabHtml(state);
      case 'finance': return this.financeTabHtml(state);
      case 'economy': return this.economyTabHtml(state);
      case 'rankings': return this.rankingsTabHtml(state);
      default: return this.infoTabHtml(state);
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
        const tier = stationTier(s.level);
        const towns = townsServed(state, s).map((t) => t.name).join(', ') || 'none';
        const inds = industriesServed(state, s).map((i) => i.name).join(', ') || 'none';
        const waiting = CARGOS
          .map((c) => ({ c, n: Math.floor(s.waiting[c.id] ?? 0) }))
          .filter((e) => e.n > 0)
          .map((e) => `${swatch(e.c.color)}${e.n} ${e.c.label.toLowerCase()}`)
          .join('<br>') || 'nothing';
        const canUpgrade = s.level < STATION_TIERS.length - 1;
        const next = canUpgrade ? stationTier(s.level + 1) : null;
        const upBtn = next
          ? `<button data-action="upgrade-station" data-id="${s.id}">⬆ Upgrade to ${next.name} (${money(next.cost - tier.cost)}, radius ${next.radius})</button>`
          : '<p class="hint">Largest tier.</p>';
        return `<h3>🚉 ${escapeHtml(s.name)}</h3>
          <p>${tier.name} · catchment radius ${stationRadius(s)} · cap ${tier.cargoCap}</p>
          <p><b>Waiting:</b><br>${waiting}</p>
          <p>Serves towns: ${escapeHtml(towns)}</p>
          <p>Serves industries: ${escapeHtml(inds)}</p>
          ${upBtn}`;
      }
      case 'town': {
        const t = state.towns.find((t) => t.id === (ui.selected as { id: number }).id);
        if (!t) return this.toolHtml();
        const contested = state.rivals.some((r) =>
          r.links.some((l) => l.a === t.id || l.b === t.id),
        );
        const service = Math.round(t.serviceLevel * 100);
        return `<h3>🏘 ${escapeHtml(t.name)}</h3>
          <p>Population: ${Math.floor(t.population).toLocaleString('en-US')}</p>
          <p>Service rating: ${service}%</p>
          <p>Wants: passengers, mail, goods, food, lumber. Demanded deliveries grow the town.</p>
          ${contested ? '<p class="warn-text">⚠ A rival railroad is courting this town — connect it before they take the traffic.</p>' : ''}`;
      }
      case 'industry': {
        const i = state.industries.find((i) => i.id === (ui.selected as { id: number }).id);
        if (!i) return this.toolHtml();
        const def = industryDef(i.kind);
        const outs = industryOutputs(def).map((c) => `${swatch(cargoDef(c).color)}${cargoDef(c).label}`).join(' ');
        const ins = industryInputs(def).map((c) => `${swatch(cargoDef(c).color)}${cargoDef(c).label}`).join(' ');
        const stock = industryInputs(def)
          .map((c) => ({ c, n: Math.floor(i.stock[c] ?? 0) }))
          .filter((e) => e.n > 0)
          .map((e) => `${cargoDef(e.c).label} ${e.n}`)
          .join(', ') || '—';
        return `<h3>${def.icon} ${escapeHtml(i.name)}</h3>
          <p>${def.label}</p>
          ${ins ? `<p><b>Wants:</b> ${ins}</p>` : ''}
          ${outs ? `<p><b>Ships:</b> ${outs}</p>` : ''}
          ${def.recipe ? `<p>Stockpiled inputs: ${stock}</p><p>Activity: ${Math.round(i.activity * 100)}%</p>` : ''}`;
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
    const ui = this.ui;
    if (ui.tool === 'station') {
      const tiers = STATION_TIERS.map(
        (t) =>
          `<button data-action="set-level" data-level="${t.level}" class="type ${ui.stationLevel === t.level ? 'active' : ''}">
            ${t.name}<br><small>${money(t.cost)} · radius ${t.radius} · cap ${t.cargoCap}</small>
          </button>`,
      ).join('');
      return `<h3>🚉 Station tool</h3><p class="hint">Pick a tier, then click to place. Bigger tiers reach further and hold more cargo.</p>${tiers}`;
    }
    const tips: Record<Tool, string> = {
      inspect: 'Click tiles, stations, towns, industries or trains to inspect them.',
      track: `Drag to lay track. Plains $${TRACK_COST[Terrain.Grass]}, forest $${TRACK_COST[Terrain.Forest]}, hills $${TRACK_COST[Terrain.Hill]}, bridges $${TRACK_COST[Terrain.Water]}. Trains run diagonals automatically.`,
      station: '',
      train: 'Pick a locomotive, click stations to define stops, then Confirm.',
      route: 'Click a train, then click stations for its new route, then Confirm.',
      bulldoze: 'Click or drag to remove track. Click stations to demolish them (must not be on a route).',
      upgrade: 'Click one of your stations to upgrade it to the next tier.',
    };
    return `<h3>${ui.tool[0].toUpperCase() + ui.tool.slice(1)} tool</h3><p>${tips[ui.tool]}</p>
      <p class="hint">Pan: right-drag / WASD · Zoom: scroll · Minimap: click to jump ·
      Pause: space · Follow: F · Help: H</p>`;
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
      const year = currentYear(state);
      const avail = availableTrainTypes(year);
      const types = avail.map(
        (t) =>
          `<button data-action="set-type" data-type="${t.id}" class="type ${draft.typeId === t.id ? 'active' : ''}">
            ${swatch(t.color)}${t.name}<br>
            <small>${money(t.cost)} · cap ${t.capacity} · spd ${t.speed} · ${Math.round(t.reliability * 100)}% rel · ${money(t.runningCost)}/day</small>
          </button>`,
      ).join('');
      return `<h3>🚆 Buy Locomotive · ${year}</h3>${types}${stopsHtml}
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
      train.cargo.map((b) => `${swatch(cargoDef(b.kind).color)}${b.qty} ${cargoDef(b.kind).label.toLowerCase()}`).join('<br>') || 'empty';
    const stops = train.stops
      .map((sid) => escapeHtml(getStation(state, sid)?.name ?? '?'))
      .join(' → ');
    const sellPrice = Math.round(type.cost * TRAIN_SELL_FACTOR);
    const age = Math.max(0, Math.floor((state.day - train.builtDay) / 360));
    return `<h3>🚆 ${escapeHtml(train.name)}</h3>
      <p>${swatch(type.color)}${type.name} · cap ${type.capacity} · ${money(type.runningCost)}/day · age ${age}y</p>
      <p>Status: ${status}</p>
      <p>Cargo (${cargoCount(train)}/${type.capacity}):<br>${cargo}</p>
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
    if (train.state === 'broken') return '🔧 broken down — under repair';
    const at = getStation(state, train.atStationId);
    if (train.state === 'loading') return `loading at ${escapeHtml(at?.name ?? '?')}`;
    return `⚠ stranded at ${escapeHtml(at?.name ?? '?')} — no track connection`;
  }

  // ------------------------------------------------------------ trains tab

  private trainsTabHtml(state: GameState): string {
    if (state.trains.length === 0) {
      return `<h3>🚆 Fleet</h3><p class="hint">No trains yet. Use the Buy Train tool (key 4).</p>`;
    }
    const rows = state.trains
      .map((t) => {
        const type = trainType(t.typeId);
        const selected = this.ui.selected?.kind === 'train' && this.ui.selected.id === t.id;
        return `<button class="trainrow ${selected ? 'active' : ''} ${t.state === 'stranded' || t.state === 'broken' ? 'stranded' : ''}"
            data-action="select-train" data-id="${t.id}">
          ${swatch(type.color)}
          <span class="trainrow-name">${escapeHtml(t.name)}</span>
          <span class="trainrow-status">${STATUS_ICON[t.state]}</span>
          <span class="trainrow-earn">${money(t.earnings)}</span>
        </button>`;
      })
      .join('');
    const total = state.trains.reduce((s, t) => s + t.earnings, 0);
    return `<h3>🚆 Fleet (${state.trains.length})</h3>
      <p class="hint">Lifetime earnings shown · fleet total ${money(total)}. Click to follow.</p>${rows}`;
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
    const limit = loanLimit(state);
    const interest = Math.round((state.loan * LOAN_INTEREST_YEARLY) / 12);
    return `<h3>📊 Finances</h3>
      <table class="fin">
        <tr><td>Cash</td><td>${money(state.cash)}</td></tr>
        <tr><td>Company value</td><td>${money(companyValue(state))}</td></tr>
        <tr><td>Economy</td><td>${economyLabel(state.economy)} (×${state.economy.toFixed(2)})</td></tr>
        <tr><td>This month net</td><td class="${net < 0 ? 'neg' : 'pos'}">${money(net)}</td></tr>
        <tr><td>Last month net</td><td>${money(f.lastMonth.income - f.lastMonth.expenses)}</td></tr>
        <tr><td>All-time net</td><td>${money(f.total.income - f.total.expenses)}</td></tr>
      </table>
      <h4>Monthly history <span class="legend"><i class="inc"></i>income <i class="exp"></i>costs</span></h4>
      <div class="chart">${chart}</div>
      <h4>Bonds</h4>
      <p>Outstanding ${money(state.loan)} of ${money(limit)} credit line${state.loan > 0 ? ` · interest ${money(interest)}/mo` : ''}</p>
      <button data-action="take-loan" ${state.loan + LOAN_STEP > limit ? 'disabled' : ''}>Issue ${money(LOAN_STEP)} bond</button>
      <button data-action="repay-loan" ${state.loan <= 0 || state.cash < Math.min(LOAN_STEP, state.loan) ? 'disabled' : ''}>Repay ${money(state.loan > 0 ? Math.min(LOAN_STEP, state.loan) : LOAN_STEP)}</button>`;
  }

  // ------------------------------------------------------------ economy tab

  private economyTabHtml(state: GameState): string {
    // network traffic report: how much of each cargo is waiting across stations
    const totals: Record<string, number> = {};
    for (const s of state.stations) {
      for (const c of CARGOS) totals[c.id] = (totals[c.id] ?? 0) + (s.waiting[c.id] ?? 0);
    }
    const rows = CARGOS.map((c) => {
      const n = Math.floor(totals[c.id] ?? 0);
      return `<tr><td>${swatch(c.color)}${c.label}</td><td>$${c.base.toFixed(1)}+${c.perTile.toFixed(2)}/t</td><td>${n}</td></tr>`;
    }).join('');
    // industry census
    const census: Record<string, number> = {};
    for (const i of state.industries) census[i.kind] = (census[i.kind] ?? 0) + 1;
    const censusRows = Object.entries(census)
      .map(([k, n]) => `${industryDef(k as never).icon} ${industryDef(k as never).label} ×${n}`)
      .join(' · ');
    return `<h3>📦 Cargo &amp; Traffic</h3>
      <p class="hint">Economy ${economyLabel(state.economy)} — revenue ×${state.economy.toFixed(2)} right now.</p>
      <table class="fin cargo">
        <tr><th>Cargo</th><th>Rate</th><th>Waiting</th></tr>
        ${rows}
      </table>
      <h4>Supply chains</h4>
      <p class="hint">coal + iron → <b>steel</b> → goods · logs → <b>lumber</b> · grain/livestock → <b>food</b> · coal/oil → power · ports import goods &amp; export raws.</p>
      <h4>Industries on the map</h4>
      <p class="hint">${censusRows}</p>`;
  }

  // ----------------------------------------------------------- rankings tab

  private rankingsTabHtml(state: GameState): string {
    const rows = rankings(state, companyValue(state));
    const max = Math.max(1, ...rows.map((r) => r.value));
    const body = rows
      .map((r, i) => {
        const w = Math.round((Math.max(0, r.value) / max) * 100);
        return `<div class="rank ${r.isPlayer ? 'me' : ''}">
          <span class="rank-pos">${i + 1}</span>
          <span class="rank-name">${swatch(r.color)}${escapeHtml(r.name)}</span>
          <span class="rank-val">${money(r.value)}</span>
          <div class="rank-bar"><div style="width:${w}%;background:${r.color}"></div></div>
        </div>`;
      })
      .join('');
    return `<h3>🏆 Company Rankings</h3>
      <p class="hint">Rival railroads expand and claim territory (dashed lines on the map). Out-grow them.</p>
      ${body}`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
