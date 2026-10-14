import { todayISO } from "@/lib/dates";
import { getSetting, listGoals, listMemories, listTransactions, loadFinanceData } from "@/lib/repo";
import { requireAuth } from "@/lib/session";

export async function GET() {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayISO();
  const [data, goals, profile, cashBuffer, memories, transactions] = await Promise.all([
    loadFinanceData(),
    listGoals(),
    getSetting("profile"),
    getSetting("cash_buffer"),
    listMemories(),
    listTransactions({ limit: 10000 }),
  ]);

  const accountKeys = new Map<number, string>();
  const accounts = data.accounts.map((a) => {
    const key = `acc_${a.id}_${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    accountKeys.set(a.id, key);
    return {
      key,
      name: a.name,
      institution: a.institution,
      type: a.type,
      balance: a.balance,
      credit_limit: a.credit_limit,
      statement_day: a.statement_day,
      payment_due_days: a.payment_due_days,
      next_due_date: a.next_due_date,
      notes: a.notes,
    };
  });

  const plans = data.plans.map((p) => ({
    name: p.name,
    account: p.account_id ? accountKeys.get(p.account_id) : undefined,
    kind: p.kind,
    original_amount: p.original_amount,
    payment_amount: p.payment_amount,
    capital_per_payment: p.capital_per_payment,
    payments_made: p.payments_made,
    total_payments: p.total_payments,
    next_payment_date: p.next_payment_date,
    notes: p.notes,
  }));

  const bills = data.bills.map((b) => ({
    name: b.name,
    account: b.account_id ? accountKeys.get(b.account_id) : undefined,
    amount: b.amount,
    day_of_month: b.day_of_month,
    is_estimate: b.is_estimate,
    notes: b.notes,
  }));

  const incomes = data.incomes.map((i) => ({
    name: i.name,
    account: i.account_id ? accountKeys.get(i.account_id) : undefined,
    amount: i.amount,
    frequency: i.frequency,
    anchor_date: i.anchor_date,
    restricted_to: i.restricted_to,
    notes: i.notes,
  }));

  const backup = {
    _meta: {
      app: "Finance Coach",
      exported_at: new Date().toISOString(),
      version: 1,
    },
    profile: profile ?? "",
    cash_buffer: cashBuffer ? Number(cashBuffer) : 2000,
    accounts,
    plans,
    bills,
    incomes,
    goals,
    memories,
    transactions,
  };

  const filename = `finance-backup-${today}.json`;
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
