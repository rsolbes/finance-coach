import "server-only";
import { query, run } from "./db";
import { diffDays, todayISO } from "./dates";
import { planStatus, round2 } from "./engine";
import { loadFinanceData } from "./repo";
import type { DebtBreakdown, DebtBreakdownItem, DebtEvolution, DebtSnapshot, FinanceData } from "./types";

const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));

export function calculateCurrentDebt(
  data: FinanceData,
  today: string,
): {
  total_debt: number;
  cards_debt: number;
  loans_debt: number;
  breakdown: DebtBreakdown;
} {
  const creditAccounts = data.accounts.filter((a) => a.active && a.type === "credit");
  const creditAccountIds = new Set(creditAccounts.map((a) => a.id));

  const cards: DebtBreakdownItem[] = creditAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    amount: round2(a.balance),
    detail: a.statement_balance != null ? `Corte: $${a.statement_balance.toFixed(2)}` : undefined,
  }));

  // Non-card installment plans (loans like Mercado Pago, device financing, etc.)
  const nonCardPlans = data.plans.filter((p) => p.active && (!p.account_id || !creditAccountIds.has(p.account_id)));
  const loans: DebtBreakdownItem[] = nonCardPlans.map((p) => {
    const s = planStatus(data, p, today);
    return {
      id: p.id,
      name: p.name,
      amount: s.remaining_total,
      kind: p.kind,
      detail: `${s.payments_left} pagos restantes (${s.next_payment ?? ""})`,
    };
  });

  const cards_debt = sum(cards.map((c) => c.amount));
  const loans_debt = sum(loans.map((l) => l.amount));
  const total_debt = round2(cards_debt + loans_debt);

  return {
    total_debt,
    cards_debt,
    loans_debt,
    breakdown: { cards, loans },
  };
}

export interface RecordSnapshotOptions {
  date?: string;
  total_debt?: number;
  cards_debt?: number;
  loans_debt?: number;
  breakdown?: DebtBreakdown;
  source?: string;
  notes?: string;
  data?: FinanceData;
}

export async function recordDebtSnapshot(options: RecordSnapshotOptions = {}): Promise<DebtSnapshot> {
  const date = options.date ?? todayISO();
  let total_debt = options.total_debt;
  let cards_debt = options.cards_debt;
  let loans_debt = options.loans_debt;
  let breakdown = options.breakdown;

  if (total_debt === undefined || cards_debt === undefined || loans_debt === undefined || breakdown === undefined) {
    const data = options.data ?? (await loadFinanceData());
    const computed = calculateCurrentDebt(data, date);
    total_debt ??= computed.total_debt;
    cards_debt ??= computed.cards_debt;
    loans_debt ??= computed.loans_debt;
    breakdown ??= computed.breakdown;
  }

  const source = options.source ?? "auto";
  const notes = (options.notes ?? "").trim();
  const breakdownJson = JSON.stringify(breakdown);

  await run(
    `INSERT INTO debt_snapshots (date, total_debt, cards_debt, loans_debt, breakdown, source, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       total_debt = excluded.total_debt,
       cards_debt = excluded.cards_debt,
       loans_debt = excluded.loans_debt,
       breakdown = excluded.breakdown,
       source = excluded.source,
       notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE debt_snapshots.notes END,
       created_at = datetime('now')`,
    [date, total_debt, cards_debt, loans_debt, breakdownJson, source, notes],
  );

  const rows = await query("SELECT * FROM debt_snapshots WHERE date = ? LIMIT 1", [date]);
  return toSnapshot(rows[0]);
}

