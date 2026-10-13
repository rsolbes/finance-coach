import { describe, expect, it } from "vitest";
import { isSpending, merchantKey, spendingSummary } from "./spending";
import type { Transaction } from "./types";

const makeTx = (partial: Partial<Transaction>): Transaction => ({
  id: 1,
  account_id: 1,
  date: "2026-10-15",
  description: "Test",
  amount: -100,
  category: "groceries",
  notes: "",
  source: "manual",
  created_at: "2026-10-15 12:00:00",
  ...partial,
});

describe("merchantKey", () => {
  it("normalizes merchant names and collapses trailing store numbers", () => {
    expect(merchantKey("OXXO SUC 1234 MTY")).toBe("OXXO SUC");
    expect(merchantKey("OXXO SUC 998")).toBe("OXXO SUC");
    expect(merchantKey("UBER TRIP *HELP.UBER.COM")).toBe("UBER TRIP");
    expect(merchantKey("WALMART SUPERCENTER")).toBe("WALMART SUPERCENTER");
  });

  it("handles accents and special characters cleanly", () => {
    expect(merchantKey("FARMACIA SAN PABLO #42")).toBe("FARMACIA SAN");
    expect(merchantKey("CAFÉ DE TACUBA")).toBe("CAFÉ DE");
  });
});

describe("isSpending", () => {
  it("returns true for regular expenses", () => {
    expect(isSpending(makeTx({ amount: -50, category: "groceries" }))).toBe(true);
    expect(isSpending(makeTx({ amount: -120, category: "restaurants" }))).toBe(true);
  });

  it("returns false for positive amounts (income/refunds)", () => {
    expect(isSpending(makeTx({ amount: 100, category: "groceries" }))).toBe(false);
  });

  it("returns false for non-spending categories", () => {
    expect(isSpending(makeTx({ amount: -1000, category: "card_payment" }))).toBe(false);
    expect(isSpending(makeTx({ amount: -500, category: "transfer" }))).toBe(false);
    expect(isSpending(makeTx({ amount: -3000, category: "installment_purchase" }))).toBe(false);
  });
});

describe("spendingSummary", () => {
  const txs: Transaction[] = [
    makeTx({ id: 1, date: "2026-10-05", amount: -400, category: "groceries", description: "WALMART EXPRESS" }),
    makeTx({ id: 2, date: "2026-10-10", amount: -200, category: "groceries", description: "WALMART EXPRESS" }),
    makeTx({ id: 3, date: "2026-10-12", amount: -150, category: "restaurants", description: "TACOS EL GUERO" }),
    makeTx({ id: 4, date: "2026-10-15", amount: 5000, category: "income", description: "PAYROLL" }),
    makeTx({ id: 5, date: "2026-10-18", amount: -2000, category: "card_payment", description: "PAGO TARJETA" }),
    makeTx({ id: 6, date: "2026-10-20", amount: -6000, category: "installment_purchase", description: "IPHONE 12 MSI" }),
  ];

  it("computes totals excluding card payments and counting income separately", () => {
    const s = spendingSummary(txs, "2026-10-01", "2026-10-31");
    expect(s.total_spent).toBe(750); // 400 + 200 + 150
    expect(s.total_income).toBe(5000);
    expect(s.transactions).toBe(6);
    expect(s.daily_average_spent).toBe(Math.round((750 / 31) * 100) / 100);
  });

  it("groups spending by category with percentages", () => {
    const s = spendingSummary(txs, "2026-10-01", "2026-10-31");
    expect(s.by_category).toHaveLength(2);
    expect(s.by_category[0]).toMatchObject({ category: "groceries", amount: 600, pct: 80, count: 2 });
    expect(s.by_category[1]).toMatchObject({ category: "restaurants", amount: 150, pct: 20, count: 1 });
  });

  it("identifies top merchants and MSI financed purchases", () => {
    const s = spendingSummary(txs, "2026-10-01", "2026-10-31");
    expect(s.top_merchants[0]).toMatchObject({ merchant: "WALMART EXPRESS", amount: 600, count: 2 });
    expect(s.financed_in_installments.total).toBe(6000);
    expect(s.financed_in_installments.purchases).toHaveLength(1);
    expect(s.financed_in_installments.purchases[0]).toMatchObject({ description: "IPHONE 12 MSI", amount: 6000 });
  });
});
