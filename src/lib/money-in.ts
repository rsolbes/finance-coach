// Money coming in: a paycheck, a transfer from another bank, a refund. Pure rules; record-money-in.ts applies them.
import { round2 } from "./engine";
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
}

export interface MoneyInEffects {
  balance: { account_id: number; balance: number } | null;
  account_name: string;
  notes: string[];
}

export function moneyInEffects(data: FinanceData, input: MoneyInInput): MoneyInEffects | { error: string } {
  const acc = data.accounts.find((a) => a.id === input.account_id);
  if (!acc) return { error: "Unknown account" };
  if (!input.add_to_balance) return { balance: null, account_name: acc.name, notes: [] };
  if (acc.type === "credit") {
    // Money into a card (a refund or cashback) lowers what it owes.
    const balance = round2(acc.balance - input.amount);
    return { balance: { account_id: acc.id, balance }, account_name: acc.name, notes: [`${acc.name} now owes ${balance.toFixed(2)}.`] };
  }
  const balance = round2(acc.balance + input.amount);
  return { balance: { account_id: acc.id, balance }, account_name: acc.name, notes: [`${acc.name} balance is now ${balance.toFixed(2)}.`] };
}
