import { describe, expect, it } from "vitest";
import { fixtureData, TODAY } from "../test/fixture";
import { paymentEffects, paymentTargets, type PaymentEffects, type PaymentInput } from "./payments";

const data = fixtureData();
const id = (name: string) => data.accounts.find((a) => a.name === name)!.id;
const planId = (name: string) => data.plans.find((p) => p.name === name)!.id;

const input = (over: Partial<PaymentInput>): PaymentInput => ({
  date: TODAY,
  amount: 0,
  target: null,
  from_account_id: id("Payroll debit"),
  deduct_from_account: true,
  reduce_card_balance: true,
  covers_statement: true,
  ...over,
});
const pay = (over: Partial<PaymentInput>) => paymentEffects(data, input(over), TODAY) as PaymentEffects;

describe("payment targets", () => {
  it("lists cards with their pending statement and loans not charged to a card", () => {
    const targets = paymentTargets(data, TODAY);
    const cardB = targets.find((t) => t.label === "Card B")!;
    expect(cardB.due_date).toBe("2026-11-04");
    expect(cardB.due_amount).toBe(3920); // 3,100 regular + 820 installment
    expect(targets.find((t) => t.label === "Card A")!.due_amount).toBe(5500); // 4,900 + 200 + 300 + 100
    expect(targets.some((t) => t.label === "Loan 1 (4/9)")).toBe(true);
    // Installments charged to a card are paid through the card, not separately
    expect(targets.some((t) => t.label.startsWith("Card A 15 MSI"))).toBe(false);
  });
});

describe("paying a card statement", () => {
  it("lowers both balances, marks the installment paid and moves the due date", () => {
    const fx = pay({ target: `card:${id("Card B")}`, amount: 3920, date: "2026-10-30" });
    expect(fx.category).toBe("card_payment");
    expect(fx.balances).toEqual([
      { account_id: id("Payroll debit"), balance: -3420 },
      { account_id: id("Card B"), balance: 4080 },
    ]);
    expect(fx.plans).toEqual([
      { plan_id: planId("Card B installments"), payments_made: 3, next_payment_date: "2026-12-04" },
    ]);
    expect(fx.due_dates).toEqual([{ account_id: id("Card B"), next_due_date: "2026-12-05" }]);
  });

  it("covers every installment plan on the card", () => {
    const fx = pay({ target: `card:${id("Card A")}`, amount: 5500, date: "2026-10-25" });
    expect(fx.plans.map((p) => [p.payments_made, p.next_payment_date])).toEqual([
      [1, "2026-11-27"],
      [1, "2026-11-27"],
      [1, "2026-11-27"],
    ]);
    expect(fx.due_dates[0].next_due_date).toBe("2026-11-27");
  });

  it("only changes the balance when it doesn't cover the statement", () => {
    const fx = pay({ target: `card:${id("Card A")}`, amount: 1000, covers_statement: false, deduct_from_account: false });
    expect(fx.plans).toEqual([]);
    expect(fx.due_dates).toEqual([]);
    expect(fx.balances).toEqual([{ account_id: id("Card A"), balance: 9000 }]);
  });
});

describe("paying a loan", () => {
  it("marks the next payment as paid when paid early", () => {
    const fx = pay({ target: `plan:${planId("Loan 1")}`, amount: 1700, date: "2026-10-28" });
    expect(fx.category).toBe("installment_payment");
    expect(fx.plans).toEqual([{ plan_id: planId("Loan 1"), payments_made: 4, next_payment_date: "2026-12-01" }]);
  });

  it("doesn't double count an old receipt for a payment already counted", () => {
    const fx = pay({ target: `plan:${planId("Loan 1")}`, amount: 1700, date: "2026-10-01" });
    expect(fx.plans).toEqual([]);
    expect(fx.notes.join(" ")).toContain("already counted");
  });

  it("refuses installments that are charged to a card", () => {
    const res = paymentEffects(data, input({ target: `plan:${planId("Card A 15 MSI")}`, amount: 200 }), TODAY);
    expect(res).toHaveProperty("error");
  });
});
