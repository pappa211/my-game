import { MONTH_DAYS } from './config';
import { chargeRunningCosts, generateDemand } from './Economy';
import { GameState } from './types';
import { updateTrains } from './Trains';

/** Advance the whole simulation by dtDays game days. */
export function update(state: GameState, dtDays: number): void {
  if (dtDays <= 0) return;
  state.day += dtDays;

  const monthIndex = Math.floor(state.day / MONTH_DAYS);
  if (monthIndex > state.finances.monthIndex) {
    state.finances.lastMonth = state.finances.month;
    state.finances.month = { income: 0, expenses: 0 };
    state.finances.monthIndex = monthIndex;
  }

  generateDemand(state, dtDays);
  chargeRunningCosts(state, dtDays);
  updateTrains(state, dtDays);
}
