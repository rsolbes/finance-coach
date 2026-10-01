import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { evaluate } from "../calc";
import { addMonths, startOfMonth, todayISO } from "../dates";
import { cashTimeline, monthlyProjection, planStatus, revolvingBalance, revolvingDueDate, snapshot } from "../engine";
import {
  addMemory,
  deleteMemory,
  insertTransactions,
  listGoals,
  listMemories,
  listTransactions,
  loadFinanceData,
  saveEntity,
  setAccountBalance,
} from "../repo";
import { paymentTargets } from "../payments";
import { recordPayment } from "../record-payment";
import { spendingSummary } from "../spending";
import { CATEGORIES, GOAL_KINDS, GOAL_STATUSES } from "../types";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run: (input: z.infer<S>) => Promise<unknown>;
}

const tool = <S extends z.ZodType>(def: ToolDef<S>) => def;

const TOOLS = [
  tool({
    name: "get_financial_overview",
    description:
      "Current snapshot of the user's finances: cash available, monthly income vs committed payments, every card " +
      "(what's owed, how much is installments vs. balance that must be paid in full, and when), all installment plans " +
      "with payments left, when each plan ends (relief timeline), and data the user still needs to confirm. " +
      "Call this first in any conversation about their situation.",
    input: z.object({}),
    run: async () => {
      const data = await loadFinanceData();
      const today = todayISO();
      return {
        ...snapshot(data, today),
        accounts: data.accounts
          .filter((a) => a.active)
          .map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance, notes: a.notes })),
      };
    },
  }),
  tool({
    name: "get_cash_flow",
    description:
      "Day-by-day upcoming paydays and payments with the running cash balance (debit accounts and wallets; food " +
      "vouchers listed but not counted). Shows the lowest point and the first day money runs short. Use it to plan " +
      "which payment to make with which paycheck.",
    input: z.object({ days: z.number().int().min(1).max(120).describe("How many days ahead, e.g. 31") }),
    run: async ({ days }) => cashTimeline(await loadFinanceData(), todayISO(), days),
  }),
  tool({
    name: "get_monthly_projection",
    description:
      "Month-by-month income vs. bills, installments and card balances due, and what's left for living costs " +
      "(food, transport, everything else). The current month starts today. Shows which plans end each month.",
    input: z.object({ months: z.number().int().min(1).max(36) }),
    run: async ({ months }) => monthlyProjection(await loadFinanceData(), todayISO(), months),
  }),
  tool({
    name: "get_spending_summary",
    description:
      "Spending from imported/logged transactions between two dates: total, by category, top merchants. Card " +
      "payments and transfers between own accounts are excluded. Returns transactions: 0 if no data was imported.",
    input: z.object({ from: isoDate, to: isoDate }),
    run: async ({ from, to }) => spendingSummary(await listTransactions({ from, to, limit: 5000 }), from, to),
  }),
  tool({
    name: "search_transactions",
    description: "List individual transactions, newest first, filtered by date range, category and/or text.",
    input: z.object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      category: z.enum(CATEGORIES).optional(),
      text: z.string().max(100).optional().describe("Matches description or notes"),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    run: async (f) => listTransactions({ ...f, limit: f.limit ?? 50 }),
  }),
  tool({
    name: "calculate",
    description:
      "Evaluate an arithmetic expression exactly (+ - * / ^ and parentheses). Always use this instead of doing math " +
      "yourself, e.g. '3000 * 52 / 12' or '(12000 - 3*1333.33) / 6'.",
    input: z.object({ expression: z.string().min(1).max(500) }),
    run: async ({ expression }) => ({ expression, result: evaluate(expression) }),
  }),
  tool({
    name: "plan_payoff",
    description:
      "Months needed to pay off (or save) an amount with a fixed monthly payment, with optional monthly interest " +
      "rate. Returns month-by-month balances and the finish date.",
    input: z.object({
      amount: z.number().positive(),
      monthly_payment: z.number().positive(),
      monthly_interest_rate_pct: z
        .number()
        .min(0)
        .max(20)
        .optional()
        .describe("e.g. 4.5 for 4.5% per month. Leave out for savings or interest-free debt."),
    }),
    run: async ({ amount, monthly_payment, monthly_interest_rate_pct }) => {
      const r = (monthly_interest_rate_pct ?? 0) / 100;
      if (amount * r >= monthly_payment)
        return { error: "The payment doesn't cover the monthly interest; the balance would never go down." };
      const rows: { month: string; balance: number }[] = [];
      let balance = amount;
      let interestPaid = 0;
      let month = startOfMonth(todayISO());
      while (balance > 0.005 && rows.length < 360) {
        const interest = balance * r;
        interestPaid += interest;
        balance = Math.max(0, balance + interest - monthly_payment);
        month = addMonths(month, 1);
        rows.push({ month: month.slice(0, 7), balance: Math.round(balance * 100) / 100 });
      }
      return {
        months: rows.length,
        finishes: rows.at(-1)?.month,
        total_interest: Math.round(interestPaid * 100) / 100,
        schedule: rows.slice(0, 36),
      };
    },
  }),
  tool({
    name: "list_goals",
    description: "The user's goals (savings targets, debts to pay off, spending limits, habits).",
    input: z.object({ status: z.enum(GOAL_STATUSES).optional() }),
    run: async ({ status }) => listGoals(status),
  }),
  tool({
    name: "save_goal",
    description:
      "Create a goal, or update one by id (e.g. new progress or status). Only after the user agrees to the goal.",
    input: z.object({
      id: z.number().int().positive().optional(),
      title: z.string().min(1).max(200),
      kind: z.enum(GOAL_KINDS),
      target_amount: z.number().nullable().optional(),
      current_amount: z.number().nullable().optional(),
      category: z.enum(CATEGORIES).nullable().optional().describe("For spending_limit goals"),
      target_date: isoDate.nullable().optional(),
      status: z.enum(GOAL_STATUSES).optional(),
      notes: z.string().max(2000).optional(),
    }),
    run: async ({ id, ...g }) => {
      const saved = await saveEntity(
        "goals",
        {
          title: g.title,
          kind: g.kind,
          target_amount: g.target_amount ?? null,
          current_amount: g.current_amount ?? null,
          category: g.category ?? null,
          target_date: g.target_date ?? null,
          status: g.status ?? "active",
          notes: g.notes ?? "",
        },
        id,
      );
      return { saved: true, id: saved };
    },
  }),
  tool({
    name: "log_transaction",
    description:
      "Record a transaction the user tells you about (e.g. cash spent). Negative amount = money out. Confirm the " +
      "details with the user first if anything is ambiguous.",
    input: z.object({
      date: isoDate,
      description: z.string().min(1).max(200),
      amount: z.number(),
      category: z.enum(CATEGORIES),
      account_id: z.number().int().positive().nullable().optional(),
    }),
    run: async (t) =>
      insertTransactions([
        {
          date: t.date,
          description: t.description,
          amount: t.amount,
          category: t.category,
          account_id: t.account_id ?? null,
          notes: "",
          source: "coach",
        },
      ]),
  }),
  tool({
    name: "update_account_balance",
    description:
      "Set an account's current balance when the user tells you a new figure. Debit: money available. Credit card: " +
      "total owed as a positive number. For a credit card you can also set next_due_date (fecha límite of the next " +
      "payment), e.g. after the user pays the current statement or tells you the due date. Get account ids from " +
      "get_financial_overview.",
    input: z.object({
      account_id: z.number().int().positive(),
      balance: z.number(),
      next_due_date: isoDate.nullable().optional().describe("Credit cards only. Leave out to keep the current one."),
    }),
    run: async ({ account_id, balance, next_due_date }) => {
      const data = await loadFinanceData();
      const acc = data.accounts.find((a) => a.id === account_id);
      if (!acc) return { error: `No account with id ${account_id}` };
      const dueDate = next_due_date === undefined ? acc.next_due_date : next_due_date;
      await setAccountBalance(account_id, balance, dueDate);
      const changed = { ...acc, balance, next_due_date: dueDate };
      const updated = { ...data, accounts: data.accounts.map((a) => (a.id === account_id ? changed : a)) };
      const today = todayISO();
      return {
        updated: acc.name,
        balance,
        ...(acc.type === "credit" && {
          revolving_balance_now: revolvingBalance(updated, changed, today),
          revolving_due: revolvingDueDate(changed, today),
          plans_on_card: updated.plans
            .filter((p) => p.active && p.account_id === acc.id)
            .map((p) => planStatus(updated, p, today)),
        }),
      };
    },
  }),
  tool({
    name: "list_payment_targets",
    description:
      "Cards and loans the user can pay, with keys for record_payment, the next due date and roughly how much is due.",
    input: z.object({}),
    run: async () => paymentTargets(await loadFinanceData(), todayISO()),
  }),
  tool({
    name: "record_payment",
    description:
      "Record a payment the user says they made (to a card or a loan): logs it and updates balances, installment " +
      "progress and the card's next due date. Get the target key from list_payment_targets. Confirm the amount, " +
      "date and target with the user before calling if anything is unclear. For a card payment, covers_statement " +
      "means it pays the pending statement (in full or at least the pago para no generar intereses).",
    input: z.object({
      date: isoDate,
      amount: z.number().positive(),
      target: z.string().regex(/^(card|plan):\d+$/).nullable().describe("e.g. 'card:3' or 'plan:5'; null if neither"),
      from_account_id: z.number().int().positive().nullable().describe("Debit account or wallet the money came from"),
      deduct_from_account: z.boolean().describe("Subtract from that account's balance (false if already updated)"),
      reduce_card_balance: z.boolean().optional().describe("Card payments: subtract from the card balance (default true)"),
      covers_statement: z.boolean().optional().describe("Card payments: pays the pending statement (default true)"),
      description: z.string().max(300).optional(),
    }),
    run: async (p) =>
      recordPayment({
        ...p,
        reduce_card_balance: p.reduce_card_balance ?? true,
        covers_statement: p.covers_statement ?? true,
        description: p.description ?? "",
      }),
  }),
  tool({
    name: "remember",
    description:
      "Save a durable fact about the user for future conversations: preferences, circumstances, decisions, " +
      "commitments (e.g. 'Wants to stop ordering food delivery on weekdays'). Not for numbers already stored elsewhere.",
    input: z.object({ fact: z.string().min(3).max(500) }),
    run: async ({ fact }) => ({ saved: true, id: await addMemory(fact) }),
  }),
  tool({
    name: "forget",
    description: "Delete a remembered fact that is wrong or outdated, by id.",
    input: z.object({ id: z.number().int().positive() }),
    run: async ({ id }) => {
      await deleteMemory(id);
      return { deleted: id, remaining: await listMemories() };
    },
  }),
];

