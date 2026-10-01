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

    const goal = JSON.parse((await runTool("save_goal", { title: "Emergency fund", kind: "save", target_amount: 3000 })).content);
    expect(goal.saved).toBe(true);
    const goals = JSON.parse((await runTool("list_goals", {})).content);
    expect(goals[0].title).toBe("Emergency fund");

    const upd = JSON.parse((await runTool("update_account_balance", { account_id: 2, balance: 14000 })).content);
    expect(upd.updated).toBe("Card A");
    expect(upd.revolving_balance_now).toBe(8900); // 14,000 - 5,100 in MSI

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

  it("rejects bad input instead of running", async () => {
    const { runTool } = await import("./tools");
    expect((await runTool("get_cash_flow", { days: "lots" })).isError).toBe(true);
    expect((await runTool("calculate", { expression: "require('fs')" })).isError).toBe(true);
    expect((await runTool("nope", {})).isError).toBe(true);
  });
});
