import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { evaluate } from "../calc";
import { addMonths, startOfMonth, todayISO } from "../dates";
import { cashTimeline, monthlyProjection, revolvingBalance, revolvingDueDate, snapshot } from "../engine";
import {
  addMemory,
  deleteMemory,
  deleteTransaction,
  insertTransactions,
  listMemories,
  listTransactions,
  loadFinanceData,
  setSetting,
  updateTransaction,
} from "../repo";
import { deleteRecord, describeRecordFields, listRecords, RECORD_KINDS, saveRecord } from "./records";
import { paymentTargets } from "../payments";
import { recordPayment } from "../record-payment";
import { spendingSummary } from "../spending";
import { CATEGORIES } from "../types";

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
        bills: data.bills
          .filter((b) => b.active)
          .map((b) => ({ id: b.id, name: b.name, amount: b.amount, day_of_month: b.day_of_month, account_id: b.account_id })),
        incomes: data.incomes
          .filter((i) => i.active)
          .map((i) => ({ id: i.id, name: i.name, amount: i.amount, frequency: i.frequency })),
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
      "payments and transfers between own accounts are excluded. Purchases made a meses (installment_purchase) are " +
      "not in total_spent; they're listed in financed_in_installments, because their cost is counted monthly " +
      "through the installment plans. Returns transactions: 0 if no data was imported.",
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
    name: "list_records",
    description:
      "All records of one kind with their ids and every field: accounts (cards, debit, wallets, vouchers), plans " +
      "(installments and loans), bills (recurring payments), incomes, or goals. Use it before changing a record.",
    input: z.object({ kind: z.enum(RECORD_KINDS) }),
    run: async ({ kind }) => listRecords(kind),
  }),
  tool({
    name: "save_record",
    description:
      "Create a record (leave out id) or change an existing one (give its id; only the fields you pass change). " +
      "This is how you edit anything on the user's Plan page: accounts and cards (balance, fecha de corte, next due " +
      "date...), installment plans, recurring bills, income and goals. Fields per kind (* = required for new records):\n" +
      describeRecordFields() +
      "\nNotes: a credit card's balance is what's owed, as a positive number. A bill whose account_id is a credit " +
      "card is counted on that card's payment due date, not on the charge day. To mark a payment as made, use " +
      "record_payment instead of editing a plan. Do what the user asks; if you are inferring a change, confirm first.",
    input: z.object({
      kind: z.enum(RECORD_KINDS),
      id: z.number().int().positive().optional(),
      fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    }),
    run: async ({ kind, id, fields }) => {
      const result = await saveRecord(kind, id, fields);
      if (kind !== "accounts" || !("saved" in result)) return result;
      // For cards, show what the change means for what's due.
      const data = await loadFinanceData();
      const acc = data.accounts.find((a) => a.id === result.id);
      const today = todayISO();
      return acc?.type === "credit"
        ? { ...result, to_pay_in_full_now: revolvingBalance(data, acc, today), next_due: revolvingDueDate(acc, today) }
        : result;
    },
  }),
  tool({
    name: "delete_record",
    description:
      "Permanently delete an account, plan, bill, income or goal. Only when the user explicitly asks or confirms. " +
      "Prefer save_record with active=false (or a goal status of dropped) so history is kept.",
    input: z.object({ kind: z.enum(RECORD_KINDS), id: z.number().int().positive() }),
    run: async ({ kind, id }) => deleteRecord(kind, id),
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
    name: "update_transaction",
    description:
      "Fix a transaction by id (from search_transactions): date, description, amount (negative = money out), " +
      "category, notes or account. Only the fields you pass change.",
    input: z.object({
      id: z.number().int().positive(),
      date: isoDate.optional(),
      description: z.string().min(1).max(300).optional(),
      amount: z.number().optional(),
      category: z.enum(CATEGORIES).optional(),
      notes: z.string().max(500).optional(),
      account_id: z.number().int().positive().nullable().optional(),
    }),
    run: async ({ id, ...changes }) => (await updateTransaction(id, changes)) ?? { error: `No transaction with id ${id}` },
  }),
  tool({
    name: "delete_transaction",
    description: "Delete a transaction by id (e.g. a duplicate). Only when the user asks or confirms.",
    input: z.object({ id: z.number().int().positive() }),
    run: async ({ id }) => {
      const [t] = await listTransactions({ id, limit: 1 });
      if (!t) return { error: `No transaction with id ${id}` };
      await deleteTransaction(id);
      return { deleted: true, was: t };
    },
  }),
  tool({
    name: "set_profile",
    description:
      "Replace the user's profile (\"What the coach knows about you\" on the Plan page), used in new conversations. " +
      "Start from the current profile in your instructions and keep what is still true. For single facts, prefer remember.",
    input: z.object({ profile: z.string().min(1).max(8000) }),
    run: async ({ profile }) => {
      await setSetting("profile", profile);
      return { saved: true };
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
  list_records: "Looking at your plan",
  save_record: "Updating your plan",
  delete_record: "Removing an item",
  log_transaction: "Logging a transaction",
  update_transaction: "Fixing a transaction",
  delete_transaction: "Removing a transaction",
  set_profile: "Updating your profile",
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
