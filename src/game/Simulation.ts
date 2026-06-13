import { availableTrainTypes, LOAN_INTEREST_YEARLY, MONTH_DAYS } from './config';
import { chargeRunningCosts, generateProduction } from './Economy';
import { monthlyEvents, tickEconomy } from './Events';
import { addMessage, spend } from './GameState';
import { updateRivals } from './Rivals';
import { currentYear, GameState } from './types';
import { updateTrains } from './Trains';

/** Completed months kept for the finance chart. */
export const FINANCE_HISTORY_MONTHS = 12;

/** Push a value into a rolling, oldest-first history capped at FINANCE_HISTORY_MONTHS. */
function pushHistory(history: number[], value: number): void {
  history.push(value);
  if (history.length > FINANCE_HISTORY_MONTHS) {
    history.splice(0, history.length - FINANCE_HISTORY_MONTHS);
  }
}

/** At each month rollover, archive per-train revenue and per-town deliveries. */
function rollMonthlyHistory(state: GameState): void {
  for (const train of state.trains) {
    if (!train.revenueHistory) train.revenueHistory = [];
    pushHistory(train.revenueHistory, train.monthRevenue ?? 0);
    train.monthRevenue = 0;
  }
  for (const town of state.towns) {
    if (!town.deliveryHistory) town.deliveryHistory = [];
    pushHistory(town.deliveryHistory, town.deliveredThisMonth ?? 0);
    town.deliveredThisMonth = 0;
  }
}

/** Advance the whole simulation by dtDays game days. */
export function update(state: GameState, dtDays: number): void {
  if (dtDays <= 0) return;
  const yearBefore = currentYear(state);
  state.day += dtDays;

  const monthIndex = Math.floor(state.day / MONTH_DAYS);
  if (monthIndex > state.finances.monthIndex) {
    // Bond interest is charged at each month rollover.
    if (state.loan > 0) {
      const interest = Math.round((state.loan * LOAN_INTEREST_YEARLY) / 12);
      spend(state, interest);
      addMessage(state, `Paid $${interest} bond interest.`, 'money');
    }
    state.finances.history.push(state.finances.month);
    if (state.finances.history.length > FINANCE_HISTORY_MONTHS) {
      state.finances.history.splice(0, state.finances.history.length - FINANCE_HISTORY_MONTHS);
    }
    state.finances.lastMonth = state.finances.month;
    state.finances.month = { income: 0, expenses: 0 };
    state.finances.monthIndex = monthIndex;
    rollMonthlyHistory(state);
    monthlyEvents(state);
  }

  // Announce locomotives that become purchasable as the calendar advances.
  const yearAfter = currentYear(state);
  if (yearAfter > yearBefore) {
    for (let y = yearBefore + 1; y <= yearAfter; y++) {
      for (const t of availableTrainTypes(y)) {
        if (t.availableYear === y) {
          addMessage(state, `🚂 New locomotive available: the ${t.name}.`, 'era');
        }
      }
    }
  }

  tickEconomy(state, dtDays);
  generateProduction(state, dtDays);
  chargeRunningCosts(state, dtDays);
  updateTrains(state, dtDays);
  updateRivals(state, dtDays);
}
