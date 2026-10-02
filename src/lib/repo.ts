import "server-only";
import type { Row } from "@libsql/client";
import { addDays, todayISO } from "./dates";
import { query, run } from "./db";
import { settledOccurrences, type RecordedTransaction } from "./settlement";
import { ENTITIES, type EntityKind, type ParsedValue } from "./entities";
import type {
  Account,
  Category,
  CoachMemory,
  FinanceData,
  Goal,
  IncomeSource,
  InstallmentPlan,
  RecurringBill,
  Transaction,
} from "./types";

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const toAccount = (r: Row): Account => ({
  id: Number(r.id),
  name: str(r.name),
  institution: str(r.institution),
  type: str(r.type) as Account["type"],
  balance: Number(r.balance),
  credit_limit: num(r.credit_limit),
  statement_day: num(r.statement_day),
  payment_due_days: num(r.payment_due_days),
  next_due_date: r.next_due_date ? str(r.next_due_date) : null,
  notes: str(r.notes),
  active: Boolean(r.active),
});

const toPlan = (r: Row): InstallmentPlan => ({
  id: Number(r.id),
  name: str(r.name),
  account_id: num(r.account_id),
  kind: str(r.kind) as InstallmentPlan["kind"],
  original_amount: Number(r.original_amount),
  payment_amount: Number(r.payment_amount),
  capital_per_payment: num(r.capital_per_payment),
  total_payments: Number(r.total_payments),
  payments_made: Number(r.payments_made),
  next_payment_date: str(r.next_payment_date),
  notes: str(r.notes),
  active: Boolean(r.active),
});

const toBill = (r: Row): RecurringBill => ({
  id: Number(r.id),
  name: str(r.name),
  amount: Number(r.amount),
  day_of_month: Number(r.day_of_month),
  account_id: num(r.account_id),
  category: str(r.category) as Category,
  is_estimate: Boolean(r.is_estimate),
  notes: str(r.notes),
  active: Boolean(r.active),
});

const toIncome = (r: Row): IncomeSource => ({
  id: Number(r.id),
  name: str(r.name),
  amount: Number(r.amount),
  frequency: str(r.frequency) as IncomeSource["frequency"],
  anchor_date: str(r.anchor_date),
  account_id: num(r.account_id),
  restricted_to: r.restricted_to ? str(r.restricted_to) : null,
  notes: str(r.notes),
  active: Boolean(r.active),
});

const toTransaction = (r: Row): Transaction => ({
  id: Number(r.id),
  account_id: num(r.account_id),
  date: str(r.date),
  description: str(r.description),
  amount: Number(r.amount),
  category: str(r.category) as Category,
  notes: str(r.notes),
  source: str(r.source),
  created_at: str(r.created_at),
});

const toGoal = (r: Row): Goal => ({
  id: Number(r.id),
  title: str(r.title),
  kind: str(r.kind) as Goal["kind"],
  target_amount: num(r.target_amount),
  current_amount: num(r.current_amount),
  category: r.category ? (str(r.category) as Category) : null,
  target_date: r.target_date ? str(r.target_date) : null,
  status: str(r.status) as Goal["status"],
  notes: str(r.notes),
  created_at: str(r.created_at),
});

// ---------- finance data ----------

export async function loadFinanceData(): Promise<FinanceData> {
  const today = todayISO();
  const [accounts, plans, bills, incomes, recent] = await Promise.all([
    query("SELECT * FROM accounts ORDER BY active DESC, type, name"),
    query("SELECT * FROM plans ORDER BY active DESC, next_payment_date"),
    query("SELECT * FROM bills ORDER BY active DESC, day_of_month"),
    query("SELECT * FROM incomes ORDER BY active DESC, name"),
    // Recent movements, to know which scheduled paydays and payments are already done.
    query("SELECT date, amount, account_id, category, ref FROM transactions WHERE date >= ?", [addDays(today, -45)]),
  ]);
  const data: FinanceData = {
    accounts: accounts.map(toAccount),
    plans: plans.map(toPlan),
    bills: bills.map(toBill),
    incomes: incomes.map(toIncome),
  };
  const txs: RecordedTransaction[] = recent.map((r) => ({
    date: str(r.date),
    amount: Number(r.amount),
    account_id: num(r.account_id),
    category: str(r.category),
    ref: r.ref ? str(r.ref) : null,
  }));
  return { ...data, settled: settledOccurrences(data, txs, today) };
}

export async function listEntity(kind: EntityKind): Promise<Record<string, unknown>[]> {
  const order = kind === "goals" ? "status, created_at DESC" : "id";
  const rows = await query(`SELECT * FROM ${ENTITIES[kind].table} ORDER BY ${order}`);
  const cols = ["id", ...ENTITIES[kind].fields.map((f) => f.name)];
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}

