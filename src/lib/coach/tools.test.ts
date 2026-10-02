import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FIXTURE } from "../../test/fixture";

const BASE = join(tmpdir(), `finance-coach-test-${process.pid}`).replaceAll("\\", "/");
const DB_FILE = `${BASE}.db`;
const SEED = `${BASE}.seed.json`;

beforeAll(() => {
  // A throwaway database, seeded with the made-up fixture.
  writeFileSync(SEED, JSON.stringify(FIXTURE));
  vi.stubEnv("DATABASE_URL", `file:${DB_FILE}`);
  vi.stubEnv("SEED_FILE", SEED);
  vi.useFakeTimers({ now: new Date("2026-10-01T18:00:00Z"), toFake: ["Date"] });
});

afterAll(async () => {
  vi.useRealTimers();
  const { db } = await import("../db");
  (await db()).close();
  for (const f of [DB_FILE, SEED]) {
    try {
      rmSync(f, { force: true });
    } catch {
      // Windows may keep the file locked briefly; it lives in the temp folder anyway.
    }
  }
});

describe("coach tools", () => {
  it("exposes valid JSON schemas", async () => {
    const { toolDefinitions } = await import("./tools");
    for (const t of toolDefinitions) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("runs every read tool against the seeded database", async () => {
    const { runTool } = await import("./tools");
    const overview = await runTool("get_financial_overview", {});
    expect(overview.isError).toBe(false);
    expect(JSON.parse(overview.content).monthly_income).toBe(13000);

    const flow = JSON.parse((await runTool("get_cash_flow", { days: 31 })).content);
    expect(flow.starting_cash).toBe(500);

    expect((await runTool("get_monthly_projection", { months: 6 })).isError).toBe(false);
    expect(JSON.parse((await runTool("calculate", { expression: "3000*4" })).content).result).toBe(12000);

    const payoff = JSON.parse((await runTool("plan_payoff", { amount: 3000, monthly_payment: 1000 })).content);
    expect(payoff.months).toBe(3);
  });

  it("writes data: transactions, goals, balances, memories", async () => {
    const { runTool } = await import("./tools");
    await runTool("log_transaction", { date: "2026-10-01", description: "Tacos", amount: -120, category: "restaurants" });
    const summary = JSON.parse((await runTool("get_spending_summary", { from: "2026-10-01", to: "2026-10-31" })).content);
    expect(summary.total_spent).toBe(120);

    const goal = JSON.parse(
      (await runTool("save_record", { kind: "goals", fields: { title: "Emergency fund", kind: "save", target_amount: 3000 } }))
        .content,
    );
    expect(goal).toMatchObject({ saved: true, created: true });
    const goals = JSON.parse((await runTool("list_records", { kind: "goals" })).content);
    expect(goals[0]).toMatchObject({ title: "Emergency fund", status: "active" });

    const upd = JSON.parse((await runTool("save_record", { kind: "accounts", id: 2, fields: { balance: 14000 } })).content);
    expect(upd.record).toMatchObject({ name: "Card A", balance: 14000, statement_day: 7 }); // other fields kept
    expect(upd.to_pay_in_full_now).toBe(8900); // 14,000 - 5,100 in MSI

    const mem = JSON.parse((await runTool("remember", { fact: "Prefers Spanish" })).content);
    expect(JSON.parse((await runTool("forget", { id: mem.id })).content).remaining).toEqual([]);
  });

  it("records a payment once and refuses the same receipt twice", async () => {
    const { runTool } = await import("./tools");
    const payment = {
      date: "2026-10-30",
      amount: 3920,
      target: "card:3", // Card B
      from_account_id: 1, // Payroll debit
      deduct_from_account: true,
    };
    const first = JSON.parse((await runTool("record_payment", payment)).content);
    expect(first.ok).toBe(true);
    expect(first.notes.join(" ")).toContain("Next payment: 2026-12-05");

    const targets = JSON.parse((await runTool("list_payment_targets", {})).content);
    expect(targets.find((t: { key: string }) => t.key === "card:3").due_date).toBe("2026-12-05");

    const again = JSON.parse((await runTool("record_payment", payment)).content);
    expect(again.ok).toBe(false);
    expect(again.error).toContain("already recorded");
  });

  it("edits everything the Plan page can: bills, plans, transactions, profile", async () => {
    const { runTool } = await import("./tools");
    const run = async (name: string, input: unknown) => JSON.parse((await runTool(name, input)).content);

    // Move the gym bill to the 28th and pay it with Card A: it now counts on Card A's due date.
    const bills = await run("list_records", { kind: "bills" });
    const gym = bills.find((b: { name: string }) => b.name === "Gym");
    const moved = await run("save_record", { kind: "bills", id: gym.id, fields: { day_of_month: 28, account_id: 2 } });
    expect(moved.record).toMatchObject({ name: "Gym", amount: 500, day_of_month: 28, account_id: 2 });
    const flow = await run("get_cash_flow", { days: 60 });
    const gymRows = flow.rows.filter((r: { label: string }) => r.label.startsWith("Gym"));
    expect(gymRows.map((r: { date: string; label: string }) => [r.date, r.label])).toEqual([
      ["2026-11-27", "Gym (on Card A)"], // charged Oct 28 -> cut Nov 7 -> due Nov 27
    ]);

    // Validation is the Plan page's: bad values and unknown fields are refused.
    expect((await run("save_record", { kind: "bills", id: gym.id, fields: { day_of_month: 40 } })).error).toMatch(/at most 31/);
    expect((await run("save_record", { kind: "bills", fields: { colour: "red" } })).error).toMatch(/Unknown field/);
    expect((await run("save_record", { kind: "bills", fields: { name: "Netflix" } })).error).toMatch(/required/);

    // Fix an installment plan's schedule, then turn a bill off instead of deleting it.
    const plans = await run("list_records", { kind: "plans" });
    const loan = plans.find((p: { name: string }) => p.name === "Loan 2");
    const fixed = await run("save_record", { kind: "plans", id: loan.id, fields: { payments_made: 4, next_payment_date: "2026-12-01" } });
    expect(fixed.record).toMatchObject({ payments_made: 4, next_payment_date: "2026-12-01", total_payments: 6 });
    const off = await run("save_record", { kind: "bills", id: gym.id, fields: { active: false } });
    expect(off.record.active).toBe(0);

    // Create and delete a bill.
    const created = await run("save_record", {
      kind: "bills",
      fields: { name: "Netflix", amount: 219, day_of_month: 12, category: "subscriptions" },
    });
    expect(created.record).toMatchObject({ active: 1, is_estimate: 0 });
    expect((await run("delete_record", { kind: "bills", id: created.id })).deleted).toBe(true);
    expect((await run("delete_record", { kind: "bills", id: created.id })).error).toMatch(/No bill/);

    // Transactions: fix one, delete one.
    await run("log_transaction", { date: "2026-10-02", description: "UBER", amount: -90, category: "other" });
    const [uber] = await run("search_transactions", { text: "UBER" });
    const fixedTx = await run("update_transaction", { id: uber.id, category: "transport", amount: -95 });
    expect(fixedTx).toMatchObject({ description: "UBER", category: "transport", amount: -95 });
    expect((await run("delete_transaction", { id: uber.id })).deleted).toBe(true);
    expect(await run("search_transactions", { text: "UBER" })).toEqual([]);

    // Profile.
    expect((await run("set_profile", { profile: "Lives with family. Paid weekly." })).saved).toBe(true);
  });

  it("records money in once and adds it to the balance", async () => {
    const { runTool } = await import("./tools");
    const run = async (name: string, input: unknown) => JSON.parse((await runTool(name, input)).content);
    const before = (await run("list_records", { kind: "accounts" })).find((a: { id: number }) => a.id === 1).balance;
    const pay = { date: "2026-10-02", amount: 3000, account_id: 1, category: "income", description: "Salary" };
    expect((await run("record_money_in", pay)).ok).toBe(true);
    const after = (await run("list_records", { kind: "accounts" })).find((a: { id: number }) => a.id === 1).balance;
    expect(after).toBe(before + 3000);
    expect((await run("record_money_in", pay)).error).toMatch(/already recorded/);
  });

  it("doesn't count a recorded paycheck again in the cash flow", async () => {
    const { runTool } = await import("./tools");
    const run = async (name: string, input: unknown) => JSON.parse((await runTool(name, input)).content);
    const salaryRows = async () =>
      (await run("get_cash_flow", { days: 14 })).rows
        .filter((r: { label: string }) => r.label === "Salary")
        .map((r: { date: string }) => r.date);
    expect(await salaryRows()).toEqual(["2026-10-02", "2026-10-09"]);
    // Friday's paycheck lands a day early and is recorded with its income source.
    const res = await run("record_money_in", { date: "2026-10-01", amount: 3000, account_id: 1, category: "income", income_id: 1 });
    expect(res.notes.join(" ")).toContain("due 2026-10-02");
    expect(await salaryRows()).toEqual(["2026-10-09"]);
  });

  it("rejects bad input instead of running", async () => {
    const { runTool } = await import("./tools");
    expect((await runTool("get_cash_flow", { days: "lots" })).isError).toBe(true);
    expect((await runTool("calculate", { expression: "require('fs')" })).isError).toBe(true);
    expect((await runTool("nope", {})).isError).toBe(true);
  });
});
