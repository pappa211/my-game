import { IndustryKind } from './types';

export interface ProduceEntry {
  cargo: string;
  /** units produced per day at full output */
  rate: number;
}

export interface RecipeInput {
  cargo: string;
  /** input units consumed per output unit */
  per: number;
}

export interface Recipe {
  output: string;
  /** output units per day at full input supply */
  rate: number;
  inputs: RecipeInput[];
  /** true: needs every input (steel = coal+iron); false: any input works (mill) */
  requireAll: boolean;
}

export interface IndustryDef {
  kind: IndustryKind;
  label: string;
  icon: string;
  /** primary production from nothing (mines, farms, ports-as-importers) */
  produces?: ProduceEntry[];
  /** processing recipe (mills, mills, factories) */
  recipe?: Recipe;
  /** pure consumption that pays on delivery but yields no output (power, export) */
  consumes?: string[];
  /** preferred terrain for procedural placement */
  terrain: 'forest' | 'hill' | 'grass' | 'coast' | 'any';
}

export const INDUSTRIES: IndustryDef[] = [
  // ---- primary producers ----
  { kind: 'coalMine', label: 'Coal Mine', icon: '⛏', terrain: 'hill', produces: [{ cargo: 'coal', rate: 8 }] },
  { kind: 'ironMine', label: 'Iron Mine', icon: '⛰', terrain: 'hill', produces: [{ cargo: 'iron', rate: 7 }] },
  { kind: 'oilWell', label: 'Oil Well', icon: '🛢', terrain: 'any', produces: [{ cargo: 'oil', rate: 6 }] },
  { kind: 'lumberCamp', label: 'Lumber Camp', icon: '🪵', terrain: 'forest', produces: [{ cargo: 'logs', rate: 8 }] },
  { kind: 'farm', label: 'Farm', icon: '🌾', terrain: 'grass', produces: [{ cargo: 'grain', rate: 9 }] },
  { kind: 'ranch', label: 'Ranch', icon: '🐂', terrain: 'grass', produces: [{ cargo: 'livestock', rate: 6 }] },

  // ---- processors ----
  {
    kind: 'steelMill',
    label: 'Steel Mill',
    icon: '🏭',
    terrain: 'any',
    recipe: { output: 'steel', rate: 7, requireAll: true, inputs: [{ cargo: 'coal', per: 1 }, { cargo: 'iron', per: 1 }] },
  },
  {
    kind: 'factory',
    label: 'Factory',
    icon: '⚙',
    terrain: 'any',
    recipe: { output: 'goods', rate: 6, requireAll: false, inputs: [{ cargo: 'steel', per: 1 }, { cargo: 'lumber', per: 1.4 }] },
  },
  {
    kind: 'sawmill',
    label: 'Sawmill',
    icon: '🪚',
    terrain: 'any',
    recipe: { output: 'lumber', rate: 7, requireAll: false, inputs: [{ cargo: 'logs', per: 1 }] },
  },
  {
    kind: 'mill',
    label: 'Food Mill',
    icon: '🥫',
    terrain: 'grass',
    recipe: { output: 'food', rate: 7, requireAll: false, inputs: [{ cargo: 'grain', per: 1 }, { cargo: 'livestock', per: 1 }] },
  },

  // ---- sinks ----
  { kind: 'powerPlant', label: 'Power Plant', icon: '⚡', terrain: 'any', consumes: ['coal', 'oil'] },
  {
    kind: 'port',
    label: 'Port',
    icon: '⚓',
    terrain: 'coast',
    // imports arrive at the dock for haulage inland …
    produces: [{ cargo: 'goods', rate: 4 }, { cargo: 'mail', rate: 3 }, { cargo: 'passengers', rate: 4 }],
    // … and raw materials can be railed in for export.
    consumes: ['iron', 'steel', 'grain', 'food', 'oil', 'coal'],
  },
];

export const INDUSTRY_BY_KIND: Record<string, IndustryDef> = Object.fromEntries(
  INDUSTRIES.map((i) => [i.kind, i]),
);

export function industryDef(kind: IndustryKind): IndustryDef {
  const d = INDUSTRY_BY_KIND[kind];
  if (!d) throw new Error(`Unknown industry: ${kind}`);
  return d;
}

/** Cargo kinds this industry pays to receive (recipe inputs + pure consumes). */
export function industryInputs(def: IndustryDef): string[] {
  const inputs = new Set<string>(def.consumes ?? []);
  if (def.recipe) for (const i of def.recipe.inputs) inputs.add(i.cargo);
  return [...inputs];
}

/** Cargo kinds this industry emits to nearby stations. */
export function industryOutputs(def: IndustryDef): string[] {
  const out = new Set<string>();
  for (const p of def.produces ?? []) out.add(p.cargo);
  if (def.recipe) out.add(def.recipe.output);
  return [...out];
}

export function industryAccepts(def: IndustryDef, cargo: string): boolean {
  return industryInputs(def).includes(cargo);
}

/** Cargo a town generates and a town demands (consumes for revenue + growth). */
export const TOWN_PRODUCES = ['passengers', 'mail'];
export const TOWN_DEMANDS = ['passengers', 'mail', 'goods', 'food', 'lumber'];
