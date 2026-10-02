// Pure calculations over the user's data. The coach calls these through tools
// so every number it quotes comes from code, not from the model's arithmetic.
import {
  addDays,
  addMonths,
  diffDays,
  endOfMonth,
  monthKey,
  startOfMonth,
  withDayOfMonth,
} from "./dates";
import type {
  Account,
  FinanceData,
  IncomeFrequency,
  IncomeSource,
  InstallmentPlan,
  RecurringBill,
} from "./types";

export type EventKind = "income" | "bill" | "installment" | "card_statement";

export interface MoneyEvent {
  date: string;
  kind: EventKind;
  label: string;
  amount: number;
  account: string | null;
  /** Income that can't be used for bills (e.g. despensa vouchers). */
  restricted: boolean;
  ref: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

const PERIODS_PER_MONTH: Record<IncomeFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
};

function accountName(data: FinanceData, id: number | null): string | null {
  return data.accounts.find((a) => a.id === id)?.name ?? null;
}

// ---------- installment plans ----------

export interface ScheduledPayment {
  date: string;
  number: number;
}

/** Payments still ahead (due today or later). Earlier dates are assumed paid. */
export function planSchedule(plan: InstallmentPlan, today: string): ScheduledPayment[] {
  const out: ScheduledPayment[] = [];
  const left = plan.total_payments - plan.payments_made;
  for (let k = 0; k < left; k++) {
    const date = addMonths(plan.next_payment_date, k);
    if (date >= today) out.push({ date, number: plan.payments_made + k + 1 });
  }
  return out;
}

export interface PlanStatus {
  id: number;
  name: string;
  account: string | null;
  kind: InstallmentPlan["kind"];
  payment_amount: number;
  payments_total: number;
  payments_left: number;
  next_payment: string | null;
  last_payment: string | null;
  remaining_total: number;
  remaining_capital: number;
  remaining_interest: number;
}

export function planStatus(data: FinanceData, plan: InstallmentPlan, today: string): PlanStatus {
  const schedule = planSchedule(plan, today);
  const left = schedule.length;
  // Interest-free plans: split the original amount, so bank rounding of each payment doesn't drift.
  const capitalEach = plan.capital_per_payment ?? plan.original_amount / plan.total_payments;
  return {
    id: plan.id,
    name: plan.name,
    account: accountName(data, plan.account_id),
    kind: plan.kind,
    payment_amount: plan.payment_amount,
    payments_total: plan.total_payments,
    payments_left: left,
    next_payment: schedule[0]?.date ?? null,
    last_payment: schedule.at(-1)?.date ?? null,
    remaining_total: round2(left * plan.payment_amount),
    remaining_capital: round2(left * capitalEach),
    remaining_interest: round2(Math.max(0, left * (plan.payment_amount - capitalEach))),
  };
}

// ---------- credit cards ----------

/**
 * When the card's current non-installment balance must be paid.
 * A known next_due_date wins. Otherwise, if a statement was already cut and isn't due yet,
 * the whole balance is treated as due on that date (conservative); else it's due after the next cut.
 */
export function revolvingDueDate(account: Account, today: string): string | null {
  if (account.type !== "credit") return null;
  if (account.next_due_date && account.next_due_date >= today) return account.next_due_date;
  if (!account.statement_day) return null;
  const offset = account.payment_due_days ?? 20;
  let lastCut = withDayOfMonth(today, account.statement_day);
  if (lastCut > today) lastCut = withDayOfMonth(addMonths(startOfMonth(today), -1), account.statement_day);
  const due = addDays(lastCut, offset);
  if (today <= due) return due;
  const nextCut = withDayOfMonth(addMonths(startOfMonth(lastCut), 1), account.statement_day);
  return addDays(nextCut, offset);
}

/** Due date of the statement that will include a charge made on `charge` (a charge on the cut day is included). */
export function statementDueForCharge(account: Account, charge: string): string | null {
  if (account.type !== "credit" || !account.statement_day) return null;
  let cut = withDayOfMonth(charge, account.statement_day);
  if (cut < charge) cut = withDayOfMonth(addMonths(startOfMonth(charge), 1), account.statement_day);
  return addDays(cut, account.payment_due_days ?? 20);
}

