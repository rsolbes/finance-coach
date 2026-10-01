import { diffDays } from "./dates";
import { round2 } from "./engine";
import { NON_SPENDING_CATEGORIES, type Transaction } from "./types";

export interface SpendingSummary {
  from: string;
  to: string;
  transactions: number;
  total_spent: number;
  total_income: number;
  daily_average_spent: number;
  by_category: { category: string; amount: number; pct: number; count: number }[];
  top_merchants: { merchant: string; amount: number; count: number }[];
}

/** Rough merchant key: "OXXO SUC 1234 MTY" and "OXXO SUC 998" both become "OXXO SUC". */
export function merchantKey(description: string): string {
  const words = description
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÑÜ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.slice(0, 2).join(" ") || description.trim().toUpperCase();
}

export function isSpending(t: Transaction): boolean {
  return t.amount < 0 && !NON_SPENDING_CATEGORIES.includes(t.category);
}

export function spendingSummary(txs: Transaction[], from: string, to: string): SpendingSummary {
  const inRange = txs.filter((t) => t.date >= from && t.date <= to);
  const spend = inRange.filter(isSpending);
  const total = round2(spend.reduce((a, t) => a - t.amount, 0));

  const group = (key: (t: Transaction) => string) => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const t of spend) {
      const k = key(t);
      const cur = map.get(k) ?? { amount: 0, count: 0 };
      cur.amount -= t.amount;
      cur.count++;
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  };

  return {
    from,
    to,
    transactions: inRange.length,
    total_spent: total,
    total_income: round2(inRange.filter((t) => t.category === "income").reduce((a, t) => a + t.amount, 0)),
    daily_average_spent: round2(total / Math.max(1, diffDays(from, to) + 1)),
    by_category: group((t) => t.category).map(([category, v]) => ({
      category,
      amount: round2(v.amount),
      pct: total ? round2((v.amount / total) * 100) : 0,
      count: v.count,
    })),
    top_merchants: group((t) => merchantKey(t.description))
      .slice(0, 12)
      .map(([merchant, v]) => ({ merchant, amount: round2(v.amount), count: v.count })),
  };
}
