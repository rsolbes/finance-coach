import { describe, expect, it } from "vitest";
import { fixtureData } from "../test/fixture";
import { cashTimeline } from "./engine";
import { moneyInEffects, type MoneyInEffects } from "./money-in";
import { paymentEffects, paymentTargets, type PaymentEffects } from "./payments";
import { billOccurrenceFor, nearestIncomeOccurrence, settledOccurrences, type RecordedTransaction } from "./settlement";

const PAYDAY = "2026-10-02"; // a Friday: salary and vouchers are both scheduled
const base = fixtureData();
const id = (name: string) => base.accounts.find((a) => a.name === name)!.id;
const salary = base.incomes.find((i) => i.name === "Salary")!;

const tx = (over: Partial<RecordedTransaction>): RecordedTransaction => ({
  date: PAYDAY,
  amount: 0,
  account_id: null,
  category: "income",
  ref: null,
  ...over,
});

/** Labels and dates of the paydays the timeline still expects. */
const paydays = (settled: Set<string>, today = PAYDAY) =>
  cashTimeline({ ...base, settled }, today, 10)
    .rows.filter((r) => r.kind === "income")
    .map((r) => `${r.label} ${r.date}`);

describe("today's paycheck already recorded (the reported bug)", () => {
  it("is not counted again when it was recorded without a link", () => {
    // The salary landed in the payroll account today and the balance was updated.
    const settled = settledOccurrences(base, [tx({ amount: 3000, account_id: id("Payroll debit") })], PAYDAY);
    expect(paydays(settled)).toEqual(["Vouchers 2026-10-02", "Salary 2026-10-09", "Vouchers 2026-10-09"]);
  });

  it("handles the vouchers card the same way", () => {
    const settled = settledOccurrences(
      base,
      [tx({ amount: 3000, account_id: id("Payroll debit") }), tx({ amount: 250, account_id: id("Vouchers") })],
      PAYDAY,
    );
    expect(paydays(settled)).toEqual(["Salary 2026-10-09", "Vouchers 2026-10-09"]);
  });

  it("doesn't treat money into a different account as the paycheck", () => {
    const settled = settledOccurrences(base, [tx({ amount: 3000, account_id: id("Wallet") })], PAYDAY);
    expect(paydays(settled)).toContain("Salary 2026-10-02");
  });

  it("counts one deposit for one paycheck only", () => {
    // Two incomes into the same account on the same day need two deposits.
    const twoIncomes = { ...base, incomes: [...base.incomes, { ...salary, id: 99, name: "Side job", amount: 500 }] };
    const settled = settledOccurrences(twoIncomes, [tx({ amount: 3000, account_id: id("Payroll debit") })], PAYDAY);
    expect(settled.size).toBe(1);
  });
});

describe("explicit links", () => {
  it("match a paycheck that arrives a day early to its payday", () => {
    expect(nearestIncomeOccurrence(salary, "2026-10-01")).toBe("2026-10-02");
    expect(nearestIncomeOccurrence(salary, "2026-10-02")).toBe("2026-10-02");
    // Too far from any payday to be sure: no link.
    expect(nearestIncomeOccurrence(salary, "2026-10-05")).toBeNull();
  });

  it("are created when money in names its income source", () => {
    const fx = moneyInEffects(base, {
      date: "2026-10-01",
      amount: 3000,
      account_id: id("Payroll debit"),
      description: "",
      category: "income",
      add_to_balance: true,
      income_id: salary.id,
    }) as MoneyInEffects;
    expect(fx.ref).toBe(`income:${salary.id}@2026-10-02`);
    // A linked payday disappears from the projection even before its date.
    expect(paydays(new Set([fx.ref!]), "2026-10-01")).toEqual(["Vouchers 2026-10-02", "Salary 2026-10-09", "Vouchers 2026-10-09"]);
  });

  it("let recurring bills be paid and marked done", () => {
    const streaming = base.bills.find((b) => b.name === "Streaming")!;
    expect(paymentTargets(base, "2026-10-01").find((t) => t.key === `bill:${streaming.id}`)?.due_date).toBe("2026-10-15");
    const fx = paymentEffects(
      base,
      {
        date: "2026-10-10",
        amount: 150,
        target: `bill:${streaming.id}`,
        from_account_id: id("Payroll debit"),
        deduct_from_account: true,
        reduce_card_balance: true,
        covers_statement: true,
      },
      "2026-10-01",
    ) as PaymentEffects;
    expect(fx.ref).toBe(`bill:${streaming.id}@2026-10-15`); // paid early, for the Oct 15 occurrence
    expect(fx.category).toBe("subscriptions");
    const rows = cashTimeline({ ...base, settled: new Set([fx.ref!]) }, "2026-10-01", 50).rows;
    expect(rows.filter((r) => r.label.startsWith("Streaming")).map((r) => r.date)).toEqual(["2026-11-15"]);
  });

  it("pick the occurrence a payment is for", () => {
    const streaming = base.bills.find((b) => b.name === "Streaming")!; // day 15
    expect(billOccurrenceFor(streaming, "2026-10-10")).toBe("2026-10-15");
    expect(billOccurrenceFor(streaming, "2026-10-18")).toBe("2026-10-15"); // a few days late
    expect(billOccurrenceFor(streaming, "2026-10-25")).toBe("2026-11-15");
  });
});

describe("bills and installments paid today", () => {
  it("are not counted again", () => {
    // The fixture's gym bill (500) is due on the 1st; it was paid today.
    const settled = settledOccurrences(base, [tx({ date: "2026-10-01", amount: -500, category: "health" })], "2026-10-01");
    const rows = cashTimeline({ ...base, settled }, "2026-10-01", 10).rows;
    expect(rows.some((r) => r.label === "Gym")).toBe(false);
  });

  it("need a matching amount", () => {
    const settled = settledOccurrences(base, [tx({ date: "2026-10-01", amount: -120, category: "restaurants" })], "2026-10-01");
    expect(settled.size).toBe(0);
  });
});