/** Card balance that is NOT installments, i.e. what must be paid in full to avoid interest. */
export function revolvingBalance(data: FinanceData, account: Account, today: string): number {
  if (account.type !== "credit") return 0;
  const inPlans = data.plans
    .filter((p) => p.active && p.account_id === account.id)
    .map((p) => planStatus(data, p, today).remaining_capital);
  return round2(Math.max(0, account.balance - sum(inPlans)));
}

// ---------- events ----------

/** Scheduled pay dates of an income source between two dates (inclusive). */
export function incomeDates(inc: IncomeSource, from: string, to: string): string[] {
  const out: string[] = [];
  if (inc.frequency === "monthly") {
    const day = Number(inc.anchor_date.slice(8, 10));
    for (let m = startOfMonth(from); m <= to; m = addMonths(m, 1)) {
      const date = withDayOfMonth(m, day);
      if (date >= from && date <= to) out.push(date);
    }
    return out;
  }
  const step = inc.frequency === "weekly" ? 7 : 14;
  let date = addDays(inc.anchor_date, Math.ceil(diffDays(inc.anchor_date, from) / step) * step);
  for (; date <= to; date = addDays(date, step)) out.push(date);
  return out;
}

/** True when this occurrence was already recorded as received or paid. */
const isSettled = (data: FinanceData, ref: string, occurrence: string) => data.settled?.has(`${ref}@${occurrence}`) ?? false;

function incomeEvents(data: FinanceData, inc: IncomeSource, from: string, to: string): MoneyEvent[] {
  const ref = `income:${inc.id}`;
  return incomeDates(inc, from, to)
    .filter((date) => !isSettled(data, ref, date))
    .map((date) => ({
      date,
      kind: "income" as const,
      label: inc.name,
      amount: inc.amount,
      account: accountName(data, inc.account_id),
      restricted: Boolean(inc.restricted_to),
      ref,
    }));
}

/**
 * A bill paid with a credit card is cash out on that card's due date, not on the charge date.
 * Charges before today are already in the card's balance (and its statement event).
 */
function billEvents(data: FinanceData, bill: RecurringBill, from: string, to: string, today: string): MoneyEvent[] {
  const out: MoneyEvent[] = [];
  const card = data.accounts.find((a) => a.id === bill.account_id && a.type === "credit" && a.statement_day);
  // A card charge can be due up to ~2 months later, so start earlier to catch charges due in the window.
  const start = card ? addMonths(startOfMonth(from), -2) : startOfMonth(from);
  for (let m = start; m <= to; m = addMonths(m, 1)) {
    const charge = withDayOfMonth(m, bill.day_of_month);
    if (isSettled(data, `bill:${bill.id}`, charge)) continue;
    let date = charge;
    if (card) {
      if (charge < today) continue;
      date = statementDueForCharge(card, charge) ?? charge;
    }
    if (date < from || date > to) continue;
    const name = bill.is_estimate ? `${bill.name} (estimated)` : bill.name;
    out.push({
      date,
      kind: "bill",
      label: card ? `${name} (on ${card.name})` : name,
      amount: bill.amount,
      account: accountName(data, bill.account_id),
      restricted: false,
      ref: `bill:${bill.id}`,
    });
  }
  return out;
}

