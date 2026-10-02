import { describe, expect, it } from "vitest";
import { fixtureData, TODAY } from "../test/fixture";
import { moneyInEffects, type MoneyInEffects } from "./money-in";
import { ImportPayload, MoneyInPayload, PaymentPayload } from "./payloads";
import { paymentEffects, type PaymentEffects } from "./payments";

// Exactly what the Spending page forms send.
describe("form payloads", () => {
  it("accept what the payment form sends", () => {
    const ok = PaymentPayload.safeParse({
      date: "2026-10-01",
      amount: 939.16,
      description: "Rappi",
      target: "card:3",
      from_account_id: 1,
      deduct_from_account: true,
      reduce_card_balance: true,
      covers_statement: true,
    });
    expect(ok.success).toBe(true);
  });

  it("accept what the money-in and import forms send", () => {
    expect(
      MoneyInPayload.safeParse({
        date: "2026-10-02",
        amount: 2988.28,
        account_id: 1,
        description: "Salary (net)",
        category: "income",
        add_to_balance: true,
      }).success,
    ).toBe(true);
    expect(
      ImportPayload.safeParse({
        accountId: 2,
        newBalance: null,
        rows: [{ date: "2026-09-30", description: "Amazon", amount: -945, category: "installment_purchase", note: "" }],
      }).success,
    ).toBe(true);
  });

  it("reject malformed dates and targets", () => {
    const base = { amount: 1, description: "", from_account_id: null, deduct_from_account: false, reduce_card_balance: true, covers_statement: true };
    expect(PaymentPayload.safeParse({ ...base, date: "01/10/2026", target: null }).success).toBe(false);
    expect(PaymentPayload.safeParse({ ...base, date: "2026-10-01", target: "card:x" }).success).toBe(false);
  });
});

const data = fixtureData();
const id = (name: string) => data.accounts.find((a) => a.name === name)!.id;
const planId = (name: string) => data.plans.find((p) => p.name === name)!.id;

describe("paying with a credit card", () => {
  it("adds the amount to what the card owes and still marks the installment paid", () => {
    const fx = paymentEffects(
      data,
      {
        date: "2026-10-28",
        amount: 1700,
        target: `plan:${planId("Loan 1")}`,
        from_account_id: id("Card A"),
        deduct_from_account: true,
        reduce_card_balance: true,
        covers_statement: true,
      },
      TODAY,
    ) as PaymentEffects;
    expect(fx.balances).toEqual([{ account_id: id("Card A"), balance: 11700 }]); // owed 10,000 + 1,700
    expect(fx.plans).toEqual([{ plan_id: planId("Loan 1"), payments_made: 4, next_payment_date: "2026-12-01" }]);
  });

  it("refuses a card paying itself", () => {
    const res = paymentEffects(
      data,
      {
        date: TODAY,
        amount: 100,
        target: `card:${id("Card A")}`,
        from_account_id: id("Card A"),
        deduct_from_account: true,
        reduce_card_balance: true,
        covers_statement: false,
      },
      TODAY,
    );
    expect(res).toHaveProperty("error");
  });
});

describe("money in", () => {
  const base = { date: TODAY, description: "", category: "income" as const, add_to_balance: true };

  it("adds a paycheck to a debit account", () => {
    const fx = moneyInEffects(data, { ...base, amount: 3000, account_id: id("Payroll debit") }) as MoneyInEffects;
    expect(fx.balance).toEqual({ account_id: id("Payroll debit"), balance: 3500 });
  });

  it("lowers what a card owes for a refund", () => {
    const fx = moneyInEffects(data, { ...base, amount: 250, account_id: id("Card A"), category: "other" }) as MoneyInEffects;
    expect(fx.balance).toEqual({ account_id: id("Card A"), balance: 9750 });
  });

  it("leaves the balance alone when asked to", () => {
    const fx = moneyInEffects(data, { ...base, amount: 3000, account_id: id("Payroll debit"), add_to_balance: false }) as MoneyInEffects;
    expect(fx.balance).toBeNull();
  });
});
