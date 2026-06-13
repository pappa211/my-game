import { LOAN_INTEREST_YEARLY, MONTH_DAYS } from './config';
import { chargeRunningCosts, generateDemand } from './Economy';
import { addMessage, spend } from './GameState';
import { GameState } from './types';
import { updateTrains } from './Trains';

/** Completed months kept for the finance chart. */
export const FINANCE_HISTORY_MONTHS = 12;

/** Advance the whole simulation by dtDays game days. */
export function update(state: GameState, dtDays: number): void {
  if (dtDays <= 0) return;
  state.day += dtDays;

  const monthIndex = Math.floor(state.day / MONTH_DAYS);
  if (monthIndex > state.finances.monthIndex) {
    // Loan interest is charged at each month rollover.
    if (state.loan > 0) {
      const interest = Math.round((state.loan * LOAN_INTEREST_YEARLY) / 12);
      spend(state, interest);
      addMessage(state, `Paid $${interest} loan interest.`);
    }
    state.finances.history.push(state.finances.month);
    if (state.finances.history.length > FINANCE_HISTORY_MONTHS) {
      state.finances.history.splice(0, state.finances.history.length - FINANCE_HISTORY_MONTHS);
    }
    state.finances.lastMonth = state.finances.month;
    state.finances.month = { income: 0, expenses: 0 };
    state.finances.monthIndex = monthIndex;
  }

  generateDemand(state, dtDays);
  chargeRunningCosts(state, dtDays);
  updateTrains(state, dtDays);
}
