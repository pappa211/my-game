// Data-driven cargo catalogue. Adding a cargo here (and wiring it into an
// industry recipe in industries.ts) is all it takes to extend the economy.

export type CargoCategory = 'people' | 'bulk' | 'goods';

export interface CargoDef {
  id: string;
  label: string;
  category: CargoCategory;
  /** wagon / chart colour */
  color: string;
  /** flat revenue per unit delivered */
  base: number;
  /** extra revenue per unit per tile of haul distance */
  perTile: number;
}

export const CARGOS: CargoDef[] = [
  { id: 'passengers', label: 'Passengers', category: 'people', color: '#e8e3d4', base: 2.0, perTile: 0.42 },
  { id: 'mail', label: 'Mail', category: 'people', color: '#d9c27a', base: 3.0, perTile: 0.55 },
  { id: 'coal', label: 'Coal', category: 'bulk', color: '#2c2c31', base: 2.4, perTile: 0.34 },
  { id: 'iron', label: 'Iron Ore', category: 'bulk', color: '#8a6a52', base: 2.6, perTile: 0.36 },
  { id: 'steel', label: 'Steel', category: 'goods', color: '#9aa3ad', base: 4.2, perTile: 0.52 },
  { id: 'logs', label: 'Logs', category: 'bulk', color: '#7c5631', base: 2.2, perTile: 0.32 },
  { id: 'lumber', label: 'Lumber', category: 'goods', color: '#c9954f', base: 3.4, perTile: 0.46 },
  { id: 'grain', label: 'Grain', category: 'bulk', color: '#d7b34a', base: 2.2, perTile: 0.33 },
  { id: 'livestock', label: 'Livestock', category: 'bulk', color: '#c98a6a', base: 3.0, perTile: 0.4 },
  { id: 'food', label: 'Food', category: 'goods', color: '#e07b54', base: 4.0, perTile: 0.5 },
  { id: 'oil', label: 'Oil', category: 'bulk', color: '#2b2b33', base: 3.2, perTile: 0.42 },
  { id: 'goods', label: 'Goods', category: 'goods', color: '#caa53d', base: 4.6, perTile: 0.62 },
];

export const CARGO_BY_ID: Record<string, CargoDef> = Object.fromEntries(
  CARGOS.map((c) => [c.id, c]),
);

export const CARGO_IDS: string[] = CARGOS.map((c) => c.id);

export function cargoDef(id: string): CargoDef {
  const c = CARGO_BY_ID[id];
  if (!c) throw new Error(`Unknown cargo: ${id}`);
  return c;
}

export function emptyCargoRecord(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const id of CARGO_IDS) r[id] = 0;
  return r;
}

/** Tolerant accessor for save files that predate a cargo. */
export function cargoAmount(rec: Record<string, number> | undefined, id: string): number {
  return rec?.[id] ?? 0;
}