export const TOOL_LABELS: Record<string, string> = {
  get_financial_overview: "Reviewing your accounts",
  get_cash_flow: "Checking upcoming payments",
  get_monthly_projection: "Projecting the next months",
  get_spending_summary: "Analyzing your spending",
  search_transactions: "Searching transactions",
  calculate: "Calculating",
  plan_payoff: "Building a payoff plan",
  list_goals: "Looking at your goals",
  save_goal: "Saving a goal",
  log_transaction: "Logging a transaction",
  update_account_balance: "Updating a balance",
  list_payment_targets: "Looking at what's due",
  record_payment: "Recording your payment",
  remember: "Remembering this",
  forget: "Forgetting an outdated note",
};

/** Tool definitions sent to the API. Built once so the request prefix stays identical (prompt caching). */
export const toolDefinitions: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  };
});

/** Validates the (eagerly streamed, therefore unvalidated) input and runs the tool. */
export async function runTool(name: string, input: unknown): Promise<{ content: string; isError: boolean }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: `Unknown tool: ${name}`, isError: true };
  const parsed = t.input.safeParse(input ?? {});
  if (!parsed.success)
    return { content: `Invalid input: ${z.prettifyError(parsed.error)}`, isError: true };
  try {
    // Each entry's run matches its own schema; the array erases that pairing.
    const result = await (t.run as (i: unknown) => Promise<unknown>)(parsed.data);
    return { content: JSON.stringify(result), isError: false };
  } catch (err) {
    return { content: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
