import { describe, expect, it } from "vitest";
import { moneyInEffects } from "./money-in";
import type { FinanceData } from "./types";

const mockData: FinanceData = {
  accounts: [
    {
      id: 1,
      name: "Payroll Debit",
      institution: "BBVA",
      type: "debit",
      balance: 1000,
      credit_limit: null,
      statement_day: null,
      payment_due_days: null,
      next_due_date: null,
      notes: "",
      active: true,
    },
    {
      id: 2,
      name: "Credit Card",
      institution: "Nu",
      type: "credit",
      balance: 5000,
      credit_limit: 20000,
      statement_day: 15,
      payment_due_days: 20,
      next_due_date: "2026-11-04",
      notes: "",
      active: true,
    },
  ],
  plans: [],
  bills: [],
  incomes: [
    {
      id: 1,
      name: "Weekly Pay",
      amount: 3000,
      frequency: "weekly",
      anchor_date: "2026-10-02",
      account_id: 1,
      restricted_to: null,
      notes: "",
      active: true,
    },
  ],
};

describe("moneyInEffects", () => {
  it("adds money to a debit account balance", () => {
    const fx = moneyInEffects(mockData, {
      date: "2026-10-02",
      amount: 2500,
      account_id: 1,
      description: "Paycheck",
      category: "income",
      add_to_balance: true,
    });
    if ("error" in fx) throw new Error(fx.error);
    expect(fx.balance).toEqual({ account_id: 1, balance: 3500 });
    expect(fx.account_name).toBe("Payroll Debit");
  });

  it("reduces what a credit card owes when money goes into it", () => {
    const fx = moneyInEffects(mockData, {
      date: "2026-10-05",
      amount: 500,
      account_id: 2,
      description: "Refund",
      category: "other",
      add_to_balance: true,
    });
    if ("error" in fx) throw new Error(fx.error);
    expect(fx.balance).toEqual({ account_id: 2, balance: 4500 });
    expect(fx.notes[0]).toContain("Credit Card now owes 4500.00");
  });

  it("does not modify balance if add_to_balance is false", () => {
    const fx = moneyInEffects(mockData, {
      date: "2026-10-02",
      amount: 3000,
      account_id: 1,
      description: "Paycheck already updated",
      category: "income",
      add_to_balance: false,
    });
    if ("error" in fx) throw new Error(fx.error);
    expect(fx.balance).toBeNull();
  });

  it("links to nearest income occurrence for scheduled paychecks", () => {
    const fx = moneyInEffects(mockData, {
      date: "2026-10-01", // lands 1 day early
      amount: 3000,
      account_id: 1,
      description: "Paycheck",
      category: "income",
      add_to_balance: true,
      income_id: 1,
    });
    if ("error" in fx) throw new Error(fx.error);
    expect(fx.ref).toBe("income:1@2026-10-02");
    expect(fx.notes.join(" ")).toContain("due 2026-10-02");
  });

  it("returns an error for unknown account or income", () => {
    expect(
      moneyInEffects(mockData, {
        date: "2026-10-02",
        amount: 100,
        account_id: 999,
        description: "Test",
        category: "income",
        add_to_balance: true,
      }),
    ).toEqual({ error: "Unknown account" });

    expect(
      moneyInEffects(mockData, {
        date: "2026-10-02",
        amount: 100,
        account_id: 1,
        description: "Test",
        category: "income",
        add_to_balance: true,
        income_id: 999,
      }),
    ).toEqual({ error: "Unknown income source" });
  });
});