export function eventsBetween(data: FinanceData, from: string, to: string, today: string): MoneyEvent[] {
  const events: MoneyEvent[] = [];
  for (const inc of data.incomes.filter((i) => i.active)) events.push(...incomeEvents(data, inc, from, to));
  for (const bill of data.bills.filter((b) => b.active)) events.push(...billEvents(data, bill, from, to, today));
  for (const plan of data.plans.filter((p) => p.active)) {
    for (const p of planSchedule(plan, today)) {
      if (p.date < from || p.date > to || isSettled(data, `plan:${plan.id}`, p.date)) continue;
      events.push({
        date: p.date,
        kind: "installment",
        label: `${plan.name} (${p.number}/${plan.total_payments})`,
        amount: plan.payment_amount,
        account: accountName(data, plan.account_id),
        restricted: false,
        ref: `plan:${plan.id}`,
      });
    }
  }
  for (const acc of data.accounts.filter((a) => a.active && a.type === "credit")) {
    const due = revolvingDueDate(acc, today);
    const amount = revolvingBalance(data, acc, today);
    if (!due || amount < 0.5 || due < from || due > to) continue;
    events.push({
      date: due,
      kind: "card_statement",
      label: `${acc.name}: pay current balance (excl. installments)`,
      amount,
      account: acc.name,
      restricted: false,
      ref: `account:${acc.id}`,
    });
  }
  // Income first on the same day: payday money arrives before payments go out.
  return events.sort((a, b) =>
    a.date === b.date ? Number(a.kind !== "income") - Number(b.kind !== "income") : a.date < b.date ? -1 : 1,
  );
}

// ---------- cash flow ----------

export function availableCash(data: FinanceData): number {
  return sum(
    data.accounts.filter((a) => a.active && (a.type === "debit" || a.type === "wallet")).map((a) => a.balance),
  );
}

export interface TimelineRow extends MoneyEvent {
  balance_after: number;
}

export interface Timeline {
  from: string;
  to: string;
  starting_cash: number;
  rows: TimelineRow[];
  total_in: number;
  total_out: number;
  ending_cash: number;
  lowest_balance: number;
  lowest_balance_date: string;
  /** First date the running balance goes below zero, if any. */
  first_shortfall_date: string | null;
}

/** Running cash balance through upcoming income and payments (vouchers excluded). */
export function cashTimeline(data: FinanceData, today: string, days: number): Timeline {
  const to = addDays(today, days);
  const starting = availableCash(data);
  let balance = starting;
  let lowest = starting;
  let lowestDate = today;
  let shortfall: string | null = null;
  const rows: TimelineRow[] = [];
  for (const e of eventsBetween(data, today, to, today)) {
    if (e.restricted) {
      rows.push({ ...e, balance_after: round2(balance) });
      continue;
    }
    balance += e.kind === "income" ? e.amount : -e.amount;
    rows.push({ ...e, balance_after: round2(balance) });
    if (balance < lowest) {
      lowest = balance;
      lowestDate = e.date;
    }
    if (balance < 0 && !shortfall) shortfall = e.date;
  }
  const flows = rows.filter((r) => !r.restricted);
  return {
    from: today,
    to,
    starting_cash: starting,
    rows,
    total_in: sum(flows.filter((r) => r.kind === "income").map((r) => r.amount)),
    total_out: sum(flows.filter((r) => r.kind !== "income").map((r) => r.amount)),
    ending_cash: round2(balance),
    lowest_balance: round2(lowest),
    lowest_balance_date: lowestDate,
    first_shortfall_date: shortfall,
  };
}

export interface MonthProjection {
  month: string;
  from: string;
  to: string;
  partial: boolean;
  income: number;
  restricted_income: number;
  bills: number;
  installments: number;
  card_statements: number;
  /** Income minus bills, installments and card balances. What's left for everything else (food, transport...). */
  left_for_living: number;
  plans_ending: string[];
}

export function monthlyProjection(data: FinanceData, today: string, months: number): MonthProjection[] {
  const out: MonthProjection[] = [];
  for (let i = 0; i < months; i++) {
    const from = i === 0 ? today : addMonths(startOfMonth(today), i);
    const to = endOfMonth(from);
    const ev = eventsBetween(data, from, to, today);
    const pick = (k: EventKind, restricted = false) =>
      sum(ev.filter((e) => e.kind === k && e.restricted === restricted).map((e) => e.amount));
    const income = pick("income");
    const bills = pick("bill");
    const installments = pick("installment");
    const cards = pick("card_statement");
    out.push({
      month: monthKey(from),
      from,
      to,
      partial: from !== startOfMonth(from),
      income,
      restricted_income: pick("income", true),
      bills,
      installments,
      card_statements: cards,
      left_for_living: round2(income - bills - installments - cards),
      plans_ending: data.plans
        .filter((p) => p.active)
        .filter((p) => {
          const last = planSchedule(p, today).at(-1)?.date;
          return last !== undefined && monthKey(last) === monthKey(from);
        })
        .map((p) => p.name),
    });
  }
  return out;
}

