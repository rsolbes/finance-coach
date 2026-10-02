// Which scheduled occurrences (a payday, a bill's due date, an installment) are already done.
// The balance already includes them, so projections must not count them again.
import { addDays, addMonths, diffDays, startOfMonth, withDayOfMonth } from "./dates";
import { incomeDates, planSchedule } from "./engine";
import type { FinanceData, IncomeSource, RecurringBill } from "./types";

/** A transaction as far as settlement cares. */
export interface RecordedTransaction {
  date: string;
  amount: number;
  account_id: number | null;
  category: string;
  /** Explicit link to the occurrence it settles, e.g. "income:3@2026-10-02". */
  ref: string | null;
}

export const occurrenceKey = (ref: string, occurrence: string) => `${ref}@${occurrence}`;

/**
 * The scheduled pay date a deposit on `date` corresponds to: the closest one within a few days
 * (paychecks sometimes land a day early or late). Null if none is close enough to be sure.
 */
export function nearestIncomeOccurrence(inc: IncomeSource, date: string): string | null {
  const window = inc.frequency === "weekly" ? 2 : 5;
  const candidates = incomeDates(inc, addDays(date, -window), addDays(date, window));
  candidates.sort((a, b) => Math.abs(diffDays(date, a)) - Math.abs(diffDays(date, b)));
  return candidates[0] ?? null;
}

/** The bill occurrence a payment on `date` pays: the first due date from a week before the payment on. */
export function billOccurrenceFor(bill: RecurringBill, date: string): string {
  const earliest = addDays(date, -7);
  for (let m = startOfMonth(earliest); ; m = addMonths(m, 1)) {
    const due = withDayOfMonth(m, bill.day_of_month);
    if (due >= earliest) return due;
  }
}

/** Two amounts that are the same payment (allows small differences like bank rounding). */
const sameAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.02);

/**
 * Occurrences already settled: explicitly linked transactions, plus same-day matches for things
 * recorded without a link (e.g. today's paycheck logged by hand, or an imported statement row).
 * Each transaction settles at most one occurrence.
 */
export function settledOccurrences(data: FinanceData, txs: RecordedTransaction[], today: string): Set<string> {
  const settled = new Set<string>();
  const used = new Set<RecordedTransaction>();
  for (const t of txs) {
    if (t.ref) {
      settled.add(t.ref);
      used.add(t);
    }
  }
  const todays = txs.filter((t) => t.date === today && !used.has(t));
  const claim = (match: (t: RecordedTransaction) => boolean) => {
    const t = todays.find((x) => !used.has(x) && match(x));
    if (t) used.add(t);
    return Boolean(t);
  };

  for (const inc of data.incomes.filter((i) => i.active && i.account_id)) {
    if (!incomeDates(inc, today, today).length) continue;
    const key = occurrenceKey(`income:${inc.id}`, today);
    if (!settled.has(key) && claim((t) => t.amount > 0 && t.account_id === inc.account_id && t.category === "income"))
      settled.add(key);
  }
  for (const bill of data.bills.filter((b) => b.active && withDayOfMonth(today, b.day_of_month) === today)) {
    const key = occurrenceKey(`bill:${bill.id}`, today);
    if (!settled.has(key) && claim((t) => t.amount < 0 && sameAmount(-t.amount, bill.amount))) settled.add(key);
  }
  for (const plan of data.plans.filter((p) => p.active)) {
    if (planSchedule(plan, today)[0]?.date !== today) continue;
    const key = occurrenceKey(`plan:${plan.id}`, today);
    if (!settled.has(key) && claim((t) => t.amount < 0 && sameAmount(-t.amount, plan.payment_amount))) settled.add(key);
  }
  return settled;
}
