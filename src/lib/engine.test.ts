import { describe, expect, it } from "vitest";
import { fixtureData, TODAY } from "../test/fixture";
import { evaluate } from "./calc";
import { spendingSummary } from "./spending";
import type { Transaction } from "./types";
import { addMonths } from "./dates";
import {
  cashTimeline,
  monthlyProjection,
  planSchedule,
  revolvingBalance,
  revolvingDueDate,
  snapshot,
  statementDueForCharge,
} from "./engine";

const data = fixtureData();
const account = (name: string) => data.accounts.find((a) => a.name === name)!;

describe("dates", () => {
  it("clamps month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
});

describe("plans", () => {
  const loan = data.plans.find((p) => p.name === "Loan 1")!;

  it("lists the remaining payments from the next due date", () => {
    const s = planSchedule(loan, TODAY);
    expect(s).toHaveLength(6);
    expect(s[0]).toEqual({ date: "2026-11-01", number: 4 });
    expect(s.at(-1)).toEqual({ date: "2027-04-01", number: 9 });
  });

  it("treats past due dates as paid as time moves on", () => {
    expect(planSchedule(loan, "2026-11-02")).toHaveLength(5);
  });
});

describe("credit cards", () => {
  const cardA = account("Card A");
  const cardB = account("Card B");

  it("finds the next payment date from fecha de corte", () => {
    // Cut Sept 7 was due Sept 27 (passed) -> next cut Oct 7, due Oct 27
    expect(revolvingDueDate(cardA, TODAY)).toBe("2026-10-27");
    // Cut Sept 15, due Oct 5 (still ahead) when no due date is known
    expect(revolvingDueDate({ ...cardB, next_due_date: null }, TODAY)).toBe("2026-10-05");
  });

  it("uses a known due date until it passes", () => {
    expect(revolvingDueDate(cardB, TODAY)).toBe("2026-11-04");
    expect(revolvingDueDate(cardB, "2026-11-05")).toBe("2026-12-05");
    // Works without a fecha de corte too
    const cardC = account("Card C");
    expect(revolvingDueDate(cardC, TODAY)).toBeNull();
    expect(revolvingDueDate({ ...cardC, next_due_date: "2026-10-20" }, TODAY)).toBe("2026-10-20");
  });

  it("separates installments from the balance you must pay in full", () => {
    expect(revolvingBalance(data, cardA, TODAY)).toBe(4900); // 10,000 - (3,000 + 900 + 1,200)
    expect(revolvingBalance(data, cardB, TODAY)).toBe(3100); // 8,000 - 7 x 700
  });

  it("splits MSI by the original amount, not the rounded payment", () => {
    const odd = { ...data, plans: [{ ...data.plans[1], original_amount: 4645.23, payment_amount: 309.68 }] };
    expect(revolvingBalance(odd, { ...cardA, balance: 5000 }, TODAY)).toBe(354.77);
  });
});

describe("bills paid with a credit card", () => {
  const withCardBill = (day: number) => ({
    ...data,
    bills: data.bills.map((b) => (b.name === "Gym" ? { ...b, day_of_month: day, account_id: account("Card A").id } : b)),
  });
  const gymDates = (d: typeof data) =>
    cashTimeline(d, TODAY, 70).rows.filter((r) => r.label.startsWith("Gym")).map((r) => r.date);

  it("count on the card's due date, not the charge date", () => {
    // Card A: corte day 7, due 20 days later. Charged Oct 28 -> Nov 7 statement -> due Nov 27.
    expect(gymDates(withCardBill(28))).toEqual(["2026-11-27"]);
    expect(statementDueForCharge(account("Card A"), "2026-10-28")).toBe("2026-11-27");
  });

  it("include a charge made on the cut day in that statement", () => {
    expect(statementDueForCharge(account("Card A"), "2026-10-07")).toBe("2026-10-27");
    expect(gymDates(withCardBill(7))).toEqual(["2026-10-27", "2026-11-27"]);
  });

  it("skip charges before today, which are already in the card balance", () => {
    // A Sept 28 charge would be due Oct 27, but it's already part of the card's current balance.
    expect(gymDates(withCardBill(28))).not.toContain("2026-10-27");
  });
});

describe("cash flow", () => {
  it("runs a balance through paydays and payments", () => {
    const t = cashTimeline(data, TODAY, 30);
    expect(t.starting_cash).toBe(500); // payroll + wallet; vouchers excluded
    const paydays = t.rows.filter((r) => r.kind === "income" && !r.restricted);
    expect(paydays.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    // Gym (500) today takes the balance to exactly 0 before the first payday
    expect(t.lowest_balance).toBe(0);
    expect(t.lowest_balance_date).toBe(TODAY);
    expect(t.first_shortfall_date).toBeNull();
  });

  it("flags the first day money runs out", () => {
    const poorer = {
      ...data,
      accounts: data.accounts.map((a) => (a.name === "Payroll debit" ? { ...a, balance: 100 } : a)),
    };
    expect(cashTimeline(poorer, TODAY, 30).first_shortfall_date).toBe(TODAY);
  });

  it("projects months and frees money as plans end", () => {
    const months = monthlyProjection(data, TODAY, 8);
    expect(months[0].month).toBe("2026-10");
    expect(months[0].income).toBe(15000); // 5 Fridays
    expect(months[0].card_statements).toBe(4900); // Card A; Card B is due in November
    expect(months[1].card_statements).toBe(3100);
    expect(months[3].plans_ending).toContain("Loan 2"); // Jan 2027
    expect(months[6].plans_ending).toContain("Loan 1"); // Apr 2027
    expect(months[7].plans_ending).toContain("Card B installments"); // May 2027
  });

  it("summarizes commitments", () => {
    const s = snapshot(data, TODAY);
    expect(s.monthly_income).toBe(13000); // 3,000 x 52 / 12
    expect(s.monthly_restricted_income).toBe(1083.33);
    expect(s.needs_confirmation).toEqual([{ item: "Gym", note: "CONFIRM: day of the month." }]);
  });
});

describe("spending", () => {
  const tx = (date: string, description: string, amount: number, category: Transaction["category"]): Transaction => ({
    id: 0,
    account_id: null,
    date,
    description,
    amount,
    category,
    notes: "",
    source: "test",
    created_at: "",
  });

  it("keeps purchases made a meses out of the month's spending", () => {
    const s = spendingSummary(
      [
        tx("2026-09-30", "Amazon a meses a 15 meses", -4645.23, "installment_purchase"),
        tx("2026-09-29", "Amazon a meses", -667.9, "installment_purchase"),
        tx("2026-09-28", "Farmacia", -889, "health"),
        tx("2026-09-27", "Mensualidad 1 de 12", -78.75, "installment_payment"),
        tx("2026-09-25", "Pago tarjeta", -1000, "card_payment"),
      ],
      "2026-09-01",
      "2026-09-30",
    );
    expect(s.total_spent).toBe(967.75); // medicine + the monthly installment charge
    expect(s.financed_in_installments.total).toBe(5313.13);
    expect(s.financed_in_installments.purchases).toHaveLength(2);
    expect(s.by_category.map((c) => c.category)).not.toContain("installment_purchase");
  });
});

describe("calculate", () => {
  it("evaluates arithmetic safely", () => {
    expect(evaluate("3,000 * 52 / 12")).toBe(13000);
    expect(evaluate("-(2+3)*2^2")).toBe(-20);
    expect(() => evaluate("process.exit()")).toThrow();
    expect(() => evaluate("1/0")).toThrow();
  });
});
