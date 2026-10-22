import { describe, expect, it } from "vitest";
import { calculateCurrentDebt } from "./debt-history";
import { FIXTURE } from "../test/fixture";
import { seedToFinanceData } from "./seed";

describe("debt-history", () => {
  it("calculates current debt correctly separating cards and non-card plans", () => {
    const data = seedToFinanceData(FIXTURE);
    const today = "2026-10-01";
    const res = calculateCurrentDebt(data, today);

    // FIXTURE has:
    // Cards:
    // card_a: balance 10,000
    // card_b: balance 8,000
    // card_c: balance 2,000
    // Total cards = 20,000
    expect(res.cards_debt).toBe(20000);

    // Plans in FIXTURE:
    // card_b installments: account_id = card_b (credit) -> on card, skipped from non-card loans
    // card_a 15 MSI: account_id = card_a (credit) -> on card, skipped from non-card loans
    // loan_1: account_id = wallet (non-credit) -> loan!
    // phone: account_id = null -> loan!
    // Non-card loans should be counted
    expect(res.loans_debt).toBeGreaterThan(0);
    expect(res.total_debt).toBe(res.cards_debt + res.loans_debt);
    expect(res.breakdown.cards.length).toBe(3);
  });
});
