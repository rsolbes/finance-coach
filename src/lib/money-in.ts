// Money coming in: a paycheck, a transfer from another bank, a refund. Pure rules; record-money-in.ts applies them.
import { round2 } from "./engine";
import { nearestIncomeOccurrence, occurrenceKey } from "./settlement";
import type { FinanceData } from "./types";

export const MONEY_IN_CATEGORIES = ["income", "transfer", "other"] as const;
export type MoneyInCategory = (typeof MONEY_IN_CATEGORIES)[number];

export interface MoneyInInput {
  date: string;
  amount: number;
  account_id: number;
  description: string;
  category: MoneyInCategory;
  /** Add it to the account's balance (false if the balance was already updated by hand). */
  add_to_balance: boolean;
  /** The income source this is, so its scheduled payday stops showing as pending. */
  income_id?: number | null;
}

export interface MoneyInEffects {
  balance: { account_id: number; balance: number } | null;
  account_name: string;
  /** The scheduled payday this settles, e.g. "income:1@2026-10-02". */
  ref: string | null;
  notes: string[];
}

export function moneyInEffects(data: FinanceData, input: MoneyInInput): MoneyInEffects | { error: string } {
  const acc = data.accounts.find((a) => a.id === input.account_id);
  if (!acc) return { error: "Unknown account" };
  const notes: string[] = [];
  let ref: string | null = null;
  if (input.income_id) {
    const inc = data.incomes.find((i) => i.id === input.income_id);
    if (!inc) return { error: "Unknown income source" };
    const occurrence = nearestIncomeOccurrence(inc, input.date);
    if (occurrence) {
      ref = occurrenceKey(`income:${inc.id}`, occurrence);
      notes.push(`Counted as the ${inc.name} due ${occurrence}.`);
    }
  }
  if (!input.add_to_balance) return { balance: null, account_name: acc.name, ref, notes };
  // Money into a card (a refund or cashback) lowers what it owes.
  const balance = round2(acc.type === "credit" ? acc.balance - input.amount : acc.balance + input.amount);
  notes.unshift(acc.type === "credit" ? `${acc.name} now owes ${balance.toFixed(2)}.` : `${acc.name} balance is now ${balance.toFixed(2)}.`);
  return { balance: { account_id: acc.id, balance }, account_name: acc.name, ref, notes };
}