export async function saveEntity(kind: EntityKind, values: Record<string, ParsedValue>, id?: number) {
  const def = ENTITIES[kind];
  const cols = def.fields.map((f) => f.name);
  const args = cols.map((c) => values[c] ?? null);
  if (id) {
    await run(`UPDATE ${def.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...args, id]);
    return id;
  }
  return run(`INSERT INTO ${def.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, args);
}

export async function deleteEntity(kind: EntityKind, id: number) {
  await run(`DELETE FROM ${ENTITIES[kind].table} WHERE id = ?`, [id]);
}

export async function setAccountBalance(id: number, balance: number, nextDueDate?: string | null) {
  if (nextDueDate === undefined) await run("UPDATE accounts SET balance = ? WHERE id = ?", [balance, id]);
  else await run("UPDATE accounts SET balance = ?, next_due_date = ? WHERE id = ?", [balance, nextDueDate, id]);
}

// ---------- transactions ----------

export interface TransactionFilter {
  id?: number;
  from?: string;
  to?: string;
  category?: string;
  text?: string;
  accountId?: number;
  limit?: number;
}

export async function listTransactions(f: TransactionFilter = {}): Promise<Transaction[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (clause: string, ...values: (string | number)[]) => {
    where.push(clause);
    args.push(...values);
  };
  if (f.id) add("id = ?", f.id);
  if (f.from) add("date >= ?", f.from);
  if (f.to) add("date <= ?", f.to);
  if (f.category) add("category = ?", f.category);
  if (f.accountId) add("account_id = ?", f.accountId);
  if (f.text) add("(description LIKE ? OR notes LIKE ?)", `%${f.text}%`, `%${f.text}%`);
  const sql = `SELECT * FROM transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY date DESC, id DESC LIMIT ?`;
  const rows = await query(sql, [...args, Math.min(f.limit ?? 500, 5000)]);
  return rows.map(toTransaction);
}

export type NewTransaction = Omit<Transaction, "id" | "created_at">;

/** Inserts transactions, skipping exact duplicates (same account, date, amount and description). */
export async function insertTransactions(list: NewTransaction[]): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const t of list) {
    const dup = await query(
      `SELECT id FROM transactions WHERE account_id IS ? AND date = ? AND amount = ? AND description = ? LIMIT 1`,
      [t.account_id, t.date, t.amount, t.description],
    );
    if (dup.length) continue;
    await run(
      `INSERT INTO transactions (account_id, date, description, amount, category, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [t.account_id, t.date, t.description, t.amount, t.category, t.notes, t.source],
    );
    inserted++;
  }
  return { inserted, skipped: list.length - inserted };
}

export async function updateTransactionCategory(id: number, category: Category) {
  await run("UPDATE transactions SET category = ? WHERE id = ?", [category, id]);
}

export type TransactionChanges = Partial<Pick<Transaction, "date" | "description" | "amount" | "category" | "notes" | "account_id">>;

/** Changes only the given columns; returns the updated row, or null if it doesn't exist. */
export async function updateTransaction(id: number, changes: TransactionChanges): Promise<Transaction | null> {
  const cols = (Object.keys(changes) as (keyof TransactionChanges)[]).filter((k) => changes[k] !== undefined);
  if (cols.length)
    await run(`UPDATE transactions SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...cols.map((c) => changes[c] ?? null),
      id,
    ]);
  const rows = await query("SELECT * FROM transactions WHERE id = ?", [id]);
  return rows.length ? toTransaction(rows[0]) : null;
}

export async function deleteTransaction(id: number) {
  await run("DELETE FROM transactions WHERE id = ?", [id]);
}

// ---------- goals ----------

export async function listGoals(status?: Goal["status"]): Promise<Goal[]> {
  const rows = status
    ? await query("SELECT * FROM goals WHERE status = ? ORDER BY created_at DESC", [status])
    : await query("SELECT * FROM goals ORDER BY status, created_at DESC");
  return rows.map(toGoal);
}

// ---------- coach memory & profile ----------

export async function listMemories(): Promise<CoachMemory[]> {
  const rows = await query("SELECT * FROM memories ORDER BY id");
  return rows.map((r) => ({ id: Number(r.id), content: str(r.content), created_at: str(r.created_at) }));
}

export async function addMemory(content: string) {
  return run("INSERT INTO memories (content) VALUES (?)", [content.slice(0, 1000)]);
}

export async function deleteMemory(id: number) {
  await run("DELETE FROM memories WHERE id = ?", [id]);
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query("SELECT value FROM settings WHERE key = ?", [key]);
  return rows.length ? str(rows[0].value) : null;
}

export async function setSetting(key: string, value: string) {
  await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [
    key,
    value,
  ]);
}

// ---------- conversations ----------

export interface ConversationSummary {
  id: number;
  title: string;
  updated_at: string;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const rows = await query("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50");
  return rows.map((r) => ({ id: Number(r.id), title: str(r.title), updated_at: str(r.updated_at) }));
}

export async function createConversation(title: string, systemPrompt: string) {
  return run("INSERT INTO conversations (title, system_prompt) VALUES (?, ?)", [title.slice(0, 80), systemPrompt]);
}

export async function getConversation(id: number) {
  const rows = await query("SELECT * FROM conversations WHERE id = ?", [id]);
  if (!rows.length) return null;
  const messages = await query("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id", [id]);
  return {
    id,
    title: str(rows[0].title),
    system_prompt: str(rows[0].system_prompt),
    messages: messages.map((m) => ({ role: str(m.role) as "user" | "assistant", content: JSON.parse(str(m.content)) })),
  };
}

/** Appends messages in order. History is append-only: stored turns are never edited. */
export async function appendMessages(conversationId: number, messages: { role: string; content: unknown }[]) {
  for (const m of messages)
    await run("INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)", [
      conversationId,
      m.role,
      JSON.stringify(m.content),
    ]);
  await run("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [conversationId]);
}

export async function deleteConversation(id: number) {
  await run("DELETE FROM messages WHERE conversation_id = ?", [id]);
  await run("DELETE FROM conversations WHERE id = ?", [id]);
}
