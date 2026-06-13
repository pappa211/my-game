import { ECONOMY_DRIFT, ECONOMY_MAX, ECONOMY_MIN } from './config';
import { addMessage } from './GameState';
import { GameState, Town } from './types';

/** Smoothly drift the live economy toward its target each tick. */
export function tickEconomy(state: GameState, dtDays: number): void {
  const gap = state.economyTarget - state.economy;
  state.economy += gap * Math.min(1, ECONOMY_DRIFT * dtDays * 30);
  state.economy = Math.max(ECONOMY_MIN, Math.min(ECONOMY_MAX, state.economy));
}

function randomTown(state: GameState): Town | undefined {
  if (state.towns.length === 0) return undefined;
  return state.towns[Math.floor(Math.random() * state.towns.length)];
}

/**
 * Rolled once per in-game month. Drives the boom/bust economic cycle plus
 * occasional one-off events, mirroring Railroad Tycoon's shifting conditions.
 */
export function monthlyEvents(state: GameState): void {
  const r = Math.random();
  if (r < 0.16) {
    state.economyTarget = 1.15 + Math.random() * 0.2;
    addMessage(state, '📈 Economic boom — cargo prices are rising.', 'era');
  } else if (r < 0.3) {
    state.economyTarget = 0.72 + Math.random() * 0.13;
    addMessage(state, '📉 Recession — cargo prices are falling.', 'warn');
  } else if (r < 0.4) {
    state.economyTarget = 0.95 + Math.random() * 0.1;
    addMessage(state, 'Markets steady as conditions normalise.', 'info');
  }

  if (r > 0.4 && r < 0.5) {
    const town = randomTown(state);
    if (town) {
      const boom = 400 + Math.floor(Math.random() * 700);
      town.population += boom;
      addMessage(state, `⛏ Boom town! ${town.name} grows by ${boom} as settlers arrive.`, 'info');
    }
  } else if (r > 0.5 && r < 0.55) {
    const town = randomTown(state);
    if (town && town.population > 600) {
      const loss = Math.floor(town.population * 0.12);
      town.population -= loss;
      addMessage(state, `🔥 Fire in ${town.name} costs it ${loss} residents.`, 'warn');
    }
  }
}
