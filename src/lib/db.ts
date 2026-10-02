import "server-only";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createClient, type Client, type InArgs, type Row } from "@libsql/client";
import { seedFilePath, type SeedFile } from "./seed";

// Local SQLite file by default. Point DATABASE_URL at a Turso database
// (libsql://...) with DATABASE_AUTH_TOKEN to host the app later.
const url = process.env.DATABASE_URL ?? "file:data/coach.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  institution TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  credit_limit REAL,
  statement_day INTEGER,
  payment_due_days INTEGER,
  next_due_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  original_amount REAL NOT NULL,
  payment_amount REAL NOT NULL,
  capital_per_payment REAL,
  total_payments INTEGER NOT NULL,
  payments_made INTEGER NOT NULL DEFAULT 0,
  next_payment_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  day_of_month INTEGER NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'other',
  is_estimate INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS incomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  frequency TEXT NOT NULL,
  anchor_date TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  restricted_to TEXT,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_amount REAL,
  current_amount REAL,
  category TEXT,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT 'New conversation',
  system_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { coachDb?: Promise<Client> };

async function init(): Promise<Client> {
  // Vercel's disk is temporary: a local file there would look like an empty app and lose every change.
  if (process.env.VERCEL && url.startsWith("file:"))
    throw new Error("DATABASE_URL is not set. Add DATABASE_URL and DATABASE_AUTH_TOKEN in the Vercel project settings.");
  if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
  await client.execute("PRAGMA foreign_keys = ON");
  await client.executeMultiple(SCHEMA);
  await migrate(client);
  await seedIfEmpty(client);
  return client;
}

export function db(): Promise<Client> {
  globalForDb.coachDb ??= init();
  return globalForDb.coachDb;
}

export async function query<T = Row>(sql: string, args: InArgs = []): Promise<T[]> {
  const res = await (await db()).execute({ sql, args });
  return res.rows as T[];
}

export async function run(sql: string, args: InArgs = []): Promise<number> {
  const res = await (await db()).execute({ sql, args });
  return Number(res.lastInsertRowid ?? 0);
}

/** Adds columns introduced after a database was first created. */
async function migrate(client: Client) {
  const { rows } = await client.execute("PRAGMA table_info(accounts)");
  if (!rows.some((r) => r.name === "next_due_date"))
    await client.execute("ALTER TABLE accounts ADD COLUMN next_due_date TEXT");
  const tx = await client.execute("PRAGMA table_info(transactions)");
  // Links a transaction to the scheduled occurrence it settles ("income:3@2026-10-02").
  if (!tx.rows.some((r) => r.name === "ref")) await client.execute("ALTER TABLE transactions ADD COLUMN ref TEXT");
}

/** Fills an empty database from data/seed.json (git-ignored) if it exists. */
async function seedIfEmpty(client: Client) {
  const { rows } = await client.execute("SELECT COUNT(*) AS n FROM accounts");
  const file = seedFilePath();
  if (Number(rows[0].n) > 0 || !existsSync(file)) return;
  const seed = JSON.parse(readFileSync(file, "utf8")) as SeedFile;

  const ids = new Map<string, number>();
  for (const a of seed.accounts) {
    const res = await client.execute({
      sql: `INSERT INTO accounts (name, institution, type, balance, credit_limit, statement_day, payment_due_days,
              next_due_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        a.name,
        a.institution,
        a.type,
        a.balance,
        a.credit_limit,
        a.statement_day,
        a.payment_due_days,
        a.next_due_date ?? null,
        a.notes,
      ],
    });
    ids.set(a.key, Number(res.lastInsertRowid));
  }
  const acc = (key?: string) => (key ? (ids.get(key) ?? null) : null);

  await client.batch(
    [
      ...seed.plans.map((p) => ({
        sql: `INSERT INTO plans (name, account_id, kind, original_amount, payment_amount, capital_per_payment,
                total_payments, payments_made, next_payment_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          p.name,
          acc(p.account),
          p.kind,
          p.original_amount,
          p.payment_amount,
          p.capital_per_payment,
          p.total_payments,
          p.payments_made,
          p.next_payment_date,
          p.notes,
        ],
      })),
      ...seed.bills.map((b) => ({
        sql: `INSERT INTO bills (name, amount, day_of_month, account_id, category, is_estimate, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [b.name, b.amount, b.day_of_month, acc(b.account), b.category, b.is_estimate ? 1 : 0, b.notes],
      })),
      ...seed.incomes.map((i) => ({
        sql: `INSERT INTO incomes (name, amount, frequency, anchor_date, account_id, restricted_to, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [i.name, i.amount, i.frequency, i.anchor_date, acc(i.account), i.restricted_to, i.notes],
      })),
      { sql: "INSERT INTO settings (key, value) VALUES ('profile', ?)", args: [seed.profile ?? ""] },
    ],
    "write",
  );
}
