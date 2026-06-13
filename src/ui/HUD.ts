import {
  analyzeRoute,
  demandedHere,
  missingInputs,
  oversupply,
  RouteAnalysis,
  shippingOpportunities,
  unservedDemand,
} from '../game/Analysis';
import { CARGOS, cargoDef } from '../game/cargo';
import {
  availableTrainTypes,
  GROWTH_PER_DELIVERY,
  LOAN_INTEREST_YEARLY,
  LOAN_STEP,
  MAIL_RATE,
  MONTH_DAYS,
  nextTownTier,
  PASSENGER_RATE,
  STATION_TIERS,
  stationTier,
  TOWN_MAX_POP,
  townTier,
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
  stationsCovering,
  townsServed,
} from '../game/Economy';
import { getStation, hasTrack, loanLimit, terrainAt } from '../game/GameState';
import {
  industryDef,
  industryInputs,
  industryOutputs,
  TOWN_DEMANDS,
} from '../game/industries';
import { rankings, rivalPressure } from '../game/Rivals';
import { currentYear, GameState, Terrain, Town, Train, TrainTypeDef } from '../game/types';
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
  /** Memo for the route preview so Dijkstra doesn't re-run every frame. */
  private routeMemo: { key: string; analysis: RouteAnalysis } | null = null;

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
          ${this.opportunitiesHtml(state, s.x, s.y, stationRadius(s))}
          ${upBtn}`;
      }
      case 'town': {
        const t = state.towns.find((t) => t.id === (ui.selected as { id: number }).id);
        if (!t) return this.toolHtml();
        return this.townHtml(state, t);
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
        const miss = def.recipe ? missingInputs(i, def) : [];
        const idle = miss.length > 0
          ? `<p class="warn-text">⚠ Idle — needs ${miss.map((m) => cargoDef(m).label.toLowerCase()).join(' and ')}.</p>`
          : '';
        return `<h3>${def.icon} ${escapeHtml(i.name)}</h3>
          <p>${def.label}</p>
          ${idle}
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
      : '<p class="hint">No stops yet — click stations on the map to plan the loop.</p>';
    if (draft.mode === 'buy') {
      const year = currentYear(state);
      const avail = availableTrainTypes(year);
      const preview = this.routePreviewHtml(state, draft.stops, draft.typeId);
      return `<h3>🚆 Buy Locomotive · ${year}</h3>
        ${this.engineComparisonHtml(avail, draft.typeId)}
        ${stopsHtml}${preview}
        <button class="primary" data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Buy &amp; Start</button>
        <button data-action="clear-draft">Clear</button>`;
    }
    const train = state.trains.find((t) => t.id === draft.trainId);
    if (!train) {
      return `<h3>🗺 Assign Route</h3><p class="hint">Click a train on the map to select it, then click stations to plan its new loop.</p>`;
    }
    const preview = this.routePreviewHtml(state, draft.stops, train.typeId);
    return `<h3>🗺 Route for ${escapeHtml(train.name)}</h3>
      <p class="hint">${swatch(trainType(train.typeId).color)}${trainType(train.typeId).name} · cap ${trainType(train.typeId).capacity}</p>
      ${stopsHtml}${preview}
      <button class="primary" data-action="confirm-draft" ${draft.stops.length < 2 ? 'disabled' : ''}>Assign Route</button>
      <button data-action="clear-draft">Clear</button>`;
  }

  /** Gameplay role of an engine, so the player sees why one beats another. */
  private engineRole(t: TrainTypeDef): { role: string; bestFor: string } {
    if (t.capacity >= 110 && t.speed < 10) return { role: 'Heavy freight', bestFor: 'bulk hauls: coal, ore, grain' };
    if (t.speed >= 13) return { role: 'Express', bestFor: 'passengers & mail' };
    if (t.reliability >= 0.93 && t.capacity >= 120) return { role: 'Workhorse', bestFor: 'reliable long hauls' };
    if (t.speed >= 11) return { role: 'Fast mixed', bestFor: 'fast freight or people' };
    if (t.capacity >= 70) return { role: 'Freight', bestFor: 'general freight' };
    return { role: 'Branch-line', bestFor: 'cheap, short routes' };
  }

  /** Side-by-side engine picker with role tags and best-in-class badges. */
  private engineComparisonHtml(avail: TrainTypeDef[], selectedId: string): string {
    if (avail.length === 0) return '<p class="hint">No engines are for sale in this era.</p>';
    const fastest = Math.max(...avail.map((t) => t.speed));
    const biggest = Math.max(...avail.map((t) => t.capacity));
    const toughest = Math.max(...avail.map((t) => t.reliability));
    const cheapest = Math.min(...avail.map((t) => t.cost));
    return avail
      .map((t) => {
        const { role, bestFor } = this.engineRole(t);
        const badges = [
          t.speed === fastest ? '<span class="badge">⚡ fastest</span>' : '',
          t.capacity === biggest ? '<span class="badge">📦 biggest</span>' : '',
          t.reliability === toughest ? '<span class="badge">🛡 toughest</span>' : '',
          t.cost === cheapest ? '<span class="badge">💲 cheapest</span>' : '',
        ].join('');
        return `<button data-action="set-type" data-type="${t.id}" class="type engine ${selectedId === t.id ? 'active' : ''}">
          <span class="engine-head">${swatch(t.color)}<b>${escapeHtml(t.name)}</b> <span class="engine-role">${role}</span></span>
          <small>${money(t.cost)} · cap ${t.capacity} · spd ${t.speed} · ${Math.round(t.reliability * 100)}% rel · ${money(t.runningCost)}/day</small>
          <small class="engine-for">Best for ${bestFor}.</small>
          ${badges ? `<span class="badges">${badges}</span>` : ''}
        </button>`;
      })
      .join('');
  }

  /** The route economics card — the heart of the route planner. */
  private routePreviewHtml(state: GameState, stops: number[], typeId: string): string {
    if (stops.length < 2) {
      return '<p class="hint">Pick at least two stops to preview distance, cargo and profit.</p>';
    }
    // The network is static while a draft is open (the track/station tools
    // clear the draft), so only re-run the analysis when an input changes.
    const key = `${stops.join(',')}|${typeId}|${state.stations.length}|${Math.round(state.economy * 20)}`;
    let a: RouteAnalysis;
    if (this.routeMemo && this.routeMemo.key === key) {
      a = this.routeMemo.analysis;
    } else {
      a = analyzeRoute(state, stops, typeId);
      this.routeMemo = { key, analysis: a };
    }
    if (!a.ok) {
      return `<div class="route-card bad"><b>⚠ ${escapeHtml(a.reason ?? 'Route not viable.')}</b></div>`;
    }
    const profitClass = a.monthlyProfit >= 0 ? 'pos' : 'neg';
    const limit =
      a.limitedBy === 'capacity'
        ? 'train capacity (cargo is waiting)'
        : a.limitedBy === 'supply'
          ? 'cargo available (spare capacity)'
          : '—';
    const flows = a.flows
      .slice(0, 4)
      .map(
        (f) =>
          `<div class="flow">${swatch(cargoDef(f.kind).color)}${cargoDef(f.kind).label}
            <span class="flow-route">${escapeHtml(f.fromName)} → ${escapeHtml(f.toName)}</span>
            <span class="flow-qty">${Math.round(f.unitsPerMonth)}/mo</span></div>`,
      )
      .join('') || '<div class="flow hint">No cargo flows on this loop yet.</div>';
    const chain = a.completesChain ? `<p class="chain-ok">🔗 ${escapeHtml(a.chainNote ?? 'Completes a supply chain.')}</p>` : '';
    const warns = a.warnings
      .map((w) => `<p class="warn-text">⚠ ${escapeHtml(w)}</p>`)
      .join('');
    return `<div class="route-card">
      <table class="route-fin">
        <tr><td>Round trip</td><td>${a.distance.toFixed(0)} tiles · ${a.tripsPerMonth.toFixed(1)}×/mo</td></tr>
        <tr><td>Est. revenue</td><td class="pos">${money(a.monthlyRevenue)}/mo</td></tr>
        <tr><td>Running + repairs</td><td class="neg">${money(a.monthlyRunningCost + a.monthlyRepairCost)}/mo</td></tr>
        <tr><td><b>Est. profit</b></td><td class="${profitClass}"><b>${money(a.monthlyProfit)}/mo</b></td></tr>
        <tr><td>Limited by</td><td>${limit}</td></tr>
      </table>
      <div class="flows">${flows}</div>
      ${chain}${warns}
    </div>`;
  }

  /** "Recommended cargo opportunities nearby" for a station or a prospective one. */
  private opportunitiesHtml(state: GameState, x: number, y: number, radius: number): string {
    const ships = shippingOpportunities(state, x, y, radius).slice(0, 4);
    const wants = demandedHere(state, x, y, radius);
    const shipRows = ships
      .map((o) => {
        const sinks = o.sinks.length
          ? o.sinks.map((s) => `${escapeHtml(s.name)} <span class="dim">(${s.distance})</span>`).join(', ')
          : '<span class="warn-text">no buyer on the map yet</span>';
        return `<div class="opp">${swatch(cargoDef(o.kind).color)}<b>${cargoDef(o.kind).label}</b>
          <span class="opp-rate">${o.rate.toFixed(1)}/day</span>
          <div class="opp-to">→ ${sinks}</div></div>`;
      })
      .join('');
    const wantsHtml = wants.length
      ? `<p><b>Wants delivered:</b> ${wants.map((k) => `${swatch(cargoDef(k).color)}${cargoDef(k).label}`).join(' ')}</p>`
      : '';
    if (!shipRows && !wantsHtml) return '';
    return `<h4>Opportunities</h4>
      ${shipRows ? `<div class="opps">${shipRows}</div>` : '<p class="hint">Nothing to ship from here.</p>'}
      ${wantsHtml}`;
  }

  /** Tiny inline bar chart for a short history series. */
  private sparkline(values: number[]): string {
    if (values.length === 0) return '';
    const max = Math.max(1, ...values);
    const bars = values
      .map((v) => `<div class="spark-bar" style="height:${Math.max(2, Math.round((v / max) * 100))}%" title="${Math.round(v)}"></div>`)
      .join('');
    return `<div class="spark">${bars}</div>`;
  }

  /** Town detail panel: a long-term strategic objective with live signals. */
  private townHtml(state: GameState, t: Town): string {
    const tier = townTier(t.population);
    const next = nextTownTier(t.population);
    const mul = tier.trafficMul;
    const pop = Math.floor(t.population);
    const service = Math.round(t.serviceLevel * 100);
    const covered = stationsCovering(state, t.x, t.y).length > 0;
    const pressure = rivalPressure(state, t.id);
    const history = t.deliveryHistory ?? [];
    const last12 = history.reduce((s, n) => s + n, 0) + (t.deliveredThisMonth ?? 0);
    const lastMonth = history.length ? history[history.length - 1] : (t.deliveredThisMonth ?? 0);
    const growth = lastMonth * GROWTH_PER_DELIVERY;
    const radius = stationTier(1).radius;

    const progress = next
      ? `<div class="tier-bar" title="${pop} / ${next.minPop} residents">
          <div style="width:${Math.min(100, Math.round(((pop - tier.minPop) / (next.minPop - tier.minPop)) * 100))}%"></div>
        </div>
        <p class="hint">${Math.max(0, next.minPop - pop).toLocaleString('en-US')} more residents → <b>${next.name}</b> (×${next.trafficMul} traffic).</p>`
      : '<p class="hint">A thriving metropolis — the largest tier.</p>';

    const wantChips = TOWN_DEMANDS
      .map((k) => `${swatch(cargoDef(k).color)}${cargoDef(k).label}`)
      .join(' ');

    return `<h3>🏘 ${escapeHtml(t.name)} <span class="tier-tag">${tier.name}</span></h3>
      <p>Population <b>${pop.toLocaleString('en-US')}</b>${pop >= TOWN_MAX_POP ? ' (max)' : ''} · service ${service}%</p>
      ${progress}
      <table class="fin">
        <tr><td>Growth</td><td class="${growth > 0 ? 'pos' : ''}">${growth > 0 ? '+' : ''}${growth.toFixed(1)} pop/mo</td></tr>
        <tr><td>Passengers</td><td>~${(pop * PASSENGER_RATE * mul).toFixed(0)}/day</td></tr>
        <tr><td>Mail</td><td>~${(pop * MAIL_RATE * mul).toFixed(0)}/day</td></tr>
        <tr><td>Deliveries (12 mo)</td><td>${Math.round(last12).toLocaleString('en-US')}</td></tr>
      </table>
      ${history.length ? `<h4>Deliveries by month</h4>${this.sparkline(history)}` : ''}
      <p><b>Demands:</b> ${wantChips}</p>
      ${covered ? '' : '<p class="warn-text">⚠ Not on your network — build a station within reach to start deliveries and growth.</p>'}
      ${pressure > 0 ? `<p class="warn-text">⚠ A rival is courting this town (−${Math.round(pressure * 100)}% traffic until you connect it).</p>` : ''}
      ${this.opportunitiesHtml(state, t.x, t.y, radius)}`;
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
    const m = this.trainMetrics(train);
    const { role } = this.engineRole(type);
    return `<h3>🚆 ${escapeHtml(train.name)}</h3>
      <p>${swatch(type.color)}${type.name} <span class="engine-role">${role}</span> · cap ${type.capacity} · ${money(type.runningCost)}/day · age ${age}y</p>
      <p>Status: ${status}</p>
      <p>Cargo (${cargoCount(train)}/${type.capacity}):<br>${cargo}</p>
      <table class="fin">
        <tr><td>Profit (last mo)</td><td class="${m.profit >= 0 ? 'pos' : 'neg'}">${money(m.profit)}/mo</td></tr>
        <tr><td>Earnings (12 mo)</td><td>${money(m.last12)}</td></tr>
        <tr><td>Lifetime earnings</td><td>${money(train.earnings)}</td></tr>
      </table>
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

  /** Last-full-month profit and trailing 12-month earnings for one train. */
  private trainMetrics(train: Train): { profit: number; last12: number; lastRev: number } {
    const hist = train.revenueHistory ?? [];
    const lastRev = hist.length ? hist[hist.length - 1] : (train.monthRevenue ?? 0);
    const running = trainType(train.typeId).runningCost * MONTH_DAYS;
    const last12 = hist.reduce((s, n) => s + n, 0) + (train.monthRevenue ?? 0);
    return { profit: lastRev - running, last12, lastRev };
  }

  private trainsTabHtml(state: GameState): string {
    if (state.trains.length === 0) {
      return `<h3>🚆 Fleet</h3><p class="hint">No trains yet. Use the Buy Train tool (key 4).</p>`;
    }
    const rows = state.trains
      .map((t) => {
        const type = trainType(t.typeId);
        const m = this.trainMetrics(t);
        const selected = this.ui.selected?.kind === 'train' && this.ui.selected.id === t.id;
        return `<button class="trainrow ${selected ? 'active' : ''} ${t.state === 'stranded' || t.state === 'broken' ? 'stranded' : ''}"
            data-action="select-train" data-id="${t.id}" title="Lifetime ${money(t.earnings)} · 12 mo ${money(m.last12)}">
          ${swatch(type.color)}
          <span class="trainrow-name">${escapeHtml(t.name)}</span>
          <span class="trainrow-status">${STATUS_ICON[t.state]}</span>
          <span class="trainrow-earn ${m.profit >= 0 ? 'pos' : 'neg'}">${money(m.profit)}/mo</span>
        </button>`;
      })
      .join('');

    // Profit per route — trains sharing a set of stops are one route.
    const groups = new Map<string, { name: string; count: number; profit: number; last12: number }>();
    for (const t of state.trains) {
      const key = [...t.stops].sort((a, b) => a - b).join(',');
      const m = this.trainMetrics(t);
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        g.profit += m.profit;
        g.last12 += m.last12;
      } else {
        const names = t.stops.map((id) => getStation(state, id)?.name ?? '?');
        const label = names.length <= 2 ? names.join(' ↔ ') : `${names[0]} +${names.length - 1}`;
        groups.set(key, { name: label, count: 1, profit: m.profit, last12: m.last12 });
      }
    }
    const routeRows = [...groups.values()]
      .sort((a, b) => b.profit - a.profit)
      .map(
        (g) =>
          `<div class="route-row"><span class="route-name">${escapeHtml(g.name)}${g.count > 1 ? ` ×${g.count}` : ''}</span>
            <span class="${g.profit >= 0 ? 'pos' : 'neg'}">${money(g.profit)}/mo</span></div>`,
      )
      .join('');

    const totalProfit = state.trains.reduce((s, t) => s + this.trainMetrics(t).profit, 0);
    const total12 = state.trains.reduce((s, t) => s + this.trainMetrics(t).last12, 0);
    return `<h3>🚆 Fleet (${state.trains.length})</h3>
      <p class="hint">Profit per train per month (last full month). Click to follow.</p>${rows}
      <h4>Profit by route</h4>
      <div class="routes">${routeRows}</div>
      <table class="fin">
        <tr><td>Fleet profit</td><td class="${totalProfit >= 0 ? 'pos' : 'neg'}">${money(totalProfit)}/mo</td></tr>
        <tr><td>Earnings (12 mo)</td><td>${money(total12)}</td></tr>
      </table>`;
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
    const unmet = unservedDemand(state).slice(0, 5);
    const over = oversupply(state).slice(0, 5);
    const unmetHtml = unmet.length
      ? unmet
          .map(
            (s) =>
              `<div class="signal">${swatch(cargoDef(s.kind).color)}${cargoDef(s.kind).label}
                <span class="dim">${s.count} unserved${s.example ? ` · e.g. ${escapeHtml(s.example)}` : ''}</span></div>`,
          )
          .join('')
      : '<p class="hint">Every demand point is within reach of a station. 👍</p>';
    const overHtml = over.length
      ? over
          .map(
            (s) =>
              `<div class="signal">${swatch(cargoDef(s.kind).color)}${cargoDef(s.kind).label}
                <span class="warn-text">${Math.round(s.waiting)} stacked at ${s.pileups} station${s.pileups > 1 ? 's' : ''}</span></div>`,
          )
          .join('')
      : '<p class="hint">Nothing is backing up — your trains are keeping pace. 👍</p>';
    return `<h3>📦 Cargo &amp; Traffic</h3>
      <p class="hint">Economy ${economyLabel(state.economy)} — revenue ×${state.economy.toFixed(2)} right now.</p>
      <table class="fin cargo">
        <tr><th>Cargo</th><th>Rate</th><th>Waiting</th></tr>
        ${rows}
      </table>
      <h4>Unserved demand <span class="legend">opportunity</span></h4>
      <p class="hint">Places that want cargo but have no station in reach.</p>
      ${unmetHtml}
      <h4>Oversupplied cargo <span class="legend">backing up</span></h4>
      <p class="hint">Produced faster than your trains haul it away.</p>
      ${overHtml}
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