export async function listDebtSnapshots(options: { from?: string; to?: string; limit?: number } = {}): Promise<DebtSnapshot[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (options.from) {
    where.push("date >= ?");
    args.push(options.from);
  }
  if (options.to) {
    where.push("date <= ?");
    args.push(options.to);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limitClause = options.limit ? `LIMIT ${options.limit}` : "";

  const rows = await query(`SELECT * FROM debt_snapshots ${whereClause} ORDER BY date ASC ${limitClause}`, args);
  return rows.map(toSnapshot);
}

export async function ensureInitialDebtSnapshots(providedData?: FinanceData): Promise<void> {
  const existing = await query("SELECT COUNT(*) AS count FROM debt_snapshots");
  if (Number(existing[0]?.count ?? 0) > 0) return;

  const today = todayISO();
  const baselineDate = "2026-10-01";

  // 1. Initial baseline point (start of the project)
  const initialCards: DebtBreakdownItem[] = [
    { id: 2, name: "BBVA Azul", amount: 13440.95 },
    { id: 3, name: "RappiCard", amount: 9565.7 },
    { id: 4, name: "Nu Crédito", amount: 2747.91 },
  ];
  const initialLoans: DebtBreakdownItem[] = [
    { id: 5, name: "Mercado Pago credit 1", amount: 13240.38, kind: "loan", detail: "6 pagos restantes" },
    { id: 6, name: "Mercado Pago credit 2", amount: 2639.49, kind: "loan", detail: "3 pagos restantes" },
  ];
  const initialCardsDebt = sum(initialCards.map((c) => c.amount));
  const initialLoansDebt = sum(initialLoans.map((l) => l.amount));

  await recordDebtSnapshot({
    date: baselineDate,
    total_debt: round2(initialCardsDebt + initialLoansDebt),
    cards_debt: initialCardsDebt,
    loans_debt: initialLoansDebt,
    breakdown: { cards: initialCards, loans: initialLoans },
    source: "baseline",
    notes: "Punto de partida al iniciar el proyecto (1 oct 2026)",
  });

  // 2. Current live snapshot (if today is different from baseline)
  if (today > baselineDate) {
    const data = providedData ?? (await loadFinanceData());
    await recordDebtSnapshot({
      date: today,
      data,
      source: "auto",
      notes: "Estado actual de deudas",
    });
  }
}

export async function getDebtEvolution(options: { from?: string; to?: string } = {}): Promise<DebtEvolution> {
  await ensureInitialDebtSnapshots();
  const snapshots = await listDebtSnapshots(options);

  if (snapshots.length === 0) {
    return {
      snapshots: [],
      current: null,
      baseline: null,
      change_from_baseline: null,
      days_tracked: 0,
    };
  }

  const baseline = snapshots[0];
  const current = snapshots[snapshots.length - 1];

  let change_from_baseline: DebtEvolution["change_from_baseline"] = null;
  if (baseline && current) {
    const amount = round2(current.total_debt - baseline.total_debt);
    const pct = baseline.total_debt > 0 ? round2((amount / baseline.total_debt) * 100) : 0;
    const direction = amount < -0.01 ? "down" : amount > 0.01 ? "up" : "same";
    const cards_amount = round2(current.cards_debt - baseline.cards_debt);
    const loans_amount = round2(current.loans_debt - baseline.loans_debt);

    change_from_baseline = {
      amount,
      pct,
      direction,
      cards_amount,
      loans_amount,
    };
  }

  const days_tracked = baseline && current ? Math.max(0, diffDays(current.date, baseline.date)) : 0;

  return {
    snapshots,
    current,
    baseline,
    change_from_baseline,
    days_tracked,
  };
}

export async function deleteDebtSnapshot(id: number): Promise<void> {
  await run("DELETE FROM debt_snapshots WHERE id = ?", [id]);
}

function toSnapshot(r: Record<string, unknown>): DebtSnapshot {
  let breakdown: DebtBreakdown = { cards: [], loans: [] };
  if (typeof r.breakdown === "string") {
    try {
      breakdown = JSON.parse(r.breakdown);
    } catch {
      breakdown = { cards: [], loans: [] };
    }
  }
  return {
    id: Number(r.id),
    date: String(r.date),
    total_debt: Number(r.total_debt ?? 0),
    cards_debt: Number(r.cards_debt ?? 0),
    loans_debt: Number(r.loans_debt ?? 0),
    breakdown,
    source: String(r.source ?? "auto"),
    notes: String(r.notes ?? ""),
    created_at: String(r.created_at ?? ""),
  };
}