// ---------- snapshot ----------

export interface ReliefItem {
  plan: string;
  last_payment: string;
  monthly_amount_freed: number;
}

export interface Snapshot {
  today: string;
  available_cash: number;
  voucher_balance: number;
  monthly_income: number;
  monthly_restricted_income: number;
  monthly_bills: number;
  monthly_installments: number;
  monthly_committed: number;
  committed_pct_of_income: number;
  left_after_committed: number;
  cards: {
    account: string;
    owed: number;
    in_installments: number;
    revolving: number;
    revolving_due: string | null;
    credit_limit: number | null;
  }[];
  revolving_debt: number;
  installment_debt_remaining: number;
  total_to_pay: number;
  plans: PlanStatus[];
  relief_timeline: ReliefItem[];
  needs_confirmation: { item: string; note: string }[];
}

export function snapshot(data: FinanceData, today: string): Snapshot {
  const incomes = data.incomes.filter((i) => i.active);
  const monthly = (restricted: boolean) =>
    sum(
      incomes
        .filter((i) => Boolean(i.restricted_to) === restricted)
        .map((i) => i.amount * PERIODS_PER_MONTH[i.frequency]),
    );
  const plans = data.plans.filter((p) => p.active).map((p) => planStatus(data, p, today));
  const live = plans.filter((p) => p.payments_left > 0);
  const monthlyIncome = monthly(false);
  const bills = sum(data.bills.filter((b) => b.active).map((b) => b.amount));
  const installments = sum(live.map((p) => p.payment_amount));
  const committed = round2(bills + installments);

  const cards = data.accounts
    .filter((a) => a.active && a.type === "credit")
    .map((a) => {
      const revolving = revolvingBalance(data, a, today);
      return {
        account: a.name,
        owed: a.balance,
        in_installments: round2(a.balance - revolving),
        revolving,
        revolving_due: revolvingDueDate(a, today),
        credit_limit: a.credit_limit,
      };
    });
  const revolvingDebt = sum(cards.map((c) => c.revolving));
  const installmentDebt = sum(live.map((p) => p.remaining_total));

  const confirm: Snapshot["needs_confirmation"] = [];
  const collect = (item: string, notes: string) => {
    for (const line of notes.split("\n")) if (line.includes("CONFIRM")) confirm.push({ item, note: line.trim() });
  };
  data.accounts.filter((a) => a.active).forEach((a) => collect(a.name, a.notes));
  data.plans.filter((p) => p.active).forEach((p) => collect(p.name, p.notes));
  data.bills.filter((b) => b.active).forEach((b) => collect(b.name, b.notes));
  incomes.forEach((i) => collect(i.name, i.notes));

  return {
    today,
    available_cash: availableCash(data),
    voucher_balance: sum(data.accounts.filter((a) => a.active && a.type === "voucher").map((a) => a.balance)),
    monthly_income: monthlyIncome,
    monthly_restricted_income: monthly(true),
    monthly_bills: bills,
    monthly_installments: installments,
    monthly_committed: committed,
    committed_pct_of_income: monthlyIncome > 0 ? round2((committed / monthlyIncome) * 100) : 0,
    left_after_committed: round2(monthlyIncome - committed),
    cards,
    revolving_debt: revolvingDebt,
    installment_debt_remaining: installmentDebt,
    total_to_pay: round2(revolvingDebt + installmentDebt),
    plans,
    relief_timeline: live
      .filter((p) => p.last_payment)
      .sort((a, b) => (a.last_payment! < b.last_payment! ? -1 : 1))
      .map((p) => ({ plan: p.name, last_payment: p.last_payment!, monthly_amount_freed: p.payment_amount })),
    needs_confirmation: confirm,
  };
}
